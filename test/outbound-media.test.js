import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cleanupDir, freshImport, makeTempHome } from './helpers.js';

test('cleanupPublicMedia removes only expired generated outbound files', async () => {
  const home = makeTempHome();
  const publicDir = path.join(home, 'zylos/http/public/media');
  fs.mkdirSync(publicDir, { recursive: true });
  const oldGenerated = path.join(publicDir, 'zalo-old.png');
  const freshGenerated = path.join(publicDir, 'zalo-fresh.png');
  const unrelated = path.join(publicDir, 'manual.png');
  fs.writeFileSync(oldGenerated, 'old');
  fs.writeFileSync(freshGenerated, 'fresh');
  fs.writeFileSync(unrelated, 'manual');
  const oldTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
  fs.utimesSync(oldGenerated, oldTime, oldTime);
  const oldHome = process.env.HOME;
  try {
    process.env.HOME = home;
    const { cleanupPublicMedia } = await freshImport('src/lib/outbound-media.js');
    const removed = cleanupPublicMedia({
      media: {
        publicDir,
        ttlHours: 1
      }
    });

    assert.equal(removed, 1);
    assert.equal(fs.existsSync(oldGenerated), false);
    assert.equal(fs.existsSync(freshGenerated), true);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    process.env.HOME = oldHome;
    cleanupDir(home);
  }
});
