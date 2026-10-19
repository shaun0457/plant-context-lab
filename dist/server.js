#!/usr/bin/env node

// src/server/main.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// src/engine/pca-model.json
var pca_model_default = {
  format: "pca-monitor/1",
  variables: [
    "XMEAS(7)",
    "XMEAS(9)",
    "XMEAS(11)",
    "XMEAS(13)",
    "XMEAS(21)",
    "XMV(10)"
  ],
  window: 5,
  mean: [
    2705.344538,
    120.4522295,
    80.13751956,
    2634.025844,
    94.65570449,
    41.07999626
  ],
  scale: [
    5.666974995,
    0.8272710714,
    0.4336213629,
    5.386938765,
    1.009254568,
    1.476609952
  ],
  loadings: [
    [
      0.4580233388,
      0.1793703455
    ],
    [
      0.4672921889,
      0.02058461187
    ],
    [
      0.4162821996,
      0.3579144201
    ],
    [
      0.4579466088,
      0.1792944863
    ],
    [
      0.3935175991,
      -0.4585164169
    ],
    [
      -0.1843653013,
      0.7726033933
    ]
  ],
  eigenvalues: [
    4.537307319,
    1.405776726
  ],
  allEigenvalues: [
    4.537307319,
    1.405776726,
    0.05121119713,
    0.004818219396,
    6045015312e-13,
    2820367834e-13
  ],
  k: 2,
  explainedVariance: 0.9905140075,
  confidence: 0.99,
  t2Limit: 11.7387,
  speLimit: 0.461,
  training: {
    generator: "scripts/train-pca.ts (engine lumped model)",
    seeds: [
      101,
      202,
      303,
      404,
      505,
      606
    ],
    holdoutSeeds: [
      707,
      808
    ],
    warmupSteps: 480,
    stepsPerSeed: 3e3,
    sampleHours: 0.01,
    rows: 17976,
    operatingMode: "XMV(10) loop AUTO, no disturbance, plus operator moves of up to +/-3 % held 18-54 min",
    preprocessing: "5-sample moving mean, autoscaled with training mean and standard deviation",
    componentRule: "smallest k with cumulative explained variance >= 0.9",
    limits: "empirical 99 % quantile of training T² and SPE",
    labels: "none; the monitor outputs scores and contributors only",
    holdoutFalseAlarm: {
      t2: 67e-4,
      spe: 17e-4,
      any: 83e-4
    },
    holdoutFalseAlarmAutoOnly: {
      t2: 0,
      spe: 0,
      any: 0
    }
  }
};

