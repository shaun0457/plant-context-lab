// Page language: Traditional Chinese by default, English through the toggle or ?lang=en.
// DOM-free checks: string tables are complete in both languages, and nothing the
// English page can show (English strings, English engine fields, the script) contains CJK.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GATE_PARAMS, KNOW, KR, LOOPS, RULES, SHORT, SIG, STATE_ORDER, TEDGES, TNODES, createSimulation, evaluateAdjustment } from '../src/engine/index.ts';
import { STRINGS } from '../src/page/strings.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');
const CJK = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
/** the one intentional CJK text in English mode: the language toggle label, marked lang="zh-Hant" */
const TOGGLE = /<button type="button" data-lang="zh" lang="zh-Hant"[^>]*>中文<\/button>/;

test('every string key exists in both languages with the same placeholders', () => {
  const en = Object.keys(STRINGS.en).sort();
  const zh = Object.keys(STRINGS.zh).sort();
  assert.deepEqual(zh, en);
  for (const k of en) {
    assert.ok(STRINGS.en[k].length > 0 && STRINGS.zh[k].length > 0, 'empty string: ' + k);
    assert.equal(placeholders(STRINGS.zh[k]), placeholders(STRINGS.en[k]), 'placeholders differ: ' + k);
  }
});

test('English strings contain no CJK characters', () => {
  for (const [k, v] of Object.entries(STRINGS.en)) assert.doesNotMatch(v, CJK, k);
});

