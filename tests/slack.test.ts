import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BODY, sourceUrl } from '../src/clip';
import { isDestination, validWebhook } from '../src/config';
import { plan, post } from '../src/slack';
import { prose } from './fixture-helpers';

// Deliberately non-issued path segments. Never pass a real fetch to post().
const origin = 'https://hooks.slack.com';
const path = '/services/not/a/credential';
const dummy = origin + path;
const clip = { title: '<!here>', url: 'https://example.invalid/a|b?q=1&x=2#s', rows: prose('<!channel> @everyone <@U123> *bold* <https://example.invalid|click>'), selected: true };
const [payload] = plan(clip);

test('literal webhook allowlist, not URL normalization', () => {
  assert.equal(validWebhook(dummy), true);
  for (const bad of [undefined, 1, '', ` ${dummy}`, `${dummy}\n`, `${dummy}#`, `${dummy}?`, `${dummy}?q=x`, `${dummy}#x`,
    `${origin}:443${path}`, `http://hooks.slack.com${path}`, `https://hooks.slack.com.invalid${path}`, `https://user:pw@hooks.slack.com${path}`,
    `https://hooks.slack.com@other.invalid${path}`, `https://@hooks.slack.com${path}`, `${origin}/x/..${path}`, `${dummy}/`,
    `${dummy}/extra`, `${origin}/services/a//b`, dummy.replace('/a/', '/%61/'), dummy.replace('/a/', '\\a/'), `${origin}/api/post`]) {
    assert.equal(validWebhook(bad), false);
  }
});
test('invalid or URL-like labels cannot become stored settings', () => {
  assert.ok(isDestination({ label: '#book-club', webhook: dummy }));
  for (const label of ['', 'x\nb', 'a'.repeat(81), dummy]) assert.equal(isDestination({ label, webhook: dummy }), false);
  assert.equal(isDestination({ webhook: 'no', label: '#book-club' }), false);
});
test('source links are HTTP(S) only and must fit intact', () => {
  for (const url of ['about:blank', 'file:///test', 'data:text/html,a', 'https://u:p@example.invalid/', dummy, `https://example.invalid/${'a'.repeat(2048)}`]) assert.equal(sourceUrl(url), null);
  assert.throws(() => plan({ ...clip, url: `https://example.invalid/?${'&'.repeat(700)}` }));
});
test('page title and body are literal blocks; only a validated, encoded source link uses mrkdwn', () => {
  const [meta, header, body] = payload.blocks;
  assert.deepEqual(header?.text, { type: 'plain_text', text: clip.title, emoji: false });
  assert.deepEqual(body, { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: clip.rows[0].runs[0].text }] }] });
  assert.deepEqual(meta?.elements?.[1], { type: 'mrkdwn', verbatim: true, text: '<https://example.invalid/a%7Cb?q=1&amp;x=2#s|Open original page>' });
  assert.equal(payload.mrkdwn, false); assert.equal(payload.unfurl_links, false); assert.equal(payload.unfurl_media, false);
  assert.doesNotMatch(payload.text, /@|<|example/);
});
test('body round-trips at block, message, Unicode, whitespace and maximum boundaries', () => {
  for (const text of [ 'x', 'x'.repeat(3000), 'x'.repeat(3001), 'x'.repeat(24000), 'x'.repeat(24001),
    `${'a'.repeat(2999)}🌍`, `${'x'.repeat(2850)}\n\n${'abc de '.repeat(3400)}tail`, 'x'.repeat(MAX_BODY)]) {
    const title = 't'.repeat(3000);
    const parts = plan({ ...clip, rows: prose(text), title });
    const pieces: string[] = [];
    for (const [i,p] of parts.entries()) {
      assert.equal(p.blocks[0]?.elements?.[0]?.text, `Selection · ${i + 1}/${parts.length}`);
      assert.equal(p.blocks[1]?.text?.text, title); assert.ok(p.blocks.length <= 10);
      for (const b of p.blocks.slice(2)) {
        assert.equal(b.type, 'rich_text');
        for (const section of b.elements) for (const leaf of section.elements) {
          const piece = leaf.text; assert.ok(piece && piece.length <= 3000);
          assert.doesNotMatch(piece, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u); pieces.push(piece);
        }
      }
    }
    assert.equal(pieces.join(''), text);
    if (text.length === 24000) assert.equal(parts.length, 1);
    if (text.length === 24001) assert.equal(parts.length, 2);
  }
});
test('refuse oversize text or title instead of trimming', () => {
  assert.throws(() => plan({ ...clip, rows: prose('a'.repeat(MAX_BODY+1)) }), /240,000/);
  assert.throws(() => plan({ ...clip, title: 'a'.repeat(3001) }), /3,000/);
  assert.throws(() => plan({ ...clip, rows: prose(' \t') }));
});
test('one POST, no credentials or redirects; require explicit ok acknowledgement', async () => {
  for (const [status, reply, expected] of [[200, 'ok\n', 'sent'], [200, 'invalid_payload', 'rejected'], [200, '', 'unknown'],
    [200, '<html>ok</html>', 'unknown'], [204, null, 'unknown'], [302, '', 'unknown'], [403, 'action_prohibited', 'rejected'], [429, '', { retryAfter: 60 }], [503, '', 'unknown']] as const) {
    let calls = 0;
    const actual = await post(dummy, payload, async (url, init) => {
      calls++;
      assert.equal(url, dummy); assert.equal(init?.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
      assert.ok(init.signal instanceof AbortSignal); assert.equal(init.body, JSON.stringify(payload));
      return new Response(reply, { status });
    });
    assert.deepEqual(actual, expected); assert.equal(calls, 1);
  }
});
test('429 uses Slack Retry-After without retrying the request', async () => {
  assert.deepEqual(await post(dummy, payload, async () => new Response('', { status: 429, headers: { 'Retry-After': '21' } })), { retryAfter: 21 });
});
test('network failure, timeout, and unreadable reply remain uncertain; never retry', async () => {
  for (const fail of [new TypeError('mock offline'), new DOMException('mock timeout', 'TimeoutError')]) {
    let calls = 0;
    assert.equal(await post(dummy, payload, async () => { calls++; throw fail; }), 'unknown');
    assert.equal(calls, 1);
  }
  const response = new Response('ok'); await response.text();
  assert.equal(await post(dummy, payload, async () => response), 'unknown');
});
test('revalidate endpoint at send boundary before calling transport', async () => {
  let called = false;
  await assert.rejects(post(`${dummy}?`, payload, async () => { called = true; return new Response('ok'); }));
  assert.equal(called, false);
});
