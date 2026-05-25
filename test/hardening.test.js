import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, freshImport, makeTempHome, runNode, withTempHome } from './helpers.js';

// ─── Config permissions (HIGH) ───

test('saveConfig writes config with 0o600 permissions', async () => {
  await withTempHome(async (home) => {
    const { saveConfig } = await freshImport('src/lib/config.js');
    assert.equal(saveConfig({ enabled: true, botToken: 'x' }), true);
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    const stat = fs.statSync(configPath);
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

test('repairConfigPermissions fixes loose config and data dir', async () => {
  await withTempHome(async (home) => {
    const dataDir = path.join(home, 'zylos/components/zalo');
    const configPath = path.join(dataDir, 'config.json');
    fs.writeFileSync(configPath, '{}', { mode: 0o644 });
    fs.chmodSync(dataDir, 0o755);

    const { repairConfigPermissions } = await freshImport('src/lib/config.js');
    repairConfigPermissions();

    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  });
});

test('configure hook writes config with restricted permissions', async () => {
  const home = makeTempHome();
  fs.rmSync(path.join(home, 'zylos/components/zalo'), { recursive: true, force: true });
  try {
    const result = await runNode(['hooks/configure.js'], {
      env: { HOME: home },
      input: JSON.stringify({ ZALO_BOT_TOKEN: 'token-1' })
    });
    assert.equal(result.code, 0, result.stderr);
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    const stat = fs.statSync(configPath);
    assert.equal(stat.mode & 0o777, 0o600);
    const dirStat = fs.statSync(path.join(home, 'zylos/components/zalo'));
    assert.equal(dirStat.mode & 0o777, 0o700);
  } finally {
    cleanupDir(home);
  }
});

// ─── SSRF hardening (Z-2 MEDIUM) ───

test('validateDownloadUrl blocks non-HTTPS URLs', async () => {
  await withTempHome(async () => {
    const { validateDownloadUrl } = await freshImport('src/lib/media.js');
    assert.equal(await validateDownloadUrl('http://example.com/img.png'), false);
    assert.equal(await validateDownloadUrl('ftp://example.com/img.png'), false);
    assert.equal(await validateDownloadUrl('file:///etc/passwd'), false);
    assert.equal(await validateDownloadUrl('not-a-url'), false);
  });
});

test('validateDownloadUrl allows Zalo CDN hosts as fast-path', async () => {
  await withTempHome(async () => {
    const { validateDownloadUrl } = await freshImport('src/lib/media.js');
    assert.equal(await validateDownloadUrl('https://files.dlfl.vn/photo.jpg'), true);
    assert.equal(await validateDownloadUrl('https://zc-photo.zadn.vn/img.png'), true);
    assert.equal(await validateDownloadUrl('https://media.zdn.vn/file.gif'), true);
    assert.equal(await validateDownloadUrl('https://cdn.zaloapp.com/sticker.webp'), true);
  });
});

test('downloadImage blocks redirect to private IP', async () => {
  await withTempHome(async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => new Response('', {
      status: 302,
      headers: { location: 'https://127.0.0.1/secret' }
    });
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      const result = await downloadImage('https://example.com/redir.png');
      assert.equal(result, null);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

// ─── Correlation key / path traversal (Z-3 MEDIUM) ───

test('safeCorrelationId strips path traversal characters', () => {
  function safeCorrelationId(raw) {
    if (!raw) return null;
    return String(raw).replace(/[^a-zA-Z0-9_:-]/g, '_');
  }

  assert.equal(safeCorrelationId('../../../etc/passwd'), '_________etc_passwd');
  assert.equal(safeCorrelationId('chat:123'), 'chat:123');
  assert.equal(safeCorrelationId('a/b\\c'), 'a_b_c');
  assert.equal(safeCorrelationId(null), null);
  assert.equal(safeCorrelationId(undefined), null);
});

// ─── webhookSecret masking in admin show (Z-12 LOW) ───

test('admin show masks webhookSecret', async () => {
  const home = makeTempHome();
  try {
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      botToken: '12345678:secret-part',
      webhookSecret: 'my-super-secret-value',
      enabled: true
    }));

    const result = await runNode(['scripts/admin.js', 'show'], { env: { HOME: home } });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!result.stdout.includes('my-super-secret-value'), 'webhookSecret should be masked');
    assert.ok(result.stdout.includes('my-s...'), 'webhookSecret should show first 4 chars');
    assert.ok(!result.stdout.includes(':secret-part'), 'botToken should be masked');
    assert.ok(result.stdout.includes('12345678...'), 'botToken should show first 8 chars');
  } finally {
    cleanupDir(home);
  }
});

// ─── Context eviction bounds (Z-8 LOW) ───

test('context history evicts entries beyond the tracked chat limit', async () => {
  await withTempHome(async () => {
    const { recordEntry, getHistory } = await freshImport('src/lib/context.js');
    for (let i = 0; i < 510; i++) {
      recordEntry(`chat-${i}`, {
        timestamp: new Date().toISOString(),
        message_id: `m-${i}`,
        user_id: 'u1',
        text: `msg ${i}`
      }, { message: { context_messages: 5 } });
    }
    const h = getHistory('chat-509', null, { message: { context_messages: 5 } });
    assert.ok(h.length > 0, 'recent chat should still have history');
  });
});
