/**
 * Read models composed from topology + knowledge + rules: engineering context for
 * one element, and a plant overview. Neither exposes the injected scenario: an
 * agent has to infer what is happening from signals, like an operator would.
 */
import { KNOW, NODE_FORTRAN, REFNAME, refOf } from './knowledge.ts';
import { EXPLICITLY_UNSPECIFIED, RULES } from './rules.ts';
import { MODELLED_SIGNALS, MODELLED_XMVS, SIG } from './signals.ts';
import { BIND, LOOPS, SHORT, SN, TE, TEDGES, TN, TNODES, ZH, resolveElement } from './topology.ts';

export interface EngineeringContext {
  element: { key: string; id: string; type: 'NODE' | 'EDGE'; kind: string; name: string; label: string; labelZh: string; from?: string; to?: string; stream?: string };
  signals: { id: string; relation: string; quantity: string; name: string; unit: string; nominal: number; modelled: boolean; limits: string[] | 'no reviewed limit' }[];
  knowledge: { type: string; status: string; text: string; refs: { key: string; id: string; review: string }[] }[];
  rules: { id: string; signal: string; kind: string; comparator: string; value: number; unit: string; state: string; source: unknown; note: string }[];
  topologyRefs: string[];
  coverage: string;
}

export function getEngineeringContext(ref: string): EngineeringContext | null {
  const key = resolveElement(ref);
  if (!key) return null;
  const id = key.slice(2);
  const isN = key[0] === 'n';
  const el = isN ? TN[id] : TE[id];
  const binds = BIND[id] || [];
  const signals = binds.map((b) => {
    const rs = RULES.filter((r) => r.signal === b.v).map((r) => r.id);
    return {
      id: b.v, relation: b.rel, quantity: b.q, name: SIG[b.v][0], unit: SIG[b.v][1], nominal: SIG[b.v][2],
      modelled: MODELLED_SIGNALS.includes(b.v),
      limits: rs.length ? rs : ('no reviewed limit' as const),
    };
  });
  const knowledge = (KNOW[key] || []).map((x) => ({ type: x.t, status: x.s, text: x.txt, refs: x.r.map(refOf) }));
  const sigIds = binds.map((b) => b.v);
  const rules = RULES.filter((r) => sigIds.includes(r.signal)).map((r) => ({ ...r }));
  const topologyRefs = (isN ? ['downs_vogel_1993'].concat(NODE_FORTRAN[id] ? ['sim_fortran'] : []) : ['downs_vogel_1993', 'sim_fortran'])
    .map((r) => REFNAME[r]).concat(['tep-process-graph 0.2.0 · HUMAN_VERIFIED']);
  const explicit = sigIds.filter((s) => EXPLICITLY_UNSPECIFIED[s]).map((s) => s + ': alarm and shutdown limits are explicitly unspecified (' + EXPLICITLY_UNSPECIFIED[s] + '); do not infer one.');
  return {
    element: {
      key, id, type: isN ? 'NODE' : 'EDGE', kind: el.kind, name: el.name,
      label: isN ? SHORT[id] : (SN[id] ? 'stream ' + SN[id] : el.name), labelZh: ZH[id] || '',
      ...(isN ? {} : { from: TE[id].s, to: TE[id].t }),
      ...(SN[id] ? { stream: SN[id] } : {}),
    },
    signals,
    knowledge,
    rules,
    topologyRefs,
    coverage: (knowledge.length
      ? 'Reviewed knowledge covers the reactor-cooling subsystem only.'
      : 'No extracted limits, SOP or control descriptions for this element; the knowledge base covers the reactor-cooling subsystem only.') + (explicit.length ? ' ' + explicit.join(' ') : ''),
  };
}

export function topologySummary() {
  return {
    revision: 'tep-process-graph 0.2.0 (HUMAN_VERIFIED)',
    nodes: TNODES.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
    edges: TEDGES.map((e) => ({ id: e.id, kind: e.kind, from: e.s, to: e.t, name: e.name })),
    loops: LOOPS.map((l) => ({ id: l.id, path: l.path })),
    counts: { nodes: TNODES.length, edges: TEDGES.length, bindings: Object.values(BIND).reduce((a, b) => a + b.length, 0) },
    modelledSignals: MODELLED_SIGNALS.slice(),
    modelledXmvs: MODELLED_XMVS.slice(),
  };
}
