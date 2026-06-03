/**
 * Outbound image preflight and public rehost helpers.
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateIp } from './ip.js';

const DEFAULT_TTL_HOURS = 24;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

function cleanBaseUrl(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function configuredMedia(config) {
  return config?.media || config?.outboundMedia || {};
}

function derivePublicBaseUrl(config) {
  const media = configuredMedia(config);
  if (media.publicBaseUrl) return cleanBaseUrl(media.publicBaseUrl);
  if (config?.webhookUrl) {
    try {
      return `${new URL(config.webhookUrl).origin}/public/media`;
    } catch {}
  }
  if (process.env.DOMAIN) return `https://${process.env.DOMAIN}/public/media`;
  return null;
}

function resolvePublicDir(config) {
  const media = configuredMedia(config);
  return media.publicDir || path.join(process.env.HOME, 'zylos/http/public/media');
}

function mediaMaxBytes(config) {
  const media = configuredMedia(config);
  const mb = Number(media.maxMb || media.rehostMaxMb || media.preflightMaxMb || config?.message?.mediaMaxMb || 10);
  return Math.max(1, mb) * 1024 * 1024;
}

function ttlMs(config) {
  const media = configuredMedia(config);
  const hours = Number(media.ttlHours || media.publicTtlHours || DEFAULT_TTL_HOURS);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function parseRemoteUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed;
  } catch {}
  return null;
}

async function requirePublicHttpsUrl(raw) {
  const parsed = parseRemoteUrl(raw);
  if (!parsed) throw new Error('Zalo photo URL must be an absolute HTTPS URL or a local image path');
  if (parsed.protocol !== 'https:') throw new Error('Zalo photo URL must use HTTPS');
  if (isPrivateIp(parsed.hostname)) throw new Error('Zalo photo URL must not target private or loopback IPs');
  if (!net.isIP(parsed.hostname)) {
    let addresses;
    try {
      addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    } catch (err) {
      throw new Error(`Zalo photo URL host could not be resolved: ${err.message}`);
    }
    const blocked = addresses.find(({ address }) => isPrivateIp(address));
    if (blocked) {
      throw new Error(`Zalo photo URL host resolves to a private or loopback IP (${blocked.address})`);
    }
  }
  return parsed;
}

function contentTypeBase(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function contentTypeFromExtension(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  if (normalized === '.png') return 'image/png';
  if (normalized === '.gif') return 'image/gif';
  if (normalized === '.webp') return 'image/webp';
  return '';
}

function extensionFromContentType(contentType) {
  const type = contentTypeBase(contentType);
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  return '';
}

function extensionFromPathOrUrl(value) {
  try {
    const parsed = parseRemoteUrl(value);
    const pathname = parsed ? parsed.pathname : value;
    const ext = path.extname(pathname);
    if (/^\.(jpe?g|png|gif|webp)$/i.test(ext)) return ext.toLowerCase() === '.jpeg' ? '.jpg' : ext.toLowerCase();
  } catch {}
  return '';
}

function imageTypeFromMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return 'image/png';
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

function detectImageType({ headerType, buffer, fallbackExt }) {
  const header = contentTypeBase(headerType);
  if (header.startsWith('image/')) return header;
  const magic = imageTypeFromMagic(buffer);
  if (magic) return magic;
  const fallback = contentTypeFromExtension(fallbackExt);
  if (fallback) return fallback;
  return '';
}

function resolveLocalPath(raw) {
  if (String(raw || '').startsWith('file://')) {
    return fileURLToPath(raw);
  }
  return path.resolve(String(raw || ''));
}

function publicConfig(config) {
  const publicBaseUrl = derivePublicBaseUrl(config);
  if (!publicBaseUrl) {
    throw new Error('Outbound image rehost requires media.publicBaseUrl or webhookUrl/DOMAIN to derive https://<domain>/public/media');
  }
  const parsed = new URL(publicBaseUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Outbound image rehost publicBaseUrl must use HTTPS');
  }
  if (!parsed.pathname.includes('/public/')) {
    throw new Error('Outbound image rehost publicBaseUrl must include the /public/ path prefix');
  }
  return {
    publicBaseUrl,
    publicDir: resolvePublicDir(config)
  };
}

function publicName(ext) {
  return `zalo-${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
}

function writePublicImage(buffer, { contentType, source, config }) {
  const { publicBaseUrl, publicDir } = publicConfig(config);
  const fallbackExt = extensionFromPathOrUrl(source);
  const ext = extensionFromContentType(contentType) || fallbackExt || '.jpg';
  fs.mkdirSync(publicDir, { recursive: true, mode: 0o755 });
  const name = publicName(ext);
  const filePath = path.join(publicDir, name);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, buffer, { mode: 0o644 });
  fs.renameSync(tmpPath, filePath);
  return {
    url: `${publicBaseUrl}/${encodeURIComponent(name)}`,
    path: filePath,
    contentType,
    size: buffer.length
  };
}

function getHeader(headers, name) {
  return headers?.get?.(name) || '';
}

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  await requirePublicHttpsUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function guardedFetch(url, init = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, redirectCount = 0, purpose = 'image fetch' } = {}) {
  if (redirectCount > MAX_REDIRECTS) throw new Error(`${purpose} failed: too many redirects`);
  const parsed = await requirePublicHttpsUrl(url);
  let response;
  try {
    response = await fetchWithTimeout(parsed.href, { ...init, redirect: 'manual' }, timeoutMs);
  } catch (err) {
    throw new Error(`${purpose} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
  }
  if (response.status >= 300 && response.status < 400) {
    const location = getHeader(response.headers, 'location');
    if (!location) throw new Error(`${purpose} failed: redirect missing Location`);
    const nextUrl = new URL(location, parsed.href).href;
    return guardedFetch(nextUrl, init, { timeoutMs, redirectCount: redirectCount + 1, purpose });
  }
  return { response, url: parsed.href };
}

async function readSmallResponse(response, maxBytes = 4096) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    chunks.push(buf);
    if (total >= maxBytes) break;
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

async function rangeProbeImage(url, { config, purpose = 'image preflight' } = {}) {
  const maxBytes = mediaMaxBytes(config);
  const { response } = await guardedFetch(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-63' }
  }, { purpose });
  if (!response.ok) throw new Error(`${purpose} failed: HTTP ${response.status}`);
  const length = Number(getHeader(response.headers, 'content-length') || 0);
  if (length > maxBytes) throw new Error(`${purpose} failed: media exceeds ${maxBytes} bytes`);
  const buffer = await readSmallResponse(response, 4096);
  const fallbackExt = extensionFromPathOrUrl(url);
  const contentType = detectImageType({
    headerType: getHeader(response.headers, 'content-type'),
    buffer,
    fallbackExt
  });
  if (!contentType) throw new Error(`${purpose} failed: content is not a supported image type`);
  return { contentType, size: length || null };
}

export async function preflightImageUrl(url, { config } = {}) {
  const maxBytes = mediaMaxBytes(config);
  const { response, url: finalUrl } = await guardedFetch(url, { method: 'HEAD' }, { purpose: 'image preflight' });
  if (response.status === 405 || response.status === 501) {
    const probed = await rangeProbeImage(finalUrl, { config });
    return { url: finalUrl, ...probed };
  }
  if (!response.ok) throw new Error(`image preflight failed: HTTP ${response.status}`);
  const contentType = contentTypeBase(getHeader(response.headers, 'content-type'));
  const length = Number(getHeader(response.headers, 'content-length') || 0);
  if (length > maxBytes) throw new Error(`image preflight failed: media exceeds ${maxBytes} bytes`);
  if (contentType.startsWith('image/')) {
    return { url: finalUrl, contentType, size: length || null };
  }
  if (contentType === 'application/octet-stream' || !contentType) {
    const probed = await rangeProbeImage(finalUrl, { config });
    return { url: finalUrl, ...probed };
  }
  throw new Error(`image preflight failed: content-type ${contentType || 'missing'} is not image/*`);
}

async function readRemoteImage(url, { config, _redirectCount = 0 } = {}) {
  if (_redirectCount > 5) throw new Error('image rehost failed: too many redirects');
  const parsed = await requirePublicHttpsUrl(url);
  const maxBytes = mediaMaxBytes(config);
  const { response, url: finalUrl } = await guardedFetch(parsed.href, { method: 'GET' }, {
    purpose: 'image rehost',
    redirectCount: _redirectCount
  });
  if (response.status >= 300 && response.status < 400) {
    const location = getHeader(response.headers, 'location');
    if (!location) throw new Error('image rehost failed: redirect missing Location');
    return readRemoteImage(new URL(location, parsed.href).href, { config, _redirectCount: _redirectCount + 1 });
  }
  if (!response.ok) throw new Error(`image rehost failed: HTTP ${response.status}`);

  const length = Number(getHeader(response.headers, 'content-length') || 0);
  if (length > maxBytes) throw new Error(`image rehost failed: media exceeds ${maxBytes} bytes`);

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error(`image rehost failed: media exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  const buffer = Buffer.concat(chunks);
  const fallbackExt = extensionFromPathOrUrl(finalUrl);
  const contentType = detectImageType({
    headerType: getHeader(response.headers, 'content-type'),
    buffer,
    fallbackExt
  });
  if (!contentType) throw new Error('image rehost failed: content is not a supported image type');
  return { buffer, contentType };
}

function readLocalImage(raw, { config } = {}) {
  const filePath = resolveLocalPath(raw);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`local image not found: ${raw}`);
  }
  if (!stat.isFile()) throw new Error(`local image is not a file: ${raw}`);
  const maxBytes = mediaMaxBytes(config);
  if (stat.size > maxBytes) throw new Error(`local image exceeds ${maxBytes} bytes`);
  const buffer = fs.readFileSync(filePath);
  const fallbackExt = extensionFromPathOrUrl(filePath);
  const contentType = detectImageType({ buffer, fallbackExt });
  if (!contentType) throw new Error('local image is not a supported image type');
  return { buffer, contentType };
}

export function cleanupPublicMedia(config) {
  const publicDir = resolvePublicDir(config);
  if (!fs.existsSync(publicDir)) return 0;
  const cutoff = Date.now() - ttlMs(config);
  let removed = 0;
  for (const name of fs.readdirSync(publicDir)) {
    if (!name.startsWith('zalo-') || name.endsWith('.tmp')) continue;
    const filePath = path.join(publicDir, name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    } catch {}
  }
  if (removed > 0) console.log(`[zalo] Outbound media cleanup: removed ${removed} expired public files`);
  return removed;
}

async function selfVerifyHostedImage(hosted, { config } = {}) {
  try {
    await preflightImageUrl(hosted.url, { config });
  } catch (err) {
    try { fs.unlinkSync(hosted.path); } catch {}
    throw new Error(`hosted image self-check failed for ${hosted.url}: ${err.message}`);
  }
}

export async function resolveOutboundImage(raw, { config } = {}) {
  const source = String(raw || '').trim();
  if (!source) throw new Error('Image URL or local path is required');
  cleanupPublicMedia(config);

  const remote = parseRemoteUrl(source);
  if (remote) {
    try {
      await preflightImageUrl(remote.href, { config });
      return { url: remote.href, hosted: false };
    } catch (preflightError) {
      const { buffer, contentType } = await readRemoteImage(remote.href, { config });
      const hosted = writePublicImage(buffer, { contentType, source: remote.href, config });
      await selfVerifyHostedImage(hosted, { config });
      return { ...hosted, hosted: true, reason: preflightError.message };
    }
  }

  const { buffer, contentType } = readLocalImage(source, { config });
  const hosted = writePublicImage(buffer, { contentType, source, config });
  await selfVerifyHostedImage(hosted, { config });
  return { ...hosted, hosted: true, reason: 'local file rehosted' };
}
