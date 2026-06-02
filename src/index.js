#!/usr/bin/env node
/**
 * zylos-zalo — Zalo Bot Platform channel for Zylos Agent
 *
 * Supports both long polling (default) and webhook delivery modes.
 */

import { execFile } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, DATA_DIR, repairConfigPermissions } from './lib/config.js';
import {
  hasOwner, bindOwner, isDmAllowed,
  isGroupAllowed, isGroupSenderAllowed, getGroupName
} from './lib/auth.js';
import {
  logAndRecord, ensureReplay, getHistory, formatMessage
} from './lib/context.js';
import { downloadMedia, cleanupOldMedia } from './lib/media.js';
import { loadSeenDmUsers, sendDmWelcomeIfFirstSeen } from './lib/dm-welcome.js';
import {
  getPairingStatus, markPairingPending, savePairingState, buildPairingNotification
} from './lib/dm-pairing.js';
import { getTranscriptionProvider, transcribeAudio } from './lib/transcribe.js';
import {
  getMe, getUpdates, sendMessage, sendChatAction,
  setWebhook, deleteWebhook, ZaloApiError, setApiBaseUrl
} from './lib/api.js';
import {
  createDeduper, createRateLimiter, getUpdateDedupKey, timingSafeStringEqual
} from './lib/webhook-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

repairConfigPermissions();
let config = loadConfig();
const botToken = config.botToken;
if (!botToken) {
  console.error('[zalo] botToken not set in config.json');
  process.exit(1);
}

const C4_RECEIVE = path.join(process.env.HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');
const webhookDeduper = createDeduper({
  ttlMs: config.webhook?.dedupWindowMs || 5 * 60 * 1000,
  maxSize: config.webhook?.dedupMaxEntries || 1000
});
const webhookRateLimiter = createRateLimiter({
  windowMs: config.webhook?.rateLimitWindowMs || 60 * 1000,
  max: config.webhook?.rateLimitMax || 120
});

let botInfo = null;
let stopped = false;
let pollingOffset = undefined;
let ownerBindingInProgress = false;
setApiBaseUrl(config.apiBaseUrl);
let transcriptionProvider = getTranscriptionProvider(config.voiceTranscription, process.env, { modelPath: config.whisperModel || process.env.WHISPER_MODEL });
let VOICE_ENABLED = transcriptionProvider.available;
const seenDmUsers = loadSeenDmUsers();

// ============================================================
// C4 bridge
// ============================================================

function parseC4Response(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout.trim()); } catch { return null; }
}

function sendToC4(source, endpoint, content, { onReject, onFail } = {}) {
  if (!content) return;
  const args = [
    C4_RECEIVE,
    '--channel', source,
    '--endpoint', endpoint,
    '--json',
    '--content', content
  ];

  execFile(process.execPath, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (!error) {
      console.log(`[zalo] Sent to C4: ${content.substring(0, 50)}...`);
      return;
    }
    const response = parseC4Response(stdout);
    if (response && response.ok === false && response.error?.message) {
      console.warn(`[zalo] C4 rejected (${response.error.code}): ${response.error.message}`);
      if (onReject) onReject(response.error.message);
      return;
    }
    console.warn(`[zalo] C4 send failed, retrying in 2s: ${error.message}`);
    setTimeout(() => {
      execFile(process.execPath, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }, (retryError, retryStdout) => {
        if (!retryError) return;
        const retryResponse = parseC4Response(retryStdout);
        if (retryResponse?.ok === false && retryResponse.error?.message && onReject) {
          onReject(retryResponse.error.message);
          return;
        }
        console.error(`[zalo] C4 delivery failed after retry: ${retryError.message}`);
        if (onFail) onFail();
      });
    }, 2000);
  });
}

// ============================================================
// Typing indicator
// ============================================================

const TYPING_DIR = path.join(DATA_DIR, 'typing');
fs.mkdirSync(TYPING_DIR, { recursive: true });

const TYPING_TIMEOUT = 120000;
const activeTyping = new Map();

