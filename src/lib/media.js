/**
 * Inbound media download helpers for zylos-zalo.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  return '';
}

function extensionFromUrl(rawUrl) {
  try {
    const ext = path.extname(new URL(rawUrl).pathname);
    if (/^\.[a-z0-9]{1,8}$/i.test(ext)) return ext.toLowerCase();
  } catch {}
  return '';
}

function safeName(value) {
  return String(value || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function downloadImage(url, { messageId, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!url) return null;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      throw new Error(`image exceeds ${maxBytes} bytes`);
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new Error(`image exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }

    const contentType = response.headers.get('content-type') || '';
    const ext = extensionFromContentType(contentType) || extensionFromUrl(url) || '.img';
    const filePath = path.join(MEDIA_DIR, `${safeName(messageId)}${ext}`);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.concat(chunks));
    fs.renameSync(tmpPath, filePath);
    return { path: filePath, contentType, size: total };
  } finally {
    clearTimeout(timer);
  }
}
