---
name: zalo
version: 0.1.1
description: >-
  Zalo Bot Platform communication channel (polling + webhook modes).
  Use when: (1) replying to Zalo messages (DM or allowed group),
  (2) sending proactive messages to Zalo users or groups,
  (3) managing DM/group access control (dmPolicy, dmAllowFrom, groupPolicy, groups),
  (4) configuring the bot (delivery mode, webhook settings),
  (5) troubleshooting Zalo bot connection issues.
  Config at ~/zylos/components/zalo/config.json. Service: pm2 zylos-zalo.
type: communication

lifecycle:
  npm: false
  service:
    type: pm2
    name: zylos-zalo
    entry: src/index.js
  data_dir: ~/zylos/components/zalo
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - logs/
    - data/

upgrade:
  repo: zylos-ai/zylos-zalo
  branch: main

config:
  required:
    - name: ZALO_BOT_TOKEN
      description: "Zalo Bot Platform token (numeric_id:secret format, from bot.zaloplatforms.com)"
      sensitive: true

dependencies:
  - comm-bridge
---

# Zalo Bot

Zalo Bot Platform messaging component for Zylos Agent.

Depends on: comm-bridge (C4 message routing).

## Sending Messages

Via C4 Bridge (always use stdin form):
```bash
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo" "<chat_id>"
message
EOF
```

Or directly (for testing):
```bash
node ~/zylos/.claude/skills/zalo/scripts/send.js <chat_id> "message"
```

## Admin CLI

```bash
node ~/zylos/.claude/skills/zalo/scripts/admin.js show               # Config (token masked)
node ~/zylos/.claude/skills/zalo/scripts/admin.js set-dm-policy open  # DM policy
node ~/zylos/.claude/skills/zalo/scripts/admin.js add-dm-allow <id>   # Allowlist add
node ~/zylos/.claude/skills/zalo/scripts/admin.js show-owner          # Owner info
node ~/zylos/.claude/skills/zalo/scripts/admin.js help                # All commands
```

## Config Location

- Config: `~/zylos/components/zalo/config.json`
- Logs: `~/zylos/components/zalo/logs/`
- Inbound media: `~/zylos/components/zalo/media/`

If `botToken` is omitted from config, the component falls back to
`ZALO_BOT_TOKEN` from `~/zylos/.env`, matching the Telegram component's env
token pattern. There is no tokenFile support.

Set `apiBaseUrl` only when a deployment needs a non-default Zalo Bot API host.

## Group Access

Groups are accepted when `groupPolicy` is `open` or the group id appears under
`groups`. Per-group `allowFrom` may contain `*` or specific sender ids; the
owner bypasses per-group allowlists but not `groupPolicy: disabled`, which is
absolute.

```json
{
  "groupPolicy": "allowlist",
  "groups": {
    "123456789": {
      "name": "Team Chat",
      "mode": "mention",
      "allowFrom": ["*"],
      "historyLimit": 5
    }
  }
}
```

Webhook mode verifies the secret with timing-safe comparison, rate-limits
requests, and ignores duplicate event/chat/message ids during the configured
dedup window. `webhookSecret` is required in webhook mode.

Inbound Zalo image events are downloaded to `media/` and forwarded to C4 as file
attachments. The default max image size is 10 MB and can be adjusted with
`message.mediaMaxMb`.

## Delivery Modes

**Polling (default):** No public URL needed. Set `"delivery": "polling"` in config.

**Webhook:** Set in config:
```json
{
  "delivery": "webhook",
  "webhookUrl": "https://your-domain.com/zalo/webhook",
  "webhookSecret": "your-secret",
  "webhookPath": "/zalo/webhook"
}
```

## Service Management

```bash
pm2 status zylos-zalo
pm2 logs zylos-zalo
pm2 restart zylos-zalo
```

## Outbound Images

`[MEDIA:image]` currently requires a public HTTP(S) image URL. Local file
hosting is the concrete remaining implementation path: expose selected local
files through a short-lived tokenized HTTPS route on the webhook server, then
pass that URL to Zalo `sendPhoto`.

## Outbound Stickers

```bash
node ~/zylos/.claude/skills/zalo/scripts/send.js <chat_id> "[MEDIA:sticker]<sticker_id>"
```

Inbound sticker events are forwarded as text markers. The Bot Platform wrapper
does not currently implement quote replies; outbound replies are plain messages
until the quote-reply API contract is verified.
