import { type Clip, MAX_BODY, sourceUrl } from './clip';
import { validWebhook } from './config';
import { ClipLimit, richBlocks } from './rich';

const BLOCK_SIZE = 3000;
const BLOCKS_PER_PART = 8;

export function plan(clip: Clip) {
  const url = sourceUrl(clip.url);
  const rows = clip.rows;
  if (!url || !rows.some(row => row.runs.some(r => r.text.trim()))) throw new ClipLimit('Empty text or unsupported source URL.');
  if (rows.reduce((n, row) => n + row.runs.reduce((a, r) => a + r.text.length, 0), 0) > MAX_BODY) throw new ClipLimit('Text exceeds the 240,000-unit limit. Select a shorter passage.');
  const title = clip.title || url.hostname;
  if (title.length > BLOCK_SIZE) throw new ClipLimit('Title exceeds the 3,000-unit limit.');
  // The source link is the only mrkdwn object. Its visible label is constant.
  const href = url.href.replace(/[|<>]/g, c => encodeURIComponent(c)).replaceAll('&', '&amp;');
  const link = `<${href}|Open original page>`;
  if (link.length > BLOCK_SIZE) throw new ClipLimit('Source link is too long to include intact.');
  const chunks = richBlocks(rows);
  const count = Math.ceil(chunks.length / BLOCKS_PER_PART);
  const plain = (text: string) => ({ type: 'plain_text', text, emoji: false });
  const section = (text: string) => ({ type: 'section', text: plain(text) });
  return Array.from({ length: count }, (_, i) => {
    const part = `${clip.selected ? 'Selection' : 'Article'} · ${i + 1}/${count}`;
    return {
      text: `Slack Clipper: ${part}`, mrkdwn: false, unfurl_links: false, unfurl_media: false,
      blocks: [
        { type: 'context', elements: [plain(part), { type: 'mrkdwn', text: link, verbatim: true }] },
        section(title), ...chunks.slice(i * BLOCKS_PER_PART, (i + 1) * BLOCKS_PER_PART),
      ],
    };
  });
}

export type Receipt = 'sent' | 'rejected' | 'unknown' | { retryAfter: number };
export async function post(webhook: string, payload: ReturnType<typeof plan>[number], transport = fetch): Promise<Receipt> {
  if (!validWebhook(webhook)) throw new Error('Invalid destination');
  try {
    const response = await transport(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'));
      return { retryAfter: Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60 };
    }
    if (response.status >= 400 && response.status < 500) return 'rejected';
    if (response.status !== 200 || response.redirected) return 'unknown';
    const reply = (await response.text()).trim();
    if (reply === 'ok') return 'sent';
    return /^[a-z][a-z_]+$/.test(reply) ? 'rejected' : 'unknown';
  } catch { return 'unknown'; } // A timeout or blocked redirect does not prove non-delivery.
}
