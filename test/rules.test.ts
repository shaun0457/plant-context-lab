import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KR } from '../src/engine/knowledge.ts';
import { evaluateRules, RULES } from '../src/engine/rules.ts';
import { SIG } from '../src/engine/signals.ts';

const nominal = () => Object.fromEntries(Object.keys(SIG).map((id) => [id, SIG[id][2]]));

test('rules use only the approved limits, each with id and source', () => {
  const byId = Object.fromEntries(RULES.map((r) => [r.id, r]));
  assert.equal(byId['RL-XMEAS9-NU'].value, 150);
  assert.equal(byId['RL-XMEAS9-SD'].value, 175);
  assert.equal(byId['RL-XMEAS7-NU'].value, 2895);
  assert.equal(byId['RL-XMEAS7-SD'].value, 3000);
  for (const r of RULES) {
    assert.match(r.id, /^RL-/);
    if (r.kind === 'ATTENTION_BAND') {
      assert.equal(r.source.knowledge, null);
      assert.ok(r.source.derivedFrom, 'derived rule names its parent');
      assert.match(r.note, /Not a published limit/);
    } else {
      assert.ok([KR.row1.id, KR.row2.id].includes(r.source.knowledge as string));
      assert.match(String(r.source.publication), /Downs & Vogel \(1993\)/);
    }
  }
  assert.ok(!RULES.some((r) => r.value === 145), 'the rejected 145 degC claim is never a rule');
  assert.deepEqual([...new Set(RULES.map((r) => r.signal))].sort(), ['XMEAS(7)', 'XMEAS(9)']);
});

test('state boundaries: NORMAL, ATTENTION, ALARM, TRIP', () => {
  const cases: [number, string][] = [[120.4, 'NORMAL'], [142.59, 'NORMAL'], [142.6, 'ATTENTION'], [150, 'ATTENTION'], [150.01, 'ALARM'], [174.99, 'ALARM'], [175, 'TRIP'], [200, 'TRIP']];
  for (const [v, st] of cases) {
    const r = evaluateRules({ ...nominal(), 'XMEAS(9)': v });
    const s9 = r.signals.find((s) => s.signal === 'XMEAS(9)')!;
    assert.equal(s9.state, st, 'XMEAS(9)=' + v);
  }
  const p = evaluateRules({ ...nominal(), 'XMEAS(7)': 2900 });
  assert.equal(p.worst.state, 'ALARM');
  assert.equal(p.worst.ruleId, 'RL-XMEAS7-NU');
  const t = evaluateRules({ ...nominal(), 'XMEAS(7)': 3000, 'XMEAS(9)': 151 });
  assert.equal(t.worst.state, 'TRIP');
  assert.equal(t.worst.ruleId, 'RL-XMEAS7-SD');
});

test('signals without a reviewed limit are reported, never guessed', () => {
  const r = evaluateRules(nominal());
  assert.equal(r.worst.state, 'NORMAL');
  assert.ok(r.noReviewedLimit.includes('XMEAS(21)'));
  assert.ok(r.noReviewedLimit.includes('XMEAS(8)'));
  assert.ok(!r.noReviewedLimit.includes('XMEAS(9)'));
  assert.equal(r.signals.length, 2);
  const nan = evaluateRules({ ...nominal(), 'XMEAS(9)': NaN });
  assert.equal(nan.signals.find((s) => s.signal === 'XMEAS(9)')!.state, 'NORMAL');
});