function startTyping(chatId, correlationId) {
  sendChatAction(botToken, chatId).catch(() => {});
  const interval = setInterval(() => {
    sendChatAction(botToken, chatId).catch(() => {});
  }, 5000);
  const timeout = setTimeout(() => {
    stopTyping(correlationId);
  }, TYPING_TIMEOUT);
  activeTyping.set(correlationId, { interval, timeout, startedAt: Date.now() });
}

function stopTyping(correlationId) {
  const state = activeTyping.get(correlationId);
  if (!state) return;
  clearInterval(state.interval);
  clearTimeout(state.timeout);
  activeTyping.delete(correlationId);
}

function handleTypingDoneFile(filename) {
  if (!filename || !filename.endsWith('.done')) return;
  const correlationId = filename.replace('.done', '');
  const filePath = path.join(TYPING_DIR, filename);
  if (activeTyping.has(correlationId)) {
    stopTyping(correlationId);
  }
  try { fs.unlinkSync(filePath); } catch {}
}

let typingWatcher = null;
try {
  typingWatcher = fs.watch(TYPING_DIR, (eventType, filename) => {
    if (eventType === 'rename' && filename) handleTypingDoneFile(filename);
  });
  typingWatcher.on('error', () => { typingWatcher = null; });
} catch {}

const typingPollInterval = setInterval(() => {
  try {
    for (const f of fs.readdirSync(TYPING_DIR)) handleTypingDoneFile(f);
  } catch {}
  const now = Date.now();
  for (const [id, state] of activeTyping) {
    if (now - state.startedAt > TYPING_TIMEOUT) stopTyping(id);
  }
}, 30000);

// Clean stale markers from previous run
try {
  for (const f of fs.readdirSync(TYPING_DIR)) {
    try { fs.unlinkSync(path.join(TYPING_DIR, f)); } catch {}
  }
} catch {}

// ============================================================
// Endpoint builder
// ============================================================

function safeId(raw) {
  return String(raw).replace(/[^a-zA-Z0-9_:-]/g, '_');
}

function buildEndpoint(chatId, { messageId } = {}) {
  let endpoint = String(chatId);
  if (messageId) {
    const correlationId = safeId(`${chatId}:${messageId}`);
    endpoint += `|msg:${messageId}|req:${correlationId}`;
  }
  return endpoint;
}

// ============================================================
// Message handler
// ============================================================

async function handleUpdate(update) {
  const eventName = update.event_name;
  if (!eventName) return;

  if (eventName === 'message.text.received') {
    await handleTextMessage(update);
  } else if (eventName === 'message.image.received' || eventName === 'user_send_image') {
    await handleImageMessage(update);
  } else if (eventName === 'message.file.received' || eventName === 'user_send_file') {
    await handleFileMessage(update);
  } else if (eventName === 'message.audio.received' || eventName === 'user_send_audio') {
    await handleVoiceMessage(update);
  } else if (eventName === 'message.video.received' || eventName === 'user_send_video') {
    await handleVideoMessage(update);
  } else if (eventName === 'message.gif.received' || eventName === 'user_send_gif') {
    await handleGifMessage(update);
  } else if (eventName === 'message.link.received' || eventName === 'user_send_link') {
    await handleLinkMessage(update);
  } else if (eventName === 'message.location.received' || eventName === 'user_send_location') {
    await handleLocationMessage(update);
  } else if (eventName === 'message.sticker.received' || eventName === 'user_send_sticker') {
    await handleStickerMessage(update);
  } else {
    console.log(`[zalo] Unhandled event: ${eventName}`);
  }
}

function isDuplicateUpdate(update) {
  const key = getUpdateDedupKey(update);
  if (!key) return false;
  return webhookDeduper.isDuplicate(key);
}

