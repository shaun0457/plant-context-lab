/**
 * LLM activity feed for the connected viewer.
 *
 * Every MCP request the server answers (tool calls, resource reads, prompt gets,
 * list calls) becomes one short record: what was called, with which arguments,
 * at which snapshot, and a one-line summary of the result. The viewer shows the
 * records live, so a session in which the LLM only reads and simulates is still
 * visible.
 *
 * The log observes the MCP transport (incoming requests, outgoing responses), so
 * it also sees schema-validation errors and unknown tools, and it never changes
 * a result. It is shared by every MCP connection of the process (stdio and the
 * stateless Streamable HTTP endpoint).
 *
 * SDK behaviour this relies on (@modelcontextprotocol/sdk 1.31.0, pinned exactly
 * in package.json so an upgrade is a deliberate, tested change):
 *   - Protocol.connect() chains a transport's pre-set onmessage and onclose
 *     handlers instead of replacing them;
 *   - every response is sent through transport.send().
 * test/activity.test.ts checks both (records appear, results are unchanged).
 *
 * Rules:
 *   - Summaries are built only from tool results, which never reveal the active
 *     scenario, and from the request arguments. No record names the scenario.
 *   - Everything the client sends (arguments, rationale, client name and version)
 *     is untrusted: control, format and bidi characters are stripped and each
 *     field is length-capped here. The page escapes it again before display.
 *   - The log is a bounded ring (ACTIVITY_CAP records). Repeated handshakes from
 *     the same client are not logged again, so they cannot evict tool records.
 *   - Observing must never break the MCP path: every hook swallows its own errors.
 */
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const ACTIVITY_CAP = 200;
export const MAX_ARGS_LEN = 160;
export const MAX_ARG_VALUE_LEN = 40;
export const MAX_ARG_KEYS = 8;
export const MAX_ARG_DEPTH = 2;
export const MAX_SUMMARY_LEN = 200;
export const MAX_RATIONALE_LEN = 300;
export const MAX_NAME_LEN = 64;
export const MAX_CLIENT_FIELD_LEN = 64;
/** how long a simulation overlay stays meaningful for a viewer that connects later */
export const SIM_OVERLAY_TTL_MS = 120_000;
/** the same client re-initializing within this window adds no new session record */
export const SESSION_RELOG_MS = 10 * 60_000;
const MAX_PENDING = 64;

export type ActivityKind = 'tool' | 'resource' | 'prompt' | 'list' | 'session';
export type ActivityOutcome = 'ok' | 'error' | 'ACCEPT' | 'REJECT';

export interface ActivityRecord {
  seq: number;
  /** wall time, ISO 8601 */
  ts: string;
  kind: ActivityKind;
  /** tool name, resource uri, prompt name or method */
  name: string;
  /** short argument summary (untrusted text, capped) */
  args: string;
  snapshot: string | null;
  outcome: ActivityOutcome;
  /** one-line result summary */
  summary: string;
  /** propose_adjustment only (untrusted text, capped) */
  rationale?: string;
  applied?: boolean;
  /** element keys the call was about (topology / engineering context) */
  focus?: string[];
  /** element keys reached by a topology impact query */
  reach?: string[];
}

export interface SimPoint { min: number; 'XMEAS(9)': number; 'XMEAS(7)': number; 'XMEAS(21)': number; 'XMV(10)': number }

/** the latest simulate_adjustment, for the dashed overlay on the trend charts */
export interface SimOverlay {
  seq: number;
  /** wall time in ms when it was recorded */
  at: number;
  snapshot: { id: string; T_h: number; K: number };
  xmv: string;
  target: number;
  current: number | null;
  minutes: number;
  withChange: SimPoint[];
  noChange: SimPoint[];
}

export interface McpClientInfo {
  name: string;
  version: string;
  protocol: string;
  /** true once the client sent notifications/initialized (or any later request) */
  initialized: boolean;
  /** false once the connection that initialized it closed (stdio / in-memory) */
  connected: boolean;
  /** wall time, ISO 8601, of the first initialize of this client identity */
  since: string;
}

export interface ActivityUpdate {
  record: ActivityRecord | null;
  client: McpClientInfo | null;
  sim?: SimOverlay;
  /** the plant changed (applied proposal, human control): drop any simulation overlay */
  simCleared?: boolean;
}

