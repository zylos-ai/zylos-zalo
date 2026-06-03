/**
 * Zalo Bot Platform API client
 *
 * Wraps Zalo Bot Platform endpoints.
 * All methods are POST with JSON body. URL pattern: /bot{TOKEN}/{method}
 */

import { isPrivateIp } from './ip.js';

const DEFAULT_ZALO_API_BASE = 'https://bot-api.zaloplatforms.com';
const DEFAULT_TIMEOUT = 30000;
const POLLING_BUFFER = 5000;

let apiBaseUrl = DEFAULT_ZALO_API_BASE;

export class ZaloApiError extends Error {
  constructor(message, code, response, { status = null, method = null } = {}) {
    super(message);
    this.name = 'ZaloApiError';
    this.code = code;
    this.response = response;
    this.status = status;
    this.method = method;
  }

  get isPollingTimeout() {
    return this.code === 408;
  }
}

function truncate(value, maxLength = 500) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

async function parseApiResponse(resp, method) {
  const raw = await resp.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (!resp.ok) {
      throw new ZaloApiError(
        `HTTP ${resp.status}: ${truncate(raw)}`,
        resp.status,
        { raw: truncate(raw) },
        { status: resp.status, method }
      );
    }
    throw new ZaloApiError(
      `Invalid JSON response from Zalo API: ${err.message}`,
      resp.status || 0,
      { raw: truncate(raw) },
      { status: resp.status, method }
    );
  }
}

function apiErrorMessage(data, status) {
  return data?.description
    || data?.error_description
    || data?.message
    || data?.error?.message
    || `API error ${status}`;
}

function apiErrorCode(data, status) {
  return data?.error_code
    ?? data?.code
    ?? data?.error?.code
    ?? status;
}

export function setApiBaseUrl(baseUrl) {
  if (!baseUrl) {
    apiBaseUrl = DEFAULT_ZALO_API_BASE;
    return;
  }
  const parsed = new URL(baseUrl);
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol === 'http:' && !isLoopback) {
    throw new ZaloApiError('Zalo API base URL must use HTTPS for non-loopback targets', 0, null);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ZaloApiError('Zalo API base URL must use HTTP or HTTPS', 0, null);
  }
  apiBaseUrl = parsed.href.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}

if (process.env.ZALO_API_BASE) {
  setApiBaseUrl(process.env.ZALO_API_BASE);
}

async function apiCall(token, method, body = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const url = `${apiBaseUrl}/bot${token}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);

    const data = await parseApiResponse(resp, method);
    if (!resp.ok || data.error_code || data.ok === false) {
      const code = apiErrorCode(data, resp.status);
      throw new ZaloApiError(
        apiErrorMessage(data, resp.status),
        code,
        data,
        { status: resp.status, method }
      );
    }
    return data.result !== undefined ? data.result : data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof ZaloApiError) throw err;
    if (err.name === 'AbortError') {
      throw new ZaloApiError('Request timeout', 408, null, { method });
    }
    throw new ZaloApiError(err.message, 0, null, { method });
  }
}

function validatePhotoUrl(photoUrl) {
  let parsed;
  try {
    parsed = new URL(photoUrl);
  } catch {
    throw new ZaloApiError('Zalo photo URL must be an absolute HTTP or HTTPS URL', 0, null);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ZaloApiError('Zalo photo URL must use HTTP or HTTPS', 0, null);
  }
  if (isPrivateIp(parsed.hostname)) {
    throw new ZaloApiError('Zalo photo URL must not target private or loopback IPs', 0, null);
  }
}

export function getMe(token) {
  return apiCall(token, 'getMe');
}

export function sendMessage(token, chatId, text) {
  return apiCall(token, 'sendMessage', { chat_id: chatId, text });
}

export function sendPhoto(token, chatId, photoUrl) {
  validatePhotoUrl(photoUrl);
  return apiCall(token, 'sendPhoto', { chat_id: chatId, photo: photoUrl });
}

export function sendSticker(token, chatId, sticker) {
  if (!sticker) {
    throw new ZaloApiError('Zalo sticker id is required', 0, null);
  }
  return apiCall(token, 'sendSticker', { chat_id: chatId, sticker });
}

export function sendChatAction(token, chatId, action = 'typing') {
  return apiCall(token, 'sendChatAction', { chat_id: chatId, action }, 5000);
}

export function getUpdates(token, offset, timeoutSec = 10, limit = 100) {
  const httpTimeout = (timeoutSec * 1000) + POLLING_BUFFER;
  return apiCall(token, 'getUpdates', {
    offset,
    timeout: timeoutSec,
    limit
  }, httpTimeout);
}

export function setWebhook(token, url, secretToken) {
  const body = { url };
  if (secretToken) body.secret_token = secretToken;
  return apiCall(token, 'setWebhook', body);
}

export function deleteWebhook(token) {
  return apiCall(token, 'deleteWebhook', {}, 5000);
}

export function getWebhookInfo(token) {
  return apiCall(token, 'getWebhookInfo');
}
