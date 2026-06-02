/**
 * Operator diagnostics for zylos-zalo.
 *
 * Turns the startup token validation into an actionable, on-demand health
 * report: credentials, API reachability, webhook/delivery sanity, owner
 * binding, and file permissions. Probes are injectable for testing.
 */

import fs from 'node:fs';
import { DATA_DIR, CONFIG_PATH } from './config.js';
import { getMe, getWebhookInfo, getApiBaseUrl } from './api.js';

function check(name, ok, detail = '') {
  return { name, ok: Boolean(ok), detail };
}

function formatStatus(ok) {
  return ok ? 'ok' : 'warn';
}

export function formatDoctorReport(results) {
  return results
    .map(result => `[${formatStatus(result.ok)}] ${result.name}${result.detail ? ` - ${result.detail}` : ''}`)
    .join('\n');
}

export async function runDoctor(config, {
  getMeImpl = getMe,
  webhookInfoImpl = getWebhookInfo,
  statImpl = fs.statSync,
  existsImpl = fs.existsSync,
} = {}) {
  const results = [];
  const token = config.botToken;

  results.push(check('component enabled', config.enabled !== false,
    config.enabled === false ? 'config.enabled is false' : 'enabled'));
  results.push(check('bot token', !!token,
    token ? 'configured' : 'missing — set botToken in config.json or ZALO_BOT_TOKEN in .env'));
  results.push(check('api base url', true, getApiBaseUrl()));

  // Token validity via getMe — the core operator probe.
  if (token) {
    try {
      const me = await getMeImpl(token);
      const id = me?.id ?? me?.account_id ?? 'unknown';
      const name = me?.display_name ?? me?.name ?? '';
      results.push(check('getMe (token valid)', true, `bot ${name ? `${name} ` : ''}(${id})`));
    } catch (err) {
      results.push(check('getMe (token valid)', false,
        `${err.message || 'getMe failed'} — token may be invalid or the API unreachable`));
    }
  } else {
    results.push(check('getMe (token valid)', false, 'skipped — no token'));
  }

  // Delivery / webhook sanity.
  const delivery = config.delivery || 'polling';
  if (delivery === 'webhook') {
    if (token) {
      try {
        const info = await webhookInfoImpl(token);
        const registered = info?.url || '';
        const expected = config.webhookUrl || '';
        const match = expected ? registered === expected : !!registered;
        const detail = registered
          ? `registered: ${registered}${expected && registered !== expected ? ` (config expects ${expected})` : ''}`
          : 'no webhook registered — run setWebhook or switch to polling';
        results.push(check('webhook registration', match, detail));
      } catch (err) {
        results.push(check('webhook registration', false, err.message));
      }
    } else {
      results.push(check('webhook registration', false, 'skipped — no token'));
    }
  } else {
    results.push(check('delivery mode', true, 'polling'));
  }

  // Owner binding.
  const owner = config.owner || {};
  results.push(check('owner bound', !!owner.user_id,
    owner.user_id ? `${owner.name || 'unknown'} (${owner.user_id})` : 'not bound yet (binds on first owner DM)'));

  // File permissions — config holds the bot token, must stay private.
  try {
    if (existsImpl(CONFIG_PATH)) {
      const mode = statImpl(CONFIG_PATH).mode & 0o777;
      results.push(check('config permissions', mode === 0o600,
        `0${mode.toString(8)}${mode === 0o600 ? '' : ' (expected 0600)'}`));
    } else {
      results.push(check('config permissions', false, 'config.json not found'));
    }
  } catch (err) {
    results.push(check('config permissions', false, err.message));
  }
  try {
    if (existsImpl(DATA_DIR)) {
      const mode = statImpl(DATA_DIR).mode & 0o777;
      results.push(check('data dir permissions', mode === 0o700,
        `0${mode.toString(8)}${mode === 0o700 ? '' : ' (expected 0700)'}`));
    }
  } catch (err) {
    results.push(check('data dir permissions', false, err.message));
  }

  return results;
}
