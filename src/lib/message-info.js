/**
 * Normalize a Zalo update (polling or webhook) into the fields the handlers use.
 *
 * Inbound group detection uses `chat_type === 'GROUP'`; outbound derives the
 * type from the id (`zgr-` prefix, see chat-type.js). A group whose id lacks
 * the prefix breaks that assumption, so it is logged loudly.
 */
import { getGroupName } from './auth.js';
import { isGroupId } from './chat-type.js';

/**
 * @param {object} update
 * @param {object} config
 * @param {{warn: function}} [logger]
 */
export function getMessageInfo(update, config, logger = console) {
  const message = update.message || {};
  const sender = update.sender || message.from || {};
  const chat = message.chat || {};
  const isGroup = chat.chat_type === 'GROUP' || message.chat_type === 'GROUP';
  const chatId = chat.id || message.chat_id || sender.id;
  if (isGroup && chatId && !isGroupId(chatId)) {
    logger.warn(`[zalo] GROUP chat id ${chatId} does not start with zgr-; outbound will not recognize it as a group unless it is in config.groups or logged as a group`);
  }
  const senderId = sender.id || chatId;
  const userName = sender.display_name || sender.name || String(senderId || chatId);
  const groupName = chat.name || chat.title || getGroupName(config, chatId, String(chatId));
  const messageId = message.msg_id || message.message_id || `${Date.now()}`;
  return { message, sender, chat, isGroup, chatId, senderId, userName, groupName, messageId };
}