test('every key the page uses is defined, including the dynamic ones', () => {
  const tpl = read('web/index.template.html');
  const used = new Set<string>();
  for (const m of tpl.matchAll(/data-i18n(?:-html|-title|-aria|-ph)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of tpl.matchAll(/\bt\('([\w.]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]); // 'stz.' + state, 'rz.' + code: added below
  for (const m of tpl.matchAll(/\bt\([^()]*\?'([\w.]+)':'([\w.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of tpl.matchAll(/'(guide\.\w+)'/g)) used.add(m[1]); // guided-run caption keys passed to guideCaption()
  for (const s of Object.keys(STATE_ORDER)) used.add('stz.' + s);
  for (const c of ['XMV_UNKNOWN', 'XMV_NOT_MODELLED', 'TARGET_INVALID', 'TARGET_OUT_OF_RANGE', 'RATIONALE_MISSING', 'TRIP_ACTIVE', 'STEP_TOO_LARGE', 'RATE_LIMIT', 'SIM_RULE_TRIP', 'SIM_RULE_ALARM', 'SIM_HEADROOM_LOSS', 'PCA_SPE_WORSENS']) used.add('rz.' + c);
  assert.ok(used.size > 150, 'scan found too few keys: ' + used.size);
  for (const k of used) assert.ok(k in STRINGS.en, 'missing string key: ' + k);
});

test('gate reason codes the engine emits all have a label', () => {
  const sim = createSimulation({ seed: 3 });
  const seen = new Set<string>();
  for (const p of [{ xmv: 'XMV(99)', target: 50, rationale: '' }, { xmv: 'XMV(3)', target: 150, rationale: 'x' }, { xmv: 'XMV(10)', target: Number.NaN, rationale: 'x' }, { xmv: 'XMV(10)', target: 99, rationale: 'x' }]) {
    for (const r of evaluateAdjustment(sim, p, { apply: false, source: 'test' }).reasons) seen.add(r.code);
  }
  assert.ok(seen.size >= 5);
  for (const c of seen) assert.ok(('rz.' + c) in STRINGS.en, c);
  assert.ok(GATE_PARAMS.maxStepPct > 0);
});

const unesc = (v: string) => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ATTR: [string, string][] = [['data-i18n-title', 'title'], ['data-i18n-aria', 'aria-label'], ['data-i18n-ph', 'placeholder']];

/**
 * Checks that the template's static text is the Chinese table (so the page is right before any
 * script runs), and returns the template with every translated text and attribute blanked out.
 */
function staticTextChecked(): { rest: string; n: number } {
  let s = read('web/index.template.html');
  let n = 0;
  s = s.replace(/(data-i18n="([\w.]+)"[^>]*>)([^<]*)</g, (_m, head: string, k: string, text: string) => {
    n++;
    assert.equal(unesc(text), STRINGS.zh[k], k);
    return head + '<';
  });
  s = s.replace(/(data-i18n-html="([\w.]+)"[^>]*>)(.*?)(<\/(?:p|span)>)(?=\s*(?:<\/|<div|$))/gm, (_m, head: string, k: string, html: string, tail: string) => {
    n++;
    assert.equal(html, STRINGS.zh[k], k);
    return head + tail;
  });
  s = s.replace(/<[^<>]*data-i18n-(?:title|aria|ph)="[^"]*"[^<>]*>/g, (tag) => {
    for (const [da, attr] of ATTR) {
      const k = new RegExp(da + '="([\\w.]+)"').exec(tag);
      if (!k) continue;
      const re = new RegExp('(\\s' + attr + '=")([^"]*)(")');
      const v = re.exec(tag);
      assert.ok(v, attr + ' missing for ' + k[1]);
      n++;
      assert.equal(unesc(v[2]), STRINGS.zh[k[1]], k[1]);
      tag = tag.replace(re, (_x, a: string, _b: string, c: string) => a + c);
    }
    return tag;
  });
  return { rest: s, n };
}

test('static text in the template is the Traditional Chinese table (correct before any script runs)', () => {
  const { n } = staticTextChecked();
  assert.ok(n > 60, 'checked ' + n);
  const tpl = read('web/index.template.html');
  assert.match(tpl, /<html lang="zh-Hant">/);
  assert.match(tpl, /id="pWhy"[^>]*value="([^"]*)"/);
  assert.equal(unesc(/id="pWhy"[^>]*value="([^"]*)"/.exec(tpl)![1]), STRINGS.zh['pp.whyDefault']);
});

test('English rendering path: outside the translated static text the template has no CJK', () => {
  // whatever the script writes comes from t() (English table, checked above) or zhv(); so no
  // CJK may remain once the Chinese static text, the toggle label, the meta description and
  // the default rationale (all replaced or invisible in English mode) are taken out
  let { rest } = staticTextChecked();
  assert.match(rest, TOGGLE);
  rest = rest.replace(TOGGLE, '').replace(/<meta name="description" content="[^"]*">/, '').replace(/(id="pWhy"[^>]*value=")[^"]*"/, '$1"');
  const bad = rest.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => CJK.test(l));
  assert.deepEqual(bad, []);
});

test('engine fields shown in English mode have no CJK; Chinese engine fields are read only through zhv()', () => {
  const english: string[] = [];
  for (const items of Object.values(KNOW)) for (const x of items) english.push(x.t, x.txt);
  for (const r of Object.values(KR)) english.push(r.id, r.rv);
  for (const l of LOOPS) english.push(l.name, l.path);
  for (const v of Object.values(SIG)) english.push(v[0], v[1]);
  for (const n of TNODES) english.push(n.name);
  for (const e of TEDGES) english.push(e.name);
  english.push(...Object.values(SHORT));
  for (const r of RULES) english.push(r.id, r.unit);
  for (const s of english) assert.doesNotMatch(s, CJK, s);

  const tpl = read('web/index.template.html');
  const zhRefs = [...tpl.matchAll(/(?:\bZH\[|\.txtZh\b|\.rvZh\b|\.nameZh\b)/g)].length;
  const guarded = [...tpl.matchAll(/zhv\((?:ZH\[|[\w.]+\.(?:txtZh|rvZh|nameZh)\b)/g)].length;
  assert.ok(zhRefs > 0);
  assert.equal(guarded, zhRefs, 'read Chinese engine fields only as the first argument of zhv()');
});

test('built page defaults to Traditional Chinese and carries both string tables', () => {
  const html = read('index.html');
  assert.match(html, /<html lang="zh-Hant">/);
  assert.ok(html.includes('var PCL_I18N='));
  assert.ok(!html.includes('__PCL_I18N__'));
  assert.ok(html.includes('30 秒上手') && html.includes('Try it in 30 seconds'));
  assert.ok(html.includes('npx -y github:shaun0457/plant-context-lab'));
  assert.match(html, /return okLang\(s\)\?s:'zh';/, 'fallback language is Traditional Chinese');
  assert.doesNotMatch(html, /https?:/i);
});

test('the string table inlined in index.html round-trips to exactly STRINGS', () => {
  const html = read('index.html');
  const start = html.indexOf('var PCL_I18N=');
  const end = html.indexOf(';</script>', start);
  assert.ok(start >= 0 && end > start);
  const literal = html.slice(start + 'var PCL_I18N='.length, end);
  assert.ok(!literal.includes('<'), 'every < in the strings is escaped inside the script');
  assert.deepEqual(JSON.parse(literal), STRINGS);
});
