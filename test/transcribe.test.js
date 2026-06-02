import assert from 'node:assert/strict';
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
