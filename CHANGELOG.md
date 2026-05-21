# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Inbound image download to component media storage with C4 file attachment forwarding.
- Group chat routing and access control using `groupPolicy`, configured groups, per-group `allowFrom`, and group history replay.
- `ZALO_BOT_TOKEN` fallback from `~/zylos/.env` when `botToken` is omitted from config.
- Comprehensive Node test suite for API, auth, config, context, media, hooks, and send script behavior.
- Webhook timing-safe secret comparison, replay deduplication, and fixed-window rate limiting.
- Configurable Zalo Bot API base URL via `apiBaseUrl`.
- Outbound sticker sending with `[MEDIA:sticker]`.
- Inbound sticker event forwarding.

### Changed
- Outbound `[MEDIA:image]` now requires a public HTTP(S) URL instead of accepting local paths that Zalo cannot fetch directly.
- `sendPhoto` validates that photo values are absolute HTTP(S) URLs before posting to Zalo.
- Outbound text now strips Markdown and chunks long messages on paragraph breaks before line/space fallback.
- Polling now requests a numeric 10-second timeout with `limit: 100`.
- `send.js` now reads stdin before CLI message arguments for C4-safe message delivery.
- Webhook mode now requires `webhookSecret`; public unauthenticated webhooks are rejected at startup.

## [0.1.0] - 2026-05-20

### Added
- Zalo Bot Platform API client (getMe, sendMessage, sendPhoto, sendChatAction, getUpdates, setWebhook, deleteWebhook)
- Dual delivery modes: long polling (default) and webhook
- DM access control: owner auto-binding, dmPolicy (owner/allowlist/open), dmAllowFrom list
- Typing indicators via sendChatAction with file-watcher-based stop mechanism
- Chat history logging with JSONL per-chat files and cold-start replay
- C4 bridge integration with structured message formatting
- Internal HTTP server for recording outgoing messages
- C4 send.js interface with message chunking (2000 char limit)
- Graceful shutdown with webhook cleanup
- Zero npm dependencies

### Upgrade Notes

Initial release. Install with:

```bash
zylos add zalo
```