export interface ActivityState {
  cap: number;
  seq: number;
  client: McpClientInfo | null;
  records: ActivityRecord[];
  /** latest simulation overlay with its age, or null once older than SIM_OVERLAY_TTL_MS or invalidated */
  sim: (SimOverlay & { ageMs: number }) | null;
}

export interface ActivityOptions {
  cap?: number;
  now?: () => number;
  /** snapshot id of the live plant, for records whose result carries none */
  snapshot?: () => string | null;
}

export interface ObserveOptions {
  /**
   * The transport is one long-lived connection (stdio, in-memory): its close
   * means the client is gone. Not for stateless HTTP, where every request has
   * its own short-lived transport.
   */
  trackClose?: boolean;
}

// C0/C1 controls, soft hyphen, Arabic letter mark, Mongolian vowel separator,
// zero-width, line/paragraph separators, bidi embeddings / overrides / isolates,
// word joiner and invisible operators, BOM, interlinear annotation, tag characters.
const UNSAFE_RANGES: [number, number][] = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x061c, 0x061c], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];
// built from code points so the source holds no invisible characters
const UNSAFE = new RegExp('[' + UNSAFE_RANGES.map(([a, b]) => String.fromCodePoint(a) + (b > a ? '-' + String.fromCodePoint(b) : '')).join('') + ']', 'gu');

/** Untrusted text: strip control, format and bidi characters, collapse whitespace, cap the length. */
export function cleanText(v: unknown, max: number): string {
  let s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  if (s.length > max * 4) s = s.slice(0, max * 4);
  s = s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, Math.max(0, max - 1));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // never split a surrogate pair
  return cut + '…';
}

function argValue(v: unknown, depth = 0): string {
  if (Array.isArray(v)) {
    if (depth >= MAX_ARG_DEPTH) return '[…]';
    return '[' + v.slice(0, 8).map((x) => argValue(x, depth + 1)).join(',') + (v.length > 8 ? ',…' : '') + ']';
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object') return '{…}';
  return cleanText(v, MAX_ARG_VALUE_LEN);
}

/** Short `key=value` summary of request arguments (at most MAX_ARG_KEYS keys); skipped keys are reported elsewhere. */
export function summarizeArgs(args: unknown, skip: string[] = []): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args === undefined ? '' : cleanText(argValue(args), MAX_ARGS_LEN);
  const parts: string[] = [];
  for (const k in args as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(args, k) || skip.includes(k)) continue;
    parts.push(cleanText(k, 24) + '=' + argValue((args as Record<string, unknown>)[k]));
    if (parts.length >= MAX_ARG_KEYS) break;
  }
  return cleanText(parts.join(' '), MAX_ARGS_LEN);
}

const num = (v: unknown, d = 2): string => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '–');
const short = (v: number): string => String(+v.toFixed(2));
const sigDigits = (id: string): number => (id === 'XMEAS(7)' ? 1 : 2);

interface Summary {
  outcome: ActivityOutcome;
  summary: string;
  snapshot?: string | null;
  focus?: string[];
  reach?: string[];
  applied?: boolean;
  sim?: Omit<SimOverlay, 'seq' | 'at'>;
}

type Obj = Record<string, any>;

/** the request arguments a summary may use */
export interface ToolArgs { xmv?: unknown; target?: unknown }

function pcaText(p: Obj | null | undefined): string {
  if (!p) return 'PCA n/a';
  if (p.exceeded?.any) {
    const spe = !!p.exceeded.spe;
    return 'PCA ' + (spe ? 'SPE ' + num(p.spe) + ' > ' + num(p.speLimit) : 'T² ' + num(p.t2) + ' > ' + num(p.t2Limit));
  }
  return 'PCA within limits (score ' + num(p.score) + '×)';
}

