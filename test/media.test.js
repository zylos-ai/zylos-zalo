import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { freshImport, withTempHome } from './helpers.js';

function installFetch(responseFactory) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (...args) => responseFactory(...args);
  return () => {
    globalThis.fetch = previous;
  };
}

test('downloadImage saves inbound image with safe name and content-type extension', async () => {
  await withTempHome(async (home) => {
    const restore = installFetch(async () =>
      new Response(Buffer.from('image-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '11' }
      })
    );
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      const saved = await downloadImage('https://example.com/photo.bin', {
        messageId: 'msg/with:chars',
        maxBytes: 100
      });

      assert.equal(saved.contentType, 'image/png');
      assert.equal(saved.size, 11);
      assert.equal(saved.path, path.join(home, 'zylos/components/zalo/media/msg_with_chars.png'));
      assert.equal(fs.readFileSync(saved.path, 'utf8'), 'image-bytes');
    } finally {
      restore();
    }
  });
});

test('downloadImage falls back to URL extension and rejects failed responses', async () => {
  await withTempHome(async () => {
    let restore = installFetch(async () =>
      new Response(Buffer.from('gif-bytes'), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    );
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      const saved = await downloadImage('https://example.com/path/photo.gif', { messageId: 'm2', maxBytes: 100 });
      assert.equal(path.basename(saved.path), 'm2.gif');
    } finally {
      restore();
    }

    restore = installFetch(async () => new Response('missing', { status: 404 }));
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      await assert.rejects(() => downloadImage('https://example.com/missing.png'), /HTTP 404/);
    } finally {
      restore();
    }
  });
});

test('downloadImage enforces content-length and streamed byte limits', async () => {
  await withTempHome(async () => {
    let restore = installFetch(async () =>
      new Response(Buffer.from('too big'), { status: 200, headers: { 'content-length': '999' } })
    );
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      await assert.rejects(() => downloadImage('https://example.com/a.png', { maxBytes: 2 }), /exceeds 2 bytes/);
    } finally {
      restore();
    }

    restore = installFetch(async () => new Response(Buffer.from('too big'), { status: 200 }));
    try {
      const { downloadImage } = await freshImport('src/lib/media.js');
      await assert.rejects(() => downloadImage('https://example.com/a.png', { maxBytes: 2 }), /exceeds 2 bytes/);
    } finally {
      restore();
    }
  });
});

test('downloadImage returns null for blank URLs', async () => {
  await withTempHome(async () => {
    const { downloadImage } = await freshImport('src/lib/media.js');
    assert.equal(await downloadImage(''), null);
  });
});
