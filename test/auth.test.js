import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, freshImport, makeTempHome } from './helpers.js';

const oldHome = process.env.HOME;
const oldToken = process.env.ZALO_BOT_TOKEN;
const home = makeTempHome();
process.env.HOME = home;
delete process.env.ZALO_BOT_TOKEN;

test.after(() => {
  process.env.HOME = oldHome;
  if (oldToken === undefined) delete process.env.ZALO_BOT_TOKEN;
  else process.env.ZALO_BOT_TOKEN = oldToken;
  cleanupDir(home);
});

function baseConfig(overrides = {}) {
  return {
    owner: { user_id: 'owner-1', name: 'Owner', bound_at: 'now' },
    dmPolicy: 'owner',
    dmAllowFrom: [],
    groupPolicy: 'allowlist',
    groups: {},
    message: { context_messages: 5 },
    ...overrides
  };
}

test('auth owner binding persists owner and adds DM allowlist entry', async () => {
  fs.mkdirSync(path.join(home, 'zylos/components/zalo'), { recursive: true });
  const { bindOwner, hasOwner, isOwner, isDmAllowed } = await freshImport('src/lib/auth.js');
  const config = baseConfig({ owner: { user_id: null, name: null, bound_at: null } });

  assert.equal(hasOwner(config), false);
  bindOwner(config, 123, 'Felix');

  assert.equal(hasOwner(config), true);
  assert.equal(isOwner(config, '123'), true);
  assert.equal(isDmAllowed(config, '123'), true);
  assert.deepEqual(config.dmAllowFrom, ['123']);

  const saved = JSON.parse(fs.readFileSync(path.join(home, 'zylos/components/zalo/config.json'), 'utf8'));
  assert.equal(saved.owner.user_id, '123');
});

test('auth enforces DM policies', async () => {
  const { isDmAllowed } = await freshImport('src/lib/auth.js');
  assert.equal(isDmAllowed(baseConfig({ dmPolicy: 'owner' }), 'user-1'), false);
  assert.equal(isDmAllowed(baseConfig({ dmPolicy: 'open' }), 'user-1'), true);
  assert.equal(isDmAllowed(baseConfig({ dmPolicy: 'allowlist', dmAllowFrom: ['user-1'] }), 'user-1'), true);
  assert.equal(isDmAllowed(baseConfig({ dmPolicy: 'allowlist', dmAllowFrom: ['user-2'] }), 'user-1'), false);
});

test('auth enforces group policy and per-group senders', async () => {
  const { isGroupAllowed, isGroupSenderAllowed, getGroupName, addGroup } = await freshImport('src/lib/auth.js');
  const config = baseConfig({
    groups: {
      groupA: { name: 'Group A', allowFrom: ['user-1'], historyLimit: 3 },
      groupOpen: { name: 'Open Group', allowFrom: ['*'] }
    }
  });

  assert.equal(isGroupAllowed(baseConfig({ groupPolicy: 'disabled' }), 'groupA'), false);
  assert.equal(isGroupAllowed(baseConfig({ groupPolicy: 'open' }), 'any-group'), true);
  assert.equal(isGroupAllowed(config, 'groupA'), true);
  assert.equal(isGroupAllowed(config, 'missing'), false);

  assert.equal(isGroupSenderAllowed(config, 'groupA', 'user-1'), true);
  assert.equal(isGroupSenderAllowed(config, 'groupA', 'user-2'), false);
  assert.equal(isGroupSenderAllowed(config, 'groupA', 'owner-1'), true);
  assert.equal(isGroupSenderAllowed(config, 'groupOpen', 'anyone'), true);
  assert.equal(getGroupName(config, 'groupA', 'fallback'), 'Group A');
  assert.equal(getGroupName(config, 'missing', 'fallback'), 'fallback');

  assert.equal(addGroup(config, 'groupB', 'Group B'), true);
  assert.equal(addGroup(config, 'groupB', 'Group B'), false);
  assert.deepEqual(config.groups.groupB.allowFrom, ['*']);
});

test('auth bindOwner rolls back in-memory state on config save failure', async () => {
  const configDir = path.join(home, 'zylos/components/zalo');
  fs.mkdirSync(configDir, { recursive: true });
  const { bindOwner, hasOwner } = await freshImport('src/lib/auth.js');
  const config = baseConfig({ owner: { user_id: null, name: null, bound_at: null }, dmAllowFrom: [] });

  const configPath = path.join(configDir, 'config.json');
  try { fs.unlinkSync(configPath); } catch {}
  fs.mkdirSync(configPath, { recursive: true });

  const result = bindOwner(config, 'user-999', 'TestUser');
  assert.equal(result, false);
  assert.equal(hasOwner(config), false);
  assert.ok(!config.dmAllowFrom.includes('user-999'));

  fs.rmSync(configPath, { recursive: true, force: true });
});
