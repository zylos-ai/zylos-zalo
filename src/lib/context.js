/**
 * Chat history and message formatting for zylos-zalo
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const LOGS_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });

const MAX_TRACKED_CHATS = 500;
const chatHistories = new Map();
const replayedKeys = new Set();

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function logFileName(chatId) {
  return `${String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`;
}

function getHistoryLimit(chatId, config) {
  const gc = config?.groups?.[String(chatId)];
  return gc?.historyLimit || config?.message?.context_messages || 5;
}

function evictOldest(collection, maxSize) {
  while (collection.size > maxSize) {
    collection.delete(collection.keys().next().value);
  }
}

export function recordEntry(chatId, entry, config) {
  chatId = String(chatId);
  if (!chatHistories.has(chatId)) {
    chatHistories.set(chatId, []);
    evictOldest(chatHistories, MAX_TRACKED_CHATS);
  }
  const history = chatHistories.get(chatId);

  if (entry.message_id && !String(entry.message_id).startsWith('bot:')) {
    if (history.some(m => m.message_id === entry.message_id)) return;
  }

  history.push(entry);
  const limit = getHistoryLimit(chatId, config);
  if (history.length > limit * 2) {
    chatHistories.set(chatId, history.slice(-limit));
  }
}

const DEFAULT_MAX_LOG_BYTES = 512 * 1024;

export function logAndRecord(chatId, entry, config) {
  chatId = String(chatId);
  const logFile = path.join(LOGS_DIR, logFileName(chatId));
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    const maxBytes = config?.logging?.maxLogBytes || DEFAULT_MAX_LOG_BYTES;
    try {
      const stat = fs.statSync(logFile);
      if (stat.size > maxBytes) rotateLog(logFile, maxBytes);
    } catch {}
  } catch (err) {
    console.error(`[zalo] Log write failed for ${chatId}: ${err.message}`);
  }
  recordEntry(chatId, entry, config);
}

function rotateLog(logFile, maxBytes) {
  const keepBytes = Math.floor(maxBytes * 0.75);
  const buf = Buffer.alloc(keepBytes);
  const fd = fs.openSync(logFile, 'r');
  const stat = fs.fstatSync(fd);
  fs.readSync(fd, buf, 0, keepBytes, stat.size - keepBytes);
  fs.closeSync(fd);
  const content = buf.toString('utf8');
  const firstNewline = content.indexOf('\n');
  const trimmed = firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
  fs.writeFileSync(logFile, trimmed);
}

function readTailLines(filePath, count) {
  const CHUNK = 4096;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    if (stat.size === 0) return [];
    let pos = stat.size;
    let tail = '';
    while (pos > 0) {
      const readSize = Math.min(CHUNK, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      tail = buf.toString('utf-8') + tail;
      const lines = tail.trim().split('\n').filter(l => l);
      if (lines.length > count) return lines.slice(-count);
    }
    return tail.trim().split('\n').filter(l => l).slice(-count);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

export function ensureReplay(chatId, config) {
  chatId = String(chatId);
  if (replayedKeys.has(chatId)) return;

  const logFile = path.join(LOGS_DIR, logFileName(chatId));
  if (!fs.existsSync(logFile)) {
    replayedKeys.add(chatId);
    evictOldest(replayedKeys, MAX_TRACKED_CHATS);
    return;
  }

  const limit = getHistoryLimit(chatId, config);
  try {
    const tail = readTailLines(logFile, limit);
    for (const line of tail) {
      try {
        recordEntry(chatId, JSON.parse(line), config);
      } catch {}
    }
    replayedKeys.add(chatId);
    evictOldest(replayedKeys, MAX_TRACKED_CHATS);
    if (tail.length > 0) {
      console.log(`[zalo] Replayed ${tail.length} log entries for ${chatId}`);
    }
  } catch (err) {
    console.error(`[zalo] Log replay failed for ${chatId}: ${err.message}`);
  }
}

export function getHistory(chatId, excludeMessageId, config) {
  const history = chatHistories.get(String(chatId));
  if (!history || history.length === 0) return [];
  const limit = getHistoryLimit(chatId, config);
  const filtered = excludeMessageId
    ? history.filter(m => m.message_id !== excludeMessageId)
    : history;
  return filtered.slice(-limit);
}

export function formatMessage(opts) {
  const { chatType, groupName, userName, text, contextMessages, mediaPath } = opts;

  let prefix;
  if (chatType === 'dm') {
    prefix = '[Zalo DM]';
  } else {
    prefix = `[Zalo GROUP:${escapeXml(groupName || 'group')}]`;
  }

  const parts = [`${prefix} ${escapeXml(userName)} said: `];

  if (contextMessages && contextMessages.length > 0) {
    const contextLines = contextMessages.map(m =>
      `[${escapeXml(m.user_name || String(m.user_id))}]: ${escapeXml(m.text)}`
    ).join('\n');
    parts.push(`<group-context>\n${contextLines}\n</group-context>\n\n`);
  }

  parts.push(`<current-message>\n${escapeXml(text)}\n</current-message>`);

  let message = parts.join('');
  if (mediaPath) {
    message += ` ---- file: ${escapeXml(mediaPath)}`;
  }
  return message;
}
