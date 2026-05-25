/**
 * Inbound media download helpers for zylos-zalo.
 */

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
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

const ZALO_CDN_PATTERNS = [
  /\.dlfl\.vn$/i,
  /\.zadn\.vn$/i,
  /\.zdn\.vn$/i,
  /\.zaloapp\.com$/i,
];

function isPrivateIP(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === '::') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

export async function validateDownloadUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  if (isPrivateIP(parsed.hostname)) return false;
  if (ZALO_CDN_PATTERNS.some(p => p.test(parsed.hostname))) return true;
  try {
    const addrs = await dns.resolve4(parsed.hostname).catch(() => []);
    const addrs6 = await dns.resolve6(parsed.hostname).catch(() => []);
    for (const ip of [...addrs, ...addrs6]) {
      if (isPrivateIP(ip)) return false;
    }
  } catch {}
  return true;
}

export async function downloadImage(url, { messageId, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!url) return null;

  if (!await validateDownloadUrl(url)) {
    console.warn(`[zalo] Download blocked: ${url} (non-HTTPS or private destination)`);
    return null;
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location && !await validateDownloadUrl(location)) {
        console.warn(`[zalo] Download redirect blocked: ${location}`);
        return null;
      }
      return downloadImage(location, { messageId, maxBytes });
    }
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
