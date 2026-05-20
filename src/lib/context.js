/**
 * Chat history and message formatting for zylos-zalo
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const LOGS_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });

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

export function recordEntry(chatId, entry, config) {
  chatId = String(chatId);
  if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
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

export function logAndRecord(chatId, entry, config) {
  chatId = String(chatId);
  const logFile = path.join(LOGS_DIR, logFileName(chatId));
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error(`[zalo] Log write failed for ${chatId}: ${err.message}`);
  }
  recordEntry(chatId, entry, config);
}

export function ensureReplay(chatId, config) {
  chatId = String(chatId);
  if (replayedKeys.has(chatId)) return;

  const logFile = path.join(LOGS_DIR, logFileName(chatId));
  if (!fs.existsSync(logFile)) {
    replayedKeys.add(chatId);
    return;
  }

  const limit = getHistoryLimit(chatId, config);
  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    const tail = lines.slice(-limit);
    for (const line of tail) {
      try {
        recordEntry(chatId, JSON.parse(line), config);
      } catch {}
    }
    replayedKeys.add(chatId);
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
