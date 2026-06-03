import {
  hasOwner,
  isDmAllowed,
  isGroupAllowed,
  isGroupSenderAllowed
} from './auth.js';

export const UNSUPPORTED_MESSAGE_FALLBACK =
  "Sorry, I can't read voice messages on this channel yet.";
export const UNSUPPORTED_MESSAGE_COOLDOWN_MS = 60 * 1000;

export function isInboundUnsupportedUserMessage(update) {
  const message = update?.message;
  return message?.from?.is_bot === false && Boolean(message?.chat?.id);
}

export function canReplyToUnsupportedMessage(config, info) {
  if (!info?.chatId || !info?.senderId) return false;
  if (!hasOwner(config)) return false;

  if (info.isGroup) {
    if (!isGroupAllowed(config, info.chatId)) return false;
    return isGroupSenderAllowed(config, info.chatId, info.senderId);
  }

  return isDmAllowed(config, info.senderId);
}

export function consumeUnsupportedMessageCooldown(cooldowns, chatId, {
  now = Date.now(),
  cooldownMs = UNSUPPORTED_MESSAGE_COOLDOWN_MS
} = {}) {
  const key = String(chatId || '');
  if (!key) return false;

  const hasPrevious = cooldowns.has(key);
  const previous = cooldowns.get(key) || 0;
  if (hasPrevious && now - previous < cooldownMs) return false;

  cooldowns.set(key, now);
  for (const [storedKey, timestamp] of cooldowns.entries()) {
    if (now - timestamp >= cooldownMs) cooldowns.delete(storedKey);
  }
  return true;
}

export async function maybeSendUnsupportedMessageFallback({
  update,
  info,
  config,
  cooldowns,
  send,
  now = Date.now(),
  cooldownMs = UNSUPPORTED_MESSAGE_COOLDOWN_MS
}) {
  if (!isInboundUnsupportedUserMessage(update)) return false;
  if (!canReplyToUnsupportedMessage(config, info)) return false;
  if (!consumeUnsupportedMessageCooldown(cooldowns, info.chatId, { now, cooldownMs })) return false;

  await send(info.chatId, UNSUPPORTED_MESSAGE_FALLBACK);
  return true;
}
