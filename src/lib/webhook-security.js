import crypto from 'node:crypto';

export function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = crypto.createHash('sha256').update(a).digest();
  const bBuf = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function createDeduper({ ttlMs = 5 * 60 * 1000, maxSize = 1000, sweepIntervalMs = 30_000 } = {}) {
  const seen = new Map();
  let lastSwept = 0;

  function sweep(now) {
    for (const [key, timestamp] of seen) {
      if (now - timestamp > ttlMs) seen.delete(key);
    }
    while (seen.size > maxSize) {
      seen.delete(seen.keys().next().value);
    }
  }

  return {
    isDuplicate(key, now = Date.now()) {
      if (!key) return false;
      if (now - lastSwept >= sweepIntervalMs || seen.size > maxSize) {
        sweep(now);
        lastSwept = now;
      }
      if (seen.has(key)) return true;
      seen.set(key, now);
      while (seen.size > maxSize) {
        seen.delete(seen.keys().next().value);
      }
      return false;
    },
    size() {
      return seen.size;
    }
  };
}

export function createRateLimiter({ windowMs = 60_000, max = 120, maxKeys = 500 } = {}) {
  const buckets = new Map();

  function sweep(now) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt > windowMs) buckets.delete(key);
    }
    while (buckets.size > maxKeys) {
      buckets.delete(buckets.keys().next().value);
    }
  }

  return {
    allow(key = 'unknown', now = Date.now()) {
      sweep(now);
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.startedAt > windowMs) {
        buckets.set(key, { startedAt: now, count: 1 });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= max;
    },
    size() {
      return buckets.size;
    }
  };
}

export function getUpdateDedupKey(update) {
  if (!update || typeof update !== 'object') return null;
  const message = update.message || {};
  const sender = update.sender || message.from || {};
  const chat = message.chat || {};
  const eventName = update.event_name || 'event';
  if (update.update_id !== undefined && update.update_id !== null) {
    return `${eventName}:update:${update.update_id}`;
  }
  const messageId = message.msg_id ?? message.message_id;
  if (messageId === undefined || messageId === null) return null;
  const chatId = chat.id || message.chat_id;
  if (chatId) return `${eventName}:chat:${chatId}:${messageId}`;
  if (sender.id) return `${eventName}:sender:${sender.id}:${messageId}`;
  return null;
}
