import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, makeTempHome, repoRoot, runNode } from './helpers.js';

const DATA_SUBDIR = 'zylos/components/zalo';

function writeConfig(home, config) {
  fs.writeFileSync(path.join(home, DATA_SUBDIR, 'config.json'), JSON.stringify(config));
}

function writeRuntimeFiles(home, { token = 'test-internal-token', port = 9 } = {}) {
  const dir = path.join(home, DATA_SUBDIR);
  fs.writeFileSync(path.join(dir, '.internal-token'), token, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.internal-endpoint.json'), JSON.stringify({ port }), { mode: 0o600 });
}

test('send script validates CLI arguments and token presence', async () => {
  let result = await runNode(['scripts/send.js']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage: send\.js/);

  const home = makeTempHome();
  try {
    writeConfig(home, { enabled: true });
    result = await runNode(['scripts/send.js', 'chat-1', 'hello'], { env: { HOME: home } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /botToken not set/);
  } finally {
    cleanupDir(home);
  }
});

test('send script sends text chunks and records outgoing messages', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1|req:req-1',
      '**hello** [world](https://example.com)'
    ], {
      env: { HOME: home, ZALO_FETCH_LOG: fetchLog }
    });

    assert.equal(result.code, 0, result.stderr);
    const calls = fs.readFileSync(fetchLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls[0].url, 'https://bot-api.zaloplatforms.com/bottoken-1/sendMessage');
    assert.deepEqual(calls[0].body, { chat_id: 'chat-1', text: 'hello world (https://example.com)' });
    assert.equal(fs.existsSync(path.join(home, 'zylos/components/zalo/typing/req-1.done')), true);
  } finally {
    cleanupDir(home);
  }
});

test('send script reads message content from stdin before CLI args', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1',
      'cli fallback'
    ], {
      env: { HOME: home, ZALO_FETCH_LOG: fetchLog },
      input: 'stdin **wins**\n'
    });

    assert.equal(result.code, 0, result.stderr);
    const calls = fs.readFileSync(fetchLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(calls[0].body, { chat_id: 'chat-1', text: 'stdin wins' });
  } finally {
    cleanupDir(home);
  }
});

test('send script accepts stdin-only message content', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1'
    ], {
      env: { HOME: home, ZALO_FETCH_LOG: fetchLog },
      input: 'hello from stdin\n'
    });

    assert.equal(result.code, 0, result.stderr);
    const calls = fs.readFileSync(fetchLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(calls[0].body, { chat_id: 'chat-1', text: 'hello from stdin' });
  } finally {
    cleanupDir(home);
  }
});

test('send script uses configured API base and sends stickers', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', apiBaseUrl: 'https://bot-api.zapps.me', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1',
      '[MEDIA:sticker]sticker-1'
    ], {
      env: { HOME: home, ZALO_FETCH_LOG: fetchLog }
    });
    assert.equal(result.code, 0, result.stderr);
    const calls = fs.readFileSync(fetchLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls[0].url, 'https://bot-api.zapps.me/bottoken-1/sendSticker');
    assert.deepEqual(calls[0].body, { chat_id: 'chat-1', sticker: 'sticker-1' });
  } finally {
    cleanupDir(home);
  }
});

test('send script sends public image URLs and rejects local image paths', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    let result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1',
      '[MEDIA:image]https://example.com/photo.jpg'
    ], {
      env: { HOME: home, ZALO_FETCH_LOG: fetchLog }
    });
    assert.equal(result.code, 0, result.stderr);
    const calls = fs.readFileSync(fetchLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls[0].url, 'https://bot-api.zaloplatforms.com/bottoken-1/sendPhoto');
    assert.deepEqual(calls[0].body, { chat_id: 'chat-1', photo: 'https://example.com/photo.jpg' });

    result = await runNode(['scripts/send.js', 'chat-1', '[MEDIA:image]/tmp/photo.jpg'], { env: { HOME: home } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /requires a public HTTP\(S\) image URL/);
  } finally {
    cleanupDir(home);
  }
});

test('send script fails with clear error when runtime files are missing', async () => {
  const home = makeTempHome();
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  try {
    const result = await runNode(['scripts/send.js', 'chat-1', 'hello'], { env: { HOME: home } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /service not running or internal token unavailable/);
  } finally {
    cleanupDir(home);
  }
});

test('send script uses effective port from runtime endpoint file', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', internal_port: 3462 });
  writeRuntimeFiles(home, { port: 3463 });
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1|req:req-1',
      'test message'
    ], {
      env: { HOME: home, ZALO_FETCH_LOG: fetchLog }
    });

    assert.equal(result.code, 0, result.stderr);
    const calls = fs.readFileSync(fetchLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const recordCall = calls.find(c => c.url.includes('3463'));
    assert.ok(recordCall, 'record-outgoing should use port 3463 from runtime file, not 3462 from config');
  } finally {
    cleanupDir(home);
  }
});

function parseReceipt(stdout) {
  const line = stdout.split('\n').find(l => l.startsWith('RECEIPT '));
  return line ? JSON.parse(line.slice('RECEIPT '.length)) : null;
}

test('send script emits a structured receipt with message ids on text send', async () => {
  const home = makeTempHome();
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1|req:req-1',
      'hello world'
    ], { env: { HOME: home } });

    assert.equal(result.code, 0, result.stderr);
    const receipt = parseReceipt(result.stdout);
    assert.ok(receipt, 'expected a RECEIPT line in stdout');
    assert.equal(receipt.status, 'sent');
    assert.equal(receipt.type, 'text');
    assert.equal(receipt.chatId, 'chat-1');
    assert.equal(receipt.correlationId, 'req-1');
    assert.equal(receipt.chunks, 1);
    assert.deepEqual(receipt.messageIds, ['mock-message-id']);
    assert.equal(typeof receipt.ts, 'number');
  } finally {
    cleanupDir(home);
  }
});

test('send script emits a failed receipt and exits non-zero on send error', async () => {
  const home = makeTempHome();
  // Local image path is rejected before any API call → triggers the failure path.
  writeConfig(home, { botToken: 'token-1', internal_port: 9 });
  writeRuntimeFiles(home);
  try {
    const result = await runNode([
      '--import',
      path.join(repoRoot, 'test/fixtures/mock-fetch.js'),
      'scripts/send.js',
      'chat-1|req:req-9',
      '[MEDIA:image]/tmp/local.jpg'
    ], { env: { HOME: home } });

    assert.equal(result.code, 1);
    const receipt = parseReceipt(result.stdout);
    assert.ok(receipt, 'expected a RECEIPT line even on failure');
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.correlationId, 'req-9');
    assert.match(receipt.error, /public HTTP\(S\) image URL/);
  } finally {
    cleanupDir(home);
  }
});
