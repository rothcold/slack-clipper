import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BODY } from '../src/clip';
import { clickHandler } from '../src/flow';
import { prose } from './fixture-helpers';

type Ports = Parameters<typeof clickHandler>[0];
const tab = { id: 7, url: 'https://example.invalid/' };
const clip = { title: 'Notes', url: tab.url, rows: prose('Some notes.'), selected: false };
const long = { ...clip, rows: prose('x'.repeat(48001)) }; // exactly three messages
const settings = { label: '#fixture', webhook: ['https://hooks.slack.com', 'services', 'not', 'a', 'credential'].join('/') };
function fixture(overrides: Partial<Ports> = {}) {
  const calls = { options: 0, extract: 0, post: 0 }; const badges: string[] = [], details: string[] = [];
  const click = clickHandler({
    settings: async () => settings, allowed: async () => true, pause: async () => {},
    options: async () => { calls.options++; },
    extract: async () => { calls.extract++; return clip; },
    post: async () => { calls.post++; return 'sent'; },
    status: async (_id, badge, detail) => { badges.push(badge); details.push(detail); }, ...overrides,
  });
  return { calls, badges, details, click };
}

test('interrupted setup has no pending send', async () => {
  const f = fixture({ settings: async () => null }); await f.click(tab); await f.click(tab);
  assert.deepEqual(f.calls, { options: 2, extract: 0, post: 0 }); assert.deepEqual(f.badges, ['SET', 'SET']);
});
test('drop same-tab and cross-tab clicks during a send; guard rapid clicks after completion', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const entered = Promise.withResolvers<void>(), reply = Promise.withResolvers<'sent'>(); let sent = 0;
  const f = fixture({ post: async () => { sent++; entered.resolve(); return reply.promise; } });
  const first = f.click(tab); await f.click(tab); await entered.promise;
  await f.click({ ...tab, id: 88 }); assert.equal(sent, 1);
  reply.resolve('sent'); await first; await f.click(tab); assert.equal(sent, 1); assert.equal(f.badges.at(-1), 'OK');
  t.mock.timers.tick(4001); await f.click(tab); assert.equal(sent, 2);
});
test('no send from restricted, inaccessible, unreadable or navigated tab', async () => {
  for (const [url, overrides, reads] of [['about:addons', {}, 0], [tab.url, { allowed: async () => false }, 0],
    [tab.url, { extract: async () => { throw new Error('permission denied'); } }, null],
    [tab.url, { extract: async () => null }, null], ['https://example.invalid/new', {}, 1]] as const) {
    const f = fixture(overrides); await f.click({ ...tab, url });
    assert.equal(f.badges.at(-1), '!'); assert.equal(f.calls.post, 0);
    if (reads !== null) assert.equal(f.calls.extract, reads);
  }
});
test('full preflight of oversized input sends zero parts and explains refusal', async () => {
  for (const input of [{ reason: 'large-text' }, { reason: 'large-dom' }, { ...clip, rows: prose('a'.repeat(MAX_BODY+1)) }, { ...clip, title: 'x'.repeat(3001) }] as const) {
    const f = fixture({ extract: async () => input }); await f.click(tab);
    assert.equal(f.calls.post, 0); assert.match(f.details.at(-1) ?? '', /(?:exceeds).*Nothing sent/);
  }
});
test('exact numbered order, one POST in flight, at least one second between acknowledgements and next send', async () => {
  const order: string[] = []; const first = Promise.withResolvers<'sent'>(); const started = Promise.withResolvers<void>();
  const f = fixture({ extract: async () => long,
    pause: async ms => { assert.ok(ms >= 1000); order.push('pause'); },
    post: async (_hook, msg) => { order.push(msg.text); started.resolve(); return first.promise; },
  });
  const batch = f.click(tab); await started.promise;
  assert.deepEqual(order, ['Slack Clipper: Article · 1/3']); first.resolve('sent'); await batch;
  assert.deepEqual(order, ['Slack Clipper: Article · 1/3', 'pause', 'Slack Clipper: Article · 2/3', 'pause', 'Slack Clipper: Article · 3/3']);
  assert.match(f.details.at(-1) ?? '', /3\/3 confirmed/); assert.equal(f.badges.at(-1), 'OK');
});
test('stop on rejected or uncertain second part; distinguish partial confirmation from delivery', async () => {
  for (const result of ['rejected', 'unknown', 'throw'] as const) {
    let sends = 0;
    const f = fixture({ extract: async () => long, post: async () => {
      if (++sends === 1) return 'sent'; if (result === 'throw') throw new Error(); return result;
    } });
    await f.click(tab); await f.click(tab);
    assert.equal(sends, 2); assert.equal(f.badges.at(-1), result === 'rejected' ? '!' : '?');
    assert.match(f.details.at(-1) ?? '', /1\/3 confirmed/); assert.match(f.details.at(-1) ?? '', /part 2/i);
  }
});
test('stop on 429, respect Retry-After on fresh clicks, never schedule an automatic retry', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] }); let sends = 0;
  const f = fixture({ extract: async () => long, post: async () => ++sends === 1 ? 'sent' : { retryAfter: 32 } });
  await f.click(tab); assert.match(f.details.at(-1) ?? '', /1\/3 confirmed.*Wait 32s/);
  t.mock.timers.tick(31000); await f.click(tab); assert.equal(sends, 2);
  t.mock.timers.tick(5000); assert.equal(sends, 2); // time alone cannot send
  await f.click(tab); assert.equal(sends, 3); assert.match(f.details.at(-1) ?? '', /0\/3 confirmed/);
});
test('storage failure is visible, sends nothing and does not strand the lock', async () => {
  let attempts = 0;
  const f = fixture({ settings: async () => { attempts++; throw new Error('mock storage unavailable'); } });
  await f.click(tab); await f.click(tab); assert.deepEqual(f.badges, ['!', '!']); assert.equal(attempts, 2); assert.equal(f.calls.post, 0);
});
