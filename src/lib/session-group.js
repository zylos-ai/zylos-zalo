/**
 * Session-group mapping for zylos-core multi-session mode.
 *
 * The group name is derived only from the reply endpoint, so the inbound
 * `--session-group` value and `scripts/session-group.js <endpoint>` always
 * agree. Rules (fixed once live; changing them needs a migration):
 *   private chat  `<chatId>|type:dm|...`    -> dm-<chatId>
 *   group         `<chatId>|type:group|...` -> group-<chatId>
 *   owner notices `admin|type:dm-pairing`   -> admin
 * Group ids start with `zgr-` and always map to group-<chatId> (legacy
 * endpoints without a type included); a `zgr-` id with `type:dm` is an error,
 * matching the outbound check that refuses the same endpoint. Other ids map to group only when the component wrote
 * `type:group`; otherwise dm. The result depends only on the endpoint string,
 * so it is stable across calls (Core and the scheduler persist it).
 * Zalo ids are used as-is; an id Core would not accept is an error, never
 * truncated or hashed. Core prefixes the component namespace; never add it here.
 */

import { isGroupId } from './chat-type.js';

/** Core's limits for the name a component passes (Core adds `<namespace>:`). */
export const SESSION_GROUP_MAX_LENGTH = 95;
export const SESSION_GROUP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/**
 * Whether Core would accept this nonempty name.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidSessionGroup(name) {
  return typeof name === 'string' && name.length <= SESSION_GROUP_MAX_LENGTH
    && SESSION_GROUP_PATTERN.test(name);
}

/**
 * Parse a reply endpoint: `<chatId>|key:value|...`.
 * @param {string} raw
 * @returns {{chatId: string, type?: string, msg?: string, req?: string}}
 */
export function parseEndpoint(raw) {
  const parts = String(raw ?? '').split('|');
  const result = { chatId: parts[0] };
  for (const p of parts.slice(1)) {
    const idx = p.indexOf(':');
    if (idx > 0) result[p.slice(0, idx)] = p.slice(idx + 1);
  }
  return result;
}

/**
 * @param {string} endpoint
 * @returns {string} group name without namespace
 * @throws {Error} when the endpoint cannot be mapped
 */
export function sessionGroupFromEndpoint(endpoint) {
  const ep = parseEndpoint(endpoint);
  if (!ep.chatId) throw new Error(`invalid Zalo endpoint: ${JSON.stringify(String(endpoint ?? '').slice(0, 64))}`);
  if (ep.chatId === 'admin') return 'admin';
  if (ep.type !== undefined && ep.type !== 'dm' && ep.type !== 'group') {
    throw new Error(`unknown chat type in endpoint: ${JSON.stringify(ep.type.slice(0, 16))}`);
  }
  if (isGroupId(ep.chatId) && ep.type === 'dm') {
    throw new Error(`endpoint type:dm does not match group id ${JSON.stringify(ep.chatId.slice(0, 64))}`);
  }
  const kind = isGroupId(ep.chatId) || ep.type === 'group' ? 'group' : 'dm';
  const name = `${kind}-${ep.chatId}`;
  if (!isValidSessionGroup(name)) {
    throw new Error(`cannot map chat id to a session group: ${JSON.stringify(ep.chatId.slice(0, 64))}`);
  }
  return name;
}
