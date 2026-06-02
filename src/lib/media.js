/**
 * Inbound media download helpers for zylos-zalo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { isPrivateIp } from './ip.js';

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  if (type === 'audio/mpeg') return '.mp3';
  if (type === 'audio/mp3') return '.mp3';
  if (type === 'audio/ogg') return '.ogg';
  if (type === 'audio/wav') return '.wav';
  if (type === 'audio/x-wav') return '.wav';
  if (type === 'audio/mp4') return '.m4a';
  if (type === 'audio/m4a') return '.m4a';
  if (type === 'video/mp4') return '.mp4';
  if (type === 'video/quicktime') return '.mov';
  if (type === 'video/webm') return '.webm';
  if (type === 'application/pdf') return '.pdf';
  if (type === 'application/zip') return '.zip';
  if (type === 'application/msword') return '.doc';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
  if (type === 'application/vnd.ms-excel') return '.xls';
  if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
  if (type === 'application/vnd.ms-powerpoint') return '.ppt';
  if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx';
  if (type === 'text/plain') return '.txt';
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

export async function validateDownloadUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  if (isPrivateIp(parsed.hostname)) return false;
  if (ZALO_CDN_PATTERNS.some(p => p.test(parsed.hostname))) return true;
  console.warn(`[zalo] Download blocked: ${parsed.hostname} is not a known Zalo CDN host`);
  return false;
}

const MAX_REDIRECTS = 5;

export async function downloadMedia(url, { messageId, maxBytes = DEFAULT_MAX_BYTES, fallbackExt = '.bin', _redirectCount = 0 } = {}) {
  if (!url) return null;
  if (_redirectCount > MAX_REDIRECTS) {
    console.warn(`[zalo] Download blocked: too many redirects for ${messageId}`);
    return null;
  }

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
      if (!location) {
        console.warn(`[zalo] Download redirect missing Location header`);
        return null;
      }
      const resolved = new URL(location, url).href;
      if (!await validateDownloadUrl(resolved)) {
        console.warn(`[zalo] Download redirect blocked: ${resolved}`);
        return null;
      }
      return downloadMedia(resolved, { messageId, maxBytes, fallbackExt, _redirectCount: _redirectCount + 1 });
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      throw new Error(`media exceeds ${maxBytes} bytes`);
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new Error(`media exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }

    const contentType = response.headers.get('content-type') || '';
    const ext = extensionFromContentType(contentType) || extensionFromUrl(url) || fallbackExt;
    const filePath = path.join(MEDIA_DIR, `${safeName(messageId)}${ext}`);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.concat(chunks));
    fs.renameSync(tmpPath, filePath);
    return { path: filePath, contentType, size: total };
  } finally {
    clearTimeout(timer);
  }
}

export function downloadImage(url, options = {}) {
  return downloadMedia(url, { fallbackExt: '.img', ...options });
}

const DEFAULT_MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function cleanupOldMedia(maxAgeMs = DEFAULT_MEDIA_MAX_AGE_MS) {
  if (!fs.existsSync(MEDIA_DIR)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  try {
    for (const file of fs.readdirSync(MEDIA_DIR)) {
      if (file.endsWith('.tmp')) continue;
      const filePath = path.join(MEDIA_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch {}
    }
  } catch {}
  if (removed > 0) console.log(`[zalo] Media cleanup: removed ${removed} files older than ${Math.round(maxAgeMs / 86400000)}d`);
  return removed;
}
