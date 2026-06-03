import assert from 'node:assert/strict';
import test from 'node:test';
import { freshImport } from './helpers.js';

function allowedDmConfig() {
  return {
    owner: { user_id: 'owner-1', name: 'Owner', bound_at: '2026-06-03T00:00:00.000Z' },
    dmPolicy: 'allowlist',
    dmAllowFrom: ['user-1'],
    groupPolicy: 'allowlist',
    groups: {}
  };
}

function unsupportedUpdate({ userId = 'user-1', chatId = 'chat-1', isBot = false } = {}) {
  return {
    event_name: 'message.unsupported.received',
    message: {
      from: { id: userId, is_bot: isBot },
      chat: { id: chatId, chat_type: 'USER' },
      msg_id: 'msg-1'
    }
  };
}

function info({ senderId = 'user-1', chatId = 'chat-1', isGroup = false } = {}) {
  return {
    chatId,
    senderId,
    isGroup
  };
}

test('unsupported user message sends fallback for allowed sender', async () => {
  const calls = [];
  const {
    UNSUPPORTED_MESSAGE_FALLBACK,
    maybeSendUnsupportedMessageFallback
  } = await freshImport('src/lib/unsupported.js');

  const sent = await maybeSendUnsupportedMessageFallback({
    update: unsupportedUpdate(),
    info: info(),
    config: allowedDmConfig(),
    cooldowns: new Map(),
    now: 1_000,
    send: async (chatId, text) => calls.push({ chatId, text })
  });

  assert.equal(sent, true);
  assert.deepEqual(calls, [{ chatId: 'chat-1', text: UNSUPPORTED_MESSAGE_FALLBACK }]);
});

test('unsupported user message does not reply to unauthorized sender', async () => {
  const calls = [];
  const { maybeSendUnsupportedMessageFallback } = await freshImport('src/lib/unsupported.js');

  const sent = await maybeSendUnsupportedMessageFallback({
    update: unsupportedUpdate({ userId: 'stranger-1' }),
    info: info({ senderId: 'stranger-1' }),
    config: allowedDmConfig(),
    cooldowns: new Map(),
    now: 1_000,
    send: async (chatId, text) => calls.push({ chatId, text })
  });

  assert.equal(sent, false);
  assert.deepEqual(calls, []);
});

test('unsupported user message cooldown suppresses repeat fallback replies', async () => {
  const calls = [];
  const { maybeSendUnsupportedMessageFallback } = await freshImport('src/lib/unsupported.js');
  const cooldowns = new Map();
  const send = async (chatId, text) => calls.push({ chatId, text });
  const config = allowedDmConfig();
  const update = unsupportedUpdate();
  const messageInfo = info();

  assert.equal(await maybeSendUnsupportedMessageFallback({
    update,
    info: messageInfo,
    config,
    cooldowns,
    now: 1_000,
    send
  }), true);
  assert.equal(await maybeSendUnsupportedMessageFallback({
    update,
    info: messageInfo,
    config,
    cooldowns,
    now: 30_000,
    send
  }), false);
  assert.equal(await maybeSendUnsupportedMessageFallback({
    update,
    info: messageInfo,
    config,
    cooldowns,
    now: 62_000,
    send
  }), true);

  assert.equal(calls.length, 2);
});