// src/engine/rng.ts
function createRng(seed) {
  return { s: seed >>> 0 || 2654435769 };
}
function uniform(r) {
  r.s = r.s + 1831565813 >>> 0;
  let t = r.s;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function gauss(r) {
  let u = 0;
  let v = 0;
  while (u === 0) u = uniform(r);
  while (v === 0) v = uniform(r);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// src/engine/signals.ts
var SIG = {
  "XMEAS(1)": ["A feed", "kscmh", 0.25052],
  "XMEAS(2)": ["D feed", "kg/h", 3664],
  "XMEAS(3)": ["E feed", "kg/h", 4509.3],
  "XMEAS(4)": ["A and C feed", "kscmh", 9.3477],
  "XMEAS(5)": ["Recycle flow", "kscmh", 26.902],
  "XMEAS(6)": ["Reactor feed rate", "kscmh", 42.339],
  "XMEAS(7)": ["Reactor pressure", "kPa gauge", 2705],
  "XMEAS(8)": ["Reactor level", "%", 75],
  "XMEAS(9)": ["Reactor temperature", "degC", 120.4],
  "XMEAS(10)": ["Purge rate", "kscmh", 0.33712],
  "XMEAS(11)": ["Separator temperature", "degC", 80.109],
  "XMEAS(12)": ["Separator level", "%", 50],
  "XMEAS(13)": ["Separator pressure", "kPa gauge", 2633.7],
  "XMEAS(14)": ["Separator underflow", "m3/h", 25.16],
  "XMEAS(15)": ["Stripper level", "%", 50],
  "XMEAS(16)": ["Stripper pressure", "kPa gauge", 3102.2],
  "XMEAS(17)": ["Stripper underflow", "m3/h", 22.949],
  "XMEAS(18)": ["Stripper temperature", "degC", 65.731],
  "XMEAS(19)": ["Stripper steam flow", "kg/h", 230.31],
  "XMEAS(20)": ["Compressor work", "kW", 341.43],
  "XMEAS(21)": ["Reactor CW outlet temperature", "degC", 94.599],
  "XMEAS(22)": ["Condenser CW outlet temperature", "degC", 77.297],
  "XMV(1)": ["D feed flow", "%", 63.053],
  "XMV(2)": ["E feed flow", "%", 53.98],
  "XMV(3)": ["A feed flow", "%", 24.644],
  "XMV(4)": ["A and C feed flow", "%", 61.302],
  "XMV(5)": ["Compressor recycle valve", "%", 22.21],
  "XMV(6)": ["Purge valve", "%", 40.064],
  "XMV(7)": ["Separator liquid flow", "%", 38.1],
  "XMV(8)": ["Stripper product flow", "%", 46.534],
  "XMV(9)": ["Stripper steam valve", "%", 47.446],
  "XMV(10)": ["Reactor CW flow", "% command", 41.106],
  "XMV(11)": ["Condenser CW flow", "%", 18.114],
  "XMV(12)": ["Agitator speed", "%", 50]
};
(function addCompositions() {
  const comp = {
    6: [23, "ABCDEF", [32.188, 8.8933, 26.383, 6.882, 18.776, 1.6567]],
    9: [29, "ABCDEFGH", [32.958, 13.823, 23.978, 1.2565, 18.579, 2.2633, 4.8436, 2.2986]],
    11: [37, "DEFGH", [0.01787, 0.8357, 0.09858, 53.724, 43.828]]
  };
  Object.keys(comp).forEach((s) => {
    const c = comp[s];
    for (let i = 0; i < c[1].length; i++) {
      SIG["XMEAS(" + (c[0] + i) + ")"] = ["stream " + s + " composition " + c[1][i], "mol%", c[2][i], c[1][i]];
    }
  });
})();
var SIGNAL_IDS = Object.keys(SIG);
var XMV_IDS = SIGNAL_IDS.filter((id) => id.startsWith("XMV("));
var MODELLED_XMVS = ["XMV(10)"];
var MODELLED_SIGNALS = ["XMEAS(7)", "XMEAS(9)", "XMEAS(11)", "XMEAS(13)", "XMEAS(21)", "XMV(10)"];
function isKnownSignal(id) {
  return Object.prototype.hasOwnProperty.call(SIG, id);
}

// src/engine/plant.ts
var STEP_H = 0.01;
var SUB = 10;
var MINUTES_PER_STEP = STEP_H * 60;
function createPlantState(seed) {
  const M = { Tr: 120.4, To: 94.599, Tin0: 35, UA: 1, Cc: 0.02, Cr: 0.25, u0: 41.106, Kc: 6, Ti: 0.25, I: 0, u: 41.106, d: 0, df: 0, Pl: 0, Sl: 0, qn: 0, mn: 0, pn: 0, Q0: 0, kF: 0 };
  M.Q0 = M.UA * (M.Tr - M.To);
  M.kF = M.Q0 / (M.To - M.Tin0) / M.u0;
  const VAL = {};
  const OU = {};
  SIGNAL_IDS.forEach((id) => {
    OU[id] = 0;
    VAL[id] = SIG[id][2];
  });
  return { M, t: 0, K: 0, VAL, OU, rng: createRng(seed), mode: "AUTO", uMan: M.u0 };
}
function clonePlantState(s) {
  return {
    M: { ...s.M },
    t: s.t,
    K: s.K,
    VAL: { ...s.VAL },
    OU: { ...s.OU },
    rng: { s: s.rng.s },
    mode: s.mode,
    uMan: s.uMan
  };
}
function stepPlant(s) {
  const M = s.M;
  const r = s.rng;
  const dt = STEP_H / SUB;
  M.mn = gauss(r) * 0.012;
  for (let i = 0; i < SUB; i++) {
    M.df += (M.d - M.df) * dt / 0.01;
    M.qn += -M.qn / 0.4 * dt + 25e-4 * Math.sqrt(dt) * gauss(r);
    const Tin = M.Tin0 + M.df;
    const Q = M.Q0 * (1 + M.qn);
    const e = M.Tr + M.mn - 120.4;
    if (s.mode === "AUTO") {
      M.I += e * dt;
      M.u = Math.max(0, Math.min(100, M.u0 + M.Kc * e + M.Kc / M.Ti * M.I));
    } else {
      M.u = Math.max(0, Math.min(100, s.uMan));
    }
    const F = M.kF * M.u;
    const dTo = (F * (Tin - M.To) + M.UA * (M.Tr - M.To)) / M.Cc;
    const dTr = (Q - M.UA * (M.Tr - M.To)) / M.Cr;
    M.To += dTo * dt;
    M.Tr += dTr * dt;
    M.Pl += (M.Tr - 120.4 - M.Pl) * dt / 0.08;
    M.Sl += (M.Tr - 120.4 - M.Sl) * dt / 0.25;
  }
  M.pn += -M.pn / 0.15 * STEP_H + 0.9 * Math.sqrt(STEP_H) * gauss(r);
  s.t += STEP_H;
  s.K++;
  const VAL = s.VAL;
  const OU = s.OU;
  for (let j = 0; j < SIGNAL_IDS.length; j++) {
    const id = SIGNAL_IDS[j];
    OU[id] += -OU[id] / 0.3 * STEP_H + 12e-4 * Math.sqrt(STEP_H) * gauss(r);
    VAL[id] = SIG[id][2] * (1 + OU[id] + 6e-4 * gauss(r));
  }
  VAL["XMEAS(9)"] = M.Tr + M.mn;
  VAL["XMEAS(21)"] = M.To + gauss(r) * 0.03;
  VAL["XMV(10)"] = M.u;
  VAL["XMEAS(7)"] = 2705 + 7 * M.Pl + M.pn + gauss(r) * 0.35;
  VAL["XMEAS(11)"] = 80.109 + 0.6 * M.Sl + gauss(r) * 0.02;
  VAL["XMEAS(13)"] = 2633.7 + 0.95 * (VAL["XMEAS(7)"] - 2705) + gauss(r) * 0.3;
}
function setDisturbance(s, mag) {
  s.M.d = mag;
}
function setManualOutput(s, u) {
  s.mode = "MANUAL";
  s.uMan = Math.max(0, Math.min(100, u));
}
function restoreAuto(s) {
  if (s.mode === "AUTO") return;
  const M = s.M;
  const e = M.Tr + M.mn - 120.4;
  M.I = (M.u - M.u0 - M.Kc * e) * M.Ti / M.Kc;
  s.mode = "AUTO";
}

// src/engine/pca.ts
function windowMean(rows, w) {
  if (!rows.length) return null;
  const n = Math.min(w, rows.length);
  const p = rows[0].length;
  const out = new Array(p).fill(0);
  for (let i = rows.length - n; i < rows.length; i++) for (let j = 0; j < p; j++) out[j] += rows[i][j];
  for (let j = 0; j < p; j++) out[j] /= n;
  return out;
}
function scorePca(model, x, topN = 3) {
  const p = model.variables.length;
  const k = model.k;
  const z2 = new Array(p);
  for (let j = 0; j < p; j++) z2[j] = (x[j] - model.mean[j]) / model.scale[j];
  const t = new Array(k).fill(0);
  for (let i = 0; i < k; i++) for (let j = 0; j < p; j++) t[i] += model.loadings[j][i] * z2[j];
  let t2 = 0;
  for (let i = 0; i < k; i++) t2 += t[i] * t[i] / model.eigenvalues[i];
  const resid = new Array(p);
  let spe = 0;
  for (let j = 0; j < p; j++) {
    let rec = 0;
    for (let i = 0; i < k; i++) rec += model.loadings[j][i] * t[i];
    resid[j] = z2[j] - rec;
    spe += resid[j] * resid[j];
  }
  const rT = t2 / model.t2Limit;
  const rS = spe / model.speLimit;
  const dominant = rS >= rT ? "SPE" : "T2";
  const contrib = new Array(p);
  for (let j = 0; j < p; j++) {
    if (dominant === "SPE") contrib[j] = resid[j] * resid[j];
    else {
      let c = 0;
      for (let i = 0; i < k; i++) c += model.loadings[j][i] * t[i] / model.eigenvalues[i];
      contrib[j] = Math.max(0, z2[j] * c);
    }
  }
  const total = contrib.reduce((a, b) => a + b, 0) || 1;
  const contributors = model.variables.map((signal, j) => ({ signal, share: +(contrib[j] / total).toFixed(3), direction: z2[j] >= 0 ? "high" : "low" })).sort((a, b) => b.share - a.share).slice(0, topN);
  return {
    t2: +t2.toFixed(3),
    t2Limit: model.t2Limit,
    spe: +spe.toFixed(3),
    speLimit: model.speLimit,
    score: +Math.max(rT, rS).toFixed(3),
    exceeded: { t2: rT > 1, spe: rS > 1, any: rT > 1 || rS > 1 },
    dominant,
    contributors
  };
}

// src/engine/knowledge.ts
var KR = {
  row1: { id: "tags-and-limits/row-1 · frag-4999c3a9b6", rv: "review-02/03 APPROVE" },
  row2: { id: "tags-and-limits/row-2 · frag-05f213cc29", rv: "review-05/06 APPROVE" },
  row3: { id: "tags-and-limits/row-3 · frag-20b267aeb6", rv: "review-07 APPROVE" },
  row4: { id: "tags-and-limits/row-4 · frag-5f243b087c", rv: "review-08 APPROVE" },
  ctrl: { id: "subsystem/control-relation ¶1 · frag-1a009aaf08", rv: "review-10 APPROVE" },
  c145: { id: "troubleshooting/competing-limit ¶1 · frag-225d0c88bb", rv: "review-11 REJECT" },
  rcw: { id: "troubleshooting/unverified-instrumentation ¶1 · frag-13c00a2a06", rv: "review-12 REJECT" },
  remap: { id: "operating-procedure/step-4 · frag-a6eeeb83f3", rv: "review-09 REMAP" },
  sop1: { id: "operating-procedure/step-1 · frag-08e4924b61", rv: "source text · not compiled", rvZh: "原文 · 未編譯" },
  sop2: { id: "operating-procedure/step-2 · frag-6e22886716", rv: "source text · not compiled", rvZh: "原文 · 未編譯" },
  sop3: { id: "operating-procedure/step-3 · frag-cfadbe187e", rv: "source text · not compiled", rvZh: "原文 · 未編譯" },
  tsrev: { id: "troubleshooting/temperature-review ¶1 · frag-3133c1a869", rv: "source text · not compiled", rvZh: "原文 · 未編譯" },
  topo: { id: "tep-process-graph 0.2.0 · downstream BFS", rv: "HUMAN_VERIFIED" }
};
var KNOW = {
  "n:reactor": [
    { t: "LIMIT", s: "APPROVED", txt: "XMEAS(9) reactor temperature: normal upper 150 degC; shutdown high 175 degC. The normal upper limit must not be used as a shutdown threshold.", txtZh: "XMEAS(9) reactor temperature：normal upper 150 degC；shutdown high 175 degC。normal upper 不可當作 shutdown threshold。", r: ["row2"] },
    { t: "LIMIT", s: "APPROVED", txt: "XMEAS(7) reactor pressure: normal upper 2895 kPa gauge; shutdown high 3000 kPa gauge.", txtZh: "XMEAS(7) reactor pressure：normal upper 2895 kPa gauge；shutdown high 3000 kPa gauge。", r: ["row1"] },
    { t: "CONFLICT", s: "REJECTED", txt: 'Competing claim "normal upper 145 degC" (troubleshooting note) was REJECTED; both the 150 and the 145 citations are kept for audit.', txtZh: "競爭主張「normal upper 145 degC」（troubleshooting note）已 REJECT；150 與 145 兩份引用都保留供稽核。", r: ["c145"] },
    { t: "SOP", s: "SOURCE", txt: "Read XMEAS(9) with its unit and exact source identity; distinguish the coolant outlet reading…", r: ["sop2"] },
    { t: "SOP", s: "SOURCE", txt: "Compare the process temperature with the normal and shutdown constraints in the tag table…", r: ["sop3"] },
    { t: "REMAP", s: "APPROVED", txt: '"reactor-side temperature" maps to XMEAS(9) for that mention only; no global alias is created.', txtZh: "「reactor-side temperature」只在該 mention 對應 XMEAS(9)，不建立全域 alias。", r: ["remap"] }
  ],
  "e:reactor_cooling_water_in": [
    { t: "CONTROL", s: "APPROVED", txt: "XMV(10) manipulates reactor cooling-water flow. Increasing cooling flow is a means of increasing heat removal, subject to the thermal state and available utility conditions.", r: ["ctrl"] },
    { t: "TAG", s: "APPROVED", txt: "XMV(10): unit % command; nominal 41.106; command range 0–100; not a process alarm / shutdown limit.", txtZh: "XMV(10)：單位 % command；基準 41.106；指令範圍 0–100；不是製程 alarm / shutdown 限值。", r: ["row4"] },
    { t: "GAP", s: "REJECTED", txt: "The proposed inlet temperature instrument RCW-IN-TT does not exist in the pinned plant context → no signal identity is created. The inlet temperature cannot be observed directly.", txtZh: "提議的入口溫度儀表 RCW-IN-TT 在 pinned plant context 中不存在 → 不建立 signal identity。入口溫度無法直接觀測。", r: ["rcw"] }
  ],
  "e:reactor_cooling_water_out": [
    { t: "TAG", s: "APPROVED", txt: "XMEAS(21) reactor cooling-water outlet temperature, degC; nominal 94.599; alarm and shutdown unspecified → no limit is inferred.", txtZh: "XMEAS(21) reactor cooling-water outlet temperature，degC；基準 94.599；alarm 與 shutdown 未指定 → 不推測限值。", r: ["row3"] },
    { t: "SOP", s: "SOURCE", txt: "When process temperature rises, compare process and cooling-water outlet readings…", r: ["tsrev"] }
  ],
  "n:reactor_cooling_water_supply": [{ t: "SOP", s: "SOURCE", txt: "Identify the reactor and internal cooling bundle in the selected plant revision.", r: ["sop1"] }],
  "n:reactor_cooling_water_return": [{ t: "SOP", s: "SOURCE", txt: "Identify the reactor and internal cooling bundle in the selected plant revision.", r: ["sop1"] }]
};
var REFNAME = {
  downs_vogel_1993: "Downs & Vogel (1993)",
  sim_fortran: "TEP Fortran model · teprob.f",
  bathelt_ricker_jelali_2015: "Bathelt, Ricker & Jelali (2015) Fig. 3",
  sim_python_backend: "TEP Python backend",
  upstream_constants: "simulator variable metadata"
};
var NODE_FORTRAN = { reactor_feed_mixer: 1, reactor: 1, separator: 1, stripper: 1 };
function refOf(key) {
  const r = KR[key];
  return { key, id: r.id, review: r.rv };
}

// src/engine/rules.ts
var STATE_ORDER = { NORMAL: 0, ATTENTION: 1, ALARM: 2, TRIP: 3 };
var DV = "Downs & Vogel (1993), process operating constraints";
var ATTENTION_HEADROOM_FRACTION = 0.25;
function attentionValue(nominal, normalUpper) {
  return +(normalUpper - ATTENTION_HEADROOM_FRACTION * (normalUpper - nominal)).toFixed(2);
}
var RULES = [
  {
    id: "RL-XMEAS9-ATT",
    signal: "XMEAS(9)",
    kind: "ATTENTION_BAND",
    comparator: ">=",
    value: attentionValue(120.4, 150),
    unit: "degC",
    state: "ATTENTION",
    source: { knowledge: null, review: null, publication: null, derivedFrom: "RL-XMEAS9-NU" },
    note: "Demo convention: last 25 % of headroom from nominal 120.40 to the approved normal upper 150 degC. Not a published limit."
  },
  {
    id: "RL-XMEAS9-NU",
    signal: "XMEAS(9)",
    kind: "NORMAL_UPPER",
    comparator: ">",
    value: 150,
    unit: "degC",
    state: "ALARM",
    source: { knowledge: KR.row2.id, review: KR.row2.rv, publication: DV },
    note: "Normal operating upper limit. Must not be used as the shutdown threshold. A competing 145 degC claim was rejected (review-11)."
  },
  {
    id: "RL-XMEAS9-SD",
    signal: "XMEAS(9)",
    kind: "SHUTDOWN_HIGH",
    comparator: ">=",
    value: 175,
    unit: "degC",
    state: "TRIP",
    source: { knowledge: KR.row2.id, review: KR.row2.rv, publication: DV },
    note: "Shutdown high limit. The lumped model has no interlock; TRIP is reported, not executed."
  },
  {
    id: "RL-XMEAS7-ATT",
    signal: "XMEAS(7)",
    kind: "ATTENTION_BAND",
    comparator: ">=",
    value: attentionValue(2705, 2895),
    unit: "kPa gauge",
    state: "ATTENTION",
    source: { knowledge: null, review: null, publication: null, derivedFrom: "RL-XMEAS7-NU" },
    note: "Demo convention: last 25 % of headroom from nominal 2705.0 to the approved normal upper 2895 kPa gauge. Not a published limit."
  },
  {
    id: "RL-XMEAS7-NU",
    signal: "XMEAS(7)",
    kind: "NORMAL_UPPER",
    comparator: ">",
    value: 2895,
    unit: "kPa gauge",
    state: "ALARM",
    source: { knowledge: KR.row1.id, review: KR.row1.rv, publication: DV },
    note: "Normal operating upper limit."
  },
  {
    id: "RL-XMEAS7-SD",
    signal: "XMEAS(7)",
    kind: "SHUTDOWN_HIGH",
    comparator: ">=",
    value: 3e3,
    unit: "kPa gauge",
    state: "TRIP",
    source: { knowledge: KR.row1.id, review: KR.row1.rv, publication: DV },
    note: "Shutdown high limit. The lumped model has no interlock; TRIP is reported, not executed."
  }
];
var RULED_SIGNALS = Array.from(new Set(RULES.map((r) => r.signal)));
var EXPLICITLY_UNSPECIFIED = {
  "XMEAS(21)": KR.row3.id
};
function triggered(rule, v) {
  return rule.comparator === ">=" ? v >= rule.value : v > rule.value;
}
function evaluateRules(values) {
  const out = [];
  let worst = { state: "NORMAL", signal: null, ruleId: null };
  RULED_SIGNALS.forEach((sig) => {
    const v = values[sig];
    const rules = RULES.filter((r) => r.signal === sig).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
    let state = "NORMAL";
    let ruleId = null;
    let next = null;
    for (const r of rules) {
      if (Number.isFinite(v) && triggered(r, v)) {
        state = r.state;
        ruleId = r.id;
      } else if (!next) next = { ruleId: r.id, value: r.value, state: r.state };
    }
    const nu = rules.find((r) => r.kind === "NORMAL_UPPER");
    out.push({
      signal: sig,
      name: SIG[sig][0],
      value: v,
      unit: SIG[sig][1],
      state,
      ruleId,
      nextLimit: next,
      headroomToNormalUpper: nu && Number.isFinite(v) ? +(nu.value - v).toFixed(3) : null
    });
    if (STATE_ORDER[state] > STATE_ORDER[worst.state]) worst = { state, signal: sig, ruleId };
  });
  const noReviewedLimit = SIGNAL_IDS.filter((id) => id.startsWith("XMEAS(") && !RULED_SIGNALS.includes(id));
  return { worst, signals: out, noReviewedLimit };
}

// src/engine/simulation.ts
var HISTORY_CAP = 480;
var EVENT_CAP = 100;
var CHANGE_CAP = 50;
var GATE_LOG_CAP = 200;
var MAX_SIGNAL_IDS = 8;
var MAX_SIGNAL_POINTS = 60;
function snapshotOf(t, K) {
  return { id: "snap@T" + t.toFixed(2) + "h/K" + K, T_h: +t.toFixed(4), K };
}
var Simulation = class _Simulation {
  plant;
  pcaModel;
  historyCap;
  hist;
  pcaRows;
  events;
  changes;
  gateLog;
  gateSeq;
  eventSeq;
  now;
  safetyCache;
  constructor(opt = {}) {
    this.plant = createPlantState(opt.seed ?? 1);
    this.pcaModel = opt.pcaModel ?? null;
    this.historyCap = opt.historyCap ?? HISTORY_CAP;
    this.hist = { t: [], K: [], v: {} };
    SIGNAL_IDS.forEach((id) => {
      this.hist.v[id] = [];
    });
    this.pcaRows = [];
    this.events = [];
    this.changes = [];
    this.gateLog = [];
    this.gateSeq = 0;
    this.eventSeq = 0;
    this.now = opt.now ?? (() => Date.now());
    this.safetyCache = null;
    const warm = opt.warmup ?? HISTORY_CAP;
    for (let i = 0; i < warm; i++) this.step();
  }
  /** Advance n samples. */
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      stepPlant(this.plant);
      this.record();
    }
  }
  record() {
    const s = this.plant;
    if (this.pcaModel) {
      this.pcaRows.push(this.pcaModel.variables.map((id) => s.VAL[id]));
      while (this.pcaRows.length > this.pcaModel.window) this.pcaRows.shift();
    }
    if (this.historyCap <= 0) return;
    const h = this.hist;
    h.t.push(s.t);
    h.K.push(s.K);
    if (h.t.length > this.historyCap) {
      h.t.shift();
      h.K.shift();
    }
    for (let j = 0; j < SIGNAL_IDS.length; j++) {
      const a = h.v[SIGNAL_IDS[j]];
      a.push(s.VAL[SIGNAL_IDS[j]]);
      if (a.length > this.historyCap) a.shift();
    }
  }
  get t() {
    return this.plant.t;
  }
  get K() {
    return this.plant.K;
  }
  snapshot() {
    return snapshotOf(this.plant.t, this.plant.K);
  }
  values() {
    return { ...this.plant.VAL };
  }
  sample() {
    return { snapshot: this.snapshot(), t: this.plant.t, K: this.plant.K, values: this.values(), mode: this.plant.mode, disturbance: this.plant.M.d };
  }
  pcaScore() {
    if (!this.pcaModel) return null;
    const x = windowMean(this.pcaRows, this.pcaModel.window);
    return x ? scorePca(this.pcaModel, x) : null;
  }
  safety() {
    const c = this.safetyCache;
    if (c && c.K === this.plant.K && c.mode === this.plant.mode) return c.s;
    const s = {
      snapshot: this.snapshot(),
      rules: evaluateRules(this.plant.VAL),
      pca: this.pcaScore(),
      loop: { xmv: "XMV(10)", mode: this.plant.mode, output: +this.plant.M.u.toFixed(3) }
    };
    this.safetyCache = { K: this.plant.K, mode: this.plant.mode, s };
    return s;
  }
  /* ---------------- human-only scenario controls (never exposed as agent tools) ---------------- */
  injectIdv4(mag, source = "human") {
    const m = Math.max(0, Math.min(10, Number(mag) || 0));
    setDisturbance(this.plant, m);
    this.pushEvent(m > 0 ? "IDV4_INJECT" : "IDV4_REMOVE", source, { magnitude_degC: m });
  }
  removeDisturbance(source = "human") {
    if (!this.plant.M.d) return;
    setDisturbance(this.plant, 0);
    this.pushEvent("IDV4_REMOVE", source, {});
  }
  restoreAuto(source = "human") {
    if (this.plant.mode === "AUTO") return;
    restoreAuto(this.plant);
    this.safetyCache = null;
    this.pushEvent("LOOP_AUTO", source, { output: +this.plant.M.u.toFixed(3) });
  }
  /** Apply an XMV change. Only the gate calls this, after an ACCEPT verdict. */
  applyAdjustment(xmv, target, source) {
    if (xmv !== "XMV(10)") throw new Error("not a modelled XMV: " + xmv);
    const from = this.plant.M.u;
    setManualOutput(this.plant, target);
    this.safetyCache = null;
    const ch = { K: this.plant.K, t: this.plant.t, xmv, from, to: this.plant.uMan };
    this.changes.push(ch);
    while (this.changes.length > CHANGE_CAP) this.changes.shift();
    this.pushEvent("ADJUSTMENT_APPLIED", source, { xmv, from: +from.toFixed(3), to: ch.to, mode: "MANUAL" });
    return ch;
  }
  pushEvent(type, source, detail) {
    this.events.push({ seq: ++this.eventSeq, type, snapshot: this.snapshot(), source, detail });
    while (this.events.length > EVENT_CAP) this.events.shift();
  }
  /** Copy of plant + PCA window. Logs, history and events are not copied. */
  branch() {
    const b = new _Simulation({ seed: 1, warmup: 0, historyCap: 0, pcaModel: this.pcaModel, now: this.now });
    b.plant = clonePlantState(this.plant);
    b.pcaRows = this.pcaRows.map((r) => r.slice());
    b.changes = this.changes.map((c) => ({ ...c }));
    return b;
  }
  /** Bounded signal history read. */
  signalWindow(ids, windowMinutes, maxPoints = MAX_SIGNAL_POINTS) {
    const uniq = Array.from(new Set(ids.map(String)));
    const truncatedIds = uniq.slice(MAX_SIGNAL_IDS);
    const take = uniq.slice(0, MAX_SIGNAL_IDS);
    const unknown = take.filter((id) => !isKnownSignal(id));
    const maxMin = this.historyCap * MINUTES_PER_STEP;
    const win = Math.max(MINUTES_PER_STEP, Math.min(maxMin, Number(windowMinutes) || 30));
    const nWant = Math.max(1, Math.round(win / MINUTES_PER_STEP));
    const n = Math.min(nWant, this.hist.t.length);
    const start = this.hist.t.length - n;
    const pts = Math.max(2, Math.min(MAX_SIGNAL_POINTS, maxPoints));
    const stride = Math.max(1, Math.ceil(n / pts));
    const signals = take.filter(isKnownSignal).map((id) => {
      const arr = this.hist.v[id];
      const points = [];
      for (let i = this.hist.t.length - 1; i >= start; i -= stride) points.push([+this.hist.t[i].toFixed(3), +arr[i].toFixed(4)]);
      points.reverse();
      return { id, name: SIG[id][0], unit: SIG[id][1], latest: +this.plant.VAL[id].toFixed(4), points };
    });
    return { signals, unknown, windowMinutes: +(n * MINUTES_PER_STEP).toFixed(1), truncatedIds };
  }
};

