#!/usr/bin/env node
/**
 * C4 send interface for zylos-zalo
 *
 * Usage:
 *   node scripts/send.js <endpoint_id> "message text"
 *   node scripts/send.js <endpoint_id> "[MEDIA:image]https://example.com/image.png"
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { loadConfig, DATA_DIR } from '../src/lib/config.js';
import { sendMessage, sendPhoto } from '../src/lib/api.js';

const MAX_LENGTH = 2000;

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: send.js <endpoint_id> <message>');
  process.exit(1);
}

const endpointRaw = args[0];
const message = args.slice(1).join(' ');

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
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline > maxLen * 0.3) breakAt = lastNewline;
    else {
      const lastSpace = chunk.lastIndexOf(' ');
      if (lastSpace > maxLen * 0.3) breakAt = lastSpace;
    }
    const part = remaining.substring(0, breakAt).trim();
    remaining = remaining.substring(breakAt).trim();
    if (part.length > 0) chunks.push(part);
  }
  return chunks;
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
  const chunks = splitMessage(text, MAX_LENGTH);
  for (let i = 0; i < chunks.length; i++) {
    await sendMessage(botToken, chatId, chunks[i]);
    console.log(`Sent chunk ${i + 1}/${chunks.length}`);
    if (i < chunks.length - 1) await sleep(500);
  }
}

async function main() {
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
