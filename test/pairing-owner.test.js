import assert from 'node:assert/strict';
import test from 'node:test';
import { freshImport } from './helpers.js';

function stateWith(...entries) {
  return {
    pending: Object.fromEntries(entries.map(entry => [entry.user_id, entry])),
    denied: {}
  };
}

test('owner pairing notification sends request details to bound owner', async () => {
  const { buildOwnerPairingDm, sendOwnerPairingDm } = await freshImport('src/lib/pairing-owner.js');
  const message = buildOwnerPairingDm({
    userId: 'u1',
    userName: 'Alice',
    firstMessage: 'hello'
  });
  assert.equal(message, [
    'Pairing request: Alice (u1) wants to chat.',
    'First message: "hello"',
    'Reply "approve" to allow or "deny" to reject.'
  ].join('\n'));

  const calls = [];
  const sent = await sendOwnerPairingDm({
    config: { owner: { user_id: 'owner-1' } },
    userId: 'u1',
    userName: 'Alice',
    firstMessage: 'hello',
    send: async (chatId, text) => calls.push({ chatId, text })
  });

  assert.equal(sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, 'owner-1');
  assert.match(calls[0].text, /Alice \(u1\) wants to chat/);
});

test('owner approve with uid allowlists and clears a pending request', async () => {
  const {
    applyOwnerPairingCommand,
    ownerPairingReplyFor,
    resolveOwnerPairingCommand
  } = await freshImport('src/lib/pairing-owner.js');
  const state = stateWith({ user_id: 'u1', name: 'Alice', chat_id: 'chat-u1' });
  const config = { dmAllowFrom: [] };
  const resolved = resolveOwnerPairingCommand('approve u1', state);

  assert.equal(applyOwnerPairingCommand(config, state, resolved), true);
  assert.deepEqual(config.dmAllowFrom, ['u1']);
  assert.deepEqual(state.pending, {});
  assert.equal(ownerPairingReplyFor(resolved), 'Approved Alice');
});

test('owner deny with uid clears pending without allowlisting', async () => {
  const {
    applyOwnerPairingCommand,
    ownerPairingReplyFor,
    resolveOwnerPairingCommand
  } = await freshImport('src/lib/pairing-owner.js');
  const state = stateWith({ user_id: 'u2', name: 'Bob', chat_id: 'chat-u2' });
  const config = { dmAllowFrom: [] };
  const resolved = resolveOwnerPairingCommand('deny u2', state);

  assert.equal(applyOwnerPairingCommand(config, state, resolved), true);
  assert.deepEqual(config.dmAllowFrom, []);
  assert.deepEqual(state.pending, {});
  assert.equal(state.denied.u2.user_id, 'u2');
  assert.equal(ownerPairingReplyFor(resolved), 'Denied Bob');
});

test('bare approve acts on one pending request and asks for uid with many', async () => {
  const { applyOwnerPairingCommand, resolveOwnerPairingCommand } = await freshImport('src/lib/pairing-owner.js');
  const single = stateWith({ user_id: 'u3', name: 'Cora', chat_id: 'chat-u3' });
  const config = { dmAllowFrom: [] };
  const singleResolved = resolveOwnerPairingCommand('approve', single);

  assert.equal(singleResolved.userId, 'u3');
  assert.equal(applyOwnerPairingCommand(config, single, singleResolved), true);
  assert.deepEqual(config.dmAllowFrom, ['u3']);

  const multiple = stateWith(
    { user_id: 'u4', name: 'Dai' },
    { user_id: 'u5', name: 'Em' }
  );
  const multipleResolved = resolveOwnerPairingCommand('approve', multiple);
  assert.equal(multipleResolved.needsUserId, true);
  assert.match(multipleResolved.message, /Please specify a user id/);
  assert.match(multipleResolved.message, /Dai \(u4\)/);
  assert.match(multipleResolved.message, /Em \(u5\)/);
});

test('owner pairing commands require pending requests, exact command text, and owner sender', async () => {
  const {
    parseOwnerPairingCommand,
    resolveOwnerPairingCommand,
    resolveOwnerPairingCommandForSender
  } = await freshImport('src/lib/pairing-owner.js');
  const state = stateWith({ user_id: 'u6', name: 'Fran' });
  const config = { owner: { user_id: 'owner-1' } };

  assert.equal(resolveOwnerPairingCommand('approve', { pending: {}, denied: {} }), null);
  assert.equal(parseOwnerPairingCommand('approve', []), null);
  assert.equal(resolveOwnerPairingCommand('I approve this plan', state), null);
  assert.equal(resolveOwnerPairingCommandForSender(config, 'u6', 'approve u6', state), null);
  assert.equal(resolveOwnerPairingCommandForSender(config, 'owner-1', 'APPROVE u6', state).userId, 'u6');
});