// src/engine/topology.ts
var TOPO = { "n": [["feed_a_supply", "FEED_SOURCE", "A feed supply"], ["feed_d_supply", "FEED_SOURCE", "D feed supply"], ["feed_e_supply", "FEED_SOURCE", "E feed supply"], ["feed_ac_supply", "FEED_SOURCE", "A and C feed supply"], ["reactor_feed_mixer", "MIXER", "Reactor feed mixing zone"], ["reactor", "REACTOR", "Reactor"], ["condenser", "CONDENSER", "Product condenser"], ["separator", "SEPARATOR", "Vapor-liquid separator"], ["compressor", "COMPRESSOR", "Recycle compressor"], ["stripper", "STRIPPER", "Product stripper"], ["purge_outlet", "PRODUCT_SINK", "Purge outlet"], ["product_outlet", "PRODUCT_SINK", "Product outlet"], ["reactor_cooling_water_supply", "UTILITY_SOURCE", "Reactor cooling water supply"], ["reactor_cooling_water_return", "UTILITY_SINK", "Reactor cooling water return"], ["condenser_cooling_water_supply", "UTILITY_SOURCE", "Condenser cooling water supply"], ["condenser_cooling_water_return", "UTILITY_SINK", "Condenser cooling water return"], ["stripper_steam_supply", "UTILITY_SOURCE", "Stripper steam supply"]], "e": [["stream_1", "MATERIAL_STREAM", "feed_a_supply", "reactor_feed_mixer", "A feed"], ["stream_2", "MATERIAL_STREAM", "feed_d_supply", "reactor_feed_mixer", "D feed"], ["stream_3", "MATERIAL_STREAM", "feed_e_supply", "reactor_feed_mixer", "E feed"], ["stream_4", "MATERIAL_STREAM", "feed_ac_supply", "stripper", "A and C feed"], ["stream_5", "MATERIAL_STREAM", "stripper", "reactor_feed_mixer", "Stripper overhead"], ["stream_6", "MATERIAL_STREAM", "reactor_feed_mixer", "reactor", "Reactor feed"], ["stream_7", "MATERIAL_STREAM", "reactor", "condenser", "Reactor product"], ["condenser_outlet", "MATERIAL_STREAM", "condenser", "separator", "Condensed reactor product"], ["separator_vapor", "MATERIAL_STREAM", "separator", "compressor", "Separator vapor to recycle"], ["stream_8", "MATERIAL_STREAM", "compressor", "reactor_feed_mixer", "Recycle"], ["stream_9", "MATERIAL_STREAM", "separator", "purge_outlet", "Purge"], ["stream_10", "MATERIAL_STREAM", "separator", "stripper", "Separator underflow"], ["stream_11", "MATERIAL_STREAM", "stripper", "product_outlet", "Product"], ["reactor_cooling_water_in", "UTILITY_STREAM", "reactor_cooling_water_supply", "reactor", "Reactor cooling water inlet"], ["reactor_cooling_water_out", "UTILITY_STREAM", "reactor", "reactor_cooling_water_return", "Reactor cooling water outlet"], ["condenser_cooling_water_in", "UTILITY_STREAM", "condenser_cooling_water_supply", "condenser", "Condenser cooling water inlet"], ["condenser_cooling_water_out", "UTILITY_STREAM", "condenser", "condenser_cooling_water_return", "Condenser cooling water outlet"], ["stripper_steam", "UTILITY_STREAM", "stripper_steam_supply", "stripper", "Stripper steam"]], "b": [["XMEAS(1)", "stream_1", "MEASURES", "flow"], ["XMEAS(2)", "stream_2", "MEASURES", "flow"], ["XMEAS(3)", "stream_3", "MEASURES", "flow"], ["XMEAS(4)", "stream_4", "MEASURES", "flow"], ["XMEAS(5)", "stream_8", "MEASURES", "flow"], ["XMEAS(6)", "stream_6", "MEASURES", "flow"], ["XMEAS(7)", "reactor", "MEASURES", "pressure"], ["XMEAS(8)", "reactor", "MEASURES", "level"], ["XMEAS(9)", "reactor", "MEASURES", "temperature"], ["XMEAS(10)", "stream_9", "MEASURES", "flow"], ["XMEAS(11)", "separator", "MEASURES", "temperature"], ["XMEAS(12)", "separator", "MEASURES", "level"], ["XMEAS(13)", "separator", "MEASURES", "pressure"], ["XMEAS(14)", "stream_10", "MEASURES", "flow"], ["XMEAS(15)", "stripper", "MEASURES", "level"], ["XMEAS(16)", "stripper", "MEASURES", "pressure"], ["XMEAS(17)", "stream_11", "MEASURES", "flow"], ["XMEAS(18)", "stripper", "MEASURES", "temperature"], ["XMEAS(19)", "stripper_steam", "MEASURES", "flow"], ["XMEAS(20)", "compressor", "MEASURES", "power"], ["XMEAS(21)", "reactor_cooling_water_out", "MEASURES", "temperature"], ["XMEAS(22)", "condenser_cooling_water_out", "MEASURES", "temperature"], ["XMEAS(23)", "stream_6", "MEASURES", "composition"], ["XMEAS(24)", "stream_6", "MEASURES", "composition"], ["XMEAS(25)", "stream_6", "MEASURES", "composition"], ["XMEAS(26)", "stream_6", "MEASURES", "composition"], ["XMEAS(27)", "stream_6", "MEASURES", "composition"], ["XMEAS(28)", "stream_6", "MEASURES", "composition"], ["XMEAS(29)", "stream_9", "MEASURES", "composition"], ["XMEAS(30)", "stream_9", "MEASURES", "composition"], ["XMEAS(31)", "stream_9", "MEASURES", "composition"], ["XMEAS(32)", "stream_9", "MEASURES", "composition"], ["XMEAS(33)", "stream_9", "MEASURES", "composition"], ["XMEAS(34)", "stream_9", "MEASURES", "composition"], ["XMEAS(35)", "stream_9", "MEASURES", "composition"], ["XMEAS(36)", "stream_9", "MEASURES", "composition"], ["XMEAS(37)", "stream_11", "MEASURES", "composition"], ["XMEAS(38)", "stream_11", "MEASURES", "composition"], ["XMEAS(39)", "stream_11", "MEASURES", "composition"], ["XMEAS(40)", "stream_11", "MEASURES", "composition"], ["XMEAS(41)", "stream_11", "MEASURES", "composition"], ["XMV(1)", "stream_2", "ACTUATES", "flow"], ["XMV(2)", "stream_3", "ACTUATES", "flow"], ["XMV(3)", "stream_1", "ACTUATES", "flow"], ["XMV(4)", "stream_4", "ACTUATES", "flow"], ["XMV(5)", "compressor", "ACTUATES", "valve_position"], ["XMV(6)", "stream_9", "ACTUATES", "valve_position"], ["XMV(7)", "stream_10", "ACTUATES", "flow"], ["XMV(8)", "stream_11", "ACTUATES", "flow"], ["XMV(9)", "stripper_steam", "ACTUATES", "valve_position"], ["XMV(10)", "reactor_cooling_water_in", "ACTUATES", "flow"], ["XMV(11)", "condenser_cooling_water_in", "ACTUATES", "flow"], ["XMV(12)", "reactor", "ACTUATES", "speed"]] };
var LOOPS = [
  { id: "recycle", name: "recycle loop", nameZh: "循環回路", path: "reactor → condenser → separator → compressor → feed mixer → reactor", e: ["stream_7", "condenser_outlet", "separator_vapor", "stream_8", "stream_6"] },
  { id: "stripper", name: "stripper loop", nameZh: "汽提回路", path: "separator → stripper → feed mixer → reactor → condenser → separator", e: ["stream_10", "stream_5", "stream_6", "stream_7", "condenser_outlet"] }
];
var SHORT = { feed_a_supply: "A feed", feed_d_supply: "D feed", feed_e_supply: "E feed", feed_ac_supply: "A+C feed", reactor_feed_mixer: "Feed mixer", reactor: "Reactor", condenser: "Condenser", separator: "Separator", compressor: "Compressor", stripper: "Stripper", purge_outlet: "Purge", product_outlet: "Product", reactor_cooling_water_supply: "Reactor CW supply", reactor_cooling_water_return: "Reactor CW return", condenser_cooling_water_supply: "Cond. CW supply", condenser_cooling_water_return: "Cond. CW return", stripper_steam_supply: "Steam supply" };
var ZH = {
  feed_a_supply: "A 進料",
  feed_d_supply: "D 進料",
  feed_e_supply: "E 進料",
  feed_ac_supply: "A+C 進料",
  reactor_feed_mixer: "進料混合區",
  reactor: "反應器",
  condenser: "產物冷凝器",
  separator: "氣液分離器",
  compressor: "循環壓縮機",
  stripper: "產品汽提塔",
  purge_outlet: "排放口",
  product_outlet: "產品出口",
  reactor_cooling_water_supply: "反應器冷卻水供應",
  reactor_cooling_water_return: "反應器冷卻水回水",
  condenser_cooling_water_supply: "冷凝器冷卻水供應",
  condenser_cooling_water_return: "冷凝器冷卻水回水",
  stripper_steam_supply: "汽提蒸汽供應",
  stream_1: "A 進料",
  stream_2: "D 進料",
  stream_3: "E 進料",
  stream_4: "A+C 進料",
  stream_5: "汽提塔塔頂",
  stream_6: "反應器進料",
  stream_7: "反應器產物",
  condenser_outlet: "冷凝後產物",
  separator_vapor: "分離器氣相",
  stream_8: "循環",
  stream_9: "排放",
  stream_10: "分離器底流",
  stream_11: "產品",
  reactor_cooling_water_in: "反應器冷卻水入口",
  reactor_cooling_water_out: "反應器冷卻水出口",
  condenser_cooling_water_in: "冷凝器冷卻水入口",
  condenser_cooling_water_out: "冷凝器冷卻水出口",
  stripper_steam: "汽提蒸汽"
};
var TN = {};
var TE = {};
var TNODES = [];
var TEDGES = [];
var BIND = {};
var SN = {};
TOPO.n.forEach((r) => {
  const o = { id: r[0], kind: r[1], name: r[2] };
  TN[o.id] = o;
  TNODES.push(o);
});
TOPO.e.forEach((r) => {
  const o = { id: r[0], kind: r[1], s: r[2], t: r[3], name: r[4] };
  TE[o.id] = o;
  TEDGES.push(o);
  const m = /^stream_(\d+)$/.exec(o.id);
  if (m) SN[o.id] = m[1];
});
TOPO.b.forEach((b) => {
  (BIND[b[1]] = BIND[b[1]] || []).push({ v: b[0], rel: b[2], q: b[3] });
});
function elLabel(k) {
  const id = k.slice(2);
  return k[0] === "n" ? SHORT[id] : SN[id] ? "stream " + SN[id] : TE[id].name;
}
function resolveElement(ref) {
  if (typeof ref !== "string") return null;
  const s = ref.trim();
  if (s.startsWith("n:") && Object.prototype.hasOwnProperty.call(TN, s.slice(2)) || s.startsWith("e:") && Object.prototype.hasOwnProperty.call(TE, s.slice(2))) return s;
  if (Object.prototype.hasOwnProperty.call(TN, s)) return "n:" + s;
  if (Object.prototype.hasOwnProperty.call(TE, s)) return "e:" + s;
  return null;
}
var MAX_HOPS = 6;
function bfs(k, depth) {
  const hop = {};
  const q = [];
  function vn(id, h) {
    if (hop["n:" + id] === void 0) {
      hop["n:" + id] = h;
      q.push([id, h]);
    }
  }
  if (k[0] === "n") vn(k.slice(2), 0);
  else {
    const e0 = TE[k.slice(2)];
    hop[k] = 0;
    vn(e0.t, 1);
  }
  while (q.length) {
    const it = q.shift();
    const u = it[0];
    const h = it[1];
    if (h >= depth) continue;
    TEDGES.forEach((e) => {
      if (e.s !== u) return;
      if (hop["e:" + e.id] === void 0) hop["e:" + e.id] = h + 1;
      vn(e.t, h + 1);
    });
  }
  return hop;
}
function impact(startKey, maxHops) {
  const depth = Math.max(1, Math.min(MAX_HOPS, Math.floor(maxHops)));
  const hop = bfs(startKey, depth);
  const byHop = {};
  Object.keys(hop).forEach((k) => {
    const v = hop[k];
    if (v === 0) return;
    (byHop[v] = byHop[v] || []).push(k);
  });
  const hops = Object.keys(byHop).map(Number).sort((a, b) => a - b).map((v) => {
    const ks = byHop[v];
    const sigs = [];
    ks.forEach((k) => (BIND[k.slice(2)] || []).forEach((b) => {
      if (b.rel === "MEASURES" && SIG[b.v]) sigs.push(b.v);
    }));
    return { hop: v, elements: ks.map((k) => ({ key: k, label: elLabel(k) })), measuredSignals: sigs };
  });
  const loops = LOOPS.map((L) => {
    const got = L.e.filter((id) => hop["e:" + id] !== void 0).length;
    return { id: L.id, name: L.name, reached: got, of: L.e.length, closed: got === L.e.length };
  });
  return {
    start: startKey,
    maxHops: depth,
    hops,
    loops,
    reachableCount: Object.keys(hop).length,
    caveat: "Structural reachability only. It describes where an effect could travel, not that it did; closed-loop control can mask downstream deviations. Not causal evidence."
  };
}

