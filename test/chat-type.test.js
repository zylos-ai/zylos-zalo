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
