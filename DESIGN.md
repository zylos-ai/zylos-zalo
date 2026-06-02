# zylos-zalo Design Document

**Version**: 0.1.4
**Date**: 2026-06-02
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
      dm-pairing.js    — DM pairing queue and owner notification text
      dm-welcome.js    — First-contact DM welcome tracking
      doctor.js        — Operator diagnostics
      transcribe.js    — Voice transcription provider selection
  scripts/
    admin.js           — Admin CLI for config management
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
  "owner": {
    "user_id": null,
    "name": null,
    "bound_at": null
  },
  "delivery": "polling",
  "dmPolicy": "owner",
  "dmAllowFrom": [],
  "dmWelcomeMessage": "",
  "voiceTranscription": "auto",
  "whisperModel": "",
  "groupPolicy": "allowlist",
  "groups": {},
  "apiBaseUrl": null,
  "webhookUrl": null,
  "webhookSecret": null,
  "webhookPath": "/zalo/webhook",
  "webhook": {
    "dedupWindowMs": 300000,
    "dedupMaxEntries": 1000,
    "rateLimitWindowMs": 60000,
    "rateLimitMax": 120
  },
  "message": {
    "context_messages": 5,
    "maxLength": 2000,
    "mediaMaxMb": 10
  },
  "logging": {
    "maxLogBytes": 524288
  },
  "retention": {
    "mediaMaxAgeDays": 7
  },
  "internal_port": 3462,
  "webhookPort": 3464
}
```

If `botToken` is omitted, the component falls back to `ZALO_BOT_TOKEN` from
`~/zylos/.env`.

`voiceTranscription` accepts `auto`, `local`, `api`, or `disabled`.
Local transcription uses `~/zylos/bin/transcribe` first, then `whisper-cli` or
`whisper` when `whisperModel` or `WHISPER_MODEL` is configured. API
transcription uses `OPENAI_API_KEY`.

## 4. API Surface

Default base: `https://bot-api.zaloplatforms.com/bot{TOKEN}/{method}`.
Set `apiBaseUrl` if the deployment needs another Zalo Bot API host.

All calls are POST with JSON body. Methods used:

| Method | Purpose |
|--------|---------|
| `getMe` | Validate token at startup |
| `sendMessage` | Send text to chat |
| `sendPhoto` | Send image to chat |
| `sendSticker` | Send sticker to chat |
| `sendChatAction` | Typing indicator |
| `getUpdates` | Long poll for updates |
| `setWebhook` | Register webhook URL |
| `deleteWebhook` | Remove webhook |
| `getWebhookInfo` | Doctor/webhook verification |

## 5. Security

- Bot token stored in `config.json` or `ZALO_BOT_TOKEN` in `~/zylos/.env`
- Owner binding stores `owner.user_id`, `owner.name`, and `owner.bound_at` in
  `config.json`, and writes `.owner-bound` as durable prior-ownership evidence
  so upgrade/config-loss cases fail closed instead of rebinding silently.
- Webhook mode requires `webhookSecret`; requests are verified via
  `X-Bot-Api-Secret-Token` header with timing-safe comparison
- Webhook mode applies fixed-window request rate limiting and 5-minute replay
  deduplication by event/chat/message id
- Internal HTTP server (record-outgoing) uses a random token generated at
  each service startup, stored in `.internal-token` (mode `0600`) under the
  component data directory. The effective internal port is stored alongside
  it in `.internal-endpoint.json` (mode `0600`). Both files are cleaned up
  on shutdown.
- Internal server binds to `127.0.0.1` in both polling and webhook modes.
  The public webhook server has no `/internal/*` routes.
- `webhookPort` controls the public webhook listener; `internal_port`
  controls the localhost internal API. If both resolve to the same port,
  the internal server auto-shifts to `internal_port + 1`.
- Group messages require `groupPolicy: "open"` or a configured group entry;
  configured groups may restrict senders with `allowFrom`
- `dmPolicy: "pairing"` records unknown DM users in `dm-pairing.json` and asks
  the owner to approve or deny through the admin CLI.

## 6. Admin CLI

`scripts/admin.js` provides config management without editing JSON directly:

| Command | Purpose |
|---------|---------|
| `show` | Display config (token masked) |
| `set-dm-policy <open\|allowlist\|owner\|pairing>` | Set DM access policy |
| `list-dm-allow` | Show DM policy and allowFrom list |
| `add-dm-allow <user_id>` | Add user to DM allowlist |
| `remove-dm-allow <user_id>` | Remove user from DM allowlist |
| `set-dm-welcome <message>` | Set first-contact DM welcome message |
| `show-dm-welcome` | Show first-contact DM welcome message |
| `clear-dm-welcome` | Disable first-contact DM welcome message |
| `dm-pending` | List pending DM pairing requests |
| `dm-approve <user_id>` | Approve pending DM access and add to `dmAllowFrom` |
| `dm-deny <user_id> [reason]` | Deny pending DM access |
| `set-delivery <polling\|webhook>` | Switch delivery mode |
| `show-owner` | Show bound owner |
| `doctor` | Run token, delivery, webhook, owner, and permission diagnostics |
| `help` | Show usage |

## 7. Limitations

- Outbound local image files are not hosted automatically yet; outbound images
  require a public HTTP(S) URL
- Polling currently expects `getUpdates` to return a single update; array
  normalization is tracked for a follow-up hardening PR
- Text messages capped at 2000 characters (chunked by send.js)
- No verified quote-reply support in the Zalo Bot Platform API wrapper yet;
  outbound replies are sent as plain messages while preserving C4 correlation
  ids