// src/engine/gate.ts
var GATE_PARAMS = {
  xmvMin: 0,
  xmvMax: 100,
  /** max |target - current| per action, percentage points of valve range */
  maxStepPct: 10,
  /** rate limit: total applied change per XMV inside this sliding window... */
  rateWindowMin: 10,
  /** ...may not exceed this many percentage points (including the proposed step) */
  maxChangeInWindowPct: 15,
  /** simulate-before-act horizon, simulated minutes */
  horizonMin: 30,
  /** REJECT if mean SPE(with change) - mean SPE(no change) exceeds this fraction of the SPE limit */
  speMarginOfLimit: 1,
  /**
   * REJECT if, versus leaving the plant alone, the change raises the simulated peak of a
   * ruled signal by more than this fraction of its nominal headroom (nominal value to the
   * approved normal upper limit). Demo convention derived from the approved limits.
   */
  maxHeadroomLossFraction: 0.05,
  rationaleMaxLen: 500
};
var TRAJ_POINTS = 12;
function simulateAhead(sim, change, minutes) {
  const b = sim.branch();
  if (change) b.applyAdjustment(change.xmv, change.target, "branch");
  const steps = Math.max(1, Math.round(minutes / MINUTES_PER_STEP));
  const watch = ["XMEAS(9)", "XMEAS(7)", "XMEAS(21)", "XMV(10)"];
  const peak = {};
  watch.forEach((id) => {
    peak[id] = -Infinity;
  });
  let worst = "NORMAL";
  let worstRule = { signal: null, ruleId: null, atMin: null };
  let speSum = 0;
  let t2Sum = 0;
  let nP = 0;
  let maxSpe = -Infinity;
  let firstExceed = null;
  const traj = [];
  const every = Math.max(1, Math.ceil(steps / TRAJ_POINTS));
  for (let i = 1; i <= steps; i++) {
    b.step();
    const v = b.plant.VAL;
    watch.forEach((id) => {
      if (v[id] > peak[id]) peak[id] = v[id];
    });
    const r = evaluateRules(v);
    if (STATE_ORDER[r.worst.state] > STATE_ORDER[worst]) {
      worst = r.worst.state;
      worstRule = { signal: r.worst.signal, ruleId: r.worst.ruleId, atMin: +(i * MINUTES_PER_STEP).toFixed(1) };
    }
    let spe = null;
    if (b.pcaModel) {
      const x = windowMean(b.pcaRows, b.pcaModel.window);
      if (x) {
        const s = scorePca(b.pcaModel, x);
        spe = s.spe;
        speSum += s.spe;
        t2Sum += s.t2;
        nP++;
        if (s.spe > maxSpe) maxSpe = s.spe;
        if (firstExceed === null && s.exceeded.any) firstExceed = +(i * MINUTES_PER_STEP).toFixed(1);
      }
    }
    if (i % every === 0 || i === steps) {
      traj.push({ min: +(i * MINUTES_PER_STEP).toFixed(1), "XMEAS(9)": +v["XMEAS(9)"].toFixed(3), "XMEAS(7)": +v["XMEAS(7)"].toFixed(1), "XMEAS(21)": +v["XMEAS(21)"].toFixed(3), "XMV(10)": +v["XMV(10)"].toFixed(3), spe });
    }
  }
  const end = {};
  watch.forEach((id) => {
    end[id] = +b.plant.VAL[id].toFixed(3);
    peak[id] = +peak[id].toFixed(3);
  });
  return {
    horizonMin: +(steps * MINUTES_PER_STEP).toFixed(1),
    steps,
    worstRuleState: worst,
    worstRule,
    peak,
    end,
    meanSpe: nP ? +(speSum / nP).toFixed(3) : null,
    maxSpe: nP ? +maxSpe.toFixed(3) : null,
    meanT2: nP ? +(t2Sum / nP).toFixed(3) : null,
    firstPcaExceedMin: firstExceed,
    trajectory: traj
  };
}
function clip(s, n) {
  return typeof s === "string" ? s.slice(0, n) : "";
}
function evaluateAdjustment(sim, proposal, opts = {}) {
  const P = GATE_PARAMS;
  const input = {
    xmv: clip(proposal?.xmv, 32).trim(),
    target: typeof proposal?.target === "number" ? proposal.target : Number(proposal?.target),
    rationale: clip(proposal?.rationale, P.rationaleMaxLen).trim()
  };
  const snapshot = sim.snapshot();
  const reasons = [];
  const checks = [];
  const check = (code, pass, message, detail) => {
    checks.push({ code, pass });
    if (pass === false) reasons.push({ code, message: message || code, detail });
  };
  const known = XMV_IDS.includes(input.xmv);
  check("XMV_UNKNOWN", known, 'Unknown manipulated variable "' + input.xmv + '". Valid ids are XMV(1)..XMV(12).', { allowed: XMV_IDS.slice() });
  const modelled = MODELLED_XMVS.includes(input.xmv);
  check(
    "XMV_NOT_MODELLED",
    known ? modelled : null,
    input.xmv + " exists in TEP but the lumped model does not simulate it, so the effect of a change cannot be checked.",
    { modelled: MODELLED_XMVS.slice() }
  );
  const finite = Number.isFinite(input.target);
  check("TARGET_INVALID", finite, "Target must be a finite number in percent.");
  check(
    "TARGET_OUT_OF_RANGE",
    finite ? input.target >= P.xmvMin && input.target <= P.xmvMax : null,
    "Target " + input.target + " % is outside the XMV range " + P.xmvMin + ".." + P.xmvMax + " %.",
    { min: P.xmvMin, max: P.xmvMax }
  );
  check("RATIONALE_MISSING", input.rationale.length > 0, "A rationale is required for every proposal.");
  const safety = sim.safety();
  const trip = safety.rules.worst.state === "TRIP";
  check("TRIP_ACTIVE", !trip, "A TRIP rule is active (" + safety.rules.worst.ruleId + "). No adjustments; escalate to a human.", { ruleId: safety.rules.worst.ruleId });
  const current = known ? sim.plant.VAL[input.xmv] : null;
  let simulation = null;
  if (modelled && finite && current !== null) {
    const step = Math.abs(input.target - current);
    check(
      "STEP_TOO_LARGE",
      step <= P.maxStepPct + 1e-9,
      "Step of " + step.toFixed(2) + " %-points exceeds the maximum " + P.maxStepPct + " per action.",
      { step: +step.toFixed(3), max: P.maxStepPct, current: +current.toFixed(3) }
    );
    const since = sim.t - P.rateWindowMin / 60;
    const used = sim.changes.filter((c) => c.xmv === input.xmv && c.t > since + 1e-9).reduce((a, c) => a + Math.abs(c.to - c.from), 0);
    check(
      "RATE_LIMIT",
      used + step <= P.maxChangeInWindowPct + 1e-9,
      "Applied change in the last " + P.rateWindowMin + " simulated min (" + used.toFixed(2) + ") plus this step (" + step.toFixed(2) + ") exceeds " + P.maxChangeInWindowPct + " %-points.",
      { usedInWindow: +used.toFixed(3), step: +step.toFixed(3), budget: P.maxChangeInWindowPct, windowMin: P.rateWindowMin }
    );
  } else {
    check("STEP_TOO_LARGE", null);
    check("RATE_LIMIT", null);
  }
  const staticOk = reasons.length === 0;
  if (staticOk) {
    const withChange = simulateAhead(sim, { xmv: input.xmv, target: input.target }, P.horizonMin);
    const noChange = simulateAhead(sim, null, P.horizonMin);
    simulation = { withChange, noChange };
    const ws = withChange.worstRuleState;
    const ns = noChange.worstRuleState;
    const unavoidable = STATE_ORDER[ns] >= STATE_ORDER.ALARM;
    const peakWorse = RULED_SIGNALS.some((s) => withChange.peak[s] > noChange.peak[s] + 1e-9);
    const relFail = STATE_ORDER[ws] > STATE_ORDER[ns] || peakWorse;
    const simDetail = { ...withChange.worstRule, noChangeWorstState: ns, judgedRelativeToNoChange: unavoidable };
    check(
      "SIM_RULE_TRIP",
      !(ws === "TRIP" && (!unavoidable || relFail)),
      "Simulated " + P.horizonMin + " min ahead, " + withChange.worstRule.ruleId + " reaches TRIP at +" + withChange.worstRule.atMin + " min" + (unavoidable ? " and the change does not improve on no change (" + ns + ")." : "."),
      simDetail
    );
    check(
      "SIM_RULE_ALARM",
      !(ws === "ALARM" && (!unavoidable || relFail)),
      "Simulated " + P.horizonMin + " min ahead, " + withChange.worstRule.ruleId + " reaches ALARM at +" + withChange.worstRule.atMin + " min" + (unavoidable ? " and the change does not improve on no change (" + ns + ")." : "."),
      simDetail
    );
    const losses = RULES.filter((r) => r.kind === "NORMAL_UPPER").map((r) => {
      const allowed = P.maxHeadroomLossFraction * (r.value - SIG[r.signal][2]);
      const loss = withChange.peak[r.signal] - noChange.peak[r.signal];
      return { signal: r.signal, ruleId: r.id, loss: +loss.toFixed(3), allowed: +allowed.toFixed(3) };
    }).filter((x) => x.loss > x.allowed);
    check(
      "SIM_HEADROOM_LOSS",
      losses.length === 0,
      "Versus no change, the simulated peak of " + losses.map((x) => x.signal + " rises by " + x.loss + " (allowed " + x.allowed + ")").join(", ") + ", eating into the headroom to the normal upper limit.",
      { exceeded: losses }
    );
    if (sim.pcaModel && withChange.meanSpe !== null && noChange.meanSpe !== null) {
      const margin = P.speMarginOfLimit * sim.pcaModel.speLimit;
      const worse = withChange.meanSpe - noChange.meanSpe;
      check(
        "PCA_SPE_WORSENS",
        !(worse > margin && withChange.meanSpe > sim.pcaModel.speLimit),
        "Mean SPE over the horizon would rise from " + noChange.meanSpe.toFixed(2) + " (no change) to " + withChange.meanSpe.toFixed(2) + ", more than the margin " + margin.toFixed(2) + ".",
        { meanSpeWith: withChange.meanSpe, meanSpeWithout: noChange.meanSpe, margin: +margin.toFixed(3), speLimit: sim.pcaModel.speLimit }
      );
    } else {
      check("PCA_SPE_WORSENS", null);
    }
  } else {
    check("SIM_RULE_TRIP", null);
    check("SIM_RULE_ALARM", null);
    check("SIM_HEADROOM_LOSS", null);
    check("PCA_SPE_WORSENS", null);
  }
  const verdict = reasons.length === 0 ? "ACCEPT" : "REJECT";
  let applied = false;
  if (verdict === "ACCEPT" && opts.apply) {
    sim.applyAdjustment(input.xmv, input.target, opts.source || "unknown");
    applied = true;
  }
  const entry = {
    seq: ++sim.gateSeq,
    ts: new Date(sim.now()).toISOString(),
    snapshot,
    source: opts.source || "unknown",
    mode: opts.apply ? "apply" : "dry-run",
    input,
    verdict,
    reasons: reasons.map((r) => ({ code: r.code, message: r.message })),
    applied
  };
  sim.gateLog.push(entry);
  while (sim.gateLog.length > GATE_LOG_CAP) sim.gateLog.shift();
  return {
    verdict,
    reasons,
    checks,
    snapshot,
    input,
    current: current === null || current === void 0 ? null : +current.toFixed(3),
    simulation,
    params: GATE_PARAMS,
    applied,
    logSeq: entry.seq
  };
}

