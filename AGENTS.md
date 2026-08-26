# Repository Guidelines

This file provides guidance to AI agents when working with code in this repository.

> **Single source of truth:** This file is a concise pointer document.
> All authoritative architecture, coding rules, and conventions live in
> **CLAUDE.md** at the project root; naming, the vi–en glossary and the
> Vietnamese voice guide live in **docs/conventions.md**. Read those first.
> Use `make help`, `package.json`, and `pnpm-workspace.yaml` as the source of
> truth for the full command list.

## Quick Reference

### Architecture

Go backend + pnpm/Turborepo monorepo frontend with shared packages.

- `server/` — Go: Chi router, pgx + sqlc, gorilla/websocket, Redis relay, Prometheus
- `apps/web/` — Next.js App Router; `apps/web/platform/` is the only place Next.js APIs are used
- `packages/core/` — headless logic: API endpoints, React Query hooks, Zustand stores, realtime, permissions, paths, i18n
- `packages/ui/` — atomic primitives (shadcn/Base UI) and design tokens; zero business logic
- `packages/views/` — shared screens and the navigation adapter
- `packages/tsconfig/`, `packages/eslint-config/` — shared config
- `e2e/` — Playwright

### State Management (critical)

- **React Query** owns all server state; keys come from the `<feature>Keys` factories and always carry the workspace id
- **Zustand** owns client state (auth session, navigation, modals); stores live in `packages/core/` only
- WebSocket events invalidate Query keys; the payload is never written into a store or a query
- Optimistic updates only for locally predictable, same-screen, trivially-rolled-back patches (task board)

### Package Boundaries (lint errors, not conventions)

- `packages/core/` — no `react-dom`, no `localStorage`, no `process.env`
- `packages/ui/` — no `@uniwork/core` imports
- `packages/views/` — no `next/*`, no `react-router-dom`; use `useNavigation()` / `<AppLink>`
- Only `packages/core/api/endpoints/` shapes API responses, through `parseWithFallback`

### Database Migrations (hard rules, enforced by `server/migrations/lint_test.go` from 005 on)

- No database foreign keys or cascading actions; relationships and cleanup live in service code
- Every index is `CREATE [UNIQUE] INDEX CONCURRENTLY`, alone in its own single-statement migration file

### Commands

```bash
make dev              # bootstrap + start everything
make check            # full verification pipeline (ends with Playwright)
pnpm typecheck        # TypeScript
pnpm test             # TS unit tests (Vitest)
make test-go          # Go tests (gofmt, vet, staticcheck, -race)
make worktree-env     # isolated DB + ports for a git worktree
```

See CLAUDE.md for the authoritative rules and the full command list.
