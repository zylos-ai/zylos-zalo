#!/usr/bin/env node
/**
 * Post-install hook for zylos-zalo
 */

import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/zalo');
const ENV_PATH = path.join(HOME, 'zylos/.env');

function hasEnvToken() {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    return /^ZALO_BOT_TOKEN=/m.test(content);
  } catch {
    return false;
  }
}

console.log('[post-install] Running zalo-specific setup...\n');

// Create subdirectories
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'typing'), { recursive: true });
console.log('  - logs/\n  - media/\n  - typing/');

// Create default config if not exists
const configPath = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(configPath)) {
  console.log('\nCreating default config.json...');
  fs.writeFileSync(configPath, JSON.stringify({ enabled: true, delivery: 'polling' }, null, 2));
  console.log('  - config.json created');
} else {
  console.log('\nConfig already exists, skipping.');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!cfg.botToken && !hasEnvToken()) {
    console.log('[!] botToken not found in config.json or ZALO_BOT_TOKEN in ~/zylos/.env — set one before starting the service');
  }
}

console.log('\n[post-install] Complete!');
