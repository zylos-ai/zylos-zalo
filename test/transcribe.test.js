import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { freshImport, withTempHome } from './helpers.js';

test('transcription provider returns disabled when configured disabled', async () => {
  await withTempHome(async () => {
    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    assert.deepEqual(getTranscriptionProvider('disabled'), { available: false, provider: 'disabled' });
  });
});

test('transcription provider uses OpenAI API fallback when configured', async () => {
  await withTempHome(async () => {
    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    const provider = getTranscriptionProvider('api', { OPENAI_API_KEY: 'sk-test' });
    assert.deepEqual(provider, { available: true, provider: 'openai-api' });
  });
});

test('transcription provider is unavailable for api mode without key', async () => {
  await withTempHome(async () => {
    const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
    assert.equal(getTranscriptionProvider('api', {}).available, false);
  });
});

test('transcription provider warns when whisper binary exists without model path', async () => {
  await withTempHome(async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-whisper-bin-'));
    const oldPath = process.env.PATH;
    const oldWarn = console.warn;
    const warnings = [];
    try {
      const whisperPath = path.join(binDir, 'whisper-cli');
      fs.writeFileSync(whisperPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      process.env.PATH = `${binDir}${path.delimiter}${oldPath || ''}`;
      console.warn = (message) => warnings.push(String(message));

      const { getTranscriptionProvider } = await freshImport('src/lib/transcribe.js');
      const provider = getTranscriptionProvider('local', {}, { modelPath: '' });

      assert.equal(provider.available, false);
      assert.ok(warnings.some(message => message.includes('whisper-cli found but WHISPER_MODEL not set')));
    } finally {
      console.warn = oldWarn;
      process.env.PATH = oldPath;
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });
});