// src/engine/context.ts
function getEngineeringContext(ref) {
  const key = resolveElement(ref);
  if (!key) return null;
  const id = key.slice(2);
  const isN = key[0] === "n";
  const el = isN ? TN[id] : TE[id];
  const binds = BIND[id] || [];
  const signals = binds.map((b) => {
    const rs = RULES.filter((r) => r.signal === b.v).map((r) => r.id);
    return {
      id: b.v,
      relation: b.rel,
      quantity: b.q,
      name: SIG[b.v][0],
      unit: SIG[b.v][1],
      nominal: SIG[b.v][2],
      modelled: MODELLED_SIGNALS.includes(b.v),
      limits: rs.length ? rs : "no reviewed limit"
    };
  });
  const knowledge = (KNOW[key] || []).map((x) => ({ type: x.t, status: x.s, text: x.txt, refs: x.r.map(refOf) }));
  const sigIds = binds.map((b) => b.v);
  const rules = RULES.filter((r) => sigIds.includes(r.signal)).map((r) => ({ ...r }));
  const topologyRefs = (isN ? ["downs_vogel_1993"].concat(NODE_FORTRAN[id] ? ["sim_fortran"] : []) : ["downs_vogel_1993", "sim_fortran"]).map((r) => REFNAME[r]).concat(["tep-process-graph 0.2.0 · HUMAN_VERIFIED"]);
  const explicit = sigIds.filter((s) => EXPLICITLY_UNSPECIFIED[s]).map((s) => s + ": alarm and shutdown limits are explicitly unspecified (" + EXPLICITLY_UNSPECIFIED[s] + "); do not infer one.");
  return {
    element: {
      key,
      id,
      type: isN ? "NODE" : "EDGE",
      kind: el.kind,
      name: el.name,
      label: isN ? SHORT[id] : SN[id] ? "stream " + SN[id] : el.name,
      labelZh: ZH[id] || "",
      ...isN ? {} : { from: TE[id].s, to: TE[id].t },
      ...SN[id] ? { stream: SN[id] } : {}
    },
    signals,
    knowledge,
    rules,
    topologyRefs,
    coverage: (knowledge.length ? "Reviewed knowledge covers the reactor-cooling subsystem only." : "No extracted limits, SOP or control descriptions for this element; the knowledge base covers the reactor-cooling subsystem only.") + (explicit.length ? " " + explicit.join(" ") : "")
  };
}
function topologySummary() {
  return {
    revision: "tep-process-graph 0.2.0 (HUMAN_VERIFIED)",
    nodes: TNODES.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
    edges: TEDGES.map((e) => ({ id: e.id, kind: e.kind, from: e.s, to: e.t, name: e.name })),
    loops: LOOPS.map((l) => ({ id: l.id, path: l.path })),
    counts: { nodes: TNODES.length, edges: TEDGES.length, bindings: Object.values(BIND).reduce((a, b) => a + b.length, 0) },
    modelledSignals: MODELLED_SIGNALS.slice(),
    modelledXmvs: MODELLED_XMVS.slice()
  };
}

