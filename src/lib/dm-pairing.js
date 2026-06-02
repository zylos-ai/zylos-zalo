/**
 * DM pairing state for zylos-zalo.
 *
 * Backs `dmPolicy: "pairing"` — an unknown DM sender is recorded as pending and
 * the owner (via C4) is notified to approve or deny. Approval adds the user to
 * dmAllowFrom; denial records them so they aren't re-prompted. State persists in
 * dm-pairing.json (0600), mirroring the Teams pairing model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const PAIRING_STATE_FILE = path.join(DATA_DIR, 'dm-pairing.json');

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

export function loadPairingState(filePath = PAIRING_STATE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      pending: parsed.pending && typeof parsed.pending === 'object' ? parsed.pending : {},
      denied: parsed.denied && typeof parsed.denied === 'object' ? parsed.denied : {},
    };
  } catch {}
  return { pending: {}, denied: {} };
}

export function savePairingState(state, filePath = PAIRING_STATE_FILE) {
  const payload = { pending: state.pending || {}, denied: state.denied || {} };
  const tmp = filePath + '.tmp';
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
    return true;
  } catch (err) {
    console.error(`[zalo] Failed to save pairing state: ${err.message}`);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

export function getPairingStatus(userId, state = loadPairingState()) {
  const id = normalizeUserId(userId);
  if (!id) return 'unknown';
  if (state.denied?.[id]) return 'denied';
  if (state.pending?.[id]) return 'pending';
  return 'unknown';
}

export function listPending(state = loadPairingState()) {
  return Object.values(state.pending || {});
}

export function markPairingPending({ userId, userName, chatId, firstMessage }, state = loadPairingState()) {
  const id = normalizeUserId(userId);
  if (!id) return state;
  if (!state.pending) state.pending = {};
  if (!state.denied) state.denied = {};
  if (!state.pending[id] && !state.denied[id]) {
    state.pending[id] = {
      user_id: id,
      name: userName || 'unknown',
      chat_id: chatId || '',
      first_message: String(firstMessage || '').substring(0, 500),
      requested_at: new Date().toISOString(),
    };
  }
  return state;
}

export function approvePairingUser(config, userId, state = loadPairingState()) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  if (!Array.isArray(config.dmAllowFrom)) config.dmAllowFrom = [];
  if (!config.dmAllowFrom.includes(id)) config.dmAllowFrom.push(id);
  delete state.pending?.[id];
  delete state.denied?.[id];
  return true;
}

export function denyPairingUser(config, userId, reason = '', state = loadPairingState()) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  if (!state.denied) state.denied = {};
  state.denied[id] = {
    user_id: id,
    denied_at: new Date().toISOString(),
    reason: String(reason || '').trim(),
  };
  delete state.pending?.[id];
  if (Array.isArray(config.dmAllowFrom)) {
    config.dmAllowFrom = config.dmAllowFrom.filter(entry => String(entry) !== id);
  }
  return true;
}

export function buildPairingNotification({ userId, userName, chatId, firstMessage }) {
  return [
    '[Zalo DM Pairing Request]',
    `${userName || 'unknown'} (${userId}) requested DM access.`,
    `Chat: ${chatId || 'unknown'}`,
    firstMessage ? `First message: ${String(firstMessage).substring(0, 500)}` : '',
    '',
    `Approve via admin CLI: dm-approve ${userId}`,
    `Deny via admin CLI:    dm-deny ${userId}`,
  ].filter(line => line !== '').join('\n');
}
