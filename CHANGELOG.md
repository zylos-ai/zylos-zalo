# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Updated component docs to match the v0.1.4 runtime surface, including admin commands, DM pairing, DM welcome, voice transcription, owner fields, receipt output, and diagnostics.
- Added `dm-pairing.json`, `seen-dm-users.json`, and `.owner-bound` to lifecycle preserve metadata so upgrades keep pairing state, first-contact welcome state, and durable owner-binding evidence.

## [0.1.4] - 2026-06-02

### Added
- First-contact DM welcome message with `set-dm-welcome` / `show-dm-welcome` / `clear-dm-welcome` admin commands (#2).
- Inbound file/document receive and forwarding to C4 (#2).
- Voice message transcription (speech-to-text) for inbound audio (#2).
- Operator `doctor` diagnostics command: token validity via `getMe`, webhook/delivery sanity, owner binding, and config/data-dir permission checks (#3).
- Structured outbound delivery receipts from `send.js` — a parseable `RECEIPT {status,type,chatId,correlationId,messageIds,chunks?,error?,ts}` line for C4 correlation (#4).
- DM pairing policy (`dmPolicy: "pairing"`): unknown senders are queued for owner approval; new `dm-pending` / `dm-approve` / `dm-deny` admin commands and C4 owner notification (#5).

## [0.1.3] - 2026-05-27

### Fixed
- False-positive ownership guard on fresh installs: `hasPriorOwnership()` treated PM2-created log files as evidence of prior ownership, causing permanent crash-loop when `config.json` was missing.

## [0.1.2] - 2026-05-26

### Added
- `logging.maxLogBytes` and `retention.mediaMaxAgeDays` in DEFAULT_CONFIG with documented defaults (512 KB, 7 days).
- Managed webhook route metadata (`type: reverse_proxy`) for Caddy integration.
- Default `webhookPort: 3464` separating public webhook listener from internal API.

### Changed
- Removed stale group `mode` field from docs, config examples, and `addGroup()` — the Zalo Bot Platform does not expose group-mode capabilities.
- `next-steps` frontmatter cleared of roadmap items.

### Fixed
- Managed webhook route declaration missing `type: reverse_proxy`, causing `zylos add` to generate no usable Caddy route.
- Webhook route target pointed to internal API port instead of webhook listener port.

### Security
- Durable owner marker (`.owner-bound`) written on owner binding; fail-closed on missing/malformed config with prior ownership evidence.
- CDN-only media download policy: only known Zalo CDN hosts allowed, eliminating DNS rebinding SSRF.
- HTTPS enforcement for custom API base URLs (loopback exempted).
- IPv6 SSRF coverage: full fe80::/10 link-local range, IPv4-mapped IPv6, bracket handling.
- Bounded redirect hops (5), bounded port retry (5 attempts), bounded log/media retention.
- C4 delivery failure notification to user instead of silent message loss.

## [0.1.1] - 2026-05-21

### Added
- Admin CLI (`scripts/admin.js`) for managing DM policy, allowlists, delivery mode, and owner info without editing config.json directly.
- Inbound image download to component media storage with C4 file attachment forwarding.
- Group chat routing and access control using `groupPolicy`, configured groups, per-group `allowFrom`, and group history replay.
- `ZALO_BOT_TOKEN` fallback from `~/zylos/.env` when `botToken` is omitted from config.
- Comprehensive Node test suite (35 tests) for API, auth, config, context, media, hooks, webhook security, and send script behavior.
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

### Security
- Timing-safe hash comparison for bot token authentication (prevents timing attacks).
- Internal token endpoint uses timing-safe comparison.
- `send.js` reads message from stdin to prevent shell injection via CLI arguments.
- Webhook endpoint requires `webhookSecret` — unauthenticated public webhooks rejected at startup.
- Sticker event handling hardened to prevent unexpected payload crashes.

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
