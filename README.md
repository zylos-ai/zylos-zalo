<p align="center">
  <img src="./assets/logo.png" alt="Zylos" height="120">
</p>

<h1 align="center">zylos-zalo</h1>

<p align="center">
  Zalo Bot Platform communication channel for Zylos Agent
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://discord.gg/GS2J39EGff"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/ZylosAI"><img src="https://img.shields.io/badge/X-follow-000000?logo=x&logoColor=white" alt="X"></a>
  <a href="https://zylos.ai"><img src="https://img.shields.io/badge/website-zylos.ai-blue" alt="Website"></a>
  <a href="https://coco.xyz"><img src="https://img.shields.io/badge/Built%20by-Coco-orange" alt="Built by Coco"></a>
</p>

---

- **Dual delivery modes** — Long polling (default, no public URL needed) and webhook (production)
- **DM access control** — Owner auto-binding, allowlist, open, or owner-only policies
- **Group routing** — Allowlisted group chats with per-group sender allowlists and replayed context
- **Inbound image download** — Downloads received Zalo images into component media storage and forwards them to C4 as file attachments
- **Sticker support** — Forwards inbound stickers and sends outbound stickers
- **Webhook hardening** — Timing-safe secret checks, request rate limiting, and short-window replay deduplication
- **Outbound formatting** — Markdown is flattened before sending, long messages split on paragraphs, and stickers are supported
- **Typing indicators** — Sends `sendChatAction` while waiting for agent response
- **C4 bridge integration** — Full message routing through the Zylos communication bridge
- **Zero npm dependencies** — Uses only Node.js built-in APIs

## Install

```bash
zylos add zalo
```

Or manually:

```bash
cd ~/zylos/.claude/skills
git clone https://github.com/zylos-ai/zylos-zalo.git zalo
cd zalo
```

## Configuration

Edit `~/zylos/components/zalo/config.json`:

```json
{
  "enabled": true,
  "botToken": "YOUR_BOT_TOKEN",
  "apiBaseUrl": "https://bot-api.zaloplatforms.com",
  "delivery": "polling",
  "dmPolicy": "owner"
}
```

Get your bot token from [bot.zaloplatforms.com](https://bot.zaloplatforms.com).

Alternatively, set `ZALO_BOT_TOKEN` in `~/zylos/.env`. A token in `config.json`
takes precedence when both are present.

### Group chats

Groups are disabled by default unless `groupPolicy` is set to `open` or the
group chat is present in `groups`:

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

Set `allowFrom` to specific Zalo user IDs to restrict which group members may
trigger the agent. The owner bypasses per-group allowlists but not
`groupPolicy: disabled`, which is absolute.

### Webhook mode (production)

```json
{
  "delivery": "webhook",
  "webhookUrl": "https://your-domain.com/zalo/webhook",
  "webhookSecret": "your-secret",
  "webhookPort": 3464
}
```

Caddy terminates HTTPS and proxies `/zalo/webhook` to the local webhook listener
on `webhookPort` (default 3464). The internal API runs separately on
`internal_port` (default 3462, localhost only).

## Usage

Send messages via C4 bridge:

```bash
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo" "<chat_id>"
Hello from Zylos!
EOF
```

Outbound images must use a public image URL:

```bash
node scripts/send.js "<chat_id>" "[MEDIA:image]https://example.com/image.png"
```

Local outbound image files are not hosted automatically yet. The concrete path
for that is a short-lived HTTPS media route on the component's webhook server
that exposes local files as tokenized public URLs before calling Zalo
`sendPhoto`.

The Bot Platform API wrapper does not implement quote replies. C4 endpoint
message ids are preserved for correlation, but outbound replies are sent as
plain messages until a verified Bot Platform quote-reply contract exists.

## Admin CLI

Manage configuration without editing JSON directly:

```bash
node scripts/admin.js help                        # Show all commands
node scripts/admin.js show                        # Show config (token masked)
node scripts/admin.js set-dm-policy allowlist      # Set DM policy
node scripts/admin.js add-dm-allow <user_id>       # Add user to allowlist
node scripts/admin.js set-delivery webhook         # Switch delivery mode
node scripts/admin.js show-owner                   # Show bound owner
```

After changes, restart the service: `pm2 restart zylos-zalo`

## Service Management

```bash
pm2 status zylos-zalo
pm2 logs zylos-zalo
pm2 restart zylos-zalo
```

## Tests

```bash
npm test
```

The suite uses Node's built-in test runner and covers API payload/error
handling, access control, config/env loading, context formatting/history,
inbound media download, webhook security helpers, lifecycle hooks, and the C4
send script.

## Built by Coco

Zylos is the open-source core of [Coco](https://coco.xyz/) — the AI employee platform.

## License

[MIT](./LICENSE)