/** One-line summary of a tool result (the parsed JSON the tool returned). */
export function summarizeToolResult(name: string, args: ToolArgs, r: Obj): Summary {
  const snapshot = typeof r?.snapshot?.id === 'string' ? r.snapshot.id : null;
  if (!r || r.ok !== true) return { outcome: 'error', summary: cleanText(r?.error ?? 'error', MAX_SUMMARY_LEN), snapshot };
  const out = (summary: string, extra: Partial<Summary> = {}): Summary => ({ outcome: 'ok', summary: cleanText(summary, MAX_SUMMARY_LEN), snapshot, ...extra });
  switch (name) {
    case 'get_plant_overview': {
      const s = r.safetySummary || {};
      const pca = s.pcaScore === null || s.pcaScore === undefined ? 'PCA n/a' : 'PCA score ' + num(s.pcaScore) + '×' + (s.pcaExceeded ? ' (above limit)' : '');
      return out('rules ' + s.worstRuleState + ', ' + pca + ', loop ' + r.loop?.mode + ' ' + num(r.loop?.output, 1) + ' %, ' + (r.modelled?.signals?.length ?? 0) + ' modelled signals');
    }
    case 'get_signals': {
      const sigs: Obj[] = Array.isArray(r.signals) ? r.signals : [];
      let s = sigs.slice(0, 4).map((x) => x.id + ' ' + num(x.latest, sigDigits(x.id))).join(', ') + (sigs.length > 4 ? ', +' + (sigs.length - 4) : '');
      s = (s || 'no known signals') + ' (latest, ' + num(r.windowMinutes, 1) + ' min window)';
      if (r.unknownIds?.length) s += '; unknown ' + r.unknownIds.length;
      if (r.droppedIds?.length) s += '; dropped ' + r.droppedIds.length;
      return out(s);
    }
    case 'get_safety_state': {
      const w = r.rules?.worst || {};
      const top = r.pca?.contributors?.[0]?.signal;
      return out('rules ' + w.state + (w.ruleId ? ' (' + w.ruleId + ')' : '') + ', ' + pcaText(r.pca) + (top ? ', top ' + top : '') + ', loop ' + r.loop?.mode + ' ' + num(r.loop?.output, 1) + ' %');
    }
    case 'get_topology_impact': {
      const im = r.impact || {};
      const start = String(im.start || '');
      const reach: string[] = [];
      for (const h of im.hops || []) for (const e of h.elements || []) reach.push(String(e.key));
      const closed = (im.loops || []).filter((l: Obj) => l.closed).map((l: Obj) => l.name);
      return out('from ' + start + ', ' + im.maxHops + ' hops: ' + Math.max(0, (im.reachableCount ?? 1) - 1) + ' elements reachable' + (closed.length ? ', closed loop: ' + closed.join(', ') : ''), { focus: start ? [start] : [], reach });
    }
    case 'get_engineering_context': {
      const c = r.context || {};
      const key = String(c.element?.key || '');
      return out((c.element?.label || key) + ' (' + key + '): ' + (c.signals?.length ?? 0) + ' signals, ' + (c.rules?.length ?? 0) + ' rules, ' + (c.knowledge?.length ?? 0) + ' knowledge items', { focus: key ? [key] : [] });
    }
    case 'simulate_adjustment': {
      const inp = r.input || {};
      const w = r.withChange || {};
      const n = r.noChange || {};
      const pick = (t: Obj[]): SimPoint[] => (Array.isArray(t) ? t.slice(0, 64).map((p) => ({ min: +p.min, 'XMEAS(9)': +p['XMEAS(9)'], 'XMEAS(7)': +p['XMEAS(7)'], 'XMEAS(21)': +p['XMEAS(21)'], 'XMV(10)': +p['XMV(10)'] })) : []);
      const xmv = cleanText(inp.xmv, 16);
      const summary = 'simulate ' + xmv + ' ' + num(inp.current, 1) + ' -> ' + short(Number(inp.target)) + ' % (' + short(Number(w.horizonMin ?? inp.minutes)) + ' min): worst ' + w.worstRuleState
        + (n.worstRuleState && n.worstRuleState !== w.worstRuleState ? ' (no change ' + n.worstRuleState + ')' : '')
        + ', end XMEAS(9) ' + num(w.end?.['XMEAS(9)'], 1) + ' vs ' + num(n.end?.['XMEAS(9)'], 1) + ' without'
        + (w.meanSpe !== null && w.meanSpe !== undefined ? ', mean SPE ' + num(w.meanSpe) + ' vs ' + num(n.meanSpe) : '');
      const snap = r.snapshot && typeof r.snapshot.K === 'number' ? { id: cleanText(r.snapshot.id, 48), T_h: +r.snapshot.T_h, K: +r.snapshot.K } : null;
      return out(summary, snap ? {
        sim: { snapshot: snap, xmv, target: Number(inp.target), current: typeof inp.current === 'number' ? inp.current : null, minutes: Number(w.horizonMin ?? inp.minutes), withChange: pick(w.trajectory), noChange: pick(n.trajectory) },
      } : {});
    }
    case 'propose_adjustment': {
      const codes = (r.reasons || []).map((x: Obj) => x.code).join(', ');
      const xmv = cleanText(args?.xmv, 16) || '?';
      const target = typeof args?.target === 'number' ? short(args.target) : cleanText(args?.target, 16);
      const verdict: ActivityOutcome = r.verdict === 'ACCEPT' ? 'ACCEPT' : 'REJECT';
      const tail = verdict === 'ACCEPT' ? (r.applied ? ', applied (loop MANUAL)' : ', not applied') : (codes ? ' ' + codes : '');
      return { outcome: verdict, summary: cleanText('propose ' + xmv + ' -> ' + target + ' %: ' + verdict + tail, MAX_SUMMARY_LEN), snapshot, applied: !!r.applied };
    }
    case 'get_gate_log': {
      const e: Obj[] = Array.isArray(r.entries) ? r.entries : [];
      return out(e.length + ' of ' + r.total + ' entries' + (e[0] ? ', newest #' + e[0].seq + ' ' + e[0].verdict : ''));
    }
    default:
      return out('ok');
  }
}

