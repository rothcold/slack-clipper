import { type Row, type Style, sourceUrl } from './clip';

export class ClipLimit extends Error {}
type Leaf = { type: 'text'; text: string; style?: Style } | { type: 'link'; text: string; url: string; style?: Style };
type Section = { type: 'rich_text_section'; elements: Leaf[] };
type Group = Section | { type: 'rich_text_preformatted' | 'rich_text_quote'; elements: Leaf[] } |
  { type: 'rich_text_list'; style: 'ordered' | 'bullet'; indent: number; offset?: number; elements: Section[] };
type Block = { type: 'rich_text'; elements: Group[] };

// Local budgets, not claims about Slack's nested-element limits. Account for
// repeated URLs and markup density as well as visible text. Preflight everything.
export function richBlocks(rows: Row[]): Block[] {
  const blocks: Block[] = [];
  let block: Block = { type: 'rich_text', elements: [] };
  let room = 3000, leaves = 0;
  function finishBlock() {
    if (!block.elements.length) return;
    blocks.push(block);
    if (blocks.length > 128) throw new ClipLimit('Formatting exceeds the 16-message limit. Select a shorter passage.');
    block = { type: 'rich_text', elements: [] }; room = 3000; leaves = 0;
  }
  for (const row of rows) {
    let elements: Leaf[] = [], continuation = false;
    function flush() {
      if (!elements.length) return;
      const section: Section = { type: 'rich_text_section', elements };
      if (row.kind === 'item' && !continuation) {
        const prev = block.elements.at(-1);
        if (prev?.type === 'rich_text_list' && prev.style === row.list && prev.indent === row.indent &&
          (row.list === 'bullet' || (prev.offset ?? 0) + prev.elements.length === row.offset)) prev.elements.push(section);
        else block.elements.push({ type: 'rich_text_list', style: row.list, indent: row.indent,
          ...(row.list === 'ordered' && { offset: row.offset }), elements: [section] });
      } else if (row.kind === 'pre' || row.kind === 'quote') block.elements.push({ type: row.kind === 'pre' ? 'rich_text_preformatted' : 'rich_text_quote', elements });
      else block.elements.push(section);
      elements = []; continuation = true;
    }
    // Keep a short semantic unit together rather than wrapping a heading or list
    // item unnecessarily at the end of the previous block.
    const size = row.runs.reduce((n, r) => n + r.text.length + (r.href?.length ?? 0), 0);
    if (size <= 3000 && size > room) finishBlock();
    for (const run of row.runs) {
      const url = run.href ? sourceUrl(run.href)?.href : undefined;
      const style: Style = { ...(run.style?.bold && { bold: true }), ...(run.style?.italic && { italic: true }), ...(run.style?.code && { code: true }) };
      const styling = Object.keys(style).length ? { style } : {};
      let pos = 0;
      while (pos < run.text.length) {
        let end = Math.min(run.text.length, pos + room - (url?.length ?? 0));
        if (end < run.text.length && end > pos && /[\uD800-\uDBFF]/u.test(run.text.charAt(end - 1))) end--;
        if (end <= pos || leaves === 64) { flush(); finishBlock(); continue; }
        if (end < run.text.length) {
          const tail = run.text.slice(Math.max(pos, end - 160), end);
          const boundary = tail.lastIndexOf('\n');
          if (boundary >= 0) end -= tail.length - boundary - 1;
        }
        const text = run.text.slice(pos, end);
        elements.push(url ? { type: 'link', url, text, ...styling } : { type: 'text', text, ...styling });
        room -= text.length + (url?.length ?? 0); leaves++; pos = end;
        if (pos < run.text.length) { flush(); finishBlock(); }
      }
    }
    flush();
  }
  finishBlock();
  return blocks;
}
