---
name: zalo
version: 0.1.4
description: >-
  Zalo Bot Platform communication channel (polling + webhook modes).
  Use when: (1) replying to Zalo messages (DM or allowed group),
  (2) sending proactive messages or media (images, stickers) to Zalo users or groups,
  (3) managing DM access control (dmPolicy: open/allowlist/owner, dmAllowFrom list),
  (4) managing group access control (groupPolicy, per-group allowFrom),
  (5) configuring the bot (admin CLI, delivery mode, webhook settings),
  (6) troubleshooting Zalo bot connection or polling issues.
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
    - media/

upgrade:
  repo: zylos-ai/zylos-zalo
  branch: main

config:
  required:
    - name: ZALO_BOT_TOKEN
      description: "Zalo Bot Platform token (numeric_id:secret format, from bot.zaloplatforms.com)"
      sensitive: true

http_routes:
  - path: /zalo/webhook
    target: http://localhost:3464
    type: reverse_proxy
    description: "Zalo Bot webhook endpoint (webhook delivery mode only)"

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

## Media Messages

```bash
# Send image (requires public HTTP(S) URL)
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo" "<chat_id>"
[MEDIA:image]https://example.com/photo.jpg
EOF

# Send sticker
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo" "<chat_id>"
[MEDIA:sticker]<sticker_id>
EOF
```

Inbound Zalo image events are automatically downloaded to `media/` and forwarded
to C4 as file attachments. The default max image size is 10 MB and can be
adjusted with `message.mediaMaxMb` in config.

## Config Location

- Config: `~/zylos/components/zalo/config.json`
- Logs: `~/zylos/components/zalo/logs/`
- Inbound media: `~/zylos/components/zalo/media/`

## Environment Variables

Required in `~/zylos/.env`:

```bash
# Zalo Bot Platform token (required, from bot.zaloplatforms.com)
ZALO_BOT_TOKEN=123456789:abc123secret
```

Alternatively, set `botToken` directly in `config.json` (takes precedence over
the env variable when both are present).

## Delivery Modes

**Polling (default):** No public URL needed. Set `"delivery": "polling"` in config.

**Webhook (production):** Caddy terminates HTTPS and proxies `/zalo/webhook` to
the local webhook listener on `webhookPort` (default 3464). The internal
record-outgoing API runs on a separate `internal_port` (default 3462, localhost
only).

```json
{
  "delivery": "webhook",
  "webhookUrl": "https://your-domain.com/zalo/webhook",
  "webhookSecret": "your-secret",
  "webhookPath": "/zalo/webhook",
  "webhookPort": 3464
}
```

Webhook mode verifies the secret with timing-safe comparison, rate-limits
requests, and ignores duplicate event/chat/message ids during the configured
dedup window. `webhookSecret` is required in webhook mode.

## Service Management

```bash
pm2 status zylos-zalo    # Check status
pm2 logs zylos-zalo      # View logs
pm2 restart zylos-zalo   # Restart service
```

## Owner

First user to send a private message becomes the owner (admin).
Owner bypasses DM policy and per-group allowlist checks. However,
`groupPolicy: disabled` blocks all group messages, including from the owner.

Owner info stored in config.json:
```json
{
  "owner": {
    "bound": true,
    "id": "xxx",
    "name": "User Name"
  }
}
```

## Access Control

DM and group access are controlled by independent policies:

```json
{
  "dmPolicy": "owner",
  "dmAllowFrom": ["user_id_1"],
  "groupPolicy": "allowlist",
  "groups": { ... }
}
```

**Private DM (dmPolicy):**
1. Owner? → always allowed
2. `dmPolicy` = `open`? → anyone can DM
3. `dmPolicy` = `owner`? → only owner can DM
4. `dmPolicy` = `allowlist`? → check `dmAllowFrom` list; not in list → dropped

**Group message (groupPolicy):**
1. `groupPolicy` = `disabled`? → all group messages dropped (including owner)
2. `groupPolicy` = `open`? → respond from any group
3. `groupPolicy` = `allowlist`? → only configured groups; unlisted groups → dropped
4. Per-group `allowFrom` set? → only listed senders pass (owner always bypasses)
5. `allowFrom: ["*"]` → all group members allowed

**Key points:**
- Owner bypasses allowlist checks only; `groupPolicy: disabled` blocks all group messages, including from owner
- `dmPolicy` and `groupPolicy` are fully independent — changing one never affects the other
- No user-level whitelist for groups; use per-group `allowFrom` to restrict senders

### Groups Config Format

Groups are stored in a map keyed by group chat id:

```json
{
  "groupPolicy": "allowlist",
  "groups": {
    "123456789": {
      "name": "Team Chat",
      "allowFrom": ["*"],
      "historyLimit": 5,
      "added_at": "2026-01-01T00:00:00Z"
    }
  }
}
```

- `allowFrom`: List of user IDs. `["*"]` = all group members allowed. Empty/absent = all allowed.
- `historyLimit`: Per-group context message limit (overrides `message.context_messages`)

## Admin CLI

Manage bot configuration via `admin.js`:

```bash
ADM="node ~/zylos/.claude/skills/zalo/scripts/admin.js"

# General
$ADM show                                    # Show full config (token masked)
$ADM show-owner                              # Show current owner
$ADM help                                    # Show all commands

# DM Access Control
$ADM set-dm-policy <open|allowlist|owner>     # Set DM policy
$ADM list-dm-allow                            # Show DM policy + allowFrom list
$ADM add-dm-allow <user_id>                   # Add user to dmAllowFrom
$ADM remove-dm-allow <user_id>                # Remove user from dmAllowFrom

# Bot Settings
$ADM set-delivery <polling|webhook>           # Switch delivery mode
```

After changes, restart: `pm2 restart zylos-zalo`

## Group Context

When responding in groups, the bot includes recent message context so Claude
understands the conversation. Context is retrieved from logged messages since
the last response.

Configuration in `config.json`:
```json
{
  "message": {
    "context_messages": 10
  }
}
```

Chat logs rotate at `logging.maxLogBytes` (default 512 KB). Inbound media is
deleted after `retention.mediaMaxAgeDays` (default 7 days), with cleanup at
startup and every 6 hours.

Message logs are stored in `~/zylos/components/zalo/logs/<chat_id>.log`.
