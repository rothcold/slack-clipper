import Readability from '../vendor/readability/Readability.cjs';
import { type Extraction, MAX_BODY, clean, sourceUrl } from './clip';
import { rowsFrom } from './semantics';

const omit = 'script,style,noscript,template,iframe,object,embed,svg,canvas,form,input,textarea,select,button,[contenteditable],[hidden],[inert],[aria-hidden="true" i],nav,aside,.sr-only,.visually-hidden,.anchor,clipboard-copy';
function excluded(el: Element, doc: Document) {
  if (el.matches(omit)) return true;
  const s = doc.defaultView?.getComputedStyle(el);
  return s && (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.contentVisibility === 'hidden' || s.opacity === '0');
}
// Inspect visibility before cloning: detached DOMs have no page styles. Copy only
// allowed nodes; never move a live node or reparse HTML. A range also clips the
// boundary text nodes, so selecting one word cannot disclose its siblings.
function visibleCopy(n: Node, dest: Document, source: Document, range?: Range): Node | null {
  if (range && !range.intersectsNode(n)) return null;
  if (n.nodeType === 3) {
    const text = n.nodeValue ?? '';
    return dest.createTextNode(text.slice(range?.startContainer === n ? range.startOffset : 0, range?.endContainer === n ? range.endOffset : undefined));
  }
  if (n.nodeType !== 1) return null;
  const el = n as Element;
  if (excluded(el, source)) return null;
  const copy = dest.importNode(el, false);
  if (el.localName === 'a' && el.hasAttribute('href')) {
    let url: URL | null = null;
    try { url = sourceUrl(new URL(el.getAttribute('href') ?? '', source.baseURI).href); } catch { /* label only */ }
    if (url) copy.setAttribute('href', url.href); else copy.removeAttribute('href');
  }
  for (const child of el.childNodes) {
    if (el.localName === 'details' && !el.hasAttribute('open') && (child as Element).localName !== 'summary') continue;
    const node = visibleCopy(child, dest, source, range);
    if (node) copy.appendChild(node);
  }
  return copy;
}

export function extract(doc: Document): Extraction {
  if (!['text/html', 'application/xhtml+xml'].includes(doc.contentType) || !doc.body) return null;
  const selection = doc.getSelection();
  const selected = !!selection?.rangeCount && !selection.isCollapsed;
  if (selected && selection.rangeCount !== 1) return null; // never substitute the full article
  if (!selected && doc.getElementsByTagName('*').length > 50000) return { reason: 'large-dom' };
  const title = clean(doc.title).replace(/\n+/g, ' ') || doc.location.hostname;
  const url = doc.location.href;
  const copy = doc.implementation.createHTMLDocument(title);
  const readme = !selected && doc.location.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/?$/.test(doc.location.pathname) &&
    doc.querySelector('article.markdown-body.entry-content[itemprop="text"]');
  const src = readme || doc.body;
  for (let parent = src.parentElement; parent; parent = parent.parentElement) {
    if (excluded(parent, doc) || parent.matches('details:not([open])')) return null;
  }
  const root = visibleCopy(src, copy, doc, selected ? selection.getRangeAt(0) : undefined);
  if (!root) return null;
  if (!readme) copy.body.replaceWith(root);
  const article = selected || readme ? { title, content: rowsFrom(root) } : new Readability(copy, {
    disableJSONLD: true, serializer: root => rowsFrom(root),
  }).parse();
  const rows = article?.content;
  if (!rows?.length) return null;
  if (rows.reduce((n, row) => n + row.runs.reduce((a, r) => a + r.text.length, 0), 0) > MAX_BODY) return { reason: 'large-text' };
  return { title: clean(article?.title || title).replace(/\n+/g, ' '), url, rows, selected };
}
