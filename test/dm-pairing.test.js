import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { freshImport, withTempHome } from './helpers.js';

const STATE_REL = 'zylos/components/zalo/dm-pairing.json';

test('unknown → pending → approve adds to dmAllowFrom and clears pending', async () => {
  await withTempHome(async (home) => {
    const m = await freshImport('src/lib/dm-pairing.js');
    assert.equal(m.getPairingStatus('u1'), 'unknown');

    let state = m.markPairingPending({ userId: 'u1', userName: 'Stranger', chatId: 'c1', firstMessage: 'hi' });
    m.savePairingState(state);
    assert.equal(m.getPairingStatus('u1'), 'pending');
    assert.equal(m.listPending().length, 1);
    // persisted at 0600
    const mode = fs.statSync(path.join(home, STATE_REL)).mode & 0o777;
    assert.equal(mode, 0o600);

    const config = { dmAllowFrom: [] };
    state = m.loadPairingState();
    assert.equal(m.approvePairingUser(config, 'u1', state), true);
    m.savePairingState(state);
    assert.deepEqual(config.dmAllowFrom, ['u1']);
    assert.equal(m.getPairingStatus('u1'), 'unknown'); // no longer pending
  });
});

test('markPairingPending is idempotent and skips denied users', async () => {
  await withTempHome(async () => {
    const m = await freshImport('src/lib/dm-pairing.js');
    let state = m.markPairingPending({ userId: 'u2', userName: 'A', chatId: 'c' });
    state = m.markPairingPending({ userId: 'u2', userName: 'A-again', chatId: 'c' }, state);
    assert.equal(Object.keys(state.pending).length, 1);
    assert.equal(state.pending.u2.name, 'A'); // first record wins, not overwritten

    // deny, then a new pending attempt should not re-queue
    const config = { dmAllowFrom: ['u2'] };
    m.denyPairingUser(config, 'u2', 'spam', state);
    assert.equal(m.getPairingStatus('u2', state), 'denied');
    assert.deepEqual(config.dmAllowFrom, []); // removed from allowlist
    state = m.markPairingPending({ userId: 'u2', userName: 'A', chatId: 'c' }, state);
    assert.equal(m.getPairingStatus('u2', state), 'denied'); // still denied, not pending
  });
});

test('buildPairingNotification includes identity and approve/deny lines', async () => {
  const m = await freshImport('src/lib/dm-pairing.js');
  const text = m.buildPairingNotification({ userId: 'u9', userName: 'Bob', chatId: 'c9', firstMessage: 'hello' });
  assert.match(text, /Bob \(u9\)/);
  assert.match(text, /dm-approve u9/);
  assert.match(text, /dm-deny u9/);
  assert.match(text, /hello/);
});

test('approve/deny are no-ops for empty user ids', async () => {
  const m = await freshImport('src/lib/dm-pairing.js');
  const config = { dmAllowFrom: [] };
  assert.equal(m.approvePairingUser(config, '', { pending: {}, denied: {} }), false);
  assert.equal(m.denyPairingUser(config, '', '', { pending: {}, denied: {} }), false);
  assert.deepEqual(config.dmAllowFrom, []);
});
