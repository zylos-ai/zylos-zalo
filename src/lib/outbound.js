/**
 * Outbound destination policy for scripts/send.js: the same rules as inbound.
 *
 * - Group (`type:group`): only groups `isGroupAllowed` accepts. Inbound does
 *   not let the owner through a disabled or unlisted group, so there is no
 *   owner-reply exception.
 * - DM (`type:dm`, or no type for endpoints built before 0.2.0): the chat id
 *   must pass `isDmAllowed` (owner always). Otherwise, only a reply to the
 *   endpoint's `msg` is allowed when the component log shows that message was
 *   accepted from a sender who is still allowed. A missing log or entry
 *   denies, never allows.
 */
import { isDmAllowed, isGroupAllowed } from './auth.js';

/**
 * @param {object} config
 * @param {{chatId: string, type?: string, msg?: string}} ep
 * @param {(chatId: string, messageId: string) => object|null} findLogged
 * @returns {string|null} denial reason, or null when allowed
 */
export function outboundDenialReason(config, ep, findLogged = () => null) {
  if (!ep?.chatId) return 'missing destination id';
  if (ep.type === 'group') {
    if (isGroupAllowed(config, ep.chatId)) return null;
    return `group ${ep.chatId} is not allowed (groupPolicy=${config.groupPolicy || 'allowlist'})`;
  }
  if (ep.type !== undefined && ep.type !== 'dm') return `unknown chat type ${ep.type}`;
  if (isDmAllowed(config, ep.chatId)) return null;
  if (ep.msg) {
    const entry = findLogged(ep.chatId, ep.msg);
    if (entry && entry.user_id !== 'bot' && isDmAllowed(config, entry.user_id)) return null;
  }
  return `DM ${ep.chatId} is not allowed (dmPolicy=${config.dmPolicy || 'owner'})`;
}
