import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { extract } from '../src/page';
import { plan } from '../src/slack';
import type { Row } from '../src/clip';

const html = readFileSync(new URL('./fixtures/github-readme.html', import.meta.url), 'utf8');
const url = 'https://github.com/org/repo#readme';
const code = "if test -f config; then\n    printf '%s\\n' 'two  spaces'\n\tmake bench\n\nfi\n";
const text = (s: string) => ({ type: 'text', text: s });
const bold = (s: string) => ({ ...text(s), style: { bold: true } });
function payload(d: Document) { const clip = extract(d); assert.ok(clip && !('reason' in clip)); return plan(clip); }

test('GitHub README DOM to final webhook blocks: headings, styles, href, lists, quote and exact shell bytes', () => {
  const d = new JSDOM(html, { url }).window.document;
  const before = d.documentElement.outerHTML;
  const [p] = payload(d);
  assert.equal(p.blocks[0].elements[1].text, `<${url}|Open original page>`);
  const groups = p.blocks.slice(2).flatMap(b => b.elements);
  for (const h of ['Security Model', 'Performance & Multiplexing']) assert.ok(groups.some(g => g.type === 'rich_text_section' && JSON.stringify(g.elements) === JSON.stringify([bold(h)])));
  assert.deepEqual(groups[1].elements, [text('Read the '), bold('security '), { ...text('guide'), style: { bold: true, italic: true } }, text(' and '),
    { type: 'link', url: 'https://github.com/org/repo/blob/main/docs/security.md#access', text: 'access rules' }, text('.')]);
  const lists = groups.filter(g => g.type === 'rich_text_list');
  assert.deepEqual(lists.map(g => [g.style, g.indent, g.offset, g.elements.length]), [['ordered',0,2,2], ['bullet',1,undefined,1]]);
  assert.deepEqual(lists[0].elements[0].elements, [text('Check '), { ...text('git status'), style: { code: true } }, text('.')]);
  assert.deepEqual(groups.find(g => g.type === 'rich_text_quote').elements, [text('Use '), { ...text('one'), style: { italic: true } }, text(' channel.')]);
  assert.deepEqual(groups.find(g => g.type === 'rich_text_preformatted').elements, [text(code)]);
  assert.equal(d.documentElement.outerHTML, before);
});
test('hostile markup remains literal; unsafe links lose only the href; hidden and non-README nodes stay out', () => {
  const d = new JSDOM(html, { url }).window.document;
  d.querySelector('#unsafe-scheme').setAttribute('href', 'javascript:void(0)');
  const [p] = payload(d);
  const leaves = p.blocks.slice(2).flatMap(b => b.elements).flatMap(g => g.type === 'rich_text_list' ? g.elements.flatMap(e=>e.elements) : g.elements);
  assert.ok(leaves.every(l => l.type === 'text' || l.type === 'link'));
  assert.deepEqual(leaves.filter(l => l.type === 'link').map(l => l.url), ['https://github.com/org/repo/blob/main/docs/security.md#access']);
  const body = leaves.map(l=>l.text).join('');
  assert.ok(body.includes('Literal <!channel> <@U123> @here *not bold* <https://bad.invalid|fake>. JS label data label credentials label.'));
  assert.doesNotMatch(body, /navigation|outside the README|permalink icon|Copy command|probe/);
});
test('selection slices styled boundary nodes, excludes hidden siblings and unselected neighbours', () => {
  const d = new JSDOM('<p>before <b>prefixWORD<span hidden>hidden</span></b><i>LASTsuffix</i> after</p>', { url }).window.document;
  const r = d.createRange(); r.setStart(d.querySelector('b').firstChild, 6); r.setEnd(d.querySelector('i').firstChild, 4); d.getSelection().addRange(r);
  const [p] = payload(d); assert.match(p.text, /Selection/);
  assert.deepEqual(p.blocks[2].elements[0].elements, [bold('WORD'), { ...text('LAST'), style: { italic: true } }]);
});
test('Readability fallback retains relative link, paragraph styles, and indented code', () => {
  const d = new JSDOM('<base href="https://example.invalid/guide/"><title>Manual</title><article><h2>Steps</h2><p>Follow <strong>these steps</strong> in the <a href="setup">guide</a>.</p><pre>line\n  A\n\tB</pre></article>', { url: 'https://example.invalid/manual' }).window.document;
  const [p] = payload(d); const json = JSON.stringify(p.blocks.slice(2));
  assert.match(json, /rich_text_preformatted/); assert.ok(json.includes(JSON.stringify('line\n  A\n\tB'))); assert.ok(json.includes('https://example.invalid/guide/setup')); assert.ok(json.includes('"bold":true'));
});
test('long formatted payloads round-trip code, links, styles and list ordinals across messages', () => {
  const pre = `${'   x\t🌍\n'.repeat(4900)}end\n`; const label = `start${'🌍'.repeat(15050)}end`;
  const href = 'https://example.invalid/guide';
  const rows: Row[] = [{ kind:'pre', runs:[{text:pre}] }, {kind:'quote',runs:[{ text:label, style:{italic:true}, href }]},
    ...Array.from({length:450}, (_,i): Row => ({kind:'item',list:'ordered',offset:i,indent:0,runs:[{text:`step ${i + 1}`}]}))];
  const parts = plan({ title:'Notes',url,selected:false,rows }); assert.ok(parts.length > 2);
  let codeOut='', linkOut=''; const numbers: number[] = [];
  for (const [i,p] of parts.entries()) {
    assert.equal(p.text, `Slack Clipper: Article · ${i+1}/${parts.length}`); assert.ok(p.blocks.length <= 10);
    for (const b of p.blocks.slice(2)) for (const g of b.elements) {
      if (g.type === 'rich_text_list') { for (const [j,s] of g.elements.entries()) { numbers.push(g.offset+j+1); assert.equal(s.elements[0].text, `step ${numbers.at(-1)}`); } continue; }
      for (const leaf of g.elements) { assert.ok(leaf.text.length > 0 && leaf.text.length <= 3000); assert.ok(leaf.text.isWellFormed());
        if (g.type === 'rich_text_preformatted') codeOut+=leaf.text;
        else { assert.equal(g.type,'rich_text_quote'); assert.deepEqual(leaf.style,{italic:true}); assert.equal(leaf.url,href); linkOut+=leaf.text; }
      }
    }
  }
  assert.equal(codeOut,pre); assert.equal(linkOut,label); assert.deepEqual(numbers, Array.from({ length:450 },(_,i)=>i+1));
});
test('excessive link metadata is refused in preflight, not dropped or truncated', () => {
  const runs = Array.from({length:129}, () => ({ text:'link', href:`https://example.invalid/${'x'.repeat(1900)}` }));
  assert.throws(() => plan({ title:'Notes',url,selected:false,rows:[{kind:'section',runs}] }), /16-message/);
});
