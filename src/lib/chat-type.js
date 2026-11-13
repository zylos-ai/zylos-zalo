/**
 * Real chat type of a Zalo chat id. Never taken from the `type` segment of an
 * endpoint: that string is written or copied by the agent.
 *
 * - Zalo group ids start with `zgr-` -> group.
 * - Ids configured in `config.groups`, or whose accepted inbound record says
 *   `chat_type: 'group'` -> group.
 * - Plain alphanumeric ids -> dm.
 * - Anything else -> unknown (callers apply the strictest rule).
 */
export const GROUP_ID_PREFIX = 'zgr-';

export function isGroupId(chatId) {
  return String(chatId ?? '').startsWith(GROUP_ID_PREFIX);
}

/**
 * @param {object} config
 * @param {string} chatId
 * @param {object|null} [record] accepted inbound log entry for this chat
 * @returns {'group'|'dm'|'unknown'}
 */
export function resolveChatType(config, chatId, record = null) {
  const id = String(chatId ?? '');
  if (!id) return 'unknown';
  if (isGroupId(id)) return 'group';
  if (config?.groups?.[id]) return 'group';
  if (record && record.chat_type === 'group') return 'group';
  if (/^[A-Za-z0-9]+$/.test(id)) return 'dm';
  return 'unknown';
}