// src/engine/index.ts
var PCA_MODEL = pca_model_default;
function createSimulation(opt = {}) {
  return new Simulation({ pcaModel: PCA_MODEL, ...opt });
}

// src/server/docs.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
function packageRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      try {
        if (JSON.parse(readFileSync(pj, "utf8")).name === "plant-context-lab") return dir;
      } catch {
      }
    }
    dir = dirname(dir);
  }
  throw new Error("plant-context-lab package root not found");
}
function loadDocs(root = packageRoot()) {
  const read = (f) => readFileSync(join(root, "docs", f), "utf8");
  return {
    systemPrompt: read("system-prompt.md"),
    operatingManual: read("operating-manual.md"),
    architecture: read("architecture.md"),
    rules: read("rules.md")
  };
}

// src/server/mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// src/server/tools.ts
var DISCLAIMER = "SIMULATED plant (illustrative lumped model of the Tennessee Eastman reactor-cooling subsystem). Education only; not for real plant operation.";
var REF_TOPO = "tep-process-graph 0.2.0 · HUMAN_VERIFIED";
var REF_DV = "Downs & Vogel (1993)";
var REF_BRJ = "Bathelt, Ricker & Jelali (2015)";
var REF_PCA = "pca-model.json (pca-monitor/1, trained offline on simulated normal operation)";
var REF_GATE = "gate params: maxStep " + GATE_PARAMS.maxStepPct + " %, rate " + GATE_PARAMS.maxChangeInWindowPct + " %/" + GATE_PARAMS.rateWindowMin + " min, horizon " + GATE_PARAMS.horizonMin + " min";
var MAX_SIM_MINUTES = 120;
function ruleRefs() {
  return RULES.map((r) => r.id + (r.source.knowledge ? " · " + r.source.knowledge : " · derived from " + r.source.derivedFrom));
}
function round(v, d = 3) {
  return +(+v).toFixed(d);
}
function createToolHandlers(ctx) {
  const { sim } = ctx;
  function base(refs) {
    return { snapshot: sim.snapshot(), refs, disclaimer: DISCLAIMER };
  }
  function err(message, refs = []) {
    return { ok: false, error: message, ...base(refs) };
  }
  return {
    get_plant_overview() {
      const s = sim.safety();
      const topo = topologySummary();
      const v = sim.plant.VAL;
      return {
        ok: true,
        ...base([REF_TOPO, REF_DV, REF_BRJ, REF_PCA]),
        plant: "Tennessee Eastman process, reactor-cooling subsystem (simulated)",
        topology: { revision: topo.revision, counts: topo.counts, nodes: topo.nodes.map((n) => n.id), loops: topo.loops },
        modelled: {
          signals: topo.modelledSignals.map((id) => ({ id, name: SIG[id][0], unit: SIG[id][1], nominal: SIG[id][2], value: round(v[id]) })),
          adjustableXmvs: MODELLED_XMVS.slice(),
          note: "Only these signals have dynamics. Other XMEAS/XMV are noisy constants around nominal; other XMVs cannot be adjusted."
        },
        loop: {
          controlled: "XMEAS(9)",
          setpoint_degC: 120.4,
          manipulated: "XMV(10)",
          mode: s.loop.mode,
          output: s.loop.output,
          note: "An accepted adjustment puts the loop in MANUAL at the target. Only a human can return it to AUTO (page button)."
        },
        safetySummary: { worstRuleState: s.rules.worst.state, worstRuleId: s.rules.worst.ruleId, pcaScore: s.pca ? s.pca.score : null, pcaExceeded: s.pca ? s.pca.exceeded.any : null },
        timebase: { minutesPerSample: MINUTES_PER_STEP, simTime_h: round(sim.t, 2) },
        viewer: ctx.viewerUrl || null,
        nextStep: "Call get_safety_state first, then get_signals / get_engineering_context. Use simulate_adjustment before propose_adjustment."
      };
    },
    get_signals(args) {
      const ids = Array.isArray(args?.ids) ? args.ids : [];
      if (!ids.length) return err('ids must be a non-empty array of signal ids such as "XMEAS(9)".');
      const w = sim.signalWindow(ids, args.window_minutes ?? 30, MAX_SIGNAL_POINTS);
      return {
        ok: true,
        ...base([REF_TOPO, REF_BRJ, REF_DV, "browser-simulated values (illustrative)"]),
        limits: { maxIds: MAX_SIGNAL_IDS, maxPoints: MAX_SIGNAL_POINTS, maxWindowMinutes: round(sim.historyCap * MINUTES_PER_STEP, 1) },
        windowMinutes: w.windowMinutes,
        signals: w.signals,
        unknownIds: w.unknown,
        droppedIds: w.truncatedIds,
        pointFormat: "[sim time h, value]"
      };
    },
    get_safety_state() {
      const s = sim.safety();
      return {
        ok: true,
        ...base([...ruleRefs(), REF_PCA, KR.row3.id + " (XMEAS(21) limits unspecified)"]),
        rules: s.rules,
        pca: s.pca ? { ...s.pca, note: "Anomaly score only. The monitor has no fault classifier and never names a fault; contributors are variables, not causes." } : null,
        loop: s.loop,
        interpretation: {
          ruleStates: "NORMAL < ATTENTION (demo band, last 25 % of headroom) < ALARM (above approved normal upper) < TRIP (at/above approved shutdown).",
          whenTrip: "Recommend no adjustments and escalate to a human. The gate rejects every proposal while a TRIP is active."
        }
      };
    },
    get_topology_impact(args) {
      const key = resolveElement(args?.node_id);
      if (!key) return err('Unknown node or edge id "' + String(args?.node_id) + '". Use ids from get_plant_overview (for example "reactor" or "reactor_cooling_water_in").', [REF_TOPO]);
      const hops = Math.max(1, Math.min(MAX_HOPS, Math.floor(Number(args.max_hops ?? 3)) || 3));
      return { ok: true, ...base([REF_TOPO, REF_DV, KR.topo.id]), impact: impact(key, hops) };
    },
    get_engineering_context(args) {
      const c = getEngineeringContext(args?.node_id);
      if (!c) return err('Unknown node or edge id "' + String(args?.node_id) + '".', [REF_TOPO]);
      const refs = [REF_TOPO, ...new Set(c.knowledge.flatMap((k) => k.refs.map((r) => r.id + " · " + r.review))), ...c.rules.map((r) => r.id)];
      return { ok: true, ...base(refs), context: c };
    },
    simulate_adjustment(args) {
      const xmv = String(args?.xmv ?? "").trim();
      if (!XMV_IDS.includes(xmv)) return err('Unknown XMV "' + xmv + '". Valid: XMV(1)..XMV(12).');
      if (!MODELLED_XMVS.includes(xmv)) return err(xmv + " is not simulated by the lumped model, so its effect cannot be predicted. Adjustable: " + MODELLED_XMVS.join(", ") + ".");
      const target = Number(args?.target);
      if (!Number.isFinite(target) || target < GATE_PARAMS.xmvMin || target > GATE_PARAMS.xmvMax) return err("target must be a number in " + GATE_PARAMS.xmvMin + ".." + GATE_PARAMS.xmvMax + " %.");
      const minutes = Math.max(1, Math.min(MAX_SIM_MINUTES, Number(args?.minutes ?? GATE_PARAMS.horizonMin) || GATE_PARAMS.horizonMin));
      const withChange = simulateAhead(sim, { xmv, target }, minutes);
      const noChange = simulateAhead(sim, null, minutes);
      return {
        ok: true,
        ...base([...ruleRefs(), REF_PCA, KR.ctrl.id]),
        branchOnly: true,
        note: "Branch copy only: the live plant was not changed. This is not a gate verdict; propose_adjustment runs the gate.",
        input: { xmv, target, minutes, current: round(sim.plant.VAL[xmv]) },
        withChange,
        noChange,
        pcaLimits: sim.pcaModel ? { t2: sim.pcaModel.t2Limit, spe: sim.pcaModel.speLimit } : null
      };
    },
    propose_adjustment(args, source = "mcp") {
      const r = evaluateAdjustment(sim, { xmv: args?.xmv, target: args?.target, rationale: args?.rationale }, { apply: true, source });
      return {
        ok: true,
        ...base([...ruleRefs(), REF_PCA, REF_GATE]),
        snapshot: r.snapshot,
        verdict: r.verdict,
        applied: r.applied,
        reasons: r.reasons,
        checks: r.checks,
        current: r.current,
        simulation: r.simulation,
        gateLogSeq: r.logSeq,
        params: r.params,
        note: r.applied ? "Applied: XMV(10) loop is now MANUAL at the target. Only a human can return it to AUTO." : "Not applied. The gate decides; do not retry the same proposal to get around it."
      };
    },
    get_gate_log(args = {}) {
      const limit = Math.max(1, Math.min(50, Math.floor(Number(args?.limit ?? 20)) || 20));
      const log2 = sim.gateLog.slice(-limit).reverse();
      return { ok: true, ...base([REF_GATE]), total: sim.gateSeq, entries: log2 };
    }
  };
}

