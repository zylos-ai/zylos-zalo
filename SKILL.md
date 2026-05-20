---
name: zalo
version: 0.1.0
description: >-
  Zalo Bot Platform communication channel (polling + webhook modes).
  Use when: (1) replying to Zalo messages (DM),
  (2) sending proactive messages to Zalo users,
  (3) managing DM access control (dmPolicy: open/allowlist/owner, dmAllowFrom list),
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

## Config Location

- Config: `~/zylos/components/zalo/config.json`
- Logs: `~/zylos/components/zalo/logs/`

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
