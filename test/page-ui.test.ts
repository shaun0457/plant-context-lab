// Calm default view: the "Show sources" toggle, the collapsed "About this demo" section,
// and plain wording in what a first-time visitor sees. DOM-free: checks the template and
// runs the small preference helpers in a sandbox with a stub localStorage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { STRINGS } from '../src/page/strings.ts';
import { SERVER_VERSION } from '../src/server/mcp.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const tpl = readFileSync(root + 'web/index.template.html', 'utf8');
const html = readFileSync(root + 'index.html', 'utf8');
const CJK = /[㐀-䶿一-鿿]/;

/** the one-line helper definitions, evaluated against a fake window.localStorage */
function prefHelpers(store: { getItem(k: string): string | null; setItem(k: string, v: string): void }) {
  const src = ['SKEY', 'readSrcPref', 'writeSrcPref'].map((name) => {
    const re = name === 'SKEY' ? /var SKEY='[^']+',SRC=false;/ : new RegExp('function ' + name + '\\([^)]*\\)\\{.*\\}');
    const m = re.exec(tpl);
    assert.ok(m, name + ' not found in the template');
    return m[0];
  }).join('\n');
  const ctx = vm.createContext({ window: { localStorage: store } });
  vm.runInContext(src + '\nthis.read=readSrcPref;this.write=writeSrcPref;this.key=SKEY;', ctx);
  return ctx as unknown as { read(): boolean; write(on: boolean): void; key: string };
}

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

test('sources toggle: off by default, remembered under pcl-sources, and safe without storage', () => {
  const s = memStore();
  const h = prefHelpers(s);
  assert.equal(h.key, 'pcl-sources');
  assert.equal(h.read(), false, 'nothing stored: sources hidden');
  h.write(true);
  assert.equal(s.m.get('pcl-sources'), '1');
  assert.equal(h.read(), true, 'remembered on');
  h.write(false);
  assert.equal(s.m.get('pcl-sources'), '0');
  assert.equal(h.read(), false, 'remembered off');
  assert.equal(prefHelpers(memStore({ 'pcl-sources': 'yes' })).read(), false, 'only "1" turns it on');
  const broken = prefHelpers({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(broken.read(), false, 'blocked storage: default off');
  assert.doesNotThrow(() => broken.write(true));
});

test('sources toggle: the static page starts with sources hidden and the button wired to the stored choice', () => {
  assert.match(tpl, /<body>/, 'body has no src-on class before the script runs');
  const btn = /<button type="button" class="btn srcbtn" id="bSrc"[^>]*data-i18n="src.show">顯示來源<\/button>/.exec(tpl);
  assert.ok(btn, 'sources button with its static label');
  // the label swaps (顯示來源 / 隱藏來源), so aria-pressed would double the state ("隱藏來源, pressed")
  assert.doesNotMatch(btn[0], /aria-pressed/);
  assert.doesNotMatch(/function setSources\([^)]*\)\{[\s\S]*?\n\}/.exec(tpl)![0], /aria-pressed/);
  assert.match(tpl, /applyStatic\(\);\r?\nsetSources\(readSrcPref\(\),false\);/, 'boot applies the remembered choice without rewriting it');
  assert.match(tpl, /if\(e\.target\.closest\('#bSrc'\)\)\{setSources\(!SRC,true\);return;\}/, 'a click flips and remembers it');
  // hidden by default: technical ids, source-only elements and reference chips (one "keep" chip per panel at most)
  assert.match(tpl, /body:not\(\.src-on\) \.src,body:not\(\.src-on\) \.tid,body:not\(\.src-on\) \.ref:not\(\.keep\)\{display:none!important\}/);
  for (const id of ['cT', 'cK']) assert.match(tpl, new RegExp('class="[^"]*\\bsrc\\b[^"]*" id="' + id + '"'), id + ' is sources-only');
  assert.ok(html.includes('setSources(readSrcPref(),false)'), 'built page carries the toggle');
  // <option> text cannot hide a span: the valve list shows the XMV id only in the sources view, rebuilt on toggle
  assert.match(tpl, /esc\(sigName\(id\)\)\+\(SRC\?' · '\+id:''\)/);
  assert.match(/function setSources\([^)]*\)\{[\s\S]*?\n\}/.exec(tpl)![0], /renderXmvOptions\(\)/);
});

