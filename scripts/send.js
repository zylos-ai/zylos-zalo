#!/usr/bin/env node
/**
 * C4 send interface for zylos-zalo
 *
 * Usage:
 *   echo "message text" | node scripts/send.js <endpoint_id>
 *   node scripts/send.js <endpoint_id> "message text"
 *   echo "[MEDIA:image]https://example.com/image.png" | node scripts/send.js <endpoint_id>
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DATA_DIR } from '../src/lib/config.js';
import { sendMessage, sendPhoto, sendSticker, setApiBaseUrl } from '../src/lib/api.js';

const MAX_LENGTH = 2000;

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: send.js <endpoint_id> [message]');
  console.error('       echo "message" | send.js <endpoint_id>');
  process.exit(1);
}

const endpointRaw = args[0];
const cliMessage = args.slice(1).join(' ');

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.pause();
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', finish);
  });
}

function parseEndpoint(raw) {
  const result = { chatId: null, msg: null, req: null };
  const parts = raw.split('|');
  result.chatId = parts[0];
  for (const p of parts.slice(1)) {
    const [key, ...rest] = p.split(':');
    result[key] = rest.join(':');
  }
  return result;
}

function safeCorrelationId(raw) {
  if (!raw) return null;
  return String(raw).replace(/[^a-zA-Z0-9_:-]/g, '_');
}

const parsed = parseEndpoint(endpointRaw);
const chatId = parsed.chatId;
const correlationId = safeCorrelationId(parsed.req);

if (!chatId) {
  console.error('Error: invalid endpoint (missing chatId)');
  process.exit(1);
}

const config = loadConfig();
setApiBaseUrl(config.apiBaseUrl);
const botToken = config.botToken;
if (!botToken) {
  console.error('Error: botToken not set in config.json');
  process.exit(1);
}

const INTERNAL_TOKEN_PATH = path.join(DATA_DIR, '.internal-token');
const INTERNAL_ENDPOINT_PATH = path.join(DATA_DIR, '.internal-endpoint.json');

function readInternalToken() {
  try {
    return fs.readFileSync(INTERNAL_TOKEN_PATH, 'utf8').trim();
  } catch {
    return null;
  }
}

function readInternalPort() {
  try {
    const data = JSON.parse(fs.readFileSync(INTERNAL_ENDPOINT_PATH, 'utf8'));
    return data.port || null;
  } catch {
    return null;
  }
}

const INTERNAL_TOKEN = readInternalToken();
const INTERNAL_PORT = readInternalPort();

if (!INTERNAL_TOKEN || !INTERNAL_PORT) {
  console.error('Error: service not running or internal token unavailable');
  process.exit(1);
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let breakAt = maxLen;
    const chunk = remaining.substring(0, breakAt);
    const lastParaBreak = chunk.lastIndexOf('\n\n');
    if (lastParaBreak > maxLen * 0.3) breakAt = lastParaBreak + 1;
    else {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > maxLen * 0.3) breakAt = lastNewline;
      else {
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > maxLen * 0.3) breakAt = lastSpace;
      }
    }
    const part = remaining.substring(0, breakAt).trim();
    remaining = remaining.substring(breakAt).trim();
    if (part.length > 0) chunks.push(part);
  }
  return chunks;
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, (match) => match.slice(3, -3).replace(/^\w*\n/, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s/gm, '- ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

function markTypingDone() {
  if (!correlationId) return;
  try {
    const typingDir = path.join(DATA_DIR, 'typing');
    fs.mkdirSync(typingDir, { recursive: true });
    fs.writeFileSync(path.join(typingDir, `${correlationId}.done`), String(Date.now()));
  } catch {}
}

async function recordOutgoing(text) {
  try {
    const body = JSON.stringify({ chatId, text: text.substring(0, 500) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(`http://127.0.0.1:${INTERNAL_PORT}/internal/record-outgoing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Pull the message id out of a Zalo API send result, tolerant of field naming.
function extractMessageId(result) {
  if (!result || typeof result !== 'object') return null;
  return result.message_id ?? result.msg_id ?? result.messageId ?? result.id ?? null;
}

// Emit a single machine-parseable delivery receipt for C4 correlation.
function emitReceipt({ status, type, messageIds = [], chunks, error }) {
  const receipt = { status, type, chatId, correlationId, messageIds, ts: Date.now() };
  if (chunks !== undefined) receipt.chunks = chunks;
  if (error) receipt.error = error;
  console.log('RECEIPT ' + JSON.stringify(receipt));
}

async function sendText(text) {
  const chunks = splitMessage(stripMarkdown(text), MAX_LENGTH);
  const messageIds = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await sendMessage(botToken, chatId, chunks[i]);
    const id = extractMessageId(result);
    if (id !== null) messageIds.push(id);
    console.log(`Sent chunk ${i + 1}/${chunks.length}`);
    if (i < chunks.length - 1) await sleep(500);
  }
  return { chunks: chunks.length, messageIds };
}

async function main() {
  const stdinData = await readStdin(cliMessage ? 100 : 5000);
  const message = stdinData.trim() || cliMessage;

  if (!message) {
    console.error('Error: no message provided');
    process.exit(1);
  }

  try {
    if (message.trim() === '[SKIP]') {
      markTypingDone();
      emitReceipt({ status: 'skipped', type: 'text' });
      console.log('Skipped (smart mode)');
      return;
    }

    if (message.startsWith('[MEDIA:image]')) {
      const photoUrl = message.substring('[MEDIA:image]'.length).trim();
      if (!/^https?:\/\//i.test(photoUrl)) {
        throw new Error('Zalo sendPhoto requires a public HTTP(S) image URL; local file hosting is not implemented yet');
      }
      const result = await sendPhoto(botToken, chatId, photoUrl);
      markTypingDone();
      await recordOutgoing('[sent a photo]');
      const id = extractMessageId(result);
      emitReceipt({ status: 'sent', type: 'photo', messageIds: id !== null ? [id] : [] });
      console.log('Photo sent successfully');
      return;
    }

    if (message.startsWith('[MEDIA:sticker]')) {
      const sticker = message.substring('[MEDIA:sticker]'.length).trim();
      if (!sticker) throw new Error('Sticker id is required');
      const result = await sendSticker(botToken, chatId, sticker);
      markTypingDone();
      await recordOutgoing('[sent a sticker]');
      const id = extractMessageId(result);
      emitReceipt({ status: 'sent', type: 'sticker', messageIds: id !== null ? [id] : [] });
      console.log('Sticker sent successfully');
      return;
    }

    const { chunks, messageIds } = await sendText(message);
    markTypingDone();
    await recordOutgoing(message);
    emitReceipt({ status: 'sent', type: 'text', messageIds, chunks });
    console.log('Message sent successfully');
  } catch (err) {
    markTypingDone();
    emitReceipt({ status: 'failed', type: 'text', error: err.message });
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
