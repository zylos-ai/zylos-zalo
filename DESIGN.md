# zylos-zalo Design Document

**Version**: 0.1.0
**Date**: 2026-05-20
**Repository**: https://github.com/zylos-ai/zylos-zalo

---

## 1. Overview

Zalo Bot Platform communication channel for Zylos Agent. Connects the Zylos agent to Vietnam's Zalo messaging platform via the official Bot Platform API.

## 2. Architecture

### 2.1 Component Structure

```
zylos-zalo/
  src/
    index.js           — Main entry (polling/webhook, message handling, typing)
    lib/
      api.js           — Zalo Bot Platform API client
      config.js        — Config loader
      auth.js          — Owner binding + access control
      context.js       — Chat history + message formatting
  scripts/
    send.js            — C4 outbound send interface
  hooks/
    configure.js       — Writes collected config to config.json
    post-install.js    — Creates data directories
    post-upgrade.js    — Config schema migrations
    pre-upgrade.js     — Config backup before upgrade
```

### 2.2 Data Flow

**Inbound (User -> Agent):**
1. Zalo delivers update via polling (`getUpdates`) or webhook push
2. `handleUpdate()` dispatches by `event_name`
3. Message handler checks auth (owner binding, DM policy)
4. Starts typing indicator
5. Formats message and sends to C4 via `c4-receive.js`
6. C4 dispatches to Claude

**Outbound (Agent -> User):**
1. Claude calls `c4-send.js "zalo" "<endpoint>"`
2. C4 routes to `scripts/send.js`
3. `send.js` calls Zalo `sendMessage` API, chunking if > 2000 chars
4. Writes `.done` marker to stop typing indicator
5. Records outgoing message to internal server for history

### 2.3 Delivery Modes

| Mode | Config | URL Required | Use Case |
|------|--------|-------------|----------|
| Polling | `"delivery": "polling"` | No | Development, behind firewalls |
| Webhook | `"delivery": "webhook"` | Yes (HTTPS) | Production |

On startup, polling mode deletes any existing webhook. Webhook mode registers via `setWebhook` and cleans up on shutdown.

## 3. Configuration

Located at `~/zylos/components/zalo/config.json`:

```json
{
  "enabled": true,
  "botToken": "numeric_id:secret",
  "delivery": "polling",
  "dmPolicy": "owner",
  "dmAllowFrom": [],
  "webhookUrl": null,
  "webhookSecret": null,
  "webhookPath": "/zalo/webhook",
  "message": {
    "context_messages": 5,
    "maxLength": 2000
  },
  "internal_port": 3462
}
```

## 4. API Surface

Base: `https://bot-api.zaloplatforms.com/bot{TOKEN}/{method}`

All calls are POST with JSON body. Methods used:

| Method | Purpose |
|--------|---------|
| `getMe` | Validate token at startup |
| `sendMessage` | Send text to chat |
| `sendPhoto` | Send image to chat |
| `sendChatAction` | Typing indicator |
| `getUpdates` | Long poll for updates |
| `setWebhook` | Register webhook URL |
| `deleteWebhook` | Remove webhook |

## 5. Security

- Bot token stored in `config.json` (data dir, never committed)
- Webhook requests verified via `X-Bot-Api-Secret-Token` header
- Internal HTTP server (record-outgoing) uses SHA-256 token derived from bot token
- Internal server binds to 127.0.0.1 only (polling mode) or validates token (webhook mode)

## 6. Limitations

- Zalo Bot Platform groups are not reliably supported — DM only for now
- `getUpdates` returns a single update per call (unlike Telegram's array)
- Text messages capped at 2000 characters (chunked by send.js)
- No official quote-reply support in Zalo Bot API
