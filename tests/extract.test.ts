import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { MAX_BODY } from '../src/clip';
import { extract } from '../src/page';
import { prose, visible } from './fixture-helpers';

const doc = (html: string): Document => new JSDOM(html, { url: 'https://example.invalid/a?ref=1#read' }).window.document;
const paragraph = 'Rivers carry water through a changing landscape, leaving clues about earlier seasons. '.repeat(5).trim();
function select(d: Document, selector: string) {
  const el = d.querySelector(selector);
  assert.ok(el);
  const range = d.createRange(); range.selectNodeContents(el); d.getSelection()?.addRange(range);
}

test('Readability extracts article paragraphs, ignores navigation and form, preserves live DOM', () => {
  const d = doc(`<title>River journal</title><nav>MY MENU</nav><article><h1>River journal</h1><p>${paragraph}</p><p>Next day: ${paragraph}</p></article><form><textarea>PRIVATE DRAFT</textarea></form>`);
  const before = d.documentElement.outerHTML;
  const clip = extract(d);
  assert.ok(clip && !('reason' in clip));
  assert.equal(clip.title, 'River journal');
  assert.equal(clip.url, d.location.href);
  assert.ok(visible(clip.rows).includes(`${paragraph}\nNext day:`));
  assert.doesNotMatch(visible(clip.rows), /MY MENU|PRIVATE DRAFT/);
  assert.equal(clip.selected, false);
  assert.equal(d.documentElement.outerHTML, before);
});
test('selection wins even when surrounded by an article', () => {
  const d = doc(`<p>${paragraph}</p><span> just    this\nline </span>`);
  select(d, 'span');
  assert.deepEqual(extract(d), { title: 'example.invalid', url: d.location.href, rows: prose('just this line'), selected: true });
});
test('empty and form-only pages do not become a title-only share', () => {
  assert.equal(extract(doc('<title>Empty</title>')), null);
  assert.equal(extract(doc('<form><p>Private draft</p></form>')), null);
});
test('both article and selection preserve the complete long text', () => {
  const long = paragraph.repeat(160);
  const d = doc(`<article><p>${long}</p></article>`);
  for (const selected of [false, true]) {
    if (selected) select(d, 'p');
    const clip = extract(d); assert.ok(clip && !('reason' in clip));
    assert.equal(clip.selected, selected); assert.equal(visible(clip.rows), long);
  }
});
test('oversized article and selection return an explicit refusal, never a prefix', () => {
  const d = doc(`<p>${'a'.repeat(MAX_BODY + 1)}</p>`);
  assert.deepEqual(extract(d), { reason: 'large-text' });
  select(d, 'p'); assert.deepEqual(extract(d), { reason: 'large-text' });
});
