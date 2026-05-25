#!/usr/bin/env node
/**
 * Configure hook for zylos-zalo
 *
 * Called by zylos after collecting SKILL.md config.required values.
 * Receives a JSON object on stdin and writes to config.json.
 *
 * Example stdin: { "ZALO_BOT_TOKEN": "123:secret" }
 */

import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/zalo');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const KEY_MAP = {
  'ZALO_BOT_TOKEN': 'botToken'
};

const DEFAULT_CONFIG = {
  enabled: true,
  delivery: 'polling'
};

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

try {
  const raw = (await readStdin()).trim();
  if (!raw) throw new Error('Expected stdin JSON object');

  const collected = JSON.parse(raw);
  if (!collected || typeof collected !== 'object') throw new Error('Input must be a JSON object');

  let config = DEFAULT_CONFIG;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch {}

  for (const [name, value] of Object.entries(collected)) {
    if (value === undefined || value === null || value === '') continue;
    const key = KEY_MAP[name] || name.replace(/^ZALO_/, '').toLowerCase();
    config[key] = value;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
  console.log(`[configure] Wrote config to ${CONFIG_PATH}`);
} catch (err) {
  console.error(`[configure] ${err.message}`);
  process.exit(1);
}
