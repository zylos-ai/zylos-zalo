# CLAUDE.md

Development guidelines for zylos-zalo.

## Project Conventions

- **ESM only** — Use `import`/`export`, never `require()`. All files use ES Modules (`"type": "module"` in package.json)
- **Node.js 20+** — Minimum runtime version
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **No `files` in package.json** — Rely on `.gitignore` to exclude unnecessary files. Use `.npmignore` if publishing to npm
- **Secrets in `.env` only** — Never commit secrets. Use `~/zylos/.env` for credentials, `config.json` for non-sensitive runtime config
- **English for code** — Comments, commit messages, PR descriptions, and documentation in English

## Release Process

When releasing a new version, **all four files** must be updated in the same commit:

1. **`package.json`** — Bump `version` field
2. **`package-lock.json`** — Run `npm install` after bumping package.json to sync the lock file
3. **`SKILL.md`** — Update `version` in YAML frontmatter to match package.json
4. **`CHANGELOG.md`** — Add new version entry following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format

Version bump commit message: `chore: bump version to X.Y.Z`

After merge, create a GitHub Release with tag `vX.Y.Z` from the merge commit.

## Architecture

This is a **communication component** for the Zylos agent ecosystem.

- `src/index.js` — Main entry point (polling + webhook delivery modes)
- `src/lib/api.js` — Zalo Bot Platform API wrapper
- `src/lib/auth.js` — Owner binding + DM/group access control
- `src/lib/config.js` — Config loader with env fallback
- `src/lib/context.js` — Group chat context management
- `src/lib/media.js` — Inbound image download and media handling
- `src/lib/webhook-security.js` — Timing-safe secret verification, rate limiting, replay dedup
- `scripts/admin.js` — Admin CLI (DM policy, delivery mode, owner info)
- `scripts/send.js` — C4 outbound message interface
- `hooks/` — Lifecycle hooks (configure, post-install, pre-upgrade, post-upgrade)
- `ecosystem.config.cjs` — PM2 service config (CommonJS required by PM2)

See [DESIGN.md](./DESIGN.md) for full architecture documentation.
