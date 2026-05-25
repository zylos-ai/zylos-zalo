/**
 * Configuration loader for zylos-zalo
 */

import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
export const DATA_DIR = path.join(HOME, 'zylos/components/zalo');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const ENV_PATH = path.join(HOME, 'zylos/.env');

export const DEFAULT_CONFIG = {
  enabled: true,
  botToken: null,
  owner: { user_id: null, name: null, bound_at: null },
  dmPolicy: 'owner',
  dmAllowFrom: [],
  groupPolicy: 'allowlist',
  groups: {},
  apiBaseUrl: null,
  delivery: 'polling',
  webhookUrl: null,
  webhookSecret: null,
  webhookPath: '/zalo/webhook',
  webhook: {
    dedupWindowMs: 5 * 60 * 1000,
    dedupMaxEntries: 1000,
    rateLimitWindowMs: 60 * 1000,
    rateLimitMax: 120
  },
  message: {
    context_messages: 5,
    maxLength: 2000,
    mediaMaxMb: 10
  },
  logging: {
    maxLogBytes: 512 * 1024
  },
  retention: {
    mediaMaxAgeDays: 7
  },
  internal_port: 3462,
  webhookPort: 3464
};

function loadDotEnv() {
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[zalo] Failed to load ${ENV_PATH}: ${err.message}`);
  }
}

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const [key, val] of Object.entries(overrides)) {
    if (val && typeof val === 'object' && !Array.isArray(val) && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      result[key] = deepMerge(defaults[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

let lastGoodConfig = null;

const OWNER_MARKER_PATH = path.join(DATA_DIR, '.owner-bound');

function hasPriorOwnership() {
  if (fs.existsSync(OWNER_MARKER_PATH)) return true;
  if (fs.existsSync(CONFIG_PATH + '.backup')) return true;
  if (fs.existsSync(CONFIG_PATH + '.bak')) return true;
  const logsDir = path.join(DATA_DIR, 'logs');
  try {
    if (fs.existsSync(logsDir) && fs.readdirSync(logsDir).length > 0) return true;
  } catch {}
  return false;
}

export function writeOwnerMarker() {
  try {
    fs.writeFileSync(OWNER_MARKER_PATH, new Date().toISOString(), { mode: 0o600 });
  } catch {}
}

export function loadConfig() {
  loadDotEnv();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const config = deepMerge(DEFAULT_CONFIG, parsed);
      if (!config.botToken && process.env.ZALO_BOT_TOKEN) {
        config.botToken = process.env.ZALO_BOT_TOKEN;
      }
      if (config.owner?.user_id && !fs.existsSync(OWNER_MARKER_PATH)) {
        writeOwnerMarker();
      }
      lastGoodConfig = config;
      return config;
    }
    if (lastGoodConfig) {
      console.warn(`[zalo] Config file not found, retaining last-known-good config`);
      return lastGoodConfig;
    }
    if (hasPriorOwnership()) {
      console.error(`[zalo] Config file missing but prior ownership detected — refusing to start with defaults. Restore config.json or its backup.`);
      process.exit(1);
    }
    console.warn(`[zalo] Config file not found: ${CONFIG_PATH}`);
    return { ...DEFAULT_CONFIG, botToken: process.env.ZALO_BOT_TOKEN || null };
  } catch (err) {
    if (lastGoodConfig) {
      console.error(`[zalo] Config reload failed, retaining last-known-good config: ${err.message}`);
      return lastGoodConfig;
    }
    if (fs.existsSync(CONFIG_PATH)) {
      console.error(`[zalo] Config file exists but is unreadable/malformed — refusing to start. Fix config.json: ${err.message}`);
      process.exit(1);
    }
    if (hasPriorOwnership()) {
      console.error(`[zalo] Config missing and prior ownership detected — refusing to start. Restore config.json: ${err.message}`);
      process.exit(1);
    }
    console.error(`[zalo] Failed to load config: ${err.message}`);
    return { ...DEFAULT_CONFIG, botToken: process.env.ZALO_BOT_TOKEN || null };
  }
}

export function saveConfig(config) {
  const tmp = CONFIG_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, CONFIG_PATH);
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
    return true;
  } catch (err) {
    console.error(`[zalo] Failed to save config: ${err.message}`);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

export function repairConfigPermissions() {
  try {
    if (fs.existsSync(CONFIG_PATH)) fs.chmodSync(CONFIG_PATH, 0o600);
    if (fs.existsSync(DATA_DIR)) fs.chmodSync(DATA_DIR, 0o700);
  } catch (err) {
    console.warn(`[zalo] Failed to repair permissions: ${err.message}`);
  }
}