function getMessageInfo(update) {
  const message = update.message || {};
  const sender = update.sender || message.from || {};
  const chat = message.chat || {};
  const isGroup = chat.chat_type === 'GROUP' || message.chat_type === 'GROUP';
  const chatId = chat.id || message.chat_id || sender.id;
  const senderId = sender.id || chatId;
  const userName = sender.display_name || sender.name || String(senderId || chatId);
  const groupName = chat.name || chat.title || getGroupName(config, chatId, String(chatId));
  const messageId = message.msg_id || message.message_id || `${Date.now()}`;
  return { message, sender, chat, isGroup, chatId, senderId, userName, groupName, messageId };
}

function notifyPairingRequest(info) {
  const notification = buildPairingNotification({
    userId: info.senderId,
    userName: info.userName,
    chatId: info.chatId,
    firstMessage: info.message?.text || '',
  });
  sendToC4('zalo', 'admin|type:dm-pairing', notification);
}

// Pairing DM policy: unknown senders are recorded pending + the owner is
// notified (via C4); pending/denied senders are dropped silently to avoid spam.
function handlePairingRequest(info) {
  const status = getPairingStatus(info.senderId);
  if (status !== 'unknown') return;
  const state = markPairingPending({
    userId: info.senderId,
    userName: info.userName,
    chatId: info.chatId,
    firstMessage: info.message?.text || '',
  });
  savePairingState(state);
  notifyPairingRequest(info);
  sendMessage(botToken, info.chatId,
    'Thanks! Your request to chat has been sent to the admin for approval.').catch(() => {});
}

async function authorizeMessage(info) {
  if (!info.chatId || !info.senderId) return false;

  if (!hasOwner(config)) {
    if (info.isGroup) {
      console.log(`[zalo] Ignoring group message before owner is bound: ${info.chatId}`);
      return false;
    }
    if (ownerBindingInProgress) {
      console.log(`[zalo] Owner binding already in progress, ignoring first-contact race from ${info.senderId}`);
      return false;
    }
    ownerBindingInProgress = true;
    try {
      if (bindOwner(config, info.senderId, info.userName)) {
        sendMessage(botToken, info.chatId, 'You are now the admin of this bot.').catch(() => {});
      }
    } finally {
      ownerBindingInProgress = false;
    }
    return false;
  }

  if (info.isGroup) {
    if (!isGroupAllowed(config, info.chatId)) {
      console.log(`[zalo] Group ${info.chatId} not allowed, ignoring`);
      return false;
    }
    if (!isGroupSenderAllowed(config, info.chatId, info.senderId)) {
      console.log(`[zalo] Sender ${info.senderId} not allowed in group ${info.chatId}, ignoring`);
      return false;
    }
    return true;
  }

  if (!isDmAllowed(config, info.senderId)) {
    if ((config.dmPolicy || 'owner') === 'pairing') {
      handlePairingRequest(info);
    } else {
      sendMessage(botToken, info.chatId, "Sorry, I'm not available. Please ask my admin for access.").catch(() => {});
    }
    return false;
  }

  await sendDmWelcomeIfFirstSeen({
    send: (chatId, message) => sendMessage(botToken, chatId, message),
    userId: info.senderId,
    chatId: info.chatId,
    message: config.dmWelcomeMessage,
    seenUsers: seenDmUsers,
  });

  return true;
}

function buildC4Message({ info, text, mediaPath }) {
  ensureReplay(info.chatId, config);
  const contextMessages = info.isGroup ? getHistory(info.chatId, info.messageId, config) : null;
  return formatMessage({
    chatType: info.isGroup ? 'group' : 'dm',
    groupName: info.groupName,
    userName: info.userName,
    text,
    contextMessages,
    mediaPath
  });
}

function processAuthorizedMessage({ info, text, mediaPath }) {
  logAndRecord(info.chatId, {
    timestamp: new Date().toISOString(),
    message_id: info.messageId,
    user_id: info.senderId,
    user_name: info.userName,
    text
  }, config);

  const endpoint = buildEndpoint(info.chatId, { messageId: info.messageId });
  const correlationId = safeId(`${info.chatId}:${info.messageId}`);
  startTyping(info.chatId, correlationId);

  const msg = buildC4Message({ info, text, mediaPath });
  sendToC4('zalo', endpoint, msg, {
    onReject: (errMsg) => {
      stopTyping(correlationId);
      sendMessage(botToken, info.chatId, errMsg).catch(() => {});
    },
    onFail: () => {
      stopTyping(correlationId);
      sendMessage(botToken, info.chatId, 'Sorry, I could not process your message right now. Please try again.').catch(() => {});
    }
  });
}