// src/server/mcp.ts
var SERVER_NAME = "plant-context-lab";
var SERVER_VERSION = "0.3.0";
function asContent(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
var READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function createMcpServer(ctx, docs) {
  const h = createToolHandlers(ctx);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: "Simulated Tennessee Eastman reactor-cooling demo for education only. Read resource docs://system-prompt (or prompt operator-assistant) first. Always call get_safety_state before advising. The gate decides; you only propose." }
  );
  server.registerTool("get_plant_overview", {
    title: "Plant overview",
    description: "Read-only overview of the SIMULATED plant: topology counts, modelled signals with current values, the XMV(10) loop mode, a safety summary and the snapshot id.",
    inputSchema: {},
    annotations: READ_ONLY
  }, async () => asContent(h.get_plant_overview()));
  server.registerTool("get_signals", {
    title: "Signal history",
    description: "Read-only recent values for up to " + MAX_SIGNAL_IDS + ' signal ids (e.g. "XMEAS(9)", "XMV(10)") over a window in simulated minutes; at most 60 points per signal.',
    inputSchema: {
      ids: z.array(z.string().max(16)).min(1).max(MAX_SIGNAL_IDS).describe("Signal ids such as XMEAS(9), XMEAS(21), XMV(10)"),
      window_minutes: z.number().min(0.6).max(288).optional().describe("Window in simulated minutes (default 30, max 288)")
    },
    annotations: READ_ONLY
  }, async (a) => asContent(h.get_signals(a)));
  server.registerTool("get_safety_state", {
    title: "Safety state",
    description: "Read-only rule states (NORMAL/ATTENTION/ALARM/TRIP with rule ids and sources) plus the PCA anomaly score (T², SPE, thresholds, top contributing variables). Call this first.",
    inputSchema: {},
    annotations: READ_ONLY
  }, async () => asContent(h.get_safety_state()));
  server.registerTool("get_topology_impact", {
    title: "Topology impact",
    description: "Read-only downstream reachability from a node or edge id, up to " + MAX_HOPS + " hops, with loops flagged. Reachability is not causation.",
    inputSchema: {
      node_id: z.string().max(64).describe('Node or edge id, e.g. "reactor" or "reactor_cooling_water_in"'),
      max_hops: z.number().int().min(1).max(MAX_HOPS).optional().describe("1.." + MAX_HOPS + " (default 3)")
    },
    annotations: READ_ONLY
  }, async (a) => asContent(h.get_topology_impact(a)));
  server.registerTool("get_engineering_context", {
    title: "Engineering context",
    description: "Read-only bound signals, reviewed limits, SOP excerpts and control relations for a node or edge id, each with knowledge refs.",
    inputSchema: { node_id: z.string().max(64).describe('Node or edge id, e.g. "reactor"') },
    annotations: READ_ONLY
  }, async (a) => asContent(h.get_engineering_context(a)));
  server.registerTool("simulate_adjustment", {
    title: "Simulate adjustment (branch only)",
    description: "Runs a branch copy of the engine ahead with the change applied and without it, and returns both summaries. Never changes the live plant and is not a gate verdict.",
    inputSchema: {
      xmv: z.string().max(16).describe("Manipulated variable id; only XMV(10) is modelled"),
      target: z.number().min(GATE_PARAMS.xmvMin).max(GATE_PARAMS.xmvMax).describe("Target output, %"),
      minutes: z.number().min(1).max(MAX_SIM_MINUTES).optional().describe("Simulated minutes ahead (default " + GATE_PARAMS.horizonMin + ", max " + MAX_SIM_MINUTES + ")")
    },
    annotations: READ_ONLY
  }, async (a) => asContent(h.simulate_adjustment(a)));
  server.registerTool("propose_adjustment", {
    title: "Propose adjustment (gated)",
    description: "Submits a proposal to the deterministic gate. The gate returns ACCEPT or REJECT with machine-readable reasons; only an ACCEPT is applied (the XMV(10) loop goes to MANUAL at the target). Returns the snapshot id. Do not retry to get around a REJECT.",
    inputSchema: {
      xmv: z.string().max(16).describe("Manipulated variable id, e.g. XMV(10)"),
      target: z.number().describe("Target output, % (0..100)"),
      rationale: z.string().min(1).max(GATE_PARAMS.rationaleMaxLen).describe("Why, citing signal ids, rule ids and the snapshot id")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (a) => asContent(h.propose_adjustment(a)));
  server.registerTool("get_gate_log", {
    title: "Gate log",
    description: "Read-only recent gate evaluations (newest first) with timestamp, snapshot id, inputs, verdict and reasons.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: READ_ONLY
  }, async (a) => asContent(h.get_gate_log(a)));
  const md = (uri, text) => ({ contents: [{ uri, mimeType: "text/markdown", text }] });
  server.registerResource(
    "operating-manual",
    "manual://operating-manual",
    { title: "Operating manual", description: "Signals, normal envelope, IDV(4) response pattern, investigation steps", mimeType: "text/markdown" },
    async (uri) => md(uri.href, docs.operatingManual)
  );
  server.registerResource(
    "rules-limits",
    "rules://limits",
    { title: "Rule limits", description: "Rule ids, limits, states and sources, plus the gate parameters (JSON)", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ rules: RULES, gate: GATE_PARAMS, markdown: docs.rules }, null, 2) }] })
  );
  server.registerResource(
    "architecture",
    "docs://architecture",
    { title: "Architecture", description: "One engine, two front ends, gate authority", mimeType: "text/markdown" },
    async (uri) => md(uri.href, docs.architecture)
  );
  server.registerResource(
    "system-prompt",
    "docs://system-prompt",
    { title: "System prompt", description: "Operator-assistant system prompt", mimeType: "text/markdown" },
    async (uri) => md(uri.href, docs.systemPrompt)
  );
  server.registerPrompt("operator-assistant", {
    title: "Operator assistant",
    description: "System prompt for an assistant that advises on the simulated plant through these tools."
  }, async () => ({
    description: "Operator-assistant system prompt (simulated plant, education only)",
    messages: [{ role: "user", content: { type: "text", text: docs.systemPrompt } }]
  }));
  return server;
}

