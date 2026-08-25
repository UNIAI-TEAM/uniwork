# CLAUDE.md

Guidance for Claude Code when working in this repository. Keep this file short
and authoritative: rules here are the ones that are hard to infer from code or
easy to get wrong. Every rule below is enforced by a command, a test, or a lint
rule named next to it; if you find one that is not, fix the rule or the file.

## Conventions

The source of truth for code naming, the vi–en i18n glossary, and the
Vietnamese voice guide is `docs/conventions.md`. Read it before naming a
route/package/file/DB column/type, before editing
`packages/core/i18n/locales/`, and before writing Vietnamese UI copy.

## Project Shape

UniWork is an AI-native Work OS for Vietnamese teams (10–1,000 people):
tasks, meetings, documents and workflows co-owned by people and agents.
Product intent and design principles live in `PRODUCT.md`.

- `server/` — Go backend: Chi router, pgx + sqlc, gorilla/websocket, Redis
  relay, Prometheus metrics. Layers: `internal/handler` → `internal/service`
  → `pkg/db`.
- `apps/web/` — Next.js App Router. `apps/web/platform/` is the only place
  Next.js APIs (router, env) are touched.
- `packages/core/` — headless logic: API endpoints, React Query hooks,
  Zustand stores, realtime sync, permissions, paths, i18n.
- `packages/ui/` — atomic primitives (shadcn/Base UI registry) and design tokens.
- `packages/views/` — shared business screens and the navigation adapter.
- `packages/tsconfig/`, `packages/eslint-config/` — shared config.
- `e2e/` — Playwright.

Shared packages export raw `.ts` / `.tsx`, compiled by the consuming app.
Dependency direction is `views -> core + ui`; `core` and `ui` stay independent.
Web is the only host today; the adapters (`NavigationAdapter`,
`StorageAdapter`, `CoreProvider`) exist so a desktop or mobile host can be
added without rewriting `views`.

## State Rules

Keep server state and client state separate.

- TanStack Query owns server state: tasks, meetings, workspaces, members,
  organizations, invitations. Query keys come from the `<feature>Keys`
  factories beside each hook; workspace-scoped keys always include the
  workspace id. Hooks that need a workspace take `wsId` as a parameter.
- Zustand owns client state: `packages/core/auth/store.ts`,
  `packages/core/navigation/store.ts`, `packages/core/modals/store.ts`.
  Stores live in `packages/core/`, never in `views` or apps.
- Only the auth store and `api/endpoints/*` talk to the transport. Every
  other server interaction is a query or a mutation.
- WebSocket events invalidate Query keys (`packages/core/realtime/use-realtime-sync.ts`).
  The frame payload is never written into a query or a store — the cache is
  refreshed from the API. `use-realtime-sync.test.tsx` pins this.
- Optimistic updates only when ALL hold: the outcome is locally predictable,
  the user stays on the same screen, failure is rare, rollback is a cache
  restore. Canonical: task status/position on the board
  (`packages/core/tasks/hooks.ts`). Create, delete and anything that
  navigates await the server.
- Zustand selectors return stable references (`useShallow` for objects).

## Package Boundaries

These are lint errors (`pnpm lint`), not conventions:

- `packages/core/` — no `react-dom`, no `localStorage` / `sessionStorage`
  (use `StorageAdapter` from `platform/`), no `process.env`. Endpoint origins
  arrive through `configureRuntime()` in `packages/core/runtime-config.ts`,
  called by `apps/web/platform/runtime-config.ts`.
- `packages/ui/` — no `@uniwork/core` imports, no business logic.
- `packages/views/` — no `next/*`, no `react-router-dom`. Navigate with
  `useNavigation()` / `<AppLink>` from `@uniwork/views/navigation`;
  `apps/web/platform/navigation.tsx` is the one implementation.
- Production code may not import a devDependency
  (`import-x/no-extraneous-dependencies`).
- Every JSX text node in `packages/views/` goes through `t()`
  (`i18next/no-literal-string`).

Shared dependency versions are pinned once in the `catalog:` block of
`pnpm-workspace.yaml` (`scripts/catalog-check.test.mjs`). Every workspace
declares what it imports in its own `package.json`.

## Sharing Rules

If logic would be needed by a second host, extract it now:

