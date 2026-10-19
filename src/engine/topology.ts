/**
 * Topology (tep-sim ProcessGraph 0.2.0, HUMAN_VERIFIED), moved verbatim from the page,
 * plus the downstream BFS used for impact propagation.
 *
 * Graph reachability is a hypothesis space, not causal evidence: TEP runs in closed
 * loop and controllers can mask downstream deviations.
 */
import { SIG } from './signals.ts';

export interface TopoData {
  n: [string, string, string][];
  e: [string, string, string, string, string][];
  b: [string, string, string, string][];
}

export const TOPO: TopoData = {"n":[["feed_a_supply","FEED_SOURCE","A feed supply"],["feed_d_supply","FEED_SOURCE","D feed supply"],["feed_e_supply","FEED_SOURCE","E feed supply"],["feed_ac_supply","FEED_SOURCE","A and C feed supply"],["reactor_feed_mixer","MIXER","Reactor feed mixing zone"],["reactor","REACTOR","Reactor"],["condenser","CONDENSER","Product condenser"],["separator","SEPARATOR","Vapor-liquid separator"],["compressor","COMPRESSOR","Recycle compressor"],["stripper","STRIPPER","Product stripper"],["purge_outlet","PRODUCT_SINK","Purge outlet"],["product_outlet","PRODUCT_SINK","Product outlet"],["reactor_cooling_water_supply","UTILITY_SOURCE","Reactor cooling water supply"],["reactor_cooling_water_return","UTILITY_SINK","Reactor cooling water return"],["condenser_cooling_water_supply","UTILITY_SOURCE","Condenser cooling water supply"],["condenser_cooling_water_return","UTILITY_SINK","Condenser cooling water return"],["stripper_steam_supply","UTILITY_SOURCE","Stripper steam supply"]],"e":[["stream_1","MATERIAL_STREAM","feed_a_supply","reactor_feed_mixer","A feed"],["stream_2","MATERIAL_STREAM","feed_d_supply","reactor_feed_mixer","D feed"],["stream_3","MATERIAL_STREAM","feed_e_supply","reactor_feed_mixer","E feed"],["stream_4","MATERIAL_STREAM","feed_ac_supply","stripper","A and C feed"],["stream_5","MATERIAL_STREAM","stripper","reactor_feed_mixer","Stripper overhead"],["stream_6","MATERIAL_STREAM","reactor_feed_mixer","reactor","Reactor feed"],["stream_7","MATERIAL_STREAM","reactor","condenser","Reactor product"],["condenser_outlet","MATERIAL_STREAM","condenser","separator","Condensed reactor product"],["separator_vapor","MATERIAL_STREAM","separator","compressor","Separator vapor to recycle"],["stream_8","MATERIAL_STREAM","compressor","reactor_feed_mixer","Recycle"],["stream_9","MATERIAL_STREAM","separator","purge_outlet","Purge"],["stream_10","MATERIAL_STREAM","separator","stripper","Separator underflow"],["stream_11","MATERIAL_STREAM","stripper","product_outlet","Product"],["reactor_cooling_water_in","UTILITY_STREAM","reactor_cooling_water_supply","reactor","Reactor cooling water inlet"],["reactor_cooling_water_out","UTILITY_STREAM","reactor","reactor_cooling_water_return","Reactor cooling water outlet"],["condenser_cooling_water_in","UTILITY_STREAM","condenser_cooling_water_supply","condenser","Condenser cooling water inlet"],["condenser_cooling_water_out","UTILITY_STREAM","condenser","condenser_cooling_water_return","Condenser cooling water outlet"],["stripper_steam","UTILITY_STREAM","stripper_steam_supply","stripper","Stripper steam"]],"b":[["XMEAS(1)","stream_1","MEASURES","flow"],["XMEAS(2)","stream_2","MEASURES","flow"],["XMEAS(3)","stream_3","MEASURES","flow"],["XMEAS(4)","stream_4","MEASURES","flow"],["XMEAS(5)","stream_8","MEASURES","flow"],["XMEAS(6)","stream_6","MEASURES","flow"],["XMEAS(7)","reactor","MEASURES","pressure"],["XMEAS(8)","reactor","MEASURES","level"],["XMEAS(9)","reactor","MEASURES","temperature"],["XMEAS(10)","stream_9","MEASURES","flow"],["XMEAS(11)","separator","MEASURES","temperature"],["XMEAS(12)","separator","MEASURES","level"],["XMEAS(13)","separator","MEASURES","pressure"],["XMEAS(14)","stream_10","MEASURES","flow"],["XMEAS(15)","stripper","MEASURES","level"],["XMEAS(16)","stripper","MEASURES","pressure"],["XMEAS(17)","stream_11","MEASURES","flow"],["XMEAS(18)","stripper","MEASURES","temperature"],["XMEAS(19)","stripper_steam","MEASURES","flow"],["XMEAS(20)","compressor","MEASURES","power"],["XMEAS(21)","reactor_cooling_water_out","MEASURES","temperature"],["XMEAS(22)","condenser_cooling_water_out","MEASURES","temperature"],["XMEAS(23)","stream_6","MEASURES","composition"],["XMEAS(24)","stream_6","MEASURES","composition"],["XMEAS(25)","stream_6","MEASURES","composition"],["XMEAS(26)","stream_6","MEASURES","composition"],["XMEAS(27)","stream_6","MEASURES","composition"],["XMEAS(28)","stream_6","MEASURES","composition"],["XMEAS(29)","stream_9","MEASURES","composition"],["XMEAS(30)","stream_9","MEASURES","composition"],["XMEAS(31)","stream_9","MEASURES","composition"],["XMEAS(32)","stream_9","MEASURES","composition"],["XMEAS(33)","stream_9","MEASURES","composition"],["XMEAS(34)","stream_9","MEASURES","composition"],["XMEAS(35)","stream_9","MEASURES","composition"],["XMEAS(36)","stream_9","MEASURES","composition"],["XMEAS(37)","stream_11","MEASURES","composition"],["XMEAS(38)","stream_11","MEASURES","composition"],["XMEAS(39)","stream_11","MEASURES","composition"],["XMEAS(40)","stream_11","MEASURES","composition"],["XMEAS(41)","stream_11","MEASURES","composition"],["XMV(1)","stream_2","ACTUATES","flow"],["XMV(2)","stream_3","ACTUATES","flow"],["XMV(3)","stream_1","ACTUATES","flow"],["XMV(4)","stream_4","ACTUATES","flow"],["XMV(5)","compressor","ACTUATES","valve_position"],["XMV(6)","stream_9","ACTUATES","valve_position"],["XMV(7)","stream_10","ACTUATES","flow"],["XMV(8)","stream_11","ACTUATES","flow"],["XMV(9)","stripper_steam","ACTUATES","valve_position"],["XMV(10)","reactor_cooling_water_in","ACTUATES","flow"],["XMV(11)","condenser_cooling_water_in","ACTUATES","flow"],["XMV(12)","reactor","ACTUATES","speed"]]};