/** What is kept of a request until its response: only the fields a record uses, already capped. */
export interface Pending {
  method: string;
  /** tool / prompt name, resource uri */
  name: string;
  args: string;
  rationale?: string;
  toolArgs?: ToolArgs;
}

function pendingOf(method: string, params: Obj): Pending {
  const p = params && typeof params === 'object' ? params : {};
  if (method === 'tools/call') {
    const name = cleanText(p.name, MAX_NAME_LEN) || '?';
    const a: Obj = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? p.arguments : {};
    return {
      method, name,
      args: summarizeArgs(a, ['rationale']),
      toolArgs: { xmv: typeof a.xmv === 'string' ? cleanText(a.xmv, 32) : undefined, target: typeof a.target === 'number' ? a.target : cleanText(a.target, 16) },
      ...(name === 'propose_adjustment' && a.rationale !== undefined ? { rationale: cleanText(a.rationale, MAX_RATIONALE_LEN) } : {}),
    };
  }
  if (method === 'resources/read') return { method, name: cleanText(p.uri, MAX_NAME_LEN) || '?', args: '' };
  if (method === 'prompts/get') return { method, name: cleanText(p.name, MAX_NAME_LEN) || '?', args: summarizeArgs(p.arguments) };
  return { method, name: cleanText(method, MAX_NAME_LEN), args: '' };
}

const LIST_NOUN: Record<string, [string, string]> = {
  'tools/list': ['tools', 'tools'],
  'resources/list': ['resources', 'resources'],
  'resources/templates/list': ['resourceTemplates', 'resource templates'],
  'prompts/list': ['prompts', 'prompts'],
};
const IGNORED = new Set(['ping', 'initialize']);

export class ActivityLog {
  readonly cap: number;
  records: ActivityRecord[] = [];
  seq = 0;
  client: McpClientInfo | null = null;
  lastSim: SimOverlay | null = null;
  private readonly now: () => number;
  private readonly snap: () => string | null;
  private readonly listeners = new Set<(u: ActivityUpdate) => void>();
  private readonly observed = new WeakSet<Transport>();
  private connSeq = 0;
  /** connection that owns `client` (only for connections with trackClose) */
  private clientConn = 0;
  private lastSession: { key: string; at: number } | null = null;

  constructor(opt: ActivityOptions = {}) {
    this.cap = Math.max(1, opt.cap ?? ACTIVITY_CAP);
    this.now = opt.now ?? (() => Date.now());
    this.snap = opt.snapshot ?? (() => null);
  }

