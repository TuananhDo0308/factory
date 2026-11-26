# Software Factory

Factory-style control plane web app (`shadcn/ui` + Next.js 16 + SQLite/Prisma) and CLI/daemon (`sf`) for tracking, orchestrating, and steering multi-agent Factory runs across [`../antigravity/`](../antigravity/) and [`../claude/`](../claude/).

## Stack

- **Framework**: Next.js 16 (App Router, React 19, TypeScript)
- **UI**: `shadcn/ui` (`base-nova`, `lucide-react`, Tailwind CSS v4, `Geist` + `Geist Mono`)
- **Database**: SQLite (WAL) via Prisma 7 + `@prisma/adapter-libsql`
- **Real-time**: Server-Sent Events (`/api/stream`) + `sf daemon` local bridge & file watcher

## Quick Start

```bash
pnpm install
pnpm db:generate && pnpm db:push
pnpm dev        # http://localhost:8787 (Local Single-User mode enabled by default)
```

## CLI & Local Daemon (`sf`)

```bash
# Authenticate CLI against local server (create token in Settings -> API Keys)
node cli/sf.ts login --url http://localhost:8787 --token <sf_token>

# Start background daemon (watches live.js/runs.js/lessons.js + executes Web commands)
node cli/sf.ts daemon

# Expose local Context Lake over MCP (stdio)
node cli/sf.ts mcp
```