test('info buttons: one topic label each, aria-controls their panel, Esc closes them', () => {
  const labels = new Set<string>();
  for (const [id, key] of [['mRule', 'ui.moreRule'], ['mPca', 'ui.morePca'], ['mLoop', 'ui.moreLoop']]) {
    const b = new RegExp('<button type="button" class="ib" data-more="' + id + '" aria-controls="' + id + '" aria-expanded="false" data-i18n-aria="' + key + '" aria-label="([^"]+)">').exec(tpl);
    assert.ok(b, id + ' button');
    assert.equal(b[1], STRINGS.zh[key]);
    labels.add(STRINGS.zh[key]).add(STRINGS.en[key]);
    assert.match(tpl, new RegExp('<div class="more" id="' + id + '" hidden>'), id + ' panel starts closed');
  }
  assert.equal(labels.size, 6, 'every label names its topic');
  assert.match(tpl, /if\(e\.key==='Escape'\)\{var open=\$\$\('\[data-more\]\[aria-expanded="true"\]'\);\s*if\(open\.length\)\{open\.forEach\(function\(b\)\{setMore\(b,false\)\}\);return;\}\}/);
});

test('connected mode: the simulation overlay needs a snapshot, its caption hides the id, and a lost stream shows in the LLM status', () => {
  const simOn = /function simOn\(\)\{[\s\S]*?\n\}/.exec(tpl)![0];
  assert.match(simOn, /!sv\|\|!sv\.snapshot\|\|!isFinite\(\+sv\.snapshot\.K\)/);
  const cap = /function renderSimCap\(\)\{[\s\S]*?\n\}/.exec(tpl)![0];
  assert.match(cap, /tid\(String\(sv\.snapshot\.id\|\|''\)\)/, 'snapshot id only in the sources view');
  for (const lang of ['en', 'zh'] as const) assert.doesNotMatch(STRINGS[lang]['act.simCap'], /\{snap\}/);
  assert.match(tpl, /es\.onerror=function\(\)\{STREAM_LOST=true;setMode\('mode\.lost'\);renderLlmStatus\(\);\};/);
  assert.match(tpl, /addEventListener\('init',function\(ev\)\{STREAM_LOST=false;/);
  assert.match(tpl, /txt=STREAM_LOST\?t\('act\.streamLost'\)/);
});

test('template attributes are separated by spaces', () => {
  const markup = tpl.slice(0, tpl.indexOf('<script>'));
  assert.ok(markup.length > 10000);
  assert.doesNotMatch(markup, /="[^"\n]*"[a-z]/, 'an attribute runs into the next one');
});

test('About this demo: one collapsed section holding the context-layer strip and the built / in-progress badges', () => {
  const m = /<details class="fold about" id="about">([\s\S]*?)<\/details>/.exec(tpl);
  assert.ok(m, 'about section is a <details> without the open attribute');
  const body = m[1];
  assert.match(body, /<summary data-i18n="ft.about">關於這個 demo<\/summary>/);
  for (const k of ['ft.hon', 'ft.c1', 'ft.c2', 'ft.c3', 'ft.c4', 'ft.c5', 'ft.c6']) assert.ok(body.includes('data-i18n="' + k + '"'), k);
  assert.ok(body.includes('id="strip"'), 'context-layer strip lives inside About');
  assert.doesNotMatch(tpl, /#about'\)\.open|getElementById\('about'\)\.open|setAttribute\('open'/, 'nothing opens it by script');
  // the visible footer is a single line with the GitHub link (protocol-relative: the static page has no http URL)
  const foot = /<footer class="foot">\s*<div class="ftline">([\s\S]*?)<\/div>\s*<details/.exec(tpl);
  assert.ok(foot, 'footer starts with one line');
  assert.match(foot[1], /data-i18n-html="ft.line"/);
  assert.match(foot[1], /<a href="\/\/github\.com\/shaun0457\/plant-context-lab" target="_blank" rel="noopener noreferrer" data-i18n="ft.repo">/);
  assert.doesNotMatch(html, /https?:/i);
});

test('own-LLM setup: collapsed fold with three tabs whose snippets pin the package.json version tag', () => {
  const ver = JSON.parse(readFileSync(root + 'package.json', 'utf8')).version;
  const pin = 'github:shaun0457/plant-context-lab#v' + ver;
  assert.equal(SERVER_VERSION, ver, 'MCP server reports the package version');
  assert.match(tpl, /<details class="fold" id="orFold"><summary data-i18n="or\.llmFold">/, 'fold starts collapsed (no open attribute)');
  assert.doesNotMatch(tpl, /orFold'\)\.open|#orFold[^;]*open=/, 'nothing opens it by script');
  // tablist with roving tabindex: the first tab is selected, the other panels start hidden
  assert.match(tpl, /<div class="or-tabs" role="tablist" data-i18n-aria="or\.tabsAria"/);
  const tabs = [['Cc', 'true', '0'], ['Cx', 'false', '-1'], ['Js', 'false', '-1']];
  for (const [id, sel, ti] of tabs) {
    assert.match(tpl, new RegExp('role="tab" data-tab id="tab' + id + '" aria-controls="pane' + id + '" aria-selected="' + sel + '" tabindex="' + ti + '"'), 'tab ' + id);
    assert.match(tpl, new RegExp('<div class="or-pane" role="tabpanel" id="pane' + id + '" aria-labelledby="tab' + id + '"' + (sel === 'true' ? '>' : ' hidden>')), 'panel ' + id);
  }
  assert.match(tpl, /\/\^\(ArrowLeft\|ArrowRight\|Home\|End\)\$\/\.test\(e\.key\)/, 'arrow keys move between tabs');
  // the ref is derived at build time: hand-typed tags in the template would drift from package.json
  assert.doesNotMatch(tpl, /plant-context-lab#v\d/);
  assert.ok(!html.includes('__PCL_REF__'));
  const snip = (id: string) => {
    const m = new RegExp('<pre class="or-pre" id="' + id + '" tabindex="0">([\\s\\S]*?)</pre>').exec(html);
    assert.ok(m, id + ' snippet');
    return m[1];
  };
  assert.equal(snip('snCc'), 'claude mcp add plant-context-lab -- npx -y ' + pin);
  const cx = snip('snCx').replace(/\r\n/g, '\n');
  assert.equal(cx, '[mcp_servers.plant-context-lab]\ncommand = "npx"\nargs = ["-y", "' + pin + '", "--scenario", "idv4-step5"]\nstartup_timeout_sec = 60');
  const js = JSON.parse(snip('snJs'));
  assert.deepEqual(js, { mcpServers: { 'plant-context-lab': { command: 'npx', args: ['-y', pin, '--scenario', 'idv4-step5'] } } });
  assert.match(STRINGS.en['or.jsWin'], /"cmd"/);
  // the viewer address has no scheme (the static page carries no http URL)
  for (const lang of ['en', 'zh'] as const) assert.ok(STRINGS[lang]['or.mcpIntro'].includes('127.0.0.1:8787') && STRINGS[lang]['or.mcpIntro'].includes('22.18'));
});

test('copy buttons: a working clipboard says copied; a throwing, rejecting or missing one selects the text instead', async () => {
  const src = ['copyText', 'selectNode', 'copySnippet'].map((name) => {
    const m = new RegExp('function ' + name + '\\([^)]*\\)\\{.*\\}').exec(tpl);
    assert.ok(m, name + ' not found in the template');
    return m[0];
  }).join('\n');
  const run = async (nav: unknown) => {
    const hint = { attrs: {} as Record<string, string>, textContent: '', setAttribute(k: string, v: string) { this.attrs[k] = v; } };
    const pre = { textContent: 'claude mcp add x' };
    let selected: unknown = null;
    const ctx = vm.createContext({
      t: (k: string) => 'T:' + k,
      document: { getElementById: (id: string) => (id === 'snCc' ? pre : id === 'snCcH' ? hint : null), createRange: () => ({ selectNodeContents(n: unknown) { selected = n; } }) },
      window: { navigator: nav, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    });
    vm.runInContext(src, ctx);
    const btn = { getAttribute: (k: string) => (k === 'data-copy' ? 'snCc' : null) };
    assert.doesNotThrow(() => (ctx as unknown as { copySnippet(b: unknown): void }).copySnippet(btn));
    await new Promise((r) => setTimeout(r, 0));
    return { hint, selected, pre };
  };
  const ok = await run({ clipboard: { writeText: (s: string) => { assert.equal(s, 'claude mcp add x'); return Promise.resolve(); } } });
  assert.equal(ok.hint.textContent, 'T:or.copied');
  assert.equal(ok.selected, null);
  for (const nav of [
    { clipboard: { writeText() { throw new Error('blocked'); } } },
    { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    {},
    undefined,
  ]) {
    const r = await run(nav);
    assert.equal(r.hint.textContent, 'T:or.copyFail');
    assert.equal(r.hint.attrs['data-i18n'], 'or.copyFail', 'hint re-translates on a language switch');
    assert.equal(r.selected, r.pre, 'text selected for a manual copy');
  }
});

test('new UI strings exist in both languages and the Chinese ones are Chinese', () => {
  const keys = ['or.mcpIntro', 'or.tabsAria', 'or.tabJson', 'or.ccWhere', 'or.cxWhere', 'or.jsWhere', 'or.jsWin', 'or.copy', 'or.copyCc', 'or.copyCx', 'or.copyJs', 'or.copied', 'or.copyFail',
    'src.show', 'src.hide', 'src.tip', 'ui.moreRule', 'ui.morePca', 'ui.moreLoop', 'act.streamLost','hd.sub', 'or.llmFold', 'ft.line', 'ft.repo', 'ft.about', 'now.more',
    'now.mHint', 'now.mValve', 'now.mFirst', 'now.mManual', 'pp.gateShort', 'pp.gateMore', 'sf.rulesMore', 'sf.pcaMore', 'sf.loopMore',
    'sd.provSrc', 'sd.comp', 'tr.badgeConn', 'tr.now', 'tr.injMark', 'st.kPlant', 'st.kKnow', 'st.kSnap', 'st.kRefs', 'pv.pid', 'pv.graph',
    'vd.ACCEPT', 'vd.REJECT', 'vd.ERROR', 'lm.AUTO', 'lm.MANUAL', 'kn.LIMIT', 'sig.XMV10', 'sig.XMEAS9', 'sig.comp'];
  for (const k of keys) {
    assert.ok(STRINGS.en[k] && STRINGS.zh[k], 'missing in a language: ' + k);
    assert.match(STRINGS.zh[k], CJK, 'zh string is not Chinese: ' + k);
  }
});

test('plain language: what a first-time visitor reads by default carries no specialist ids or jargon', () => {
  // keys rendered in the default view (not the sources view, the info panels or About)
  const visible = Object.keys(STRINGS.en).filter((k) => /^(or\.(what|try|s\d)|guide\.|vd\.|lm\.|stz\.|sf\.(rules|pca|loop|top|pcaExc|pcaOk|topRef|loopMan|loopAuto|auto)$|pv\.(title|pid|graph|material|utility|hop|hint)$|hl\.|sd\.(signals|noSignals|xmv|prov|knowledge|noKnowledge|impact|depth|show)$|kn\.|kt\.|imp\.|sig\.|tr\.(?!opt)|now\.(title|st|t|m)|pp\.(?!badge)|g\.(?!simSpe)|rz\.|log\.(?!empty)|ft\.(line|repo|about))/.test(k));
  assert.ok(visible.length > 120, 'checked ' + visible.length);
  const jargon = /\b(PCA|T²|SPE|gate|provenance|binding|snapshot|fragment|frag-|tags-and-limits|XMV|XMEAS|IDV|setpoint|context layer|ACCEPT|REJECT|APPROVE)\b|IDV\(|XMV\(|XMEAS\(/i;
  for (const k of visible) for (const lang of ['en', 'zh'] as const) assert.doesNotMatch(STRINGS[lang][k], jargon, lang + ' ' + k);
});
