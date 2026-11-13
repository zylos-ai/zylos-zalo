import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isValidSessionGroup, sessionGroupFromEndpoint } from '../src/lib/session-group.js';
import {
  buildC4ReceiveArgs, classifyC4Rejection, sendToC4, GENERIC_REJECT_REPLY, UNCERTAIN_REPLY
} from '../src/lib/c4.js';
import { runNode } from './helpers.js';

const cases = [
  ['private chat', '1234567890123456789|type:dm|msg:m1|req:r1', 'dm-1234567890123456789'],
  ['endpoint from before 0.2.0 (no type) is a DM', '1234567890', 'dm-1234567890'],
  ['group', 'g4f2a9b1c|type:group|msg:m2', 'group-g4f2a9b1c'],
  ['owner pairing notice', 'admin|type:dm-pairing', 'admin'],
];

for (const [name, endpoint, expected] of cases) {
  test(`session group: ${name}`, () => {
    const group = sessionGroupFromEndpoint(endpoint);
    assert.equal(group, expected);
    assert.equal(isValidSessionGroup(group), true);
  });
}

test('session group ignores per-message parts and keeps DM/group apart', () => {
  assert.equal(sessionGroupFromEndpoint('42|type:group|msg:a'), sessionGroupFromEndpoint('42|type:group|msg:b'));
  assert.notEqual(sessionGroupFromEndpoint('42|type:dm'), sessionGroupFromEndpoint('42|type:group'));
});

test('session group rejects invalid endpoints instead of falling back', () => {
  for (const bad of ['', 'a b|type:dm', `${'9'.repeat(100)}|type:group`, '42|type:channel']) {
    assert.throws(() => sessionGroupFromEndpoint(bad));
  }
});

test('session-group CLI prints the group and fails with exit 1, no stdout', async () => {
  const ok = await runNode(['scripts/session-group.js', '42|type:group|msg:1']);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout, 'group-42\n');
  const bad = await runNode(['scripts/session-group.js', 'a b']);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
});

test('c4-receive args: --session-group only when Core lists it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-c4-'));
  const scripts = path.join(dir, '.claude/skills/comm-bridge/scripts');
  fs.mkdirSync(scripts, { recursive: true });
  const prev = process.env.ZYLOS_DIR;
  process.env.ZYLOS_DIR = dir;
  try {
    const base = ['--channel', 'zalo', '--endpoint', 'e', '--json', '--content', 'c'];
    const args = () => buildC4ReceiveArgs({ channel: 'zalo', endpoint: 'e', content: 'c', sessionGroup: 'dm-1' });
    assert.deepEqual(args(), base); // old Core: no manifest
    fs.writeFileSync(path.join(scripts, 'c4-receive-options.json'), JSON.stringify({ options: { '--channel': {} } }));
    assert.deepEqual(args(), base);
    fs.writeFileSync(path.join(scripts, 'c4-receive-options.json'), JSON.stringify({ options: { '--session-group': { takesValue: true } } }));
    assert.deepEqual(args(), [...base, '--session-group', 'dm-1']);
  } finally {
    if (prev === undefined) delete process.env.ZYLOS_DIR; else process.env.ZYLOS_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const reject = (persisted) => ({ ok: false, error: { code: 'X', message: 'core text', persisted } });
function run(responses, endpoint = '1|type:dm|msg:m') {
  return new Promise((resolve) => {
    const notices = [];
    let calls = 0;
    const exec = (_bin, _args, _opts, cb) => {
      const r = responses[calls++];
      if (r === 'ok') return cb(null, '');
      if (r === 'spawn') return cb(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '');
      if (r === 'killed') return cb(Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }), '');
      cb(Object.assign(new Error('fail'), { code: 1 }), JSON.stringify(r ?? ''));
    };
    sendToC4('zalo', endpoint, 'hi', (n) => notices.push(n),
      { exec, retryDelayMs: 1, onDone: (outcome) => resolve({ outcome, notices, calls }) });
  });
}

test('rejection classes follow error.persisted', () => {
  assert.equal(classifyC4Rejection(reject(['row'])), 'committed');
  assert.equal(classifyC4Rejection(reject([])), 'not_stored');
  assert.equal(classifyC4Rejection(reject(undefined)), 'uncertain');
});

test('sendToC4 outcomes', async () => {
  assert.deepEqual(await run(['ok']), { outcome: 'sent', notices: [], calls: 1 });
  assert.deepEqual(await run([reject(['row'])]), { outcome: 'committed', notices: [null], calls: 1 });
  assert.deepEqual(await run([reject([])]), { outcome: 'rejected', notices: [GENERIC_REJECT_REPLY], calls: 1 });
  assert.deepEqual(await run([reject(undefined)]), { outcome: 'rejected', notices: [UNCERTAIN_REPLY], calls: 1 });
  // Started but no structured result (crash, kill): uncertain, never resent.
  assert.deepEqual(await run([null]), { outcome: 'failed', notices: [UNCERTAIN_REPLY], calls: 1 });
  assert.deepEqual(await run(['killed']), { outcome: 'failed', notices: [UNCERTAIN_REPLY], calls: 1 });
  // Never started: safe to retry once.
  assert.deepEqual(await run(['spawn', 'ok']), { outcome: 'sent', notices: [], calls: 2 });
  assert.deepEqual(await run(['spawn', 'spawn']), { outcome: 'failed', notices: [UNCERTAIN_REPLY], calls: 2 });
  assert.deepEqual(await run(['spawn', reject([])]), { outcome: 'rejected', notices: [GENERIC_REJECT_REPLY], calls: 2 });
});

test('sendToC4 never sends an unmappable endpoint to the overall group', async () => {
  const notices = [];
  let called = false;
  await new Promise((resolve) => sendToC4('zalo', 'a b|type:dm', 'hi', (n) => notices.push(n),
    { exec: () => { called = true; }, onDone: resolve }));
  assert.equal(called, false);
  assert.deepEqual(notices, [GENERIC_REJECT_REPLY]);
});

test('zgr- ids always map to group, independent of the endpoint type (stable)', () => {
  assert.equal(sessionGroupFromEndpoint('zgr-0d5ae61ad6743f2a6665'), 'group-zgr-0d5ae61ad6743f2a6665');
  assert.equal(sessionGroupFromEndpoint('zgr-0d5a|msg:m1|req:r'), 'group-zgr-0d5a');
  assert.equal(sessionGroupFromEndpoint('zgr-0d5a|type:dm|msg:m1'), 'group-zgr-0d5a');
  assert.equal(sessionGroupFromEndpoint('zgr-0d5a|type:group'), 'group-zgr-0d5a');
  assert.equal(sessionGroupFromEndpoint('ecf1579cf0c2199c40d3'), 'dm-ecf1579cf0c2199c40d3');
  assert.equal(sessionGroupFromEndpoint('ecf1579cf0c2199c40d3|type:dm|msg:1'), 'dm-ecf1579cf0c2199c40d3');
});
