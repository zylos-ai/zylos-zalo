#!/usr/bin/env node
/**
 * C4 send interface for zylos-zalo
 *
 * Usage:
 *   echo "message text" | node scripts/send.js <endpoint_id>
 *   node scripts/send.js <endpoint_id> "message text"
 *   echo "[MEDIA:image]https://example.com/image.png" | node scripts/send.js <endpoint_id>
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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

const parsed = parseEndpoint(endpointRaw);
const chatId = parsed.chatId;
const correlationId = parsed.req || null;

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

const INTERNAL_TOKEN = crypto.createHash('sha256').update(botToken).digest('hex');

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
  const port = config.internal_port || 3462;
  try {
    const body = JSON.stringify({ chatId, text: text.substring(0, 500) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(`http://127.0.0.1:${port}/internal/record-outgoing`, {
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

async function sendText(text) {
  const chunks = splitMessage(stripMarkdown(text), MAX_LENGTH);
  for (let i = 0; i < chunks.length; i++) {
    await sendMessage(botToken, chatId, chunks[i]);
    console.log(`Sent chunk ${i + 1}/${chunks.length}`);
    if (i < chunks.length - 1) await sleep(500);
  }
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
      console.log('Skipped (smart mode)');
      return;
    }

    if (message.startsWith('[MEDIA:image]')) {
      const photoUrl = message.substring('[MEDIA:image]'.length).trim();
      if (!/^https?:\/\//i.test(photoUrl)) {
        throw new Error('Zalo sendPhoto requires a public HTTP(S) image URL; local file hosting is not implemented yet');
      }
      await sendPhoto(botToken, chatId, photoUrl);
      markTypingDone();
      await recordOutgoing('[sent a photo]');
      console.log('Photo sent successfully');
      return;
    }

    if (message.startsWith('[MEDIA:sticker]')) {
      const sticker = message.substring('[MEDIA:sticker]'.length).trim();
      if (!sticker) throw new Error('Sticker id is required');
      await sendSticker(botToken, chatId, sticker);
      markTypingDone();
      await recordOutgoing('[sent a sticker]');
      console.log('Sticker sent successfully');
      return;
    }

    await sendText(message);
    markTypingDone();
    await recordOutgoing(message);
    console.log('Message sent successfully');
  } catch (err) {
    markTypingDone();
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
