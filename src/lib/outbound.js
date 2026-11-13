/**
 * Outbound destination policy for scripts/send.js: the same rules as inbound.
 *
 * The chat type comes from the chat id (see chat-type.js), never from the
 * endpoint's `type`. A `type` that disagrees with the real type is refused,
 * and an id whose type cannot be determined is refused (strictest).
 *
 * - Group: groups `isGroupAllowed` accepts. In a non-allowlisted group
 *   (policy not `disabled`), only a reply to the endpoint's `msg` when the
 *   component log shows the owner wrote that accepted message, matching
 *   inbound. `disabled` blocks all group sends.
 * - DM: the chat id must pass `isDmAllowed` (owner always). Otherwise, only a
 *   reply to the endpoint's `msg` when the component log shows that message
 *   was accepted from this same chat's user, who is still allowed. A missing
 *   log or entry denies, never allows.
 */
import { isDmAllowed, isGroupAllowed, isOwner } from './auth.js';
import { resolveChatType } from './chat-type.js';

/**
 * @param {object} config
 * @param {{chatId: string, type?: string, msg?: string}} ep
 * @param {(chatId: string, messageId: string) => object|null} findLogged
 * @param {(chatId: string) => boolean} [hasLoggedGroup] any group record in the chat's log
 * @returns {string|null} denial reason, or null when allowed
 */
export function outboundDenialReason(config, ep, findLogged = () => null, hasLoggedGroup = () => false) {
  if (!ep?.chatId) return 'missing destination id';
  if (ep.chatId === 'admin' || ep.type === 'dm-pairing') {
    return 'admin notices are not replyable; message the owner through their own DM endpoint (<owner user_id>|type:dm)';
  }
  if (ep.type !== undefined && ep.type !== 'dm' && ep.type !== 'group') return `unknown chat type ${ep.type}`;
  const entry = ep.msg ? findLogged(ep.chatId, ep.msg) : null;
  const kind = resolveChatType(config, ep.chatId, entry, !!hasLoggedGroup(ep.chatId));
  if (kind === 'unknown') return `cannot determine the chat type of ${ep.chatId}; refusing to send`;
  if (ep.type !== undefined && ep.type !== kind) {
    return `endpoint type:${ep.type} does not match the real chat type (${kind}) of ${ep.chatId}`;
  }
  if (kind === 'group') {
    if (isGroupAllowed(config, ep.chatId)) return null;
    if ((config.groupPolicy || 'allowlist') !== 'disabled' && entry && isOwner(config, entry.user_id)) return null;
    return `group ${ep.chatId} is not allowed (groupPolicy=${config.groupPolicy || 'allowlist'}) and the message is not a reply to the owner`;
  }
  if (isDmAllowed(config, ep.chatId)) return null;
  if (entry && entry.user_id !== 'bot' && String(entry.user_id) === String(ep.chatId)
      && isDmAllowed(config, entry.user_id)) return null;
  return `DM ${ep.chatId} is not allowed (dmPolicy=${config.dmPolicy || 'owner'})`;
}
