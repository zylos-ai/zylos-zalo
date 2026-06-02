import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { freshImport, runNode, withTempHome } from './helpers.js';

test('sendDmWelcomeIfFirstSeen marks before sending and persists seen users', async () => {
  await withTempHome(async () => {
    const { sendDmWelcomeIfFirstSeen } = await freshImport('src/lib/dm-welcome.js');
    const seenUsers = new Set();
    const saves = [];
    const sends = [];

    const sent = await sendDmWelcomeIfFirstSeen({
      send: async (chatId, message) => sends.push([chatId, message]),
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Welcome',
      seenUsers,
      save: users => saves.push([...users]),
    });

    assert.equal(sent, true);
    assert.deepEqual(saves, [['user-1']]);
    assert.deepEqual(sends, [['chat-1', 'Welcome']]);
    assert.equal(await sendDmWelcomeIfFirstSeen({
      send: async () => sends.push(['duplicate']),
      userId: 'user-1',
      chatId: 'chat-1',
      message: 'Welcome',
      seenUsers,
      save: users => saves.push([...users]),
    }), false);
    assert.equal(sends.length, 1);
  });
});

test('seen DM users load and save uses restricted JSON file', async () => {
  await withTempHome(async (home) => {
    const { loadSeenDmUsers, saveSeenDmUsers } = await freshImport('src/lib/dm-welcome.js');
    const filePath = path.join(home, 'zylos/components/zalo/seen-dm-users.json');

    saveSeenDmUsers(new Set(['b', 'a']), filePath);
    assert.deepEqual([...loadSeenDmUsers(filePath)].sort(), ['a', 'b']);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  });
});

test('admin CLI sets and shows DM welcome message', async () => {
  await withTempHome(async (home) => {
    fs.writeFileSync(path.join(home, 'zylos/components/zalo/config.json'), JSON.stringify({ botToken: 'token' }));

    let result = await runNode(['scripts/admin.js', 'set-dm-welcome', 'Hello', 'there'], { env: { HOME: home } });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /DM welcome message updated/);

    const saved = JSON.parse(fs.readFileSync(path.join(home, 'zylos/components/zalo/config.json'), 'utf8'));
    assert.equal(saved.dmWelcomeMessage, 'Hello there');

    result = await runNode(['scripts/admin.js', 'show-dm-welcome'], { env: { HOME: home } });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Hello there/);
  });
});

test('admin CLI clears DM welcome message', async () => {
  await withTempHome(async (home) => {
    const configPath = path.join(home, 'zylos/components/zalo/config.json');
    fs.writeFileSync(configPath, JSON.stringify({ botToken: 'token', dmWelcomeMessage: 'Welcome' }));

    const result = await runNode(['scripts/admin.js', 'clear-dm-welcome'], { env: { HOME: home } });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /DM welcome message disabled/);

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.dmWelcomeMessage, '');
  });
});
