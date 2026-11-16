import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveChatType, isGroupId } from '../src/lib/chat-type.js';
import { neverStarted } from '../src/lib/c4.js';

test('resolveChatType: zgr- prefix, config, inbound record, else dm/unknown', () => {
  assert.equal(isGroupId('zgr-0d5ae61ad6743f2a6665'), true);
  assert.equal(resolveChatType({}, 'zgr-0d5ae61ad6743f2a6665'), 'group');
  assert.equal(resolveChatType({}, 'ecf1579cf0c2199c40d3'), 'dm');
  assert.equal(resolveChatType({ groups: { g1: {} } }, 'g1'), 'group');
  assert.equal(resolveChatType({}, 'g2', { chat_type: 'group' }), 'group');
  assert.equal(resolveChatType({}, 'a-b'), 'unknown');
  assert.equal(resolveChatType({}, ''), 'unknown');
});

test('neverStarted only for spawn errors', () => {
  assert.equal(neverStarted(Object.assign(new Error(), { code: 'ENOENT' })), true);
  assert.equal(neverStarted(Object.assign(new Error(), { code: 1 })), false);
  assert.equal(neverStarted(Object.assign(new Error(), { code: null, signal: 'SIGKILL' })), false);
  assert.equal(neverStarted(Object.assign(new Error(), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })), false);
  assert.equal(neverStarted(null), false);
});

test('inbound log records carry chat_type', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes("chat_type: info.isGroup ? 'group' : 'dm'"));
});

test('GROUP webhook fixture: group info, no warning; unprefixed group id warns', async () => {
  const { getMessageInfo } = await import('../src/lib/message-info.js');
  const { groupTextWebhook } = await import('./fixtures/group-webhook.js');
  const warnings = [];
  const logger = { warn: (m) => warnings.push(m) };
  const info = getMessageInfo(groupTextWebhook, {}, logger);
  assert.equal(info.isGroup, true);
  assert.equal(info.chatId, 'zgr-0f1e2d3c4b5a69788796');
  assert.equal(info.senderId, 'a1b2c3d4e5f60718293a');
  assert.equal(info.messageId, '5f4e3d2c1b0a99887766');
  assert.equal(resolveChatType({}, info.chatId), 'group');
  assert.deepEqual(warnings, []);

  const odd = structuredClone(groupTextWebhook);
  odd.message.chat.id = 'g123';
  getMessageInfo(odd, {}, logger);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /g123 does not start with zgr-/);
});

test('resolveChatType: any logged group record marks the id as group', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { hasLoggedGroupRecord } = await import('../src/lib/context.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-ct-'));
  fs.writeFileSync(path.join(dir, 'g123.jsonl'),
    `${JSON.stringify({ message_id: 'm1', chat_type: 'group' })}\n${JSON.stringify({ message_id: 'm2', user_id: 'bot' })}\n`);
  assert.equal(hasLoggedGroupRecord('g123', dir), true);
  assert.equal(hasLoggedGroupRecord('other', dir), false);
  assert.equal(resolveChatType({}, 'g123', null, true), 'group');
  assert.equal(resolveChatType({}, 'g123', null, false), 'dm');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isReplyableDmId matches what outbound can resolve as dm; inbound rejects others', async () => {
  const { isReplyableDmId } = await import('../src/lib/chat-type.js');
  assert.equal(isReplyableDmId('ecf1579cf0c2199c40d3'), true);
  assert.equal(isReplyableDmId('abc-def'), false);
  assert.equal(isReplyableDmId('abc_def'), false);
  assert.equal(resolveChatType({}, 'abc-def'), 'unknown');
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes('!info.isGroup && !isReplyableDmId(info.chatId)'));
});