1. Next.js APIs stay in `apps/web/platform/`.
2. Headless logic belongs in `packages/core/`.
3. Shared screens and the navigation adapter belong in `packages/views/`.
4. Primitives belong in `packages/ui/`; add them with `pnpm ui:add <name>`.

## Commands

`make help` is the source of truth. Common:

```bash
make dev              # bootstrap this checkout and start everything
make start            # app processes (migrates first); make stop leaves Postgres/Redis up
make check            # typecheck → lint → unit + contract tests → Go tests → E2E
make test-go          # Go: gofmt, vet, go test -race (ensures the test DB first)
make e2e              # Playwright against E2E_BASE_URL (app must be running)
make migrate-up       # apply migrations to this checkout's database
make sqlc             # regenerate after editing server/pkg/db/queries
pnpm typecheck
pnpm test
pnpm lint
pnpm ui:add badge     # shadcn/Base UI primitive into packages/ui
pnpm generate:reserved-slugs
```

Worktrees share one PostgreSQL container and get their own database and
ports via `.env.worktree` (`make worktree-env`, `make setup-worktree`,
`make start-worktree`, `make check-worktree`). `make dev` detects a worktree
and generates the file itself.

CI (`.github/workflows/ci.yml`) runs Node 22, Go 1.27, pnpm 10.28 against
`postgres:16` and `redis:7`. Playwright runs only in `make check`.

## Database and Migration Rules

Enforced by `server/migrations/lint_test.go` on every migration after `004`;
`001`–`004` are applied history and are not rewritten.

- No `FOREIGN KEY` / `REFERENCES`, no cascading deletes or updates. Resolve
  relationships and dependent cleanup in service code, inside a transaction
  when parent and cleanup must commit together.
- Every index is `CREATE INDEX CONCURRENTLY` or `CREATE UNIQUE INDEX CONCURRENTLY`,
  alone in a single-statement migration file. The runner
  (`server/migrations/embed.go`) applies files outside a transaction for
  exactly this reason.
- Ids are ULIDs in `TEXT` columns (`util.NewID()`).
- Every query filters by `workspace_id`; membership is decided only in
  `WorkspaceService.RequireMember`, where organization owners/admins are
  implicit workspace admins.

## Coding Rules

- TypeScript strict; keep types explicit. Go: `gofmt`, `go vet`, checked errors.
- Code comments in English. Specs and plans (`docs/superpowers/`) are in Vietnamese.
- Prefer existing patterns over new parallel abstractions; no broad refactors
  unless the task requires them.
- No compatibility layers, dual writes or shims in internal code unless
  asked. The API boundary is different — see below.
- Reserved slugs: edit `server/internal/service/reserved_slugs.json`, run
  `pnpm generate:reserved-slugs`, commit `packages/core/paths/reserved-slugs.ts`.
  `packages/core/paths/consistency.test.ts` also fails if a page exists
  without a `paths` builder or vice versa.

## API Compatibility

Frontend code must survive backend response drift.

- `packages/core/api/http.ts` returns `unknown`. Only `packages/core/api/endpoints/`
  shapes a response, through `parseWithFallback(raw, schema, fallback, { endpoint })`
  from `packages/core/api/schema.ts`. Never cast network JSON to `T`.
- Response schemas are lenient (server enums as `z.string()`); the exported
  types narrow them, so every `switch` over a server enum carries a `default`
  and UI optional-chains server fields.
- Every endpoint has a malformed-response test proving it degrades instead of
  throwing. Login, register and complete-onboarding are the deliberate
  exceptions that still fail loudly — there is no session to start without them.
- When adding or changing an endpoint: add the function, its schema, and a
  malformed-response case in `api/endpoints/<domain>.test.ts`.

## Backend ID Rules

Ids are opaque ULID strings. In `server/internal/handler/`, a path param is
handed to the service, which decides visibility: `authorize()` /
`RequireMember` return `ErrForbidden` or `ErrNotFound`, and
`mapServiceError` turns those into 403/404. Handlers never query the
database and never reveal whether an id exists to a non-member.

## Web Features

When adding a shared screen:

1. Put the screen in `packages/views/<domain>/`.
2. Wire the route in `apps/web/app/`; the workspace layout already composes
   `DashboardGuard` (auth → onboarding → workspace) and `WSProvider`.
