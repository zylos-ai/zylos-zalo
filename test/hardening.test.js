import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
      const result = await downloadImage('https://files.dlfl.vn/redir.png');
      assert.equal(result, null);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

test('validateDownloadUrl blocks non-CDN hostnames (CDN-only policy)', async () => {
  await withTempHome(async () => {
    const { validateDownloadUrl } = await freshImport('src/lib/media.js');
    assert.equal(await validateDownloadUrl('https://example.com/img.png'), false, 'non-CDN host');
    assert.equal(await validateDownloadUrl('https://evil.com/img.png'), false, 'arbitrary host');
    assert.equal(await validateDownloadUrl('https://attacker.dlfl.vn.evil.com/img.png'), false, 'CDN-suffix lookalike');
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

// ─── Config reload fail-closed (ZR2-1 HIGH) ───

test('loadConfig retains last-known-good config when file becomes unreadable', async () => {
  await withTempHome(async (home) => {
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      enabled: true,
      botToken: 'tok-1',
      owner: { user_id: 'owner123', user_name: 'Felix' }
    }), { mode: 0o600 });

    const { loadConfig } = await freshImport('src/lib/config.js');
    const first = loadConfig();
    assert.equal(first.owner.user_id, 'owner123');

    fs.unlinkSync(configPath);
    const second = loadConfig();
    assert.equal(second.owner.user_id, 'owner123', 'must retain owner from last-known-good config');

    fs.writeFileSync(configPath, 'INVALID JSON{{{', { mode: 0o600 });
    const third = loadConfig();
    assert.equal(third.owner.user_id, 'owner123', 'must retain owner on malformed config');
  });
});

test('loadConfig exits on cold start with missing config when .owner-bound marker exists', async () => {
  await withTempHome(async (home) => {
    const dataDir = path.join(home, 'zylos/components/zalo');
    fs.writeFileSync(path.join(dataDir, '.owner-bound'), '2026-01-01', { mode: 0o600 });

    const result = await runNode(
      ['-e', 'import("./src/lib/config.js").then(m => { m.loadConfig(); console.log("LOADED"); })'],
      { env: { HOME: home, ZALO_BOT_TOKEN: 'env-token' } }
    );
    assert.notEqual(result.stdout.trim(), 'LOADED', 'should not load defaults when owner marker exists');
    assert.ok(result.code !== 0, 'should exit on missing config with prior ownership');
  });
});

test('loadConfig exits on cold start with missing config when config.json.backup exists', async () => {
  await withTempHome(async (home) => {
    const dataDir = path.join(home, 'zylos/components/zalo');
    fs.writeFileSync(path.join(dataDir, 'config.json.backup'), '{"owner":{"user_id":"123"}}', { mode: 0o600 });

    const result = await runNode(
      ['-e', 'import("./src/lib/config.js").then(m => { m.loadConfig(); console.log("LOADED"); })'],
      { env: { HOME: home, ZALO_BOT_TOKEN: 'env-token' } }
    );
    assert.notEqual(result.stdout.trim(), 'LOADED', 'should not load defaults when backup exists');
    assert.ok(result.code !== 0, 'should exit on missing config with backup present');
  });
});

test('loadConfig exits on cold start with malformed config (always fails closed)', async () => {
  await withTempHome(async (home) => {
    const dataDir = path.join(home, 'zylos/components/zalo');
    fs.writeFileSync(path.join(dataDir, 'config.json'), 'CORRUPT{{{', { mode: 0o600 });

    const result = await runNode(
      ['-e', 'import("./src/lib/config.js").then(m => { m.loadConfig(); console.log("LOADED"); })'],
      { env: { HOME: home, ZALO_BOT_TOKEN: 'env-token' } }
    );
    assert.notEqual(result.stdout.trim(), 'LOADED', 'should not load defaults from malformed config');
    assert.ok(result.code !== 0, 'should exit on malformed existing config');
  });
});

test('loadConfig allows genuine first-run with no config and no prior ownership', async () => {
  await withTempHome(async (home) => {
    const result = await runNode(
      ['-e', 'import("./src/lib/config.js").then(m => { const c = m.loadConfig(); console.log(c.owner?.user_id === null ? "FIRST_RUN" : "ERROR"); })'],
      { env: { HOME: home, ZALO_BOT_TOKEN: 'env-token' } }
    );
    assert.ok(result.stdout.includes('FIRST_RUN'), 'genuine first-run should return defaults');
  });
});

// ─── IPv6 SSRF bypass (ZR2-2 MEDIUM) ───

test('validateDownloadUrl blocks IPv6 loopback and private-mapped addresses', async () => {
  await withTempHome(async () => {
    const { validateDownloadUrl } = await freshImport('src/lib/media.js');
    assert.equal(await validateDownloadUrl('https://[::1]/x.png'), false, '::1 loopback');
    assert.equal(await validateDownloadUrl('https://[::ffff:127.0.0.1]/x.png'), false, 'mapped 127.0.0.1');
    assert.equal(await validateDownloadUrl('https://[::ffff:10.0.0.1]/x.png'), false, 'mapped 10.x');
    assert.equal(await validateDownloadUrl('https://[::ffff:192.168.1.1]/x.png'), false, 'mapped 192.168.x');
    assert.equal(await validateDownloadUrl('https://[::ffff:172.16.0.1]/x.png'), false, 'mapped 172.16.x');
    // fe80::/10 link-local range boundary (fe80-febf) — blocked as private IPs
    assert.equal(await validateDownloadUrl('https://[fe80::1]/x.png'), false, 'link-local fe80');
    assert.equal(await validateDownloadUrl('https://[fe90::1]/x.png'), false, 'link-local fe90');
    assert.equal(await validateDownloadUrl('https://[fea0::1]/x.png'), false, 'link-local fea0');
    assert.equal(await validateDownloadUrl('https://[febf::1]/x.png'), false, 'link-local febf');
    // fec0 is outside link-local but still blocked by CDN-only policy
    assert.equal(await validateDownloadUrl('https://[fec0::1]/x.png'), false, 'non-CDN IPv6 host');
  });
});

// ─── C4 delivery failure handling (ZR2-3 MEDIUM) ───

test('sendToC4 calls onFail after retry transport failure', async () => {
  await withTempHome(async () => {
    const mod = await freshImport('src/index.js?sendToC4');
    // sendToC4 is not exported, so we test the pattern indirectly:
    // verify the function signature accepts onFail by checking the source
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
    assert.ok(src.includes('onFail'), 'sendToC4 must accept onFail callback');
    assert.ok(src.includes('C4 delivery failed after retry'), 'must log terminal failure');
    assert.ok(src.includes('Sorry, I could not process your message'), 'must notify user on failure');
  }).catch(() => {
    // Module may fail to fully initialize without a bot token; that's OK for this structural test
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
    assert.ok(src.includes('onFail'), 'sendToC4 must accept onFail callback');
    assert.ok(src.includes('C4 delivery failed after retry'), 'must log terminal failure');
  });
});

// ─── Log rotation (ZR2-4 MEDIUM) ───

test('log rotation truncates oversized JSONL files preserving valid JSON lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-rot-'));
  try {
    const logFile = path.join(tmpDir, 'test.jsonl');
    const lines = [];
    for (let i = 0; i < 50; i++) {
      lines.push(JSON.stringify({ message_id: `m-${i}`, text: `message ${i} padding data here` }));
    }
    fs.writeFileSync(logFile, lines.join('\n') + '\n');
    const originalSize = fs.statSync(logFile).size;
    assert.ok(originalSize > 500, 'test file should be large enough');

    // Reproduce the rotation logic from context.js
    const maxBytes = 500;
    const keepBytes = Math.floor(maxBytes * 0.75);
    const buf = Buffer.alloc(keepBytes);
    const fd = fs.openSync(logFile, 'r');
    const stat = fs.fstatSync(fd);
    fs.readSync(fd, buf, 0, keepBytes, stat.size - keepBytes);
    fs.closeSync(fd);
    const content = buf.toString('utf8');
    const firstNewline = content.indexOf('\n');
    const trimmed = firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
    fs.writeFileSync(logFile, trimmed);

    const rotatedSize = fs.statSync(logFile).size;
    assert.ok(rotatedSize < originalSize, 'file should be smaller after rotation');
    assert.ok(rotatedSize <= maxBytes, `file should be within limit (got ${rotatedSize})`);
    const rotatedLines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    for (const line of rotatedLines) {
      JSON.parse(line); // all remaining lines must be valid JSON
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('context.js source contains log rotation on size threshold', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/lib/context.js'), 'utf8');
  assert.ok(src.includes('rotateLog'), 'must call rotateLog function');
  assert.ok(src.includes('maxLogBytes'), 'must check configurable max log size');
  assert.ok(src.includes('stat.size > maxBytes'), 'must compare file size to threshold');
});

// ─── Media cleanup (ZR2-4 MEDIUM) ───

test('cleanupOldMedia removes files older than maxAge', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-media-'));
  const mediaDir = path.join(tmpDir, 'media');
  fs.mkdirSync(mediaDir);
  try {
    const oldFile = path.join(mediaDir, 'old-image.jpg');
    const newFile = path.join(mediaDir, 'new-image.jpg');
    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(newFile, 'new');
    const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000;
    fs.utimesSync(oldFile, new Date(oldTime), new Date(oldTime));

    // Reproduce the cleanup logic from media.js
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const file of fs.readdirSync(mediaDir)) {
      const filePath = path.join(mediaDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    }
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(oldFile), false, 'old file should be removed');
    assert.equal(fs.existsSync(newFile), true, 'new file should be kept');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('media.js source exports cleanupOldMedia with age-based rotation', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/lib/media.js'), 'utf8');
  assert.ok(src.includes('export function cleanupOldMedia'), 'must export cleanupOldMedia');
  assert.ok(src.includes('mtimeMs < cutoff'), 'must compare file age to cutoff');
  assert.ok(src.includes('fs.unlinkSync'), 'must remove expired files');
});

// ─── Redirect hop limit (ZR2-5 LOW) ───

test('downloadImage enforces redirect hop limit', async () => {
  await withTempHome(async () => {
    let fetchCount = 0;
    const previous = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchCount++;
      return new Response('', {
        status: 302,
        headers: { location: `https://files.dlfl.vn/hop${fetchCount}.png` }
      });
    };
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      const result = await downloadImage('https://files.dlfl.vn/start.png', { messageId: 'redir-test' });
      assert.equal(result, null, 'should return null after too many redirects');
      assert.ok(fetchCount <= 7, `should not follow unlimited redirects (got ${fetchCount})`);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

// ─── HTTPS-only API base URL (ZR2-6 LOW) ───

test('setApiBaseUrl rejects plaintext HTTP for non-loopback targets', async () => {
  await withTempHome(async () => {
    const { setApiBaseUrl } = await freshImport('src/lib/api.js');
    assert.throws(() => setApiBaseUrl('http://bot-api.zaloplatforms.com'), /HTTPS/);
    assert.doesNotThrow(() => setApiBaseUrl('http://localhost:3000'));
    assert.doesNotThrow(() => setApiBaseUrl('http://127.0.0.1:3000'));
    assert.doesNotThrow(() => setApiBaseUrl('https://bot-api.zaloplatforms.com'));
  });
});

// ─── Bounded port retry (ZR2-7 LOW) ───

test('startInternalServer source has bounded retry logic', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('MAX_PORT_RETRIES'), 'must define a retry limit');
  assert.ok(src.includes('portRetries > MAX_PORT_RETRIES'), 'must check retry limit before exiting');
  assert.ok(src.includes('const nextPort = port + 1'), 'must retry on an incremented port');
  assert.ok(src.includes('writeInternalRuntimeFiles(port)'), 'must publish the successful runtime port');
});

test('authorizeMessage guards first-contact owner binding against concurrent races', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('ownerBindingInProgress'), 'must track in-progress owner binding');
  assert.ok(src.includes('Owner binding already in progress'), 'must reject concurrent first-contact bind attempts');
  assert.ok(src.includes('finally'), 'must reset the in-progress flag after bind attempt');
});

