/**
 * Engineering knowledge (staged knowledge revision; fragment ids from the extraction run).
 * Moved from the page. Only the reactor-cooling subsystem is covered.
 *
 * `rv` / `txt` are English (MCP outputs, English page); `rvZh` / `txtZh` keep the
 * Traditional Chinese wording of the page and are read by the page only.
 */
export interface KnowledgeRef { id: string; rv: string; rvZh?: string }
export interface KnowledgeItem { t: string; s: 'APPROVED' | 'REJECTED' | 'SOURCE'; txt: string; txtZh?: string; r: string[] }

export const KR: Record<string, KnowledgeRef> = {
  row1: { id: 'tags-and-limits/row-1 · frag-4999c3a9b6', rv: 'review-02/03 APPROVE' },
  row2: { id: 'tags-and-limits/row-2 · frag-05f213cc29', rv: 'review-05/06 APPROVE' },
  row3: { id: 'tags-and-limits/row-3 · frag-20b267aeb6', rv: 'review-07 APPROVE' },
  row4: { id: 'tags-and-limits/row-4 · frag-5f243b087c', rv: 'review-08 APPROVE' },
  ctrl: { id: 'subsystem/control-relation ¶1 · frag-1a009aaf08', rv: 'review-10 APPROVE' },
  c145: { id: 'troubleshooting/competing-limit ¶1 · frag-225d0c88bb', rv: 'review-11 REJECT' },
  rcw: { id: 'troubleshooting/unverified-instrumentation ¶1 · frag-13c00a2a06', rv: 'review-12 REJECT' },
  remap: { id: 'operating-procedure/step-4 · frag-a6eeeb83f3', rv: 'review-09 REMAP' },
  sop1: { id: 'operating-procedure/step-1 · frag-08e4924b61', rv: 'source text · not compiled', rvZh: '原文 · 未編譯' },
  sop2: { id: 'operating-procedure/step-2 · frag-6e22886716', rv: 'source text · not compiled', rvZh: '原文 · 未編譯' },
  sop3: { id: 'operating-procedure/step-3 · frag-cfadbe187e', rv: 'source text · not compiled', rvZh: '原文 · 未編譯' },
  tsrev: { id: 'troubleshooting/temperature-review ¶1 · frag-3133c1a869', rv: 'source text · not compiled', rvZh: '原文 · 未編譯' },
  topo: { id: 'tep-process-graph 0.2.0 · downstream BFS', rv: 'HUMAN_VERIFIED' },
};

export const KNOW: Record<string, KnowledgeItem[]> = {
  'n:reactor': [
    { t: 'LIMIT', s: 'APPROVED', txt: 'XMEAS(9) reactor temperature: normal upper 150 degC; shutdown high 175 degC. The normal upper limit must not be used as a shutdown threshold.', txtZh: 'XMEAS(9) reactor temperature：normal upper 150 degC；shutdown high 175 degC。normal upper 不可當作 shutdown threshold。', r: ['row2'] },
    { t: 'LIMIT', s: 'APPROVED', txt: 'XMEAS(7) reactor pressure: normal upper 2895 kPa gauge; shutdown high 3000 kPa gauge.', txtZh: 'XMEAS(7) reactor pressure：normal upper 2895 kPa gauge；shutdown high 3000 kPa gauge。', r: ['row1'] },
    { t: 'CONFLICT', s: 'REJECTED', txt: 'Competing claim "normal upper 145 degC" (troubleshooting note) was REJECTED; both the 150 and the 145 citations are kept for audit.', txtZh: '競爭主張「normal upper 145 degC」（troubleshooting note）已 REJECT；150 與 145 兩份引用都保留供稽核。', r: ['c145'] },
    { t: 'SOP', s: 'SOURCE', txt: 'Read XMEAS(9) with its unit and exact source identity; distinguish the coolant outlet reading…', r: ['sop2'] },
    { t: 'SOP', s: 'SOURCE', txt: 'Compare the process temperature with the normal and shutdown constraints in the tag table…', r: ['sop3'] },
    { t: 'REMAP', s: 'APPROVED', txt: '"reactor-side temperature" maps to XMEAS(9) for that mention only; no global alias is created.', txtZh: '「reactor-side temperature」只在該 mention 對應 XMEAS(9)，不建立全域 alias。', r: ['remap'] },
  ],
  'e:reactor_cooling_water_in': [
    { t: 'CONTROL', s: 'APPROVED', txt: 'XMV(10) manipulates reactor cooling-water flow. Increasing cooling flow is a means of increasing heat removal, subject to the thermal state and available utility conditions.', r: ['ctrl'] },
    { t: 'TAG', s: 'APPROVED', txt: 'XMV(10): unit % command; nominal 41.106; command range 0–100; not a process alarm / shutdown limit.', txtZh: 'XMV(10)：單位 % command；基準 41.106；指令範圍 0–100；不是製程 alarm / shutdown 限值。', r: ['row4'] },
    { t: 'GAP', s: 'REJECTED', txt: 'The proposed inlet temperature instrument RCW-IN-TT does not exist in the pinned plant context → no signal identity is created. The inlet temperature cannot be observed directly.', txtZh: '提議的入口溫度儀表 RCW-IN-TT 在 pinned plant context 中不存在 → 不建立 signal identity。入口溫度無法直接觀測。', r: ['rcw'] },
  ],
  'e:reactor_cooling_water_out': [
    { t: 'TAG', s: 'APPROVED', txt: 'XMEAS(21) reactor cooling-water outlet temperature, degC; nominal 94.599; alarm and shutdown unspecified → no limit is inferred.', txtZh: 'XMEAS(21) reactor cooling-water outlet temperature，degC；基準 94.599；alarm 與 shutdown 未指定 → 不推測限值。', r: ['row3'] },
    { t: 'SOP', s: 'SOURCE', txt: 'When process temperature rises, compare process and cooling-water outlet readings…', r: ['tsrev'] },
  ],
  'n:reactor_cooling_water_supply': [{ t: 'SOP', s: 'SOURCE', txt: 'Identify the reactor and internal cooling bundle in the selected plant revision.', r: ['sop1'] }],
  'n:reactor_cooling_water_return': [{ t: 'SOP', s: 'SOURCE', txt: 'Identify the reactor and internal cooling bundle in the selected plant revision.', r: ['sop1'] }],
};

export const REFNAME: Record<string, string> = {
  downs_vogel_1993: 'Downs & Vogel (1993)',
  sim_fortran: 'TEP Fortran model · teprob.f',
  bathelt_ricker_jelali_2015: 'Bathelt, Ricker & Jelali (2015) Fig. 3',
  sim_python_backend: 'TEP Python backend',
  upstream_constants: 'simulator variable metadata',
};

export const NODE_FORTRAN: Record<string, number> = { reactor_feed_mixer: 1, reactor: 1, separator: 1, stripper: 1 };

/** Machine-readable form of a knowledge ref key. */
export function refOf(key: string): { key: string; id: string; review: string } {
  const r = KR[key];
  return { key, id: r.id, review: r.rv };
}
