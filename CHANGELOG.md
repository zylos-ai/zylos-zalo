# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
