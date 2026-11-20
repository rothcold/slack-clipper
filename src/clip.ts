// UTF-16 units, conservative for Slack's character limits. Never send a prefix.
export const MAX_BODY = 240_000;
export type Style = { bold?: true; italic?: true; code?: true };
export type Run = { text: string; style?: Style; href?: string };
export type Row = { runs: Run[] } & (
  { kind: 'section' | 'pre' | 'quote' } |
  { kind: 'item'; list: 'ordered' | 'bullet'; indent: number; offset: number }
);
export type Clip = { title: string; url: string; selected: boolean; rows: Row[] };
export function literal(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, c => c === '\n' || c === '\t' ? c : ' ');
}
export type Extraction = Clip | { reason: 'large-dom' | 'large-text' } | null;

export function clean(text: string): string {
  return text.replace(/\r\n?/g, '\n')
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, c => c === '\n' ? c : ' ')
    .replace(/[^\S\n]+/gu, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function sourceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      url.hostname.replace(/\.$/, '') !== 'hooks.slack.com' && url.href.length <= 2048 ? url : null;
  } catch { return null; }
}
