import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import Readability from '../vendor/readability/Readability.cjs';
import { extract } from '../src/page';
import { visible } from './fixture-helpers';

// Keep the real getter (upstream reads it for diagnostics). Reject every write,
// including writes to nodes detached from the page.
function forbidHtmlWrites(t: TestContext, win: Window & typeof globalThis) {
  const proto = win.Element.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  assert.ok(descriptor?.get);
  Object.defineProperty(proto, 'innerHTML', { ...descriptor, set() { throw new Error('Unexpected HTML parsing sink'); } });
  t.after(() => { Object.defineProperty(proto, 'innerHTML', descriptor); win.close(); });
}

test('retry restores fresh children and the longest attempt retains paragraph order', t => {
  const win = new JSDOM('<body><p>Opening paragraph.</p><div class="sidebar"><p>Recovered middle paragraph.</p></div><p>Closing paragraph.</p></body>').window;
  forbidHtmlWrites(t, win);
  const r = new Readability(win.document.cloneNode(true), { serializer: root => root.textContent });
  const result = r.parse();
  const attempts = (r as unknown as { _attempts: { articleContent: Element }[] })._attempts;
  assert.equal(attempts.length, 4); // Short page: all fallback policies, then pick the longest.
  assert.ok(attempts.some(a => !a.articleContent.textContent?.includes('Recovered')));
  assert.equal(result?.content?.replace(/\s/g, ''), 'Openingparagraph.Recoveredmiddleparagraph.Closingparagraph.');
});

test('noscript fallback moves an existing image subtree on the copy, preserving source attributes and caption', t => {
  const win = new JSDOM('<body><figure><img src="small.png"><noscript><span><img src="large.png"></span></noscript><figcaption>River bank.</figcaption></figure></body>').window;
  const doc = win.document;
  const before = doc.documentElement.outerHTML;
  const copy = doc.cloneNode(true) as Document;
  const fallback = copy.querySelector('noscript > span'); assert.ok(fallback);
  forbidHtmlWrites(t, win);
  const r = new Readability(copy);
  // Inspect the fallback before the parser discards image-only content.
  (r as unknown as { _unwrapNoscriptImages(d: Document): void })._unwrapNoscriptImages(copy);
  assert.equal(copy.querySelector('figure > span'), fallback);
  const img = fallback.querySelector('img'); assert.ok(img);
  assert.equal(img.getAttribute('src'), 'large.png');
  assert.equal(img.getAttribute('data-old-src'), 'small.png');
  assert.equal(copy.querySelector('figcaption')?.textContent, 'River bank.');
  assert.equal(doc.documentElement.outerHTML, before);
});

test('active page: text-only noscript stays inert, scripts and handlers do not run again, live DOM is untouched', async t => {
  // Only this fixed local test fixture executes JS. No external resources enabled.
  const win = new JSDOM(`<!doctype html><title>Notes</title><body>
    <script>window.scriptRuns = (window.scriptRuns || 0) + 1; window.clickRuns = 0</script>
    <article><p>Notes on the river and the valley.</p><p onclick="window.clickRuns++">Visible caption.</p>
    <img><noscript><img alt="Fallback only" onload="window.clickRuns++"></noscript></article></body>`,
    { url: 'https://example.invalid/notes', runScripts: 'dangerously' }).window;
  const d = win.document;
  assert.equal(d.querySelector('noscript').childElementCount, 0);
  const paragraph = d.querySelector('p[onclick]'); paragraph.click();
  assert.equal(win.scriptRuns, 1); assert.equal(win.clickRuns, 1);
  const before = d.documentElement.outerHTML;
  const mutations: MutationRecord[] = [];
  const observer = new win.MutationObserver((records: MutationRecord[]) => mutations.push(...records));
  observer.observe(d, { attributes: true, subtree: true, childList: true, characterData: true });
  forbidHtmlWrites(t, win);
  const result = extract(d); assert.ok(result && !('reason' in result));
  assert.equal(visible(result.rows), 'Notes on the river and the valley.\nVisible caption.');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual([win.scriptRuns, win.clickRuns], [1, 1]);
  assert.equal(mutations.length + observer.takeRecords().length, 0);
  assert.equal(d.documentElement.outerHTML, before); assert.equal(d.querySelector('p[onclick]'), paragraph);
  observer.disconnect();
});
