import { literal, type Row, type Run, type Style } from './clip';

// Input is a detached, pruned DOM. Neither element attributes nor markup can
// supply Slack element types. Whitespace inside pre/code is never prose-normalized.
export function rowsFrom(root: Node): Row[] {
  const rows: Row[] = [];
  type Context = { quote?: boolean; item?: Extract<Row, { kind: 'item' }> };
  let runs: Run[] = [];
  function flush(ctx: Context) {
    if (runs.length) {
      const first = runs[0], last = runs.at(-1);
      if (first && !first.style?.code) first.text = first.text.trimStart();
      if (last && !last.style?.code) last.text = last.text.trimEnd();
      runs = runs.filter(r => r.text);
      if (runs.length) {
        if (ctx.item) { rows.push({ ...ctx.item, runs }); ctx.item = undefined; }
        else rows.push({ kind: ctx.quote ? 'quote' : 'section', runs });
      }
      runs = [];
    }
  }
  function append(text: string, style: Style, href?: string, exact = false) {
    let s = literal(text);
    if (!exact && !style.code) {
      s = s.replace(/[\t\n\f ]+/g, ' ');
      if (!runs.length || /[ \n]$/.test(runs.at(-1)?.text ?? '')) s = s.replace(/^ /, '');
    }
    if (!s) return;
    const prev = runs.at(-1);
    if (prev && prev.href === href && prev.style?.bold === style.bold && prev.style?.italic === style.italic && prev.style?.code === style.code) prev.text += s;
    else runs.push({ text: s, ...(Object.keys(style).length && { style }), ...(href && { href }) });
  }
  function walk(n: Node, ctx: Context, style: Style, href?: string, depth = 0) {
    if (n.nodeType === 3) { append(n.nodeValue ?? '', style, href); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element, tag = el.localName;
    if (tag === 'br') { append('\n', style, href, true); return; }
    if (tag === 'pre') {
      flush(ctx);
      // Use the text nodes, not innerText (layout dependent) or serialized HTML.
      for (const br of el.querySelectorAll('br')) br.replaceWith('\n');
      const text = literal(el.textContent ?? '');
      if (text) rows.push({ kind: 'pre', runs: [{ text }] });
      return;
    }
    if (tag === 'ol' || tag === 'ul') {
      flush(ctx);
      let number = Number(el.getAttribute('start') ?? 1);
      for (const li of el.children) {
        if (li.localName !== 'li') continue;
        if (li.hasAttribute('value')) number = Number(li.getAttribute('value'));
        const item: Context = { item: { kind: 'item', list: tag === 'ol' ? 'ordered' : 'bullet', indent: Math.min(depth, 8),
          offset: Number.isSafeInteger(number) ? Math.max(0, number - 1) : 0, runs: [] } };
        for (const child of li.childNodes) walk(child, item, style, href, depth + 1);
        flush(item); number++;
      }
      return;
    }
    const heading = /^h[1-6]$/.test(tag);
    const block = heading || /^(article|section|div|p|blockquote|figure|figcaption|li|dt|dd|tr|td|th|hr|summary)$/.test(tag);
    if (block) flush(ctx);
    const next = tag === 'blockquote' ? { quote: true } : ctx;
    if (heading || tag === 'b' || tag === 'strong') style = { ...style, bold: true };
    if (tag === 'i' || tag === 'em') style = { ...style, italic: true };
    if (tag === 'code' || tag === 'kbd') style = { ...style, code: true };
    if (tag === 'a') href = el.getAttribute('href') ?? undefined;
    for (const child of el.childNodes) walk(child, next, style, href, depth);
    if (block) flush(next);
  }
  walk(root, {}, {}); flush({});
  return rows;
}
