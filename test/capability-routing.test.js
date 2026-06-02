import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const src = () => fs.readFileSync(path.join(import.meta.dirname, '..', 'src/index.js'), 'utf8');

test('index routes supported Zalo capability audit event types', () => {
  const code = src();
  for (const eventName of [
    'message.file.received',
    'message.audio.received',
    'message.video.received',
    'message.gif.received',
    'message.link.received',
    'message.location.received',
  ]) {
    assert.ok(code.includes(eventName), `missing ${eventName}`);
  }
});

test('DM welcome runs after access control passes', () => {
  const code = src();
  const allowIndex = code.indexOf('if (!isDmAllowed(config, info.senderId))');
  const welcomeIndex = code.lastIndexOf('sendDmWelcomeIfFirstSeen');
  assert.ok(allowIndex >= 0, 'missing DM access check');
  assert.ok(welcomeIndex > allowIndex, 'welcome should be after DM access check');
});

test('voice handler forwards transcript and transcription failure placeholders', () => {
  const code = src();
  assert.ok(code.includes('[Voice] ${transcript}'), 'missing voice transcript forwarding');
  assert.ok(code.includes('[sent a voice message, transcription failed]'), 'missing voice failure placeholder');
});
