import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { freshImport, withTempHome } from './helpers.js';

test('config loads defaults when config file is missing', async () => {
  await withTempHome(async () => {
    const { loadConfig } = await freshImport('src/lib/config.js');
    const config = loadConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.delivery, 'polling');
    assert.equal(config.dmPolicy, 'owner');
    assert.equal(config.dmWelcomeMessage, '');
    assert.equal(config.voiceTranscription, 'auto');
    assert.equal(config.whisperModel, '');
    assert.equal(config.botToken, null);
  });
});

test('config deep merges file values and preserves nested message defaults', async () => {
  await withTempHome(async (home) => {
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      botToken: 'config-token',
      message: { context_messages: 9 },
      groups: { groupA: { name: 'Group A' } }
    }));

    const { loadConfig } = await freshImport('src/lib/config.js');
    const config = loadConfig();
    assert.equal(config.botToken, 'config-token');
    assert.equal(config.message.context_messages, 9);
    assert.equal(config.message.maxLength, 2000);
    assert.equal(config.groups.groupA.name, 'Group A');
  });
});

test('config falls back to ZALO_BOT_TOKEN from ~/zylos/.env', async () => {
  await withTempHome(async (home) => {
    fs.writeFileSync(path.join(home, 'zylos/.env'), 'ZALO_BOT_TOKEN="env-token"\nIGNORED=value\n');
    fs.writeFileSync(path.join(home, 'zylos/components/zalo/config.json'), JSON.stringify({ enabled: true }));

    const { loadConfig } = await freshImport('src/lib/config.js');
    const config = loadConfig();
    assert.equal(config.botToken, 'env-token');
    assert.equal(process.env.IGNORED, 'value');
  });
});

test('config token in config.json takes precedence over env fallback', async () => {
  await withTempHome(async (home) => {
    fs.writeFileSync(path.join(home, 'zylos/.env'), 'ZALO_BOT_TOKEN=env-token\n');
    fs.writeFileSync(path.join(home, 'zylos/components/zalo/config.json'), JSON.stringify({ botToken: 'config-token' }));

    const { loadConfig } = await freshImport('src/lib/config.js');
    assert.equal(loadConfig().botToken, 'config-token');
  });
});

test('DEFAULT_CONFIG includes logging and retention defaults', async () => {
  const { DEFAULT_CONFIG } = await freshImport('src/lib/config.js');
  assert.equal(DEFAULT_CONFIG.logging.maxLogBytes, 512 * 1024);
  assert.equal(DEFAULT_CONFIG.retention.mediaMaxAgeDays, 7);
  assert.equal(DEFAULT_CONFIG.webhookPort, 3464);
});

test('saveConfig writes atomically parseable JSON', async () => {
  await withTempHome(async (home) => {
    const { saveConfig } = await freshImport('src/lib/config.js');
    assert.equal(saveConfig({ enabled: false, botToken: 'token' }), true);
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'zylos/components/zalo/config.json'), 'utf8'));
    assert.equal(saved.enabled, false);
    assert.equal(saved.botToken, 'token');
  });
});
