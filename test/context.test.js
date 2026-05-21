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

const config = {
  message: { context_messages: 2 },
  groups: {
    group1: { historyLimit: 3 }
  }
};

test('context records entries, deduplicates inbound message ids, and trims history', async () => {
  const { recordEntry, getHistory } = await freshImport('src/lib/context.js');
  recordEntry('chat1', { message_id: 'm1', text: 'one' }, config);
  recordEntry('chat1', { message_id: 'm1', text: 'duplicate' }, config);
  recordEntry('chat1', { message_id: 'bot:1', text: 'bot one' }, config);
  recordEntry('chat1', { message_id: 'm2', text: 'two' }, config);
  recordEntry('chat1', { message_id: 'm3', text: 'three' }, config);

  const history = getHistory('chat1', 'm3', config);
  assert.deepEqual(history.map((m) => m.text), ['bot one', 'two']);
});

test('context logAndRecord sanitizes log filenames and ensureReplay loads tail history once', async () => {
  let context = await freshImport('src/lib/context.js');
  context.logAndRecord('chat/with:chars', { message_id: 'm1', user_name: 'A', text: 'one' }, config);
  const { DATA_DIR } = await freshImport('src/lib/config.js');
  const logFile = path.join(DATA_DIR, 'logs/chat_with_chars.jsonl');
  assert.equal(fs.existsSync(logFile), true);

  context = await freshImport('src/lib/context.js');
  context.ensureReplay('chat/with:chars', config);
  context.ensureReplay('chat/with:chars', config);
  const history = context.getHistory('chat/with:chars', null, config);
  assert.equal(history.length, 1);
  assert.equal(history[0].text, 'one');
});

test('formatMessage escapes XML and attaches media paths', async () => {
  const { formatMessage } = await freshImport('src/lib/context.js');
  const message = formatMessage({
    chatType: 'group',
    groupName: 'R&D <Ops>',
    userName: 'Felix & Co',
    text: 'hello <world> & "friends"',
    contextMessages: [{ user_name: 'Alice <A>', text: 'prior & text' }],
    mediaPath: '/tmp/photo.png'
  });

  assert.match(message, /^\[Zalo GROUP:R&amp;D &lt;Ops&gt;\] Felix &amp; Co said:/);
  assert.match(message, /<group-context>\n\[Alice &lt;A&gt;\]: prior &amp; text\n<\/group-context>/);
  assert.match(message, /<current-message>\nhello &lt;world&gt; &amp; &quot;friends&quot;\n<\/current-message>/);
  assert.match(message, / ---- file: \/tmp\/photo.png$/);
});