export interface LoopDef {
  id: string;
  name: string;
  /** Traditional Chinese name, read by the page only */
  nameZh: string;
  path: string;
  e: string[];
}

export const LOOPS: LoopDef[] = [
  { id: 'recycle', name: 'recycle loop', nameZh: '循環回路', path: 'reactor → condenser → separator → compressor → feed mixer → reactor', e: ['stream_7', 'condenser_outlet', 'separator_vapor', 'stream_8', 'stream_6'] },
  { id: 'stripper', name: 'stripper loop', nameZh: '汽提回路', path: 'separator → stripper → feed mixer → reactor → condenser → separator', e: ['stream_10', 'stream_5', 'stream_6', 'stream_7', 'condenser_outlet'] },
];

export const SHORT: Record<string, string> = { feed_a_supply: 'A feed', feed_d_supply: 'D feed', feed_e_supply: 'E feed', feed_ac_supply: 'A+C feed', reactor_feed_mixer: 'Feed mixer', reactor: 'Reactor', condenser: 'Condenser', separator: 'Separator', compressor: 'Compressor', stripper: 'Stripper', purge_outlet: 'Purge', product_outlet: 'Product', reactor_cooling_water_supply: 'Reactor CW supply', reactor_cooling_water_return: 'Reactor CW return', condenser_cooling_water_supply: 'Cond. CW supply', condenser_cooling_water_return: 'Cond. CW return', stripper_steam_supply: 'Steam supply' };

export const ZH: Record<string, string> = { feed_a_supply: 'A 進料', feed_d_supply: 'D 進料', feed_e_supply: 'E 進料', feed_ac_supply: 'A+C 進料', reactor_feed_mixer: '進料混合區', reactor: '反應器', condenser: '產物冷凝器', separator: '氣液分離器', compressor: '循環壓縮機', stripper: '產品汽提塔', purge_outlet: '排放口', product_outlet: '產品出口', reactor_cooling_water_supply: '反應器冷卻水供應', reactor_cooling_water_return: '反應器冷卻水回水', condenser_cooling_water_supply: '冷凝器冷卻水供應', condenser_cooling_water_return: '冷凝器冷卻水回水', stripper_steam_supply: '汽提蒸汽供應',
  stream_1: 'A 進料', stream_2: 'D 進料', stream_3: 'E 進料', stream_4: 'A+C 進料', stream_5: '汽提塔塔頂', stream_6: '反應器進料', stream_7: '反應器產物', condenser_outlet: '冷凝後產物', separator_vapor: '分離器氣相', stream_8: '循環', stream_9: '排放', stream_10: '分離器底流', stream_11: '產品', reactor_cooling_water_in: '反應器冷卻水入口', reactor_cooling_water_out: '反應器冷卻水出口', condenser_cooling_water_in: '冷凝器冷卻水入口', condenser_cooling_water_out: '冷凝器冷卻水出口', stripper_steam: '汽提蒸汽' };