  subscribe(fn: (u: ActivityUpdate) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(u: ActivityUpdate): void {
    for (const fn of this.listeners) {
      try { fn(u); } catch { /* a viewer must never break the MCP path */ }
    }
  }

  add(rec: Omit<ActivityRecord, 'seq' | 'ts' | 'snapshot'> & { snapshot?: string | null }, sim?: Omit<SimOverlay, 'seq' | 'at'>): ActivityRecord {
    const t = this.now();
    const r: ActivityRecord = {
      seq: ++this.seq,
      ts: new Date(t).toISOString(),
      kind: rec.kind,
      name: cleanText(rec.name, MAX_NAME_LEN),
      args: cleanText(rec.args, MAX_ARGS_LEN),
      snapshot: rec.snapshot === undefined || rec.snapshot === null ? this.snap() : cleanText(rec.snapshot, 48),
      outcome: rec.outcome,
      summary: cleanText(rec.summary, MAX_SUMMARY_LEN),
      ...(rec.rationale !== undefined ? { rationale: cleanText(rec.rationale, MAX_RATIONALE_LEN) } : {}),
      ...(rec.applied !== undefined ? { applied: rec.applied } : {}),
      ...(rec.focus?.length ? { focus: rec.focus.slice(0, 4).map((k) => cleanText(k, 64)) } : {}),
      ...(rec.reach?.length ? { reach: rec.reach.slice(0, 40).map((k) => cleanText(k, 64)) } : {}),
    };
    this.records.push(r);
    while (this.records.length > this.cap) this.records.shift();
    let overlay: SimOverlay | undefined;
    if (sim) { overlay = { ...sim, seq: r.seq, at: t }; this.lastSim = overlay; }
    this.emit({ record: r, client: this.client, ...(overlay ? { sim: overlay } : {}) });
    return r;
  }

  /**
   * The live plant changed (an applied proposal, a human control, a scenario
   * change): a simulation from before no longer describes what will happen.
   */
  invalidateSim(): void {
    if (!this.lastSim) return;
    this.lastSim = null;
    this.emit({ record: null, client: this.client, simCleared: true });
  }

  /** initialize request seen: remember the client (untrusted fields are capped). */
  clientInitializing(params: Obj, conn = 0): void {
    const info = params?.clientInfo || {};
    const name = cleanText(info.name, MAX_CLIENT_FIELD_LEN) || 'unknown client';
    const version = cleanText(info.version, MAX_CLIENT_FIELD_LEN);
    const protocol = cleanText(params?.protocolVersion, 32);
    const same = this.client && this.client.name === name && this.client.version === version;
    this.client = { name, version, protocol, initialized: false, connected: true, since: same ? this.client!.since : new Date(this.now()).toISOString() };
    this.clientConn = conn;
  }

  /** the client finished the handshake (notifications/initialized, or any later request). */
  clientInitialized(): void {
    if (!this.client) this.client = { name: 'unknown client', version: '', protocol: '', initialized: false, connected: true, since: new Date(this.now()).toISOString() };
    if (this.client.initialized) return;
    this.client.initialized = true;
    this.client.connected = true;
    const c = this.client;
    const key = c.name + '|' + c.version + '|' + c.protocol;
    const t = this.now();
    if (this.lastSession && this.lastSession.key === key && t - this.lastSession.at < SESSION_RELOG_MS) {
      this.emit({ record: null, client: c }); // same client again: update the header, no new record
      return;
    }
    this.lastSession = { key, at: t };
    this.add({ kind: 'session', name: 'initialize', args: '', outcome: 'ok', summary: 'MCP client ' + c.name + (c.version ? ' ' + c.version : '') + ' connected' + (c.protocol ? ' (protocol ' + c.protocol + ')' : '') });
  }

  /** a tracked connection closed; if it owned the client, the client is gone. */
  connectionClosed(conn: number): void {
    if (!this.client || !this.client.connected || conn === 0 || conn !== this.clientConn) return;
    this.client.connected = false;
    this.lastSession = null; // a reconnect is worth a record
    const c = this.client;
    this.add({ kind: 'session', name: 'close', args: '', outcome: 'ok', summary: 'MCP client ' + c.name + (c.version ? ' ' + c.version : '') + ' disconnected' });
  }

  state(): ActivityState {
    const age = this.lastSim ? this.now() - this.lastSim.at : Infinity;
    return {
      cap: this.cap,
      seq: this.seq,
      client: this.client,
      records: this.records.slice(),
      sim: this.lastSim && age <= SIM_OVERLAY_TTL_MS ? { ...this.lastSim, ageMs: age } : null,
    };
  }

  /** Record a finished request from its JSON-RPC response. */
  recordResponse(p: Pending, msg: Obj): void {
    const { method } = p;
    const err = msg.error ? cleanText(msg.error.message ?? 'error', MAX_SUMMARY_LEN) : null;
    const result: Obj = msg.result || {};
    if (method === 'tools/call') {
      const base = { kind: 'tool' as const, name: p.name, args: p.args, ...(p.rationale !== undefined ? { rationale: p.rationale } : {}) };
      const text = Array.isArray(result.content) && typeof result.content[0]?.text === 'string' ? result.content[0].text : '';
      if (err || result.isError) { this.add({ ...base, outcome: 'error', summary: err || cleanText(text || 'error', MAX_SUMMARY_LEN) }); return; }
      let parsed: Obj | null = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (!parsed) { this.add({ ...base, outcome: 'ok', summary: cleanText(text, MAX_SUMMARY_LEN) }); return; }
      const s = summarizeToolResult(p.name, p.toolArgs || {}, parsed);
      this.add({ ...base, outcome: s.outcome, summary: s.summary, snapshot: s.snapshot, focus: s.focus, reach: s.reach, ...(s.applied !== undefined ? { applied: s.applied } : {}) }, s.sim);
      if (s.applied) this.invalidateSim(); // the plant changed: an earlier simulation is stale
      return;
    }
    if (method === 'resources/read') {
      const chars = Array.isArray(result.contents) ? result.contents.reduce((a: number, c: Obj) => a + (typeof c?.text === 'string' ? c.text.length : 0), 0) : 0;
      this.add({ kind: 'resource', name: p.name, args: '', outcome: err ? 'error' : 'ok', summary: err || 'read ' + (chars >= 1024 ? (chars / 1024).toFixed(1) + ' K' : chars) + ' chars' });
      return;
    }
    if (method === 'prompts/get') {
      const n = Array.isArray(result.messages) ? result.messages.length : 0;
      this.add({ kind: 'prompt', name: p.name, args: p.args, outcome: err ? 'error' : 'ok', summary: err || n + ' message' + (n === 1 ? '' : 's') });
      return;
    }
    const noun = LIST_NOUN[method];
    if (noun) {
      const n = Array.isArray(result[noun[0]]) ? result[noun[0]].length : 0;
      this.add({ kind: 'list', name: p.name, args: '', outcome: err ? 'error' : 'ok', summary: err || n + ' ' + noun[1] });
      return;
    }
    this.add({ kind: 'session', name: p.name, args: '', outcome: err ? 'error' : 'ok', summary: err || 'ok' });
  }

  /** A response could not be delivered to the client. */
  recordSendFailure(p: Pending, e: unknown): void {
    this.add({ kind: p.method === 'tools/call' ? 'tool' : p.method === 'resources/read' ? 'resource' : p.method === 'prompts/get' ? 'prompt' : 'session', name: p.name, args: p.args, outcome: 'error', summary: 'response not delivered: ' + cleanText((e as Error)?.message ?? e, 120) });
  }

  /**
   * Observe a transport before the MCP server connects to it (see the SDK notes
   * at the top). Observing the same transport twice is a no-op.
   */
  observe(transport: Transport, opt: ObserveOptions = {}): void {
    if (this.observed.has(transport)) return;
    this.observed.add(transport);
    const conn = opt.trackClose ? ++this.connSeq : 0;
    const pending = new Map<string | number, Pending>();
    const prevOnMessage = transport.onmessage;
    transport.onmessage = (message, extra) => {
      try { this.onIncoming(pending, message as Obj, conn); } catch { /* never break the MCP path */ }
      prevOnMessage?.(message, extra);
    };
    if (conn) {
      const prevOnClose = transport.onclose;
      transport.onclose = () => {
        try { this.connectionClosed(conn); } catch { /* never break the MCP path */ }
        prevOnClose?.();
      };
    }
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      let p: Pending | undefined;
      try { p = this.onOutgoing(pending, message as Obj); } catch { p = undefined; }
      const sent = send(message, options);
      if (p) {
        const failed = p;
        // a separate handler: the caller still sees the rejection of `sent`
        sent.catch((e: unknown) => { try { this.recordSendFailure(failed, e); } catch { /* ignore */ } });
      }
      return sent;
    };
  }

  private onIncoming(pending: Map<string | number, Pending>, m: Obj, conn: number): void {
    if (!m || typeof m !== 'object' || typeof m.method !== 'string') return;
    if (m.id === undefined) {
      if (m.method === 'notifications/initialized') this.clientInitialized();
      return;
    }
    if (m.method === 'initialize') this.clientInitializing(m.params, conn);
    else if (!this.client?.initialized && m.method !== 'ping') this.clientInitialized();
    if (IGNORED.has(m.method)) return;
    pending.set(m.id, pendingOf(m.method, m.params));
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value as string | number);
  }

  /** records the response and returns its request, so a failed send can be reported too */
  private onOutgoing(pending: Map<string | number, Pending>, m: Obj): Pending | undefined {
    if (!m || typeof m !== 'object' || m.method !== undefined || m.id === undefined) return undefined;
    const p = pending.get(m.id);
    if (!p) return undefined;
    pending.delete(m.id);
    this.recordResponse(p, m);
    return p;
  }
}
