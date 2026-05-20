/**
 * Configuration loader for zylos-zalo
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
export const DATA_DIR = path.join(HOME, 'zylos/components/zalo');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  enabled: true,
  botToken: null,
  owner: { user_id: null, name: null, bound_at: null },
  dmPolicy: 'owner',
  dmAllowFrom: [],
  groupPolicy: 'allowlist',
  groups: {},
  delivery: 'polling',
  webhookUrl: null,
  webhookSecret: null,
  webhookPath: '/zalo/webhook',
  message: {
    context_messages: 5,
    maxLength: 2000
  },
  internal_port: 3462
};

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

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return deepMerge(DEFAULT_CONFIG, parsed);
    }
    console.warn(`[zalo] Config file not found: ${CONFIG_PATH}`);
    return { ...DEFAULT_CONFIG };
  } catch (err) {
    console.error(`[zalo] Failed to load config: ${err.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  const tmp = CONFIG_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_PATH);
    return true;
  } catch (err) {
    console.error(`[zalo] Failed to save config: ${err.message}`);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}
