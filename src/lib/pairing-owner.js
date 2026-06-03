import {
  approvePairingUser,
  denyPairingUser,
  listPending
} from './dm-pairing.js';
import { isOwner } from './auth.js';

const FIRST_MESSAGE_LIMIT = 200;

function cleanText(value) {
  return String(value || '').trim();
}

function pendingDisplayName(entry) {
  return entry?.name || entry?.user_name || 'unknown';
}

function pendingUserId(entry) {
  return String(entry?.user_id || entry?.userId || '').trim();
}

export function truncateFirstMessage(value, limit = FIRST_MESSAGE_LIMIT) {
  const text = cleanText(value).replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

export function buildOwnerPairingDm({ userId, userName, firstMessage }) {
  return [
    `Pairing request: ${userName || 'unknown'} (${userId}) wants to chat.`,
    `First message: "${truncateFirstMessage(firstMessage)}"`,
    'Reply "approve" to allow or "deny" to reject.'
  ].join('\n');
}

export async function sendOwnerPairingDm({ config, userId, userName, firstMessage, send }) {
  const ownerId = config?.owner?.user_id;
  if (!ownerId) return false;
  await send(ownerId, buildOwnerPairingDm({ userId, userName, firstMessage }));
  return true;
}

export function parseOwnerPairingCommand(text, pendingEntries = []) {
  if (!pendingEntries.length) return null;
  const match = cleanText(text).match(/^(approve|deny)(?:\s+(\S+))?$/i);
  if (!match) return null;
  return {
    action: match[1].toLowerCase(),
    userId: match[2] ? String(match[2]).trim() : ''
  };
}

export function resolveOwnerPairingCommand(text, state) {
  const pending = listPending(state);
  const command = parseOwnerPairingCommand(text, pending);
  if (!command) return null;

  if (!command.userId && pending.length !== 1) {
    return {
      action: command.action,
      needsUserId: true,
      message: [
        'Multiple pending requests. Please specify a user id:',
        ...pending.map(entry => `- ${pendingDisplayName(entry)} (${pendingUserId(entry)})`)
      ].join('\n')
    };
  }

  const userId = command.userId || pendingUserId(pending[0]);
  const request = pending.find(entry => pendingUserId(entry) === String(userId));
  if (!request) {
    return {
      action: command.action,
      userId,
      missing: true,
      message: `No pending request for ${userId}.`
    };
  }

  return { ...command, userId, request };
}

export function resolveOwnerPairingCommandForSender(config, senderId, text, state) {
  if (!isOwner(config, senderId)) return null;
  return resolveOwnerPairingCommand(text, state);
}

export function applyOwnerPairingCommand(config, state, resolved) {
  if (!resolved?.request || resolved.needsUserId || resolved.missing) return false;

  if (resolved.action === 'approve') {
    return approvePairingUser(config, resolved.userId, state);
  }

  if (resolved.action === 'deny') {
    return denyPairingUser(config, resolved.userId, '', state);
  }

  return false;
}

export function ownerPairingReplyFor(resolved) {
  if (resolved?.needsUserId || resolved?.missing) return resolved.message;
  const name = pendingDisplayName(resolved?.request);
  if (resolved?.action === 'approve') return `Approved ${name}`;
  if (resolved?.action === 'deny') return `Denied ${name}`;
  return '';
}
