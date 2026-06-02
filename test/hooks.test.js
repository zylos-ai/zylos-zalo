import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, makeTempHome, runNode } from './helpers.js';

test('configure hook writes collected Zalo config values', async () => {
  const home = makeTempHome();
  try {
    const result = await runNode(['hooks/configure.js'], {
      env: { HOME: home },
      input: JSON.stringify({ ZALO_BOT_TOKEN: 'token-1', ZALO_DELIVERY: 'webhook' })
    });
    assert.equal(result.code, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'zylos/components/zalo/config.json'), 'utf8'));
    assert.equal(saved.botToken, 'token-1');
    assert.equal(saved.delivery, 'webhook');
    assert.equal(saved.owner, undefined);
    assert.equal(saved.dmPolicy, undefined);
    assert.equal(saved.groupPolicy, undefined);
    assert.equal(saved.webhookSecret, undefined);
  } finally {
    cleanupDir(home);
  }
});

test('configure hook ignores non-allowlisted collected keys', async () => {
  const home = makeTempHome();
  try {
    const result = await runNode(['hooks/configure.js'], {
      env: { HOME: home },
      input: JSON.stringify({
        ZALO_BOT_TOKEN: 'token-1',
        ZALO_OWNER: 'attacker',
        dmPolicy: 'open',
        groupPolicy: 'open',
        webhookSecret: 'secret',
        owner: { user_id: 'attacker' }
      })
    });
    assert.equal(result.code, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'zylos/components/zalo/config.json'), 'utf8'));
    assert.equal(saved.botToken, 'token-1');
    assert.equal(saved.owner, undefined);
    assert.equal(saved.dmPolicy, undefined);
    assert.equal(saved.groupPolicy, undefined);
    assert.equal(saved.webhookSecret, undefined);
  } finally {
    cleanupDir(home);
  }
});

test('post-install creates data directories and default config', async () => {
  const home = makeTempHome();
  fs.rmSync(path.join(home, 'zylos/components/zalo'), { recursive: true, force: true });
  try {
    const result = await runNode(['hooks/post-install.js'], { env: { HOME: home } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(home, 'zylos/components/zalo/logs')), true);
    assert.equal(fs.existsSync(path.join(home, 'zylos/components/zalo/media')), true);
    assert.equal(fs.existsSync(path.join(home, 'zylos/components/zalo/typing')), true);
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(saved, { enabled: true, delivery: 'polling' });
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  } finally {
    cleanupDir(home);
  }
});

test('pre-upgrade backs up config and post-upgrade migrates enabled field', async () => {
  const home = makeTempHome();
  const configPath = path.join(home, 'zylos/components/zalo/config.json');
  fs.writeFileSync(configPath, JSON.stringify({ botToken: 'token-1' }));
  try {
    let result = await runNode(['hooks/pre-upgrade.js'], { env: { HOME: home } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.existsSync(`${configPath}.backup`), true);
    assert.equal(fs.statSync(`${configPath}.backup`).mode & 0o777, 0o600);

    result = await runNode(['hooks/post-upgrade.js'], { env: { HOME: home } });
    assert.equal(result.code, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.enabled, true);
    assert.equal(saved.botToken, 'token-1');
  } finally {
    cleanupDir(home);
  }
});