async function handleTextMessage(update) {
  config = loadConfig();

  const info = getMessageInfo(update);
  const text = info.message.text || '';

  if (!info.chatId || !text) return;
  if (!await authorizeMessage(info)) return;
  processAuthorizedMessage({ info, text, mediaPath: null });
}

async function handleImageMessage(update) {
  config = loadConfig();

  const info = getMessageInfo(update);
  const imageUrl = info.message.photo_url || info.message.url || info.message.thumb || '';
  const caption = info.message.caption || '';

  if (!info.chatId) return;
  if (!await authorizeMessage(info)) return;

  let mediaPath = null;
  let text = caption || '[sent an image]';
  if (imageUrl) {
    try {
      const maxBytes = (config.message?.mediaMaxMb || config.mediaMaxMb || 10) * 1024 * 1024;
      const saved = await downloadMedia(imageUrl, { messageId: info.messageId, maxBytes, fallbackExt: '.img' });
      mediaPath = saved?.path || null;
      if (!caption) text = `[sent an image] ${imageUrl}`;
    } catch (err) {
      console.error(`[zalo] Failed to download image ${info.messageId}: ${err.message}`);
      text = caption || `[sent an image, download failed] ${imageUrl}`;
    }
  }

  processAuthorizedMessage({ info, text, mediaPath });
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function getMediaUrl(message, keys) {
  for (const key of keys) {
    const value = message?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const attachment = Array.isArray(message?.attachments) ? message.attachments[0] : null;
  if (attachment) {
    return firstString(attachment.url, attachment.file_url, attachment.media_url, attachment.href);
  }
  return '';
}

function getFilename(message, fallback = 'file') {
  return firstString(message.file_name, message.filename, message.name, message.title) || fallback;
}

async function handleDownloadedPlaceholder(update, {
  label,
  urlKeys,
  fallbackExt,
  textForUrl = (url) => `[sent a ${label}] ${url}`,
  textWithoutUrl = `[sent a ${label}]`,
  textDownloadFailed = (url) => `[sent a ${label}, download failed] ${url}`,
}) {
  config = loadConfig();

  const info = getMessageInfo(update);
  if (!info.chatId) return;
  if (!await authorizeMessage(info)) return;

  const url = getMediaUrl(info.message, urlKeys);
  let mediaPath = null;
  let text = url ? textForUrl(url, info.message) : textWithoutUrl;
  if (url) {
    try {
      const maxBytes = (config.message?.mediaMaxMb || config.mediaMaxMb || 10) * 1024 * 1024;
      const saved = await downloadMedia(url, { messageId: info.messageId, maxBytes, fallbackExt });
      mediaPath = saved?.path || null;
      if (!saved) text = textDownloadFailed(url, info.message);
    } catch (err) {
      console.error(`[zalo] Failed to download ${label} ${info.messageId}: ${err.message}`);
      text = textDownloadFailed(url, info.message);
    }
  }

  processAuthorizedMessage({ info, text, mediaPath });
}

async function handleFileMessage(update) {
  await handleDownloadedPlaceholder(update, {
    label: 'file',
    urlKeys: ['file_url', 'url', 'href', 'media_url'],
    fallbackExt: '.bin',
    textForUrl: (url, message) => `[sent a file: ${getFilename(message)}] ${url}`,
    textWithoutUrl: '[sent a file]',
    textDownloadFailed: (url, message) => `[sent a file: ${getFilename(message)}, download failed] ${url}`,
  });
}

async function handleVoiceMessage(update) {
  config = loadConfig();
  transcriptionProvider = getTranscriptionProvider(config.voiceTranscription, process.env, { modelPath: config.whisperModel || process.env.WHISPER_MODEL });
  VOICE_ENABLED = transcriptionProvider.available;

  const info = getMessageInfo(update);
  if (!info.chatId) return;
  if (!await authorizeMessage(info)) return;

  const audioUrl = getMediaUrl(info.message, ['audio_url', 'voice_url', 'file_url', 'url', 'media_url']);
  let mediaPath = null;
  let text = '[sent a voice message]';
  if (audioUrl) {
    try {
      const maxBytes = (config.message?.mediaMaxMb || config.mediaMaxMb || 10) * 1024 * 1024;
      const saved = await downloadMedia(audioUrl, { messageId: info.messageId, maxBytes, fallbackExt: '.audio' });
      mediaPath = saved?.path || null;
      if (mediaPath && VOICE_ENABLED) {
        const transcript = await transcribeAudio(mediaPath, {
          mode: config.voiceTranscription,
          modelPath: config.whisperModel || process.env.WHISPER_MODEL,
        });
        text = `[Voice] ${transcript}`;
      } else {
        text = '[sent a voice message, transcription unavailable]';
      }
    } catch (err) {
      console.error(`[zalo] Failed to process voice ${info.messageId}: ${err.message}`);
      text = '[sent a voice message, transcription failed]';
    }
  }

  processAuthorizedMessage({ info, text, mediaPath });
}

async function handleVideoMessage(update) {
  await handleDownloadedPlaceholder(update, {
    label: 'video',
    urlKeys: ['video_url', 'file_url', 'url', 'media_url'],
    fallbackExt: '.mp4',
    textForUrl: (url) => `[sent a video] ${url}`,
    textWithoutUrl: '[sent a video]',
    textDownloadFailed: (url) => `[sent a video, download failed] ${url}`,
  });
}

async function handleGifMessage(update) {
  await handleDownloadedPlaceholder(update, {
    label: 'GIF',
    urlKeys: ['gif_url', 'image_url', 'photo_url', 'file_url', 'url', 'media_url'],
    fallbackExt: '.gif',
    textForUrl: (url) => `[sent a GIF] ${url}`,
    textWithoutUrl: '[sent a GIF]',
    textDownloadFailed: (url) => `[sent a GIF, download failed] ${url}`,
  });
}

async function handleLinkMessage(update) {
  config = loadConfig();

  const info = getMessageInfo(update);
  if (!info.chatId) return;
  if (!await authorizeMessage(info)) return;

  const url = firstString(info.message.url, info.message.link_url, info.message.href, info.message.link?.url);
  const title = firstString(info.message.title, info.message.link?.title, info.message.description);
  const text = url
    ? `[shared a link: ${url}]${title ? ` ${title}` : ''}`
    : (title ? `[shared a link] ${title}` : '[shared a link]');
  processAuthorizedMessage({ info, text, mediaPath: null });
}

async function handleLocationMessage(update) {
  config = loadConfig();

  const info = getMessageInfo(update);
  if (!info.chatId) return;
  if (!await authorizeMessage(info)) return;

  const lat = firstString(info.message.latitude, info.message.lat, info.message.location?.latitude, info.message.location?.lat);
  const lng = firstString(info.message.longitude, info.message.lng, info.message.lon, info.message.location?.longitude, info.message.location?.lng, info.message.location?.lon);
  const address = firstString(info.message.address, info.message.location?.address, info.message.title);
  const text = lat && lng
    ? `[shared a location: ${lat}, ${lng}]${address ? ` ${address}` : ''}`
    : (address ? `[shared a location] ${address}` : '[shared a location]');
  processAuthorizedMessage({ info, text, mediaPath: null });
}

async function handleStickerMessage(update) {
  config = loadConfig();

  const info = getMessageInfo(update);
  if (!info.chatId) return;
  if (!await authorizeMessage(info)) return;

  const stickerId = info.message.sticker_id || info.message.stickerId || info.message.id || '';
  const text = stickerId ? `[sent a sticker: ${stickerId}]` : '[sent a sticker]';
  processAuthorizedMessage({ info, text, mediaPath: null });
}

// ============================================================
// Polling mode
// ============================================================

async function runPolling() {
  try {
    await deleteWebhook(botToken);
    console.log('[zalo] Cleared existing webhook (entering polling mode)');
  } catch {}

  console.log('[zalo] Starting long polling...');

  while (!stopped) {
    try {
      const update = await getUpdates(botToken, pollingOffset, 10, 100);
      if (stopped) break;

      if (update) {
        if (update.update_id !== undefined) {
          pollingOffset = update.update_id + 1;
        }
        await handleUpdate(update);
      }
    } catch (err) {
      if (stopped) break;
      if (err instanceof ZaloApiError && err.isPollingTimeout) continue;
      console.error(`[zalo] Polling error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ============================================================
// Webhook mode
// ============================================================

let webhookServer = null;

function startWebhookServer(port, webhookPath, webhookSecret) {
  webhookServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === webhookPath) {
      const remoteAddress = req.socket?.remoteAddress || 'unknown';
      if (!webhookRateLimiter.allow(remoteAddress)) {
        res.writeHead(429).end('rate limited');
        return;
      }

      if (webhookSecret) {
        const token = req.headers['x-bot-api-secret-token'];
        if (!timingSafeStringEqual(token, webhookSecret)) {
          res.writeHead(403).end('forbidden');
          return;
        }
      }

      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024) { res.writeHead(413).end('payload too large'); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.headersSent) return;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const update = body.result || body;
          if (isDuplicateUpdate(update)) {
            res.writeHead(200).end('duplicate');
            return;
          }
          handleUpdate(update).catch(err => {
            console.error(`[zalo] Webhook handling failed: ${err.message}`);
          });
          res.writeHead(200).end('ok');
        } catch {
          res.writeHead(400).end('bad request');
        }
      });
      return;
    }

    res.writeHead(404).end();
  });

  webhookServer.listen(port, '0.0.0.0', () => {
    console.log(`[zalo] Webhook server listening on 0.0.0.0:${port}`);
  });
}

async function runWebhook() {
  const internalPort = config.internal_port || 3462;
  const publicPort = config.webhookPort || internalPort;
  const webhookPath = config.webhookPath || '/zalo/webhook';
  const webhookSecret = config.webhookSecret || null;
  const webhookUrl = config.webhookUrl;

  if (!webhookUrl) {
    console.error('[zalo] webhookUrl not set, cannot start webhook mode');
    process.exit(1);
  }

  if (!webhookSecret) {
    console.error('[zalo] webhookSecret is required in webhook mode');
    process.exit(1);
  }

  let effectiveInternalPort = internalPort;
  if (publicPort === internalPort) {
    effectiveInternalPort = internalPort + 1;
    console.warn(`[zalo] webhookPort and internal_port are both ${internalPort}; internal server auto-shifted to ${effectiveInternalPort}. Set webhookPort explicitly to avoid this.`);
  }

  startWebhookServer(publicPort, webhookPath, webhookSecret);
  startInternalServer(effectiveInternalPort);

  try {
    await setWebhook(botToken, webhookUrl, webhookSecret);
    console.log(`[zalo] Webhook registered: ${webhookUrl}`);
  } catch (err) {
    console.error(`[zalo] Failed to register webhook: ${err.message}`);
    process.exit(1);
  }
}

// ============================================================
// Internal HTTP for recording outgoing
// ============================================================

const INTERNAL_TOKEN = crypto.randomBytes(32).toString('hex');
const INTERNAL_TOKEN_PATH = path.join(DATA_DIR, '.internal-token');
const INTERNAL_ENDPOINT_PATH = path.join(DATA_DIR, '.internal-endpoint.json');

function handleRecordOutgoing(req, res) {
  const token = req.headers['x-internal-token'];
  if (!timingSafeStringEqual(token, INTERNAL_TOKEN)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > 64 * 1024) { res.writeHead(413).end('payload too large'); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.headersSent) return;
    try {
      const { chatId, text } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!chatId || !text) { res.writeHead(400).end('missing fields'); return; }
      logAndRecord(chatId, {
        timestamp: new Date().toISOString(),
        message_id: `bot:${Date.now()}`,
        user_id: 'bot',
        user_name: botInfo?.name || 'bot',
        text: text.substring(0, 500)
      }, config);
      res.writeHead(200).end('ok');
    } catch {
      res.writeHead(400).end('bad json');
    }
  });
}

let internalServer = null;

function writeInternalRuntimeFiles(port) {
  fs.writeFileSync(INTERNAL_TOKEN_PATH, INTERNAL_TOKEN, { mode: 0o600 });
  fs.writeFileSync(INTERNAL_ENDPOINT_PATH, JSON.stringify({ port }), { mode: 0o600 });
}

function cleanupInternalRuntimeFiles() {
  try { fs.unlinkSync(INTERNAL_TOKEN_PATH); } catch {}
  try { fs.unlinkSync(INTERNAL_ENDPOINT_PATH); } catch {}
}

function startInternalServer(portOverride) {
  const port = portOverride || config.internal_port || 3462;
  const MAX_PORT_RETRIES = 5;
  let portRetries = 0;

  internalServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/internal/record-outgoing') {
      handleRecordOutgoing(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  internalServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      portRetries++;
      if (portRetries >= MAX_PORT_RETRIES) {
        console.error(`[zalo] Port ${port} in use after ${MAX_PORT_RETRIES} retries, exiting`);
        process.exit(1);
      }
      console.error(`[zalo] Port ${port} in use, retry ${portRetries}/${MAX_PORT_RETRIES} in 3s`);
      setTimeout(() => internalServer.listen(port, '127.0.0.1'), 3000);
    }
  });

  internalServer.listen(port, '127.0.0.1', () => {
    writeInternalRuntimeFiles(port);
    console.log(`[zalo] Internal server on 127.0.0.1:${port}`);
  });
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`[zalo] Starting zylos-zalo v${process.env.npm_package_version || '0.1.1'}...`);
  console.log(`[zalo] Data directory: ${DATA_DIR}`);
  console.log(`[zalo] Voice ASR: ${VOICE_ENABLED ? `enabled (${transcriptionProvider.provider})` : 'disabled/unavailable'}`);

  const mediaMaxAgeMs = (config.retention?.mediaMaxAgeDays || 7) * 24 * 60 * 60 * 1000;
  cleanupOldMedia(mediaMaxAgeMs);
  setInterval(() => cleanupOldMedia(mediaMaxAgeMs), 6 * 60 * 60 * 1000);

  if (!config.enabled) {
    console.log('[zalo] Component disabled in config, exiting.');
    process.exit(0);
  }

  try {
    botInfo = await getMe(botToken);
    console.log(`[zalo] Bot verified: ${botInfo.name || botInfo.id || 'OK'}`);
  } catch (err) {
    console.error(`[zalo] Invalid bot token: ${err.message}`);
    process.exit(1);
  }

  if (config.delivery === 'webhook') {
    await runWebhook();
  } else {
    startInternalServer();
    await runPolling();
  }
}

function shutdown() {
  console.log('[zalo] Shutting down...');
  stopped = true;

  clearInterval(typingPollInterval);
  if (typingWatcher) typingWatcher.close();
  for (const [, state] of activeTyping) {
    clearInterval(state.interval);
    clearTimeout(state.timeout);
  }
  activeTyping.clear();

  if (config.delivery === 'webhook') {
    deleteWebhook(botToken).catch(() => {});
  }

  if (webhookServer) webhookServer.close();
  if (internalServer) internalServer.close();
  cleanupInternalRuntimeFiles();

  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  console.error(`[zalo] Fatal error:`, err);
  process.exit(1);
});
