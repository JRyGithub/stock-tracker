# Stock Tracker

A personal stock-following app: watchlist, holdings, live quotes and web sentiment trends. It's also a learning project built with production habits.

- Architecture and decisions: [spec.md](spec.md)
- Phased delivery plan: [docs/ROADMAP.md](docs/ROADMAP.md)
- Decision records: [docs/adr/](docs/adr/)
- Rules for AI agents and contributors: [AGENTS.md](AGENTS.md) (Claude Code also loads it via `CLAUDE.md`; workflow skills live in `.claude/skills/`)

## Layout

| Path | What |
|---|---|
| `web/` | TanStack Start app (SPA mode). Phase 1 |
| `server/` | Fastify API. Phase 1 |
| `worker/` | pg-boss jobs. Phase 7 |
| `packages/types/` | Shared zod schemas and TypeScript types |
| `infra/` | Terraform. Phase 1 |

## Prerequisites

- Node 24 (`nvm use`)
- pnpm via corepack (`corepack enable`); the version is pinned in `package.json`
- Docker (Docker Desktop with WSL integration enabled, on Windows)

## Common commands

```bash
pnpm install          # install all workspaces
pnpm check            # lint + format check + typecheck + tests (what CI runs)
pnpm test             # tests only
pnpm format           # apply prettier
pnpm db:up            # start local Postgres (docker compose), waits until healthy
pnpm db:down          # stop it (data is kept in a named volume)
```

Shared packages are consumed as TypeScript source (`exports` points at `src/index.ts`), so they need no build step in development.
