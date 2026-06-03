<p align="center">
  <img src="./assets/logo.png" alt="Zylos" height="120">
</p>

<h1 align="center">zylos-zalo</h1>

> **Zylos** (/ˈzaɪ.lɒs/ 赛洛丝) — Give your AI a life

<p align="center">
  Zalo Bot Platform messaging component for <a href="https://github.com/zylos-ai/zylos-core">Zylos</a> agents.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js"></a>
  <a href="https://discord.gg/GS2J39EGff"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/ZylosAI"><img src="https://img.shields.io/badge/X-follow-000000?logo=x&logoColor=white" alt="X"></a>
  <a href="https://zylos.ai"><img src="https://img.shields.io/badge/website-zylos.ai-blue" alt="Website"></a>
  <a href="https://coco.xyz"><img src="https://img.shields.io/badge/Built%20by-Coco-orange" alt="Built by Coco"></a>
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a>
</p>

---

- **Chat on Zalo** — your AI agent lives in Zalo, supporting private and group conversations
- **Dual delivery modes** — long polling (no public URL needed) or webhook for production (see [note](#webhook-mode))
- **Zero-config start** — first message auto-binds you as admin, no setup wizards
- **Access control** — owner, allowlist, open, and pairing-based DM policies
- **Media support** — send images/stickers and receive photos, files, voice, video, GIFs, links, locations, and typing indicators
- **Voice transcription** — local or OpenAI API transcription for inbound voice messages
- **Operator diagnostics** — `doctor` checks token validity, delivery/webhook state, owner binding, and local permissions
- **Zero npm dependencies** — uses only Node.js built-in APIs

## Getting Started

Tell your Zylos agent:

> "Install the zalo component"

Or use the CLI:

```bash
zylos add zalo
```

Zylos will guide you through the setup, including obtaining a bot token from [bot.zaloplatforms.com](https://bot.zaloplatforms.com). Once installed, message your bot on Zalo — the first user to interact becomes the admin.

## Managing the Bot

Just tell your Zylos agent what you need:

| Task | Example |
|------|---------|
| Add user to allowlist | "Add user xxx to zalo allowlist" |
| Change DM policy | "Set zalo DM policy to open" |
| Approve a DM request | "Approve Zalo DM user xxx" |
| Set DM welcome | "Set Zalo DM welcome to hello" |
| Check status | "Show zalo bot status" |
| Run diagnostics | "Run Zalo doctor" |
| Switch to webhook | "Switch zalo to webhook mode" |
| Restart bot | "Restart zalo bot" |
| Upgrade | "Upgrade zalo component" |
| Uninstall | "Uninstall zalo component" |

Or manage via CLI:

```bash
zylos upgrade zalo
zylos uninstall zalo
```

## Group Chat Behavior

| Scenario | Bot Response |
|----------|--------------|
| Private chat (owner/allowlisted) | Responds via Claude |
| Private chat (`dmPolicy: pairing`) | Unknown sender is queued for owner approval |
| Allowed group message | Receives with context |
| Owner in any allowed group | Always responds |
| `groupPolicy: disabled` | All group messages blocked |
| Unknown user | Ignored |

## Webhook Mode

Webhook delivery mode requires your app to be reviewed and approved by Zalo before they will deliver events to your endpoint. Until approved, **use polling mode** (the default) — it works out of the box with no public URL or Zalo approval needed.

## Voice Messages

Inbound voice messages can be transcribed when `voiceTranscription` is `auto`,
`local`, or `api`. Local mode uses `~/zylos/bin/transcribe`, `whisper-cli`, or
`whisper` with `WHISPER_MODEL`/`whisperModel`; API mode requires
`OPENAI_API_KEY`. Set `voiceTranscription` to `disabled` to forward voice
placeholders without transcription.

On the official Zalo Bot Platform, voice notes are delivered as unsupported
message events with metadata only and no audio URL. Those messages cannot be
transcribed yet; authorized users receive a friendly fallback asking them to
type the message instead.

## Documentation

- [SKILL.md](./SKILL.md) — Component specification
- [DESIGN.md](./DESIGN.md) — Architecture and design
- [CHANGELOG.md](./CHANGELOG.md) — Version history

## Contributing

See [Contributing Guide](https://github.com/zylos-ai/.github/blob/main/CONTRIBUTING.md).

## Built by Coco

Zylos is the open-source core of [Coco](https://coco.xyz/) — the AI employee platform.

We built Zylos because we needed it ourselves: reliable infrastructure to keep AI agents running 24/7 on real work. Every component is battle-tested in production at Coco, serving teams that depend on their AI employees every day.

Want a managed experience? [Coco](https://coco.xyz/) gives you a ready-to-work AI employee — persistent memory, multi-channel communication, and skill packages — deployed in 5 minutes.

## License

[MIT](./LICENSE)
