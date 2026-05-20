---
name: zalo
version: 0.1.0
description: >
  Zalo Bot Platform communication channel for Vietnamese messaging. Use when ...
  (Include trigger patterns: what user requests should activate this component)
type: communication  # communication | capability | utility

lifecycle:
  npm: true
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
    - data/

# For HTTP services exposed through Zylos Caddy, prefer a root-internal app:
# - The component listens on localhost and serves internal routes at /.
# - Caddy exposes it at /zalo/*, strips that prefix, and forwards
#   X-Forwarded-Prefix. Browser URLs should be relative by default and should
#   use X-Forwarded-Prefix when present.
# http_routes:
#   - path: /zalo/*
#     type: reverse_proxy
#     target: localhost:3000
#     strip_prefix: /zalo

upgrade:
  repo: zylos-ai/zylos-zalo
  branch: main

config:
  required:
    # Values are collected by zylos and passed to lifecycle.hooks.configure as stdin JSON.
    # The configure hook decides how to store them in config.json.
    # - name: ZALO_API_KEY
    #   description: API key for zalo
    #   sensitive: true
  optional:
    # - name: ZALO_DEBUG
    #   description: Enable debug mode
    #   default: "false"

dependencies: []
---

# Zalo

```bash
# Example usage commands here
```

Run `node ~/zylos/.claude/skills/zalo/scripts/<script>.js --help` for all options.
