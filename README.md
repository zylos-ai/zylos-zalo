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
  "delivery": "polling",
  "dmPolicy": "owner"
}
```

Get your bot token from [bot.zaloplatforms.com](https://bot.zaloplatforms.com).

### Webhook mode (production)

```json
{
  "delivery": "webhook",
  "webhookUrl": "https://your-domain.com/zalo/webhook",
  "webhookSecret": "your-secret"
}
```

## Usage

Send messages via C4 bridge:

```bash
cat <<'EOF' | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "zalo" "<chat_id>"
Hello from Zylos!
EOF
```

## Service Management

```bash
pm2 status zylos-zalo
pm2 logs zylos-zalo
pm2 restart zylos-zalo
```

## Built by Coco

Zylos is the open-source core of [Coco](https://coco.xyz/) — the AI employee platform.

## License

[MIT](./LICENSE)
