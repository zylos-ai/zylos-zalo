import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const SEEN_DM_USERS_FILE = path.join(DATA_DIR, 'seen-dm-users.json');

export function loadSeenDmUsers(filePath = SEEN_DM_USERS_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
    if (Array.isArray(parsed.users)) return new Set(parsed.users.map(String));
  } catch {}
  return new Set();
}

export function saveSeenDmUsers(users, filePath = SEEN_DM_USERS_FILE) {
  const tmp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, JSON.stringify({ users: Array.from(users).sort() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

export async function sendDmWelcomeIfFirstSeen({ send, userId, chatId, message, seenUsers, save = saveSeenDmUsers }) {
  const normalizedUserId = String(userId || '').trim();
  const welcome = String(message || '').trim();
  if (!normalizedUserId || !chatId || !welcome || seenUsers.has(normalizedUserId)) return false;
  // Mark before sending so concurrent deliveries for the same user do not all welcome.
  seenUsers.add(normalizedUserId);
  save(seenUsers);
  await send(chatId, welcome).catch(() => {});
  return true;
}
