/**
 * SYNTHETIC fixture: NOT captured from production. Zalo's getUpdates docs only
 * show PRIVATE payloads; this GROUP payload is modeled on that shape plus the
 * live-observed `zgr-` group id prefix. All ids and names are made up.
 * Replace with a sanitized real capture when one is available.
 */
export const groupTextWebhook = {
  event_name: 'message.text.received',
  message: {
    from: { id: 'a1b2c3d4e5f60718293a', display_name: 'Test User', is_bot: false },
    chat: { id: 'zgr-0f1e2d3c4b5a69788796', chat_type: 'GROUP' },
    text: '@bot hello',
    message_id: '5f4e3d2c1b0a99887766',
    date: 1763000000000,
  },
};