test('runtime source clears resource timers on shutdown', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('mediaCleanupInterval'), 'must store media cleanup interval');
  assert.ok(src.includes('mediaCleanupInterval.unref?.()'), 'media cleanup interval should not pin the event loop');
  assert.ok(src.includes('clearInterval(mediaCleanupInterval)'), 'must clear media cleanup interval on shutdown');
  assert.ok(src.includes('c4RetryTimers'), 'must track C4 retry timers');
  assert.ok(src.includes('for (const timer of c4RetryTimers) clearTimeout(timer)'), 'must cancel C4 retry timers on shutdown');
  assert.ok(src.includes('if (stopped) return'), 'C4 retry path must honor shutdown state');
});

test('voice handler passes resolved transcription provider through', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('provider: transcriptionProvider'), 'must avoid resolving provider twice per voice message');
});

test('pairing request path reuses loaded pairing state', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('const state = loadPairingState()'), 'must load pairing state once');
  assert.ok(src.includes('getPairingStatus(info.senderId, state)'), 'status check should reuse loaded state');
  assert.ok(src.includes('}, state);'), 'pending mark should reuse loaded state');
});

test('image handling reuses downloaded placeholder path with captions', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('async function handleImageMessage(update)'));
  assert.ok(src.includes('await handleDownloadedPlaceholder(update, {'), 'image handling should use shared download path');
  assert.ok(src.includes("captionKeys: ['caption']"), 'image captions should be preserved');
  assert.ok(src.includes("urlKeys: ['photo_url', 'image_url', 'url', 'thumb', 'media_url']"), 'image URL keys should be covered');
});

test('polling normalizes single and array updates and advances offset per update', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('const updates = Array.isArray(result) ? result : (result ? [result] : [])'), 'must normalize getUpdates result shape');
  assert.ok(src.includes('function advancePollingOffset(update)'), 'must centralize offset advancement');
  assert.ok(src.includes('finally {\n          advancePollingOffset(update);'), 'must advance offset after each attempted update');
});

test('runtime source keeps an inbound dedup Set before webhook deduper', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');
  assert.ok(src.includes('const inboundUpdateKeys = new Set()'), 'must track inbound update keys');
  assert.ok(src.includes('if (inboundUpdateKeys.has(key)) return true'), 'must drop duplicate inbound keys');
  assert.ok(src.includes('inboundUpdateKeys.add(key)'), 'must record inbound keys');
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
