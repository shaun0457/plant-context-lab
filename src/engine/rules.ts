/**
 * Deterministic rule layer.
 *
 * Only limits that are (a) approved in the staged knowledge revision shown on the
 * page and (b) published by Downs & Vogel (1993) are used. Every other signal is
 * reported as having no reviewed limit; nothing is guessed.
 *
 * States: NORMAL < ATTENTION < ALARM < TRIP.
 *   ALARM     value above the approved normal operating upper limit
 *   TRIP      value at or above the approved shutdown limit
 *   ATTENTION value inside the last 25 % of headroom between the nominal value and
 *             the normal upper limit. This band is a demo convention derived from
 *             the approved limit, not a published limit, and is labelled as such.
 */
import { KR } from './knowledge.ts';
import { SIG, SIGNAL_IDS } from './signals.ts';

export type RuleState = 'NORMAL' | 'ATTENTION' | 'ALARM' | 'TRIP';
export const STATE_ORDER: Record<RuleState, number> = { NORMAL: 0, ATTENTION: 1, ALARM: 2, TRIP: 3 };

export interface RuleSource {
  /** knowledge fragment id in the staged revision, or null for derived rules */
  knowledge: string | null;
  review: string | null;
  publication: string | null;
  derivedFrom?: string;
}

export interface LimitRule {
  id: string;
  signal: string;
  kind: 'ATTENTION_BAND' | 'NORMAL_UPPER' | 'SHUTDOWN_HIGH';
  comparator: '>=' | '>';
  value: number;
  unit: string;
  state: Exclude<RuleState, 'NORMAL'>;
  source: RuleSource;
  note: string;
}

const DV = 'Downs & Vogel (1993), process operating constraints';
export const ATTENTION_HEADROOM_FRACTION = 0.25;

function attentionValue(nominal: number, normalUpper: number): number {
  return +(normalUpper - ATTENTION_HEADROOM_FRACTION * (normalUpper - nominal)).toFixed(2);
}

export const RULES: readonly LimitRule[] = [
  {
    id: 'RL-XMEAS9-ATT', signal: 'XMEAS(9)', kind: 'ATTENTION_BAND', comparator: '>=', value: attentionValue(120.40, 150), unit: 'degC', state: 'ATTENTION',
    source: { knowledge: null, review: null, publication: null, derivedFrom: 'RL-XMEAS9-NU' },
    note: 'Demo convention: last 25 % of headroom from nominal 120.40 to the approved normal upper 150 degC. Not a published limit.',
  },
  {
    id: 'RL-XMEAS9-NU', signal: 'XMEAS(9)', kind: 'NORMAL_UPPER', comparator: '>', value: 150, unit: 'degC', state: 'ALARM',
    source: { knowledge: KR.row2.id, review: KR.row2.rv, publication: DV },
    note: 'Normal operating upper limit. Must not be used as the shutdown threshold. A competing 145 degC claim was rejected (review-11).',
  },
  {
    id: 'RL-XMEAS9-SD', signal: 'XMEAS(9)', kind: 'SHUTDOWN_HIGH', comparator: '>=', value: 175, unit: 'degC', state: 'TRIP',
    source: { knowledge: KR.row2.id, review: KR.row2.rv, publication: DV },
    note: 'Shutdown high limit. The lumped model has no interlock; TRIP is reported, not executed.',
  },
  {
    id: 'RL-XMEAS7-ATT', signal: 'XMEAS(7)', kind: 'ATTENTION_BAND', comparator: '>=', value: attentionValue(2705.0, 2895), unit: 'kPa gauge', state: 'ATTENTION',
    source: { knowledge: null, review: null, publication: null, derivedFrom: 'RL-XMEAS7-NU' },
    note: 'Demo convention: last 25 % of headroom from nominal 2705.0 to the approved normal upper 2895 kPa gauge. Not a published limit.',
  },
  {
    id: 'RL-XMEAS7-NU', signal: 'XMEAS(7)', kind: 'NORMAL_UPPER', comparator: '>', value: 2895, unit: 'kPa gauge', state: 'ALARM',
    source: { knowledge: KR.row1.id, review: KR.row1.rv, publication: DV },
    note: 'Normal operating upper limit.',
  },
  {
    id: 'RL-XMEAS7-SD', signal: 'XMEAS(7)', kind: 'SHUTDOWN_HIGH', comparator: '>=', value: 3000, unit: 'kPa gauge', state: 'TRIP',
    source: { knowledge: KR.row1.id, review: KR.row1.rv, publication: DV },
    note: 'Shutdown high limit. The lumped model has no interlock; TRIP is reported, not executed.',
  },
];

export const RULED_SIGNALS: readonly string[] = Array.from(new Set(RULES.map((r) => r.signal)));

/** Signals with an explicit reviewed statement that no limit is specified. */
export const EXPLICITLY_UNSPECIFIED: Record<string, string> = {
  'XMEAS(21)': KR.row3.id,
};

export interface SignalRuleResult {
  signal: string;
  name: string;
  value: number;
  unit: string;
  state: RuleState;
  /** id of the rule that set the state, or null when NORMAL */
  ruleId: string | null;
  nextLimit: { ruleId: string; value: number; state: RuleState } | null;
  headroomToNormalUpper: number | null;
}

export interface RulesResult {
  worst: { state: RuleState; signal: string | null; ruleId: string | null };
  signals: SignalRuleResult[];
  /** process signals with no reviewed limit (reported, never guessed) */
  noReviewedLimit: string[];
}

function triggered(rule: LimitRule, v: number): boolean {
  return rule.comparator === '>=' ? v >= rule.value : v > rule.value;
}

export function evaluateRules(values: Record<string, number>): RulesResult {
  const out: SignalRuleResult[] = [];
  let worst: RulesResult['worst'] = { state: 'NORMAL', signal: null, ruleId: null };
  RULED_SIGNALS.forEach((sig) => {
    const v = values[sig];
    const rules = RULES.filter((r) => r.signal === sig).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
    let state: RuleState = 'NORMAL';
    let ruleId: string | null = null;
    let next: SignalRuleResult['nextLimit'] = null;
    for (const r of rules) {
      if (Number.isFinite(v) && triggered(r, v)) { state = r.state; ruleId = r.id; }
      else if (!next) next = { ruleId: r.id, value: r.value, state: r.state };
    }
    const nu = rules.find((r) => r.kind === 'NORMAL_UPPER');
    out.push({
      signal: sig, name: SIG[sig][0], value: v, unit: SIG[sig][1], state, ruleId, nextLimit: next,
      headroomToNormalUpper: nu && Number.isFinite(v) ? +(nu.value - v).toFixed(3) : null,
    });
    if (STATE_ORDER[state] > STATE_ORDER[worst.state]) worst = { state, signal: sig, ruleId };
  });
  const noReviewedLimit = SIGNAL_IDS.filter((id) => id.startsWith('XMEAS(') && !RULED_SIGNALS.includes(id));
  return { worst, signals: out, noReviewedLimit };
}

export function worseState(a: RuleState, b: RuleState): RuleState {
  return STATE_ORDER[a] >= STATE_ORDER[b] ? a : b;
}
