<p align="center">
  <img src="./assets/logo.png" alt="Zylos" height="120">
</p>

<h1 align="center">zylos-zalo</h1>

<p align="center">
  <a href="https://github.com/zylos-ai/zylos-core">Zylos</a> 智能体的 Zalo 通讯组件。
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
  <a href="./README.md">English</a>
</p>

---

- **Zalo 对话** — 你的 AI 智能体接入 Zalo，支持私聊和群聊
- **双投递模式** — 长轮询（无需公网 URL）或 Webhook（生产环境，详见[说明](#webhook-模式)）
- **零配置启动** — 第一条消息自动绑定为管理员，无需繁琐设置
- **媒体支持** — 收发图片、贴纸，支持输入状态指示
- **零 npm 依赖** — 仅使用 Node.js 内置 API

## 快速开始

告诉你的 Zylos 智能体：

> "安装 zalo 组件"

或使用 CLI：

```bash
zylos add zalo
```

Zylos 会引导你完成设置，包括从 [bot.zaloplatforms.com](https://bot.zaloplatforms.com) 获取 Bot Token。安装完成后，在 Zalo 上给机器人发消息 — 第一个交互的用户自动成为管理员。

## 管理机器人

直接告诉你的 Zylos 智能体：

| 操作 | 示例 |
|------|------|
| 添加白名单用户 | "把用户 xxx 加入 Zalo 白名单" |
| 修改 DM 策略 | "把 Zalo DM 策略设为 open" |
| 查看状态 | "看下 Zalo 机器人状态" |
| 切换到 Webhook | "把 Zalo 切换到 webhook 模式" |
| 重启机器人 | "重启 Zalo 机器人" |
| 升级组件 | "升级 Zalo 组件" |
| 卸载组件 | "卸载 Zalo 组件" |

或通过 CLI 管理：

```bash
zylos upgrade zalo
zylos uninstall zalo
```

## 群聊行为

| 场景 | 机器人响应 |
|------|-----------|
| 私聊（管理员/白名单） | 通过 Claude 回复 |
| 允许的群组消息 | 带上下文接收 |
| 管理员在允许的群组 | 始终回复 |
| `groupPolicy: disabled` | 所有群消息屏蔽 |
| 未知用户 | 忽略 |

## Webhook 模式

Webhook 投递模式需要你的应用通过 Zalo 审核和批准后，Zalo 才会向你的端点推送事件。在通过审核之前，请**使用轮询模式**（默认模式）— 开箱即用，无需公网 URL，也无需 Zalo 审核。

## 文档

- [SKILL.md](./SKILL.md) — 组件规格说明
- [DESIGN.md](./DESIGN.md) — 架构与设计
- [CHANGELOG.md](./CHANGELOG.md) — 版本历史

## 参与贡献

请查看[贡献指南](https://github.com/zylos-ai/.github/blob/main/CONTRIBUTING.md)。

## 由 Coco 构建

Zylos 是 [Coco](https://coco.xyz/)（AI 员工平台）的开源核心基础设施。

我们构建 Zylos 是因为我们自己需要它：可靠的基础设施，让 AI 智能体 24/7 稳定运行。每个组件都在 Coco 生产环境中经过实战检验，服务于每天依赖 AI 员工的团队。

想要开箱即用？[Coco](https://coco.xyz/) 提供即开即用的 AI 员工——持久记忆、多渠道沟通、技能包——5 分钟完成部署。

## 许可证

[MIT](./LICENSE)
