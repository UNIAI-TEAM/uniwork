# CLAUDE.md

Guidance for Claude Code in this repository. This is the DRAFT written at the
start of the usf base port; the authoritative version lands with the phase-6
plan. Everything below is already true today — do not add aspirational rules
here.

**Spec:** `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`

## Project Shape

UniWork is an AI-native Work OS for Vietnamese teams: tasks, meetings,
documents and workflows co-owned by people and agents.

- `server/` — Go backend: Chi router, pgx, sqlc, gorilla/websocket.
- `apps/web/` — Next.js App Router. The only place Next.js APIs may be used.
- `packages/core/` — headless logic: API client, React Query hooks, stores.
- `packages/ui/` — atomic UI primitives only.
- `packages/views/` — shared business screens.
- `packages/tsconfig/`, `packages/eslint-config/` — shared config.
- `e2e/` — Playwright.

Shared packages export raw `.ts` / `.tsx`, compiled by the consuming app.
Dependency direction is `views -> core + ui`; `core` and `ui` stay independent
of each other.

## Package Boundaries

These are lint errors, not conventions. `pnpm lint` fails on any of them:

- `packages/core/` — no `react-dom`, no `localStorage` / `sessionStorage`, no
  `process.env`. Endpoint origins arrive through
  `configureRuntime()` in `packages/core/runtime-config.ts`, which
  `apps/web/platform/runtime-config.ts` — the one module allowed to read the
  environment — calls at boot.
- `packages/ui/` — no `@uniwork/core` imports, no business logic.
- `packages/views/` — no `next/*`, no `react-router-dom`.
- Production code may not import a devDependency
  (`import-x/no-extraneous-dependencies`). An undeclared package does not
  resolve under pnpm's strict layout, so tsc already rejects that case.
- Every JSX text node in `packages/views/` goes through the translation hook
  (`i18next/no-literal-string`).

Shared dependency versions are pinned once in the `catalog:` block of
`pnpm-workspace.yaml`. Do not write a version number in a package manifest for
anything the catalog already covers.

## State Rules

- TanStack Query owns server state: tasks, meetings, workspaces, members,
  organizations, invitations. Query keys come from the `*Keys` factories next
  to each hook, and workspace-scoped keys always include the workspace id.
- Zustand owns client state (`packages/core/auth/store.ts`, `navigation/`,
  `modals/`). Stores live in `packages/core/`, never in views or apps.
- WebSocket events invalidate Query keys (`realtime/use-realtime-sync.ts`);
  the frame payload is never written into a query or a store — the cache is
  refreshed from the API. A test pins this.
- Optimistic updates only where the outcome is locally predictable, the user
  stays on the same screen, and rollback is a cache restore (task
  status/position on the board). Create, delete and anything that navigates
  await the server.

## API Compatibility

- `packages/core/api/http.ts` returns `unknown`; only `api/endpoints/*` may
  shape a response, through `parseWithFallback` with a zod schema and a
  fallback. Nothing outside `api/` calls the transport.
- Response schemas are lenient (enums as `z.string()`); the exported types
  narrow them, so every switch over a server enum carries a `default`.
- Every endpoint has a malformed-response test proving it degrades instead
  of throwing. Login, register and complete-onboarding are the deliberate
  exceptions that still fail loudly.

## Design Tokens

`packages/ui/styles/tokens.css` is the single source: the `--uw-*` palette, the
semantic slot layer over it, and the Tailwind `@theme inline` mapping.

- Use semantic classes (`bg-background`, `text-muted-foreground`); never
  hardcode a colour.
- Font sizes come from the role-named `--text-*` scale (`text-caption`,
  `text-body`, `text-title`, …). Tailwind's default `text-sm` / `text-base`
  ramp is not in use.
- **Every themed token must be declared in both `:root` and `.dark`**, and
  writing it as `var(--uw-something)` does not exempt it. Custom properties are
  computed and then inherited, so a slot declared only on `:root` resolves the
  var() there and carries the light value into every `.dark` subtree — UniWork
  scopes dark mode to subtrees (the onboarding rail is a dark panel inside a
  light page), so this is not theoretical. `packages/ui/styles/tokens.test.ts`
  enforces it.
- Every colour change is verified in both modes. The gate is
  `e2e/onboarding-contrast.spec.ts`, which measures contrast on the rendered
  page — reading the token values is not verification.
- The `--uw-*` aliases and `--color-text-secondary` are transitional and get
  removed once the frontend rebuild finishes. Write new code against the
  semantic slots.
- Add primitives with `pnpm ui:add <name>` rather than writing them by hand.

## Database and Migration Rules

Applied forward-only from migration `005`; migrations `001`–`004` predate these
rules and are not rewritten. `server/migrations/lint_test.go` enforces both on
every file past the legacy range, and the runner applies files outside a
transaction so concurrent index builds are possible.

- No `FOREIGN KEY` / `REFERENCES`, no cascading deletes or updates. Resolve
  relationships and dependent cleanup in application code, inside a transaction
  when parent and cleanup must commit together.
- Every index uses `CREATE INDEX CONCURRENTLY` or
  `CREATE UNIQUE INDEX CONCURRENTLY`, including on new tables. PostgreSQL
  rejects concurrent index builds inside a transaction or a multi-command
  string, so each one gets its own single-statement migration file.

## Commands

```bash
make dev              # db-up + migrate + server + web
make test             # Go tests
make e2e              # Playwright (needs make dev running)
pnpm typecheck
pnpm test
pnpm lint
pnpm ui:add <name>    # add a shadcn primitive into packages/ui
```

## Coding Rules

- TypeScript strict mode; keep types explicit.
- Go follows `gofmt`, `go vet`, checked errors.
- **Code comments in English.** Spec and plan documents are in Vietnamese.
- Prefer existing patterns over new parallel abstractions.
- Do not claim verification passed unless you ran it. If you skipped checks,
  say so.