3. Navigate with `useNavigation().push()` or `<AppLink>` in shared code.
4. Keep platform-only UI in the app or inject it through props.
5. Hooks that need workspace context accept `wsId`.

Known debt (phase 5 of the base port): `packages/views/layout/sidebar.tsx`
and the pages under `apps/web/app/` still use `useRouter` / plain anchors;
new code must not add to that.

## UI Rules

- Prefer the registry primitives in `packages/ui/components/ui/` over custom
  implementations; add new ones with `pnpm ui:add`. Every primitive is
  mounted by `packages/ui/components/ui/render-smoke.test.tsx`.
- Tokens: `packages/ui/styles/tokens.css` is the single source. Use semantic
  classes (`bg-background`, `text-muted-foreground`); never a hardcoded
  colour. Font sizes come from the role-named `--text-*` scale
  (`text-caption`, `text-body`, `text-title`, …), not Tailwind's default ramp.
- Every themed token is declared in BOTH `:root` and `.dark`; writing it as
  `var(--uw-…)` does not exempt it (custom properties are computed, then
  inherited — a `:root`-only slot carries the light value into every `.dark`
  subtree). `packages/ui/styles/tokens.test.ts` enforces it.
- Every colour change is verified in both modes by
  `e2e/onboarding-contrast.spec.ts`, which measures contrast on the rendered
  page. Reading token values is not verification.
- Four accessibility contracts live in the primitives and are tested; do not
  regress them when updating from the registry: `aria-disabled` keeps a
  button in the tab order and blocks the action in JS; touch targets are
  ≥ 44px on coarse pointers; the global `:focus-visible` outline is the focus
  indicator (no `outline-none` on interactive primitives); `StepperTitle`
  renders a `span`, not a heading.
- The `--uw-*` aliases and `--color-text-secondary` are transitional; write
  new code against the semantic slots.

## Testing

| What is tested | Location |
| --- | --- |
| Shared logic, stores, endpoints, hooks | `packages/core/**/*.test.ts(x)` |
| Shared screens, components | `packages/views/**/*.test.tsx` |
| Primitives, tokens | `packages/ui/**/*.test.ts(x)` |
| Repo contracts (catalog, usf leak, turbo hash) | `scripts/*.test.mjs`, `scripts/turbo-cache-check.sh` |
| End-to-end flows | `e2e/*.spec.ts` |
| Backend | `server/**/*_test.go` (test DB via `TEST_DATABASE_URL`, Redis via `REDIS_TEST_URL`) |

Rules:

- `packages/views/` tests never mock `next/*`; they mock the transport
  (`@uniwork/core/api/http`, see `packages/views/test/setup.ts`) so the real
  schemas stay in the loop.
- Seed the session with `setSessionUser` from `@uniwork/core/auth`; reset with
  `resetAuthStoreForTests`.
- Tests pin every env they depend on (`t.Setenv`, `configureRuntime`); the
  Makefile exports the app's env and a test that reads it will fail under
  `make check`.
- Write the failing test in the right package before the implementation when
  the change is behavioral.
- The five onboarding e2e specs (contrast, focus, mobile, shell, smoke) are a
  regression contract. Fix the component, not the spec.

## Verification

Run the narrowest useful checks while iterating; run `make check` before
claiming a change is done. Do not claim verification passed unless you ran it;
if you skipped a check, say so. After changing a root provider
(`apps/web/app/providers.tsx`), run e2e twice — the first run can land while
Next is still recompiling.

## Commits

Conventional prefixes: `feat(scope)`, `fix(scope)`, `refactor(scope)`,
`test(scope)`, `docs`, `chore(scope)`, `ci`. Atomic, grouped by intent; the
body carries the reason and what was deliberately left out.

## Domain Reminders

- Two membership tiers: organization (`organization_members`) and workspace
  (`workspace_members`). Permissions carry both (`PermissionContext{orgRole, wsRole}`
  in `packages/core/permissions/`), and every rule cites the Go gate it mirrors.
- Workspace slugs are unique within an organization only; URLs and the
  WebSocket handshake carry the pair (`/{orgSlug}/{wsSlug}`, `workspace_slug=org/ws`).
- `onboarded_at` on the user is the single source of truth for "may enter a
  workspace"; never infer it from the workspace count.
- Realtime event names are `<entity>.<verb>` with id-only payloads
  (`packages/core/types/events.ts`, published from `server/internal/service`).
