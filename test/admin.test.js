import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, freshImport, makeTempHome, runNode } from './helpers.js';

const CONFIG_REL = 'zylos/components/zalo/config.json';

function configPath(home) {
  return path.join(home, CONFIG_REL);
}

function writeConfig(home, config) {
  fs.writeFileSync(configPath(home), JSON.stringify(config, null, 2));
}

function readConfig(home) {
  return JSON.parse(fs.readFileSync(configPath(home), 'utf8'));
}

function baseConfig(extra = {}) {
  return {
    botToken: 'token-1',
    enabled: true,
    owner: { user_id: 'owner-1', name: 'Owner', bound_at: '2026-01-01T00:00:00Z' },
    dmPolicy: 'owner',
    groupPolicy: 'allowlist',
    groups: {},
    message: { context_messages: 5 },
    ...extra
  };
}

function admin(home, ...args) {
  return runNode(['scripts/admin.js', ...args], { env: { HOME: home } });
}

test('admin add-group creates a group with allow-all senders; runtime agrees', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig());
    const res = await admin(home, 'add-group', 'groupA', 'Test', 'Group');
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Added group: Test Group \(groupA\)/);

    const config = readConfig(home);
    assert.deepEqual(config.groups.groupA.allowFrom, ['*']);
    assert.equal(config.groups.groupA.name, 'Test Group');
    assert.equal(config.groups.groupA.historyLimit, 5);

    // CLI <-> runtime agreement: allow-all by default
    const { isGroupAllowed, isGroupSenderAllowed } = await freshImport('src/lib/auth.js');
    assert.equal(isGroupAllowed(config, 'groupA'), true);
    assert.equal(isGroupSenderAllowed(config, 'groupA', 'anyone'), true);
  } finally {
    cleanupDir(home);
  }
});

test('admin set-group-allowfrom restricts senders; runtime restricts, owner bypasses', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig({ groups: { groupA: { name: 'A', allowFrom: ['*'], historyLimit: 5 } } }));
    const res = await admin(home, 'set-group-allowfrom', 'groupA', 'u1, u2');
    assert.equal(res.code, 0, res.stderr);

    const config = readConfig(home);
    assert.deepEqual(config.groups.groupA.allowFrom, ['u1', 'u2']);

    const { isGroupSenderAllowed } = await freshImport('src/lib/auth.js');
    assert.equal(isGroupSenderAllowed(config, 'groupA', 'u1'), true);
    assert.equal(isGroupSenderAllowed(config, 'groupA', 'u3'), false);
    assert.equal(isGroupSenderAllowed(config, 'groupA', 'owner-1'), true, 'owner bypasses');
  } finally {
    cleanupDir(home);
  }
});

test('admin set-group-allowfrom * restores allow-all; runtime agrees', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig({ groups: { groupA: { name: 'A', allowFrom: ['u1'], historyLimit: 5 } } }));
    const res = await admin(home, 'set-group-allowfrom', 'groupA', '*');
    assert.equal(res.code, 0, res.stderr);

    const config = readConfig(home);
    assert.deepEqual(config.groups.groupA.allowFrom, ['*']);

    const { isGroupSenderAllowed } = await freshImport('src/lib/auth.js');
    assert.equal(isGroupSenderAllowed(config, 'groupA', 'someone'), true);
  } finally {
    cleanupDir(home);
  }
});

test('admin set-group-policy updates policy; runtime gating agrees', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig({ groups: { groupA: { name: 'A', allowFrom: ['*'] } } }));
    let res = await admin(home, 'set-group-policy', 'disabled');
    assert.equal(res.code, 0, res.stderr);
    let config = readConfig(home);
    assert.equal(config.groupPolicy, 'disabled');

    const { isGroupAllowed } = await freshImport('src/lib/auth.js');
    assert.equal(isGroupAllowed(config, 'groupA'), false, 'disabled blocks the group');

    res = await admin(home, 'set-group-policy', 'open');
    config = readConfig(home);
    assert.equal(config.groupPolicy, 'open');
    const auth2 = await freshImport('src/lib/auth.js');
    assert.equal(auth2.isGroupAllowed(config, 'unconfigured'), true, 'open allows any group');
  } finally {
    cleanupDir(home);
  }
});

test('admin set-group-policy rejects invalid value', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig());
    const res = await admin(home, 'set-group-policy', 'bogus');
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage: admin.js set-group-policy/);
  } finally {
    cleanupDir(home);
  }
});

test('admin set-group-allowfrom on missing group errors', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig());
    const res = await admin(home, 'set-group-allowfrom', 'ghost', 'u1');
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Group ghost not found/);
  } finally {
    cleanupDir(home);
  }
});

test('admin remove-group deletes the group', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig({ groups: { groupA: { name: 'A', allowFrom: ['*'] } } }));
    const res = await admin(home, 'remove-group', 'groupA');
    assert.equal(res.code, 0, res.stderr);
    const config = readConfig(home);
    assert.equal(config.groups.groupA, undefined);
  } finally {
    cleanupDir(home);
  }
});

test('admin set-group-history-limit updates the per-group limit', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig({ groups: { groupA: { name: 'A', allowFrom: ['*'], historyLimit: 5 } } }));
    const res = await admin(home, 'set-group-history-limit', 'groupA', '12');
    assert.equal(res.code, 0, res.stderr);
    const config = readConfig(home);
    assert.equal(config.groups.groupA.historyLimit, 12);
  } finally {
    cleanupDir(home);
  }
});

test('admin list-groups shows configured groups', async () => {
  const home = makeTempHome();
  try {
    writeConfig(home, baseConfig({ groups: { groupA: { name: 'Alpha', allowFrom: ['u1'], historyLimit: 7 } } }));
    const res = await admin(home, 'list-groups');
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Group policy: allowlist/);
    assert.match(res.stdout, /Alpha \(groupA\)/);
    assert.match(res.stdout, /allowFrom: u1/);
    assert.match(res.stdout, /historyLimit: 7/);
  } finally {
    cleanupDir(home);
  }
});
