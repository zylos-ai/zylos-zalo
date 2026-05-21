import assert from 'node:assert/strict';
import test from 'node:test';
import { freshImport } from './helpers.js';

test('timingSafeStringEqual compares strings without accepting mismatched lengths or types', async () => {
  const { timingSafeStringEqual } = await freshImport('src/lib/webhook-security.js');
  assert.equal(timingSafeStringEqual('secret', 'secret'), true);
  assert.equal(timingSafeStringEqual('secret', 'Secret'), false);
  assert.equal(timingSafeStringEqual('secret', 'secret-extra'), false);
  assert.equal(timingSafeStringEqual(undefined, 'secret'), false);
});

test('webhook deduper tracks keys for a bounded TTL window', async () => {
  const { createDeduper } = await freshImport('src/lib/webhook-security.js');
  const deduper = createDeduper({ ttlMs: 100, maxSize: 2 });
  assert.equal(deduper.isDuplicate('a', 1000), false);
  assert.equal(deduper.isDuplicate('a', 1001), true);
  assert.equal(deduper.isDuplicate('a', 1201), false);
  assert.equal(deduper.isDuplicate('b', 1202), false);
  assert.equal(deduper.isDuplicate('c', 1203), false);
  assert.equal(deduper.size() <= 2, true);
});

test('rate limiter enforces a fixed request window per key', async () => {
  const { createRateLimiter } = await freshImport('src/lib/webhook-security.js');
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limiter.allow('1.2.3.4', 1000), true);
  assert.equal(limiter.allow('1.2.3.4', 1001), true);
  assert.equal(limiter.allow('1.2.3.4', 1002), false);
  assert.equal(limiter.allow('1.2.3.4', 2101), true);
  assert.equal(limiter.allow('5.6.7.8', 1002), true);
});

test('getUpdateDedupKey uses event, chat, and message ids when present', async () => {
  const { getUpdateDedupKey } = await freshImport('src/lib/webhook-security.js');
  assert.equal(getUpdateDedupKey({
    event_name: 'message.text.received',
    message: { msg_id: 'm1', chat: { id: 'g1' } }
  }), 'message.text.received:g1:m1');
  assert.equal(getUpdateDedupKey({ event_name: 'x', message: {} }), null);
});
