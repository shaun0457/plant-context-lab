// Committed build outputs (index.html for Pages, dist/ for npx) must match the sources.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inputHash } from '../scripts/build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

test('index.html and dist/ are built from the current sources', () => {
  const info = JSON.parse(read('dist/build-info.json'));
  assert.equal(info.inputs, inputHash(), 'run npm run build and commit the outputs');
});

test('static page is self-contained and offline', () => {
  const html = read('index.html');
  assert.ok(html.includes('var PCL='), 'engine is inlined');
  assert.ok(!html.includes('__PCL_ENGINE__'));
  assert.doesNotMatch(html, /https?:/i);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="(?!data:)/i);
  // names that must never appear in the page UI (base64 so they do not appear in the repo either)
  for (const b of ["Y29udGV4dC9mYWI=","Q29udGV4dCBGYWI=","T3Blcm9u"]) { const s = Buffer.from(b, 'base64').toString('utf8'); assert.ok(!html.includes(s), 'forbidden name present'); }
  for (const s of ['概念示範', '瀏覽器內模擬', '現在發生什麼', '調整提案', '檢查紀錄']) assert.ok(html.includes(s), s);
});
