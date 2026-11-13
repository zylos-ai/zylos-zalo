/**
 * Real chat type of a Zalo chat id. Never taken from the `type` segment of an
 * endpoint: that string is written or copied by the agent.
 *
 * - Zalo group ids start with `zgr-` -> group.
 * - Ids configured in `config.groups`, or with any accepted inbound record
 *   saying `chat_type: 'group'` (the record for `msg`, or any record in that
 *   chat's log) -> group.
 * - Plain alphanumeric ids -> dm.
 * - Anything else -> unknown (callers apply the strictest rule).
 */
export const GROUP_ID_PREFIX = 'zgr-';

export const UNSUPPORTED_DM_ID_REPLY = 'Sorry, I cannot reply to this chat. Please contact my admin.';

export function isGroupId(chatId) {
  return String(chatId ?? '').startsWith(GROUP_ID_PREFIX);
}

/**
 * @param {object} config
 * @param {string} chatId
 * @param {object|null} [record] accepted inbound log entry for this chat
 * @param {boolean} [loggedGroup] the chat's log has a `chat_type: 'group'` record
 * @returns {'group'|'dm'|'unknown'}
 */
export function resolveChatType(config, chatId, record = null, loggedGroup = false) {
  const id = String(chatId ?? '');
  if (!id) return 'unknown';
  if (isGroupId(id)) return 'group';
  if (config?.groups?.[id]) return 'group';
  if (record && record.chat_type === 'group') return 'group';
  if (loggedGroup) return 'group';
  if (isReplyableDmId(id)) return 'dm';
  return 'unknown';
}

/**
 * Inbound DM ids the outbound side can reply to (see resolveChatType).
 * @param {string} chatId
 */
export function isReplyableDmId(chatId) {
  return /^[A-Za-z0-9]+$/.test(String(chatId ?? ''));
}
