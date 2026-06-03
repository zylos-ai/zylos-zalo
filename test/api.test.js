import assert from 'node:assert/strict';
import test from 'node:test';
import { freshImport } from './helpers.js';

function installFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = previous;
  };
}

test('api methods post JSON payloads to the Zalo Bot API', async () => {
  const calls = [];
  const restore = installFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, result: { id: 'ok' } }), { status: 200 });
  });
  try {
    const api = await freshImport('src/lib/api.js');
    assert.deepEqual(await api.getMe('token-1'), { id: 'ok' });
    assert.deepEqual(await api.sendMessage('token-1', 'chat-1', 'hello'), { id: 'ok' });
    assert.deepEqual(await api.sendPhoto('token-1', 'chat-1', 'https://example.com/a.png'), { id: 'ok' });
    assert.deepEqual(await api.sendSticker('token-1', 'chat-1', 'sticker-1'), { id: 'ok' });
    assert.deepEqual(await api.sendChatAction('token-1', 'chat-1'), { id: 'ok' });
    assert.deepEqual(await api.getUpdates('token-1', 10, 1), { id: 'ok' });
    assert.deepEqual(await api.setWebhook('token-1', 'https://example.com/hook', 'secret'), { id: 'ok' });
    assert.deepEqual(await api.deleteWebhook('token-1'), { id: 'ok' });
    assert.deepEqual(await api.getWebhookInfo('token-1'), { id: 'ok' });

    assert.equal(calls.length, 9);
    assert.equal(calls[0].url, 'https://bot-api.zaloplatforms.com/bottoken-1/getMe');
    for (const call of calls) {
      assert.equal(call.init.method, 'POST');
      assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json' });
    }
    assert.deepEqual(JSON.parse(calls[1].init.body), { chat_id: 'chat-1', text: 'hello' });
    assert.deepEqual(JSON.parse(calls[2].init.body), { chat_id: 'chat-1', photo: 'https://example.com/a.png' });
    assert.deepEqual(JSON.parse(calls[3].init.body), { chat_id: 'chat-1', sticker: 'sticker-1' });
    assert.deepEqual(JSON.parse(calls[5].init.body), { offset: 10, timeout: 1, limit: 100 });
    assert.deepEqual(JSON.parse(calls[6].init.body), { url: 'https://example.com/hook', secret_token: 'secret' });
  } finally {
    restore();
  }
});

test('api base URL can be configured', async () => {
  const calls = [];
  const restore = installFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, result: { id: 'ok' } }), { status: 200 });
  });
  try {
    const api = await freshImport('src/lib/api.js');
    api.setApiBaseUrl('https://bot-api.zapps.me/');
    assert.equal(api.getApiBaseUrl(), 'https://bot-api.zapps.me');
    await api.getMe('token-1');
    assert.equal(calls[0].url, 'https://bot-api.zapps.me/bottoken-1/getMe');
    api.setApiBaseUrl(null);
  } finally {
    restore();
  }
});

test('api base URL from environment uses HTTPS validation', async () => {
  const previous = process.env.ZALO_API_BASE;
  process.env.ZALO_API_BASE = 'http://bot-api.zaloplatforms.com';
  try {
    await assert.rejects(
      () => freshImport('src/lib/api.js'),
      /Zalo API base URL must use HTTPS/
    );
  } finally {
    if (previous === undefined) delete process.env.ZALO_API_BASE;
    else process.env.ZALO_API_BASE = previous;
  }
});

test('api converts Zalo and HTTP failures into ZaloApiError', async () => {
  const restore = installFetch(async () =>
    new Response(JSON.stringify({ error_code: 401, description: 'bad token' }), { status: 200 })
  );
  try {
    const api = await freshImport('src/lib/api.js');
    await assert.rejects(() => api.getMe('bad-token'), (err) => {
      assert.equal(err.name, 'ZaloApiError');
      assert.equal(err.code, 401);
      assert.equal(err.status, 200);
      assert.equal(err.method, 'getMe');
      assert.equal(err.message, 'bad token');
      return true;
    });
  } finally {
    restore();
  }
});

test('api surfaces HTTP error bodies when Zalo returns non-JSON', async () => {
  const restore = installFetch(async () =>
    new Response('upstream unavailable', { status: 502, headers: { 'content-type': 'text/plain' } })
  );
  try {
    const api = await freshImport('src/lib/api.js');
    await assert.rejects(() => api.sendPhoto('token-1', 'chat-1', 'https://example.com/photo.jpg'), (err) => {
      assert.equal(err.name, 'ZaloApiError');
      assert.equal(err.code, 502);
      assert.equal(err.status, 502);
      assert.equal(err.method, 'sendPhoto');
      assert.match(err.message, /HTTP 502: upstream unavailable/);
      assert.deepEqual(err.response, { raw: 'upstream unavailable' });
      return true;
    });
  } finally {
    restore();
  }
});

test('api maps aborted fetches to polling timeout errors', async () => {
  const restore = installFetch(async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  });
  try {
    const api = await freshImport('src/lib/api.js');
    await assert.rejects(() => api.sendChatAction('token-1', 'chat-1'), (err) => {
      assert.equal(err.name, 'ZaloApiError');
      assert.equal(err.code, 408);
      assert.equal(err.isPollingTimeout, true);
      return true;
    });
  } finally {
    restore();
  }
});

test('sendPhoto rejects non-http or malformed URLs before fetch', async () => {
  let calls = 0;
  const restore = installFetch(async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  });
  try {
    const api = await freshImport('src/lib/api.js');
    assert.throws(
      () => api.sendPhoto('token-1', 'chat-1', 'file:///etc/passwd'),
      /must use HTTP or HTTPS/
    );
    assert.throws(
      () => api.sendPhoto('token-1', 'chat-1', 'not a url'),
      /absolute HTTP or HTTPS URL/
    );
    assert.throws(
      () => api.sendPhoto('token-1', 'chat-1', 'https://127.0.0.1/a.png'),
      /private or loopback/
    );
    assert.throws(
      () => api.sendPhoto('token-1', 'chat-1', 'https://[::ffff:10.0.0.1]/a.png'),
      /private or loopback/
    );
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});