export interface TopoNode { id: string; kind: string; name: string }
export interface TopoEdge { id: string; kind: string; s: string; t: string; name: string }
export interface Binding { v: string; rel: string; q: string }

export const TN: Record<string, TopoNode> = {};
export const TE: Record<string, TopoEdge> = {};
export const TNODES: TopoNode[] = [];
export const TEDGES: TopoEdge[] = [];
export const BIND: Record<string, Binding[]> = {};
/** stream number for edges named stream_N */
export const SN: Record<string, string> = {};

TOPO.n.forEach((r) => { const o = { id: r[0], kind: r[1], name: r[2] }; TN[o.id] = o; TNODES.push(o); });
TOPO.e.forEach((r) => {
  const o = { id: r[0], kind: r[1], s: r[2], t: r[3], name: r[4] };
  TE[o.id] = o; TEDGES.push(o);
  const m = /^stream_(\d+)$/.exec(o.id);
  if (m) SN[o.id] = m[1];
});
TOPO.b.forEach((b) => { (BIND[b[1]] = BIND[b[1]] || []).push({ v: b[0], rel: b[2], q: b[3] }); });

/** 'n:<id>' for nodes, 'e:<id>' for edges. */
export function keyOf(att: string): string { return (TN[att] ? 'n:' : 'e:') + att; }

export function elLabel(k: string): string {
  const id = k.slice(2);
  return k[0] === 'n' ? SHORT[id] : (SN[id] ? 'stream ' + SN[id] : TE[id].name);
}

/** Resolve 'reactor', 'n:reactor', 'stream_7' or 'e:stream_7' to an element key, or null. */
export function resolveElement(ref: string): string | null {
  if (typeof ref !== 'string') return null;
  const s = ref.trim();
  if ((s.startsWith('n:') && Object.prototype.hasOwnProperty.call(TN, s.slice(2))) || (s.startsWith('e:') && Object.prototype.hasOwnProperty.call(TE, s.slice(2)))) return s;
  if (Object.prototype.hasOwnProperty.call(TN, s)) return 'n:' + s;
  if (Object.prototype.hasOwnProperty.call(TE, s)) return 'e:' + s;
  return null;
}

export const MAX_HOPS = 6;

/** Downstream BFS along stream direction. Returns element key -> hop. Verbatim logic. */
export function bfs(k: string, depth: number): Record<string, number> {
  const hop: Record<string, number> = {};
  const q: [string, number][] = [];
  function vn(id: string, h: number) { if (hop['n:' + id] === undefined) { hop['n:' + id] = h; q.push([id, h]); } }
  if (k[0] === 'n') vn(k.slice(2), 0);
  else { const e0 = TE[k.slice(2)]; hop[k] = 0; vn(e0.t, 1); }
  while (q.length) {
    const it = q.shift() as [string, number];
    const u = it[0];
    const h = it[1];
    if (h >= depth) continue;
    TEDGES.forEach((e) => {
      if (e.s !== u) return;
      if (hop['e:' + e.id] === undefined) hop['e:' + e.id] = h + 1;
      vn(e.t, h + 1);
    });
  }
  return hop;
}

export interface ImpactResult {
  start: string;
  maxHops: number;
  hops: { hop: number; elements: { key: string; label: string }[]; measuredSignals: string[] }[];
  loops: { id: string; name: string; reached: number; of: number; closed: boolean }[];
  reachableCount: number;
  caveat: string;
}

/** Structured downstream impact, capped at MAX_HOPS. */
export function impact(startKey: string, maxHops: number): ImpactResult {
  const depth = Math.max(1, Math.min(MAX_HOPS, Math.floor(maxHops)));
  const hop = bfs(startKey, depth);
  const byHop: Record<number, string[]> = {};
  Object.keys(hop).forEach((k) => { const v = hop[k]; if (v === 0) return; (byHop[v] = byHop[v] || []).push(k); });
  const hops = Object.keys(byHop).map(Number).sort((a, b) => a - b).map((v) => {
    const ks = byHop[v];
    const sigs: string[] = [];
    ks.forEach((k) => (BIND[k.slice(2)] || []).forEach((b) => { if (b.rel === 'MEASURES' && SIG[b.v]) sigs.push(b.v); }));
    return { hop: v, elements: ks.map((k) => ({ key: k, label: elLabel(k) })), measuredSignals: sigs };
  });
  const loops = LOOPS.map((L) => {
    const got = L.e.filter((id) => hop['e:' + id] !== undefined).length;
    return { id: L.id, name: L.name, reached: got, of: L.e.length, closed: got === L.e.length };
  });
  return {
    start: startKey,
    maxHops: depth,
    hops,
    loops,
    reachableCount: Object.keys(hop).length,
    caveat: 'Structural reachability only. It describes where an effect could travel, not that it did; closed-loop control can mask downstream deviations. Not causal evidence.',
  };
}
