/**
 * Session-group mapping for zylos-core multi-session mode.
 *
 * The group name is derived only from the reply endpoint, so the inbound
 * `--session-group` value and `scripts/session-group.js <endpoint>` always
 * agree. Rules (fixed once live; changing them needs a migration):
 *   private chat  `<chatId>|type:dm|...`    -> dm-<chatId>
 *   group         `<chatId>|type:group|...` -> group-<chatId>
 *   owner notices `admin|type:dm-pairing`   -> admin
 * Endpoints without a type (built before 0.2.0) are private chats.
 * Zalo ids are used as-is; an id Core would not accept is an error, never
 * truncated or hashed. Core prefixes the component namespace; never add it here.
 */

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
  const name = `${ep.type === 'group' ? 'group' : 'dm'}-${ep.chatId}`;
  if (!isValidSessionGroup(name)) {
    throw new Error(`cannot map chat id to a session group: ${JSON.stringify(ep.chatId.slice(0, 64))}`);
  }
  return name;
}