// src/server/web.ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
var MAX_BODY_BYTES = 8 * 1024;
var MAX_SSE_CLIENTS = 8;
var MAX_SSE_BUFFERED_BYTES = 256 * 1024;
var LOG_TAIL = 30;
var r4 = (v) => +(+v).toFixed(4);
var errStatus = (e) => e.status === 413 ? 413 : 400;
function compactSample(s) {
  const v = {};
  for (const k of Object.keys(s.values)) v[k] = r4(s.values[k]);
  return { t: r4(s.t), K: s.K, v, d: s.disturbance, m: s.mode };
}
function createWebApp(opt) {
  const { sim, controls } = opt;
  const log2 = opt.log || (() => {
  });
  const token = randomBytes(16).toString("hex");
  const page = opt.html.replace(/<html lang="([a-zA-Z-]+)">/, (_m, lang) => '<html lang="' + lang + '" data-mode="connected" data-token="' + token + '">');
  if (page === opt.html) throw new Error('index.html has no <html lang="..."> tag: cannot enable connected mode');
  const clients = /* @__PURE__ */ new Set();
  let port = 0;
  let lastGate = -1;
  let lastEvent = -1;
  const allowedHosts = () => ["127.0.0.1:" + port, "localhost:" + port];
  const allowedOrigins = () => ["http://127.0.0.1:" + port, "http://localhost:" + port];
  function send(res, code, body, type = "application/json; charset=utf-8") {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY"
    });
    res.end(data);
  }
  function history() {
    const h = sim.hist;
    return { t: h.t.map(r4), K: h.K.slice(), x9: h.v["XMEAS(9)"].map(r4), x21: h.v["XMEAS(21)"].map(r4), u10: h.v["XMV(10)"].map(r4), x7: h.v["XMEAS(7)"].map(r4) };
  }
  function statePayload(full) {
    return {
      mode: "connected",
      sample: compactSample(sim.sample()),
      safety: sim.safety(),
      running: controls.running,
      speed: controls.speed,
      gateSeq: sim.gateSeq,
      eventSeq: sim.eventSeq,
      gateLog: sim.gateLog.slice(-LOG_TAIL),
      events: sim.events.slice(-LOG_TAIL),
      ...full ? { history: history() } : {}
    };
  }
  function writeEvent(res, name, data) {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      return;
    }
    if (res.writableLength > MAX_SSE_BUFFERED_BYTES) {
      clients.delete(res);
      res.destroy();
      return;
    }
    res.write("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n");
  }
  function broadcast(samples) {
    if (!clients.size) {
      lastGate = sim.gateSeq;
      lastEvent = sim.eventSeq;
      return;
    }
    const gateChanged = sim.gateSeq !== lastGate;
    const eventChanged = sim.eventSeq !== lastEvent;
    lastGate = sim.gateSeq;
    lastEvent = sim.eventSeq;
    const payload = {
      samples: samples.map(compactSample),
      safety: sim.safety(),
      running: controls.running,
      speed: controls.speed,
      gateSeq: sim.gateSeq,
      eventSeq: sim.eventSeq,
      ...gateChanged ? { gateLog: sim.gateLog.slice(-LOG_TAIL) } : {},
      ...eventChanged ? { events: sim.events.slice(-LOG_TAIL) } : {}
    };
    for (const c of clients) writeEvent(c, "tick", payload);
  }
  function hostOk(req) {
    return allowedHosts().includes(String(req.headers.host || "").toLowerCase());
  }
  function originOk(req) {
    const o = req.headers.origin;
    return o === void 0 || allowedOrigins().includes(String(o).toLowerCase());
  }
  function tokenOk(req) {
    const got = Buffer.from(String(req.headers["x-pcl-token"] || ""));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooLarge = false;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          chunks.length = 0;
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (tooLarge) {
          reject(Object.assign(new Error("body too large"), { status: 413 }));
          return;
        }
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          reject(new Error("invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }
  function control(body) {
    switch (body.action) {
      case "inject": {
        const mag = Number(body.magnitude);
        if (mag !== 5 && mag !== 10) return { ok: false, error: "magnitude must be 5 or 10" };
        sim.injectIdv4(mag, "page");
        return { ok: true };
      }
      case "remove":
        sim.removeDisturbance("page");
        return { ok: true };
      case "auto":
        sim.restoreAuto("page");
        return { ok: true };
      case "run":
        controls.running = !!body.on;
        return { ok: true };
      case "speed": {
        const s = Number(body.value);
        if (s !== 1 && s !== 4) return { ok: false, error: "speed must be 1 or 4" };
        controls.speed = s;
        return { ok: true };
      }
      default:
        return { ok: false, error: "unknown action" };
    }
  }
  async function handle(req, res) {
    if (!hostOk(req)) {
      send(res, 421, { error: "host not allowed" });
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method || "GET";
    if (path === "/mcp") {
      if (!opt.mcpHttp) {
        send(res, 404, { error: "not found" });
        return;
      }
      if (!originOk(req)) {
        send(res, 403, { error: "origin not allowed" });
        return;
      }
      let body = void 0;
      if (method === "POST") {
        try {
          body = await readJson(req);
        } catch (e) {
          send(res, errStatus(e), { error: e.message });
          return;
        }
      }
      await opt.mcpHttp(req, res, body);
      return;
    }
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      });
      res.end(page);
      return;
    }
    if (method === "GET" && path === "/api/state") {
      send(res, 200, statePayload(true));
      return;
    }
    if (method === "GET" && path === "/api/stream") {
      if (clients.size >= MAX_SSE_CLIENTS) {
        send(res, 503, { error: "too many viewers" });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" });
      res.write("retry: 3000\n\n");
      writeEvent(res, "init", statePayload(true));
      clients.add(res);
      const hb = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(": hb\n\n");
      }, 15e3);
      hb.unref();
      const drop = () => {
        clearInterval(hb);
        clients.delete(res);
      };
      req.on("close", drop);
      res.on("close", drop);
      res.on("error", drop);
      return;
    }
    if (method === "POST" && (path === "/api/control" || path === "/api/propose")) {
      if (!originOk(req) || !tokenOk(req)) {
        send(res, 403, { error: "forbidden" });
        return;
      }
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        send(res, 415, { error: "application/json required" });
        return;
      }
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        send(res, errStatus(e), { error: e.message });
        return;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        send(res, 400, { error: "object body required" });
        return;
      }
      if (path === "/api/control") {
        const r2 = control(body);
        send(res, r2.ok ? 200 : 400, r2);
        if (r2.ok) broadcast([]);
        return;
      }
      const r = evaluateAdjustment(sim, { xmv: String(body.xmv ?? ""), target: typeof body.target === "number" ? body.target : NaN, rationale: String(body.rationale ?? "") }, { apply: body.apply === true, source: "page" });
      send(res, 200, r);
      broadcast([]);
      return;
    }
    send(res, 404, { error: "not found" });
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log2("web error: " + e.message);
      if (!res.headersSent) send(res, 500, { error: "internal error" });
      else res.end();
    });
  });
  return {
    server,
    token,
    broadcast,
    listen(p, host = "127.0.0.1", attempts = 10) {
      return new Promise((resolve, reject) => {
        let tries = 0;
        const tryPort = (pp) => {
          const onErr = (e) => {
            server.off("listening", onOk);
            if (e.code === "EADDRINUSE" && ++tries < attempts && pp < 65535) tryPort(pp + 1);
            else reject(e);
          };
          const onOk = () => {
            server.off("error", onErr);
            server.on("error", (e) => log2("web server error: " + e.message));
            const a = server.address();
            port = typeof a === "object" && a ? a.port : pp;
            resolve(port);
          };
          server.once("error", onErr);
          server.once("listening", onOk);
          try {
            server.listen(pp, host);
          } catch (e) {
            server.off("error", onErr);
            server.off("listening", onOk);
            reject(e);
          }
        };
        tryPort(p);
      });
    },
    close() {
      for (const c of clients) c.end();
      clients.clear();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

// src/server/main.ts
var SCENARIOS = { normal: 0, "idv4-step5": 5, "idv4-step10": 10 };
var HELP = `plant-context-lab ${SERVER_VERSION} (SIMULATED plant, education only)

Usage: plant-context-lab [options]

  --scenario <name>   normal | idv4-step5 | idv4-step10   (default normal; human-only)
  --port <n>          web viewer port on 127.0.0.1 (default 8787, tries the next 9 if busy)
  --tick-ms <n>       real milliseconds per simulation tick (default 1000; 1 tick = 0.6 sim min)
  --seed <n>          noise seed (default: random)
  --no-web            do not start the web viewer
  --http-mcp          also serve MCP over Streamable HTTP at http://127.0.0.1:<port>/mcp
  --stdio             force MCP over stdio even when stdin is a terminal
  -h, --help          show this help
`;
function log(msg) {
  process.stderr.write("[plant-context-lab] " + msg + "\n");
}
async function main() {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string", default: "normal" },
      port: { type: "string", default: "8787" },
      "tick-ms": { type: "string", default: "1000" },
      seed: { type: "string" },
      "no-web": { type: "boolean", default: false },
      "http-mcp": { type: "boolean", default: false },
      stdio: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    },
    strict: true
  });
  if (values.help) {
    process.stderr.write(HELP);
    return;
  }
  const scenario = String(values.scenario);
  if (!(scenario in SCENARIOS)) throw new Error('unknown scenario "' + scenario + '" (use ' + Object.keys(SCENARIOS).join(", ") + ")");
  const port = Math.max(1, Math.min(65535, parseInt(String(values.port), 10) || 8787));
  const tickMs = Math.max(100, Math.min(1e4, parseInt(String(values["tick-ms"]), 10) || 1e3));
  const seed = values.seed !== void 0 ? parseInt(String(values.seed), 10) >>> 0 : Date.now() >>> 0;
  const sim = createSimulation({ seed });
  if (SCENARIOS[scenario] > 0) sim.injectIdv4(SCENARIOS[scenario], "cli");
  const docs = loadDocs();
  const ctx = { sim, viewerUrl: null };
  const controls = { running: true, speed: 1 };
  let web = null;
  if (!values["no-web"]) {
    const html = readFileSync2(join2(packageRoot(), "index.html"), "utf8");
    const mcpHttp = values["http-mcp"] ? async (req, res, body) => {
      const server = createMcpServer(ctx, docs);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: void 0, enableJsonResponse: true });
      res.on("close", () => {
        transport.close().catch(() => {
        });
        server.close().catch(() => {
        });
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } : void 0;
    try {
      web = createWebApp({ sim, html, controls, mcpHttp, log });
      const bound = await web.listen(port, "127.0.0.1");
      ctx.viewerUrl = "http://127.0.0.1:" + bound + "/";
      log("viewer (connected mode): " + ctx.viewerUrl);
      if (mcpHttp) log("MCP Streamable HTTP: http://127.0.0.1:" + bound + "/mcp");
    } catch (e) {
      web = null;
      log("web viewer not started (" + e.message + "); continuing with MCP only");
    }
  }
  log("scenario: " + scenario + " · seed " + seed + " · tick " + tickMs + " ms = 0.6 simulated min");
  const timer = setInterval(() => {
    if (!controls.running) {
      web?.broadcast([]);
      return;
    }
    const samples = [];
    for (let i = 0; i < controls.speed; i++) {
      sim.step();
      samples.push(sim.sample());
    }
    web?.broadcast(samples);
  }, tickMs);
  let closing = false;
  const shutdown = async (why) => {
    if (closing) return;
    closing = true;
    log("shutting down (" + why + ")");
    clearInterval(timer);
    setTimeout(() => process.exit(0), 2e3).unref();
    if (web) await web.close().catch(() => {
    });
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  if (!process.stdin.isTTY || values.stdio) {
    const server = createMcpServer(ctx, docs);
    const transport = new StdioServerTransport();
    transport.onclose = () => {
      void shutdown("MCP stdio closed");
    };
    process.stdin.on("end", () => {
      void shutdown("stdin ended");
    });
    await server.connect(transport);
    log("MCP server on stdio");
  } else {
    log("stdin is a terminal: MCP stdio not started (an MCP client starts this command itself). Ctrl+C to stop.");
  }
}
main().catch((e) => {
  log("fatal: " + e.message);
  process.exit(1);
});
export {
  SCENARIOS
};
