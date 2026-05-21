import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, makeTempHome, repoRoot, runNode } from './helpers.js';

function writeConfig(home, config) {
  fs.writeFileSync(path.join(home, 'zylos/components/zalo/config.json'), JSON.stringify(config));
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

test('send script uses configured API base and sends stickers', async () => {
  const home = makeTempHome();
  const fetchLog = path.join(home, 'fetch.log');
  writeConfig(home, { botToken: 'token-1', apiBaseUrl: 'https://bot-api.zapps.me', internal_port: 9 });
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
