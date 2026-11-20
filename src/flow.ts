import { type Extraction, sourceUrl } from './clip';
import type { Destination } from './config';
import { ClipLimit } from './rich';
import { plan, type Receipt } from './slack';

export type Status = (tab: number, badge: '…' | 'SET' | 'OK' | '!' | '?', detail: string) => Promise<void>;
type Ports = {
  settings(): Promise<Destination | null>;
  options(): Promise<void>;
  allowed(): Promise<boolean>;
  extract(tab: number): Promise<Extraction>;
  post(webhook: string, body: ReturnType<typeof plan>[number]): Promise<Receipt>;
  status: Status;
  pause(ms: number): Promise<void>;
};

export function clickHandler(ports: Ports) {
  let running: number | undefined;
  let previous: number | undefined;
  let notBefore = 0;
  return async (tab: { id?: number; url?: string }) => {
    const { id, url } = tab;
    if (id === undefined) return;
    const status = (badge: Parameters<Status>[1], detail: string) => ports.status(id, badge, detail);
    if (running !== undefined || Date.now() < notBefore) {
      if (id !== (running ?? previous)) await status('!', 'Another clip is active or cooling down. Nothing queued.');
      return;
    }
    running = id; // One active batch across tabs. Acquire before the first await.
    let confirmed = 0, total = 0;
    try {
      const dest = await ports.settings();
      if (!dest) {
        await status('SET', 'Choose a destination in Settings. Nothing sent.');
        await ports.options(); return;
      }
      if (!url || !sourceUrl(url)) return await status('!', 'Unsupported or oversized URL. Open a regular HTTP(S) page. Nothing sent.');
      if (!await ports.allowed()) return await status('!', 'Allow access to hooks.slack.com in the extension permissions. Nothing sent.');
      await status('…', `Reading page for ${dest.label}…`);
      const clip = await ports.extract(id).catch(() => null);
      if (!clip) return await status('!', 'No readable text or browser access. Select text on an ordinary page and click again. Nothing sent.');
      if ('reason' in clip) return await status('!', `${clip.reason === 'large-dom' ? 'Page exceeds 50,000 elements.' : 'Text exceeds 240,000 UTF-16 units.'} Select a shorter passage. Nothing sent.`);
      if (clip.url !== url) return await status('!', 'The page changed. Review it and click again. Nothing sent.');
      const parts = plan(clip); // Preflight the entire article before any network side effect.
      total = parts.length;
      for (const part of parts) {
        if (confirmed > 0) await ports.pause(1100);
        const progress = `${confirmed}/${total} confirmed`;
        await status('…', `${progress}. Sending part ${confirmed + 1} to ${dest.label}. If interrupted, check the channel.`);
        const receipt = await ports.post(dest.webhook, part).catch(() => 'unknown' as const);
        notBefore = Date.now() + 4000;
        if (receipt === 'sent') { confirmed++; continue; }
        if (receipt === 'unknown') return await status('?', `${progress}. Part ${confirmed + 1} delivery uncertain. Stopped. Check the channel before sharing again.`);
        if (receipt === 'rejected') return await status('!', `${progress}. Slack rejected part ${confirmed + 1}. Stopped. Check the channel and webhook.`);
        notBefore = Math.max(notBefore, Date.now() + receipt.retryAfter * 1000);
        return await status('!', `${progress}. Rate-limited on part ${confirmed + 1}. Stopped. Wait ${receipt.retryAfter}s and check the channel.`);
      }
      await status('OK', `${confirmed}/${total} confirmed by Slack for ${dest.label}.`);
    } catch (error) {
      const detail = error instanceof ClipLimit ? error.message : 'Could not complete this clip.';
      await status('!', `${detail} ${total ? `${confirmed}/${total} confirmed. Check the channel.` : 'Nothing sent.'}`);
    } finally { previous = id; running = undefined; }
  };
}
