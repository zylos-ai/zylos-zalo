import assert from 'node:assert/strict';
import test from 'node:test';
import { freshImport } from './helpers.js';

const BASE_CONFIG = {
  enabled: true,
  botToken: 'tok-123',
  owner: { user_id: 'u1', name: 'Felix' },
  delivery: 'polling',
};

// All file-system checks are injected so the suite never touches real paths.
const okFs = {
  existsImpl: () => true,
  statImpl: (p) => ({ mode: String(p).endsWith('config.json') ? 0o600 : 0o700 }),
};

function byName(results, name) {
  return results.find(r => r.name === name);
}

test('doctor reports all green on a healthy polling config', async () => {
  const { runDoctor } = await freshImport('src/lib/doctor.js');
  const results = await runDoctor(BASE_CONFIG, {
    getMeImpl: async () => ({ id: 'bot-9', display_name: 'Zylos' }),
    ...okFs,
  });
  assert.equal(results.every(r => r.ok), true, JSON.stringify(results, null, 2));
  assert.match(byName(results, 'getMe (token valid)').detail, /Zylos.*bot-9|bot-9/);
  assert.equal(byName(results, 'delivery mode').detail, 'polling');
  assert.equal(byName(results, 'owner bound').ok, true);
});

test('doctor flags a missing token and skips getMe', async () => {
  const { runDoctor } = await freshImport('src/lib/doctor.js');
  const results = await runDoctor({ ...BASE_CONFIG, botToken: null }, {
    getMeImpl: async () => { throw new Error('should not be called'); },
    ...okFs,
  });
  assert.equal(byName(results, 'bot token').ok, false);
  assert.equal(byName(results, 'getMe (token valid)').ok, false);
  assert.match(byName(results, 'getMe (token valid)').detail, /skipped/);
});

test('doctor surfaces a getMe failure as a warn with the error message', async () => {
  const { runDoctor } = await freshImport('src/lib/doctor.js');
  const results = await runDoctor(BASE_CONFIG, {
    getMeImpl: async () => { throw new Error('Unauthorized'); },
    ...okFs,
  });
  const probe = byName(results, 'getMe (token valid)');
  assert.equal(probe.ok, false);
  assert.match(probe.detail, /Unauthorized/);
});

test('doctor validates webhook registration against config', async () => {
  const { runDoctor } = await freshImport('src/lib/doctor.js');
  const match = await runDoctor(
    { ...BASE_CONFIG, delivery: 'webhook', webhookUrl: 'https://x.test/zalo/webhook' },
    { getMeImpl: async () => ({ id: 'b' }), webhookInfoImpl: async () => ({ url: 'https://x.test/zalo/webhook' }), ...okFs },
  );
  assert.equal(byName(match, 'webhook registration').ok, true);

  const mismatch = await runDoctor(
    { ...BASE_CONFIG, delivery: 'webhook', webhookUrl: 'https://x.test/zalo/webhook' },
    { getMeImpl: async () => ({ id: 'b' }), webhookInfoImpl: async () => ({ url: 'https://stale.test/hook' }), ...okFs },
  );
  const w = byName(mismatch, 'webhook registration');
  assert.equal(w.ok, false);
  assert.match(w.detail, /stale\.test/);
});

test('doctor warns on loose config permissions', async () => {
  const { runDoctor } = await freshImport('src/lib/doctor.js');
  const results = await runDoctor(BASE_CONFIG, {
    getMeImpl: async () => ({ id: 'b' }),
    existsImpl: () => true,
    statImpl: (p) => ({ mode: String(p).endsWith('config.json') ? 0o644 : 0o700 }),
  });
  const perm = byName(results, 'config permissions');
  assert.equal(perm.ok, false);
  assert.match(perm.detail, /expected 0600/);
});

test('doctor notes an unbound owner without failing hard', async () => {
  const { runDoctor } = await freshImport('src/lib/doctor.js');
  const results = await runDoctor({ ...BASE_CONFIG, owner: { user_id: null } }, {
    getMeImpl: async () => ({ id: 'b' }),
    ...okFs,
  });
  const owner = byName(results, 'owner bound');
  assert.equal(owner.ok, false);
  assert.match(owner.detail, /binds on first owner DM/);
});
