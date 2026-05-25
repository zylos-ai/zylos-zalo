/**
 * Zalo Bot Platform API client
 *
 * Wraps Zalo Bot Platform endpoints.
 * All methods are POST with JSON body. URL pattern: /bot{TOKEN}/{method}
 */

const DEFAULT_ZALO_API_BASE = 'https://bot-api.zaloplatforms.com';
const DEFAULT_TIMEOUT = 30000;
const POLLING_BUFFER = 5000;

let apiBaseUrl = process.env.ZALO_API_BASE || DEFAULT_ZALO_API_BASE;

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

export class ZaloApiError extends Error {
  constructor(message, code, response) {
    super(message);
    this.name = 'ZaloApiError';
    this.code = code;
    this.response = response;
  }

  get isPollingTimeout() {
    return this.code === 408;
  }
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

    const data = await resp.json();
    if (!resp.ok || data.error_code) {
      throw new ZaloApiError(
        data.description || `API error ${resp.status}`,
        data.error_code || resp.status,
        data
      );
    }
    return data.result !== undefined ? data.result : data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof ZaloApiError) throw err;
    if (err.name === 'AbortError') {
      throw new ZaloApiError('Request timeout', 408, null);
    }
    throw new ZaloApiError(err.message, 0, null);
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
