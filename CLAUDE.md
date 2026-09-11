# CLAUDE.md

Guidance for anyone working in this repository, human or agent. `AGENTS.md` is
a symlink to this file, so every tool that looks for its own convention name
lands on the same ruleset — there is no short version that quietly omits half
the rules. Keep this file short and authoritative: rules here are the ones
that are hard to infer from code or easy to get wrong. Every rule below is
enforced by a command, a test, or a lint rule named next to it; if you find
one that is not, fix the rule or the file.

## Conventions

The source of truth for code naming, the vi–en i18n glossary, and the
Vietnamese voice guide is `docs/conventions.md`. Read it before naming a
route/package/file/DB column/type, before editing
`packages/core/i18n/locales/`, and before writing Vietnamese UI copy.
HTTP API + Swagger (SDI/SDO, Chi `apiOp`, `pathParamSDI`) is
`docs/api-sdi-sdo.md`. The *why* behind every "never" / "only" below is an
ADR in `docs/adr/` — read it before arguing with the rule, and write one
before changing it (`scripts/governance.test.mjs` checks numbering and
status).

## Project Shape

UniWork is an AI-native Work OS for Vietnamese teams (10–1,000 people):
tasks, meetings, documents and workflows co-owned by people and agents.
Product intent and design principles live in `PRODUCT.md`.

- `server/` — Go backend: Chi router, pgx + sqlc, gorilla/websocket, Redis
  relay, Prometheus metrics. Layers: `internal/handler` → `internal/service`
  → `pkg/db`; `server/internal/arch_test.go` fails on an import that crosses
  them the wrong way.
- `apps/web/` — Next.js App Router. `apps/web/platform/` is the only place
  Next.js APIs (router, env) are touched.
- `packages/core/` — headless logic: API endpoints, React Query hooks,
  Zustand stores, realtime sync, permissions, paths, i18n. Four modules came
  over with the port and no host reaches them yet: `packages/core/analytics/`,
  `packages/core/diagnostics/`, `packages/core/modals/`,
  `packages/core/navigation/`. They import each other, not the app (the
  shortcuts module left this list with F-09: ⌘J opens Ask UNI; feature-flags
  with F-11: `GET /api/v1/config` feeds `FeatureFlagsProvider`; inbox, labels,
  task-views and constants left when they were wired or removed — constants
  with UNI-505 TipTap catalog). Wire one before relying on it;
  `scripts/governance.test.mjs` recomputes the list and fails after
  2026-09-30 unless it is empty — wire or delete by then.
- `packages/ui/` — atomic primitives (shadcn/Base UI registry) and design tokens.
- `packages/views/` — shared business screens and the navigation adapter.
- `packages/tsconfig/`, `packages/eslint-config/` — shared config.
- `e2e/` — Playwright.

Shared packages export raw `.ts` / `.tsx`, compiled by the consuming app.
Dependency direction is `views -> core + ui`; `core` and `ui` stay independent.
Web is the only host today; the adapters (`NavigationAdapter`,
`StorageAdapter`, `CoreProvider`) exist so a desktop host can be added
without rewriting `views`. Mobile is not a host of `views`: it will be a
separate Expo / React Native app under apps/mobile that imports only types
and pure functions from `packages/core/` (ADR 0011, mirrors the sibling
`usf` repo); its rules land in its own CLAUDE.md when the app exists.

## State Rules

Keep server state and client state separate.

- TanStack Query owns server state: tasks, meetings, workspaces, members,
  organizations, invitations. Query keys come from the `<feature>Keys`
  factories beside each hook; workspace-scoped keys always include the
  workspace id. Hooks that need a workspace take `wsId` as a parameter.
- Zustand owns client state; stores live in `packages/core/`, never in `views`
  or apps. `packages/core/auth/store.ts` is the only store a host reaches
  today and the pattern to copy — `packages/core/navigation/store.ts` and
  `packages/core/modals/store.ts` are unwired (see Project Shape).
- Only the auth store and `api/endpoints/*` talk to the transport. Every
  other server interaction is a query or a mutation.
- WebSocket events invalidate Query keys (`packages/core/realtime/use-realtime-sync.ts`).
  The frame payload is never written into a query or a store — the cache is
  refreshed from the API. `packages/core/realtime/use-realtime-sync.test.tsx` pins this.
- Optimistic updates only when ALL hold: the outcome is locally predictable,
  the user stays on the same screen, failure is rare, rollback is a cache
  restore. Canonical: task status/position on the board
  (`packages/core/tasks/hooks.ts`). Create, delete and anything that
  navigates await the server.
- Zustand selectors return stable references (`useShallow` for objects).

## Package Boundaries

These are lint errors (`pnpm lint`), not conventions — and at `GATE_LEVEL=fast`
`scripts/lint-gate.sh` prints them without failing the run (ADR 0014), so read
the output rather than the exit code:

- `packages/core/` — no `react-dom`, no `localStorage` / `sessionStorage` (use
  `StorageAdapter` from `packages/core/platform/`), no `process.env`. Endpoint
  origins arrive through `configureRuntime()` in `packages/core/runtime-config.ts`,
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
make start            # app + local LiveKit (migrates first); make stop leaves Postgres/Redis/LiveKit up
make check            # typecheck → lint → unit + contract tests → Go tests → E2E (E2E above GATE_LEVEL=fast)
make check-full       # the same at strict, E2E included, whatever GATE_LEVEL says
make gate             # current gate level and what it changes
make test-go          # Go: gofmt, vet, staticcheck, go test -race (ensures the test DB first)
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
`postgres:16` and `redis:7`, plus `pnpm audit --audit-level high`,
`govulncheck`, a gitleaks scan, and the Playwright suite (`e2e` job: server
binary + production Next build against the same services).

## Accepted Decisions Awaiting Enforcement

ADR 0008 and 0010 (`docs/adr/`) were accepted on 2026-09-04 and shape every
Phase F feature, but their guard tests do not exist yet. Until the named test
lands, reviewers hold the rule by hand via `docs/engineering/DEFINITION_OF_DONE.md`;
when it lands, move the rule into the section above it belongs to and name the
test there. Planned guards are written without backticks on purpose: they are
not paths yet.

- ADR 0008 — every query filters by `organization_id`; membership still only
  via `RequireMember`. The column rule itself is enforced (see Database and
  Migration Rules). Still to land with F-08/F-02: a query-scope scanner over
  `server/pkg/db/queries/`, a two-organization isolation matrix test.
- ADR 0010 — the agent runtime never writes business tables; agent writes go
  proposal → human confirm → execute; `accepted` is human-only. The gateway
  half landed with F-09 (see Audit and Events); still to land with F-10: a
  lifecycle test that the runtime cannot set `accepted`, a tool-registry test
  that every tool has undo or is not auto-executable.

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
- Attribution is a pair (ADR 0007): a table created after migration `065`
  that has `created_by` also has `created_by_kind` (`human` | `agent` |
  `system`), and `tasks`, `task_comments`, `meetings`, `chat_messages` carry
  their `_kind` beside the id. Commands that record a kind take a
  `service.Actor`; handlers only ever build one with `service.Human`, and
  agents join a workspace through `workspace_agent_members`
  (`RequireAgentMember`, same file as `RequireMember`). `TestActorKindOnEveryCreatedBy`
  (migration lint) and `TestActorConstructedOnlyInService` (arch test) hold it.
- Every business table created after migration `065` declares
  `organization_id TEXT NOT NULL` (ADR 0008); identity and infrastructure
  tables are exempted by name, with a reason, in `tenantExemptTables`. The
  older tables still missing the column are listed in `tenantBackfillDebt`
  and the list only shrinks — a backfill migration removes its table there.
  `TestNewTablesCarryOrganizationID` and
  `TestTablesWithoutOrganizationIDAreTheKnownDebt` hold both.
- Every query filters by `workspace_id`; membership is decided only in
  `WorkspaceService.RequireMember`, where organization owners/admins are
  implicit workspace admins, and only in `OrganizationService.RequireMember`
  for the organization tier. `server/internal/arch_test.go` fails if any
  other file calls the membership queries.
- Organization membership has a lifecycle (F-03). A member with
  `organization_members.deactivated_at` set keeps every row they own —
  workspace membership, authored content, history — and is refused by BOTH
  membership gates: `RequireMember` answers 403 `member_deactivated`, and the
  workspace gate reads the column too, because deactivation deliberately
  leaves the workspace row in place. `TestDeactivationClosesTheWorkspaceGateToo`
  holds it. An organization has exactly one owner at a time
  (`idx_org_members_single_owner`); ownership moves only through
  `TransferOwnership`, never through a role change.
- `audit_events` is append-only. `REVOKE UPDATE, DELETE, TRUNCATE` plus a
  trigger that raises on both, so the rule holds even where the app owns the
  schema (ADR 0012). Retention never deletes; a wrong row is answered with
  another row. `TestAuditEventsAreAppendOnly` proves it.

## Audit and Events

Every command that changes business state writes an `audit_events` row and its
`outbox_events` rows in the same transaction as the change (ADR 0009, ADR 0012).

- Only `server/internal/audit` writes those two tables. Services call
  `audit.Recorder.Record(ctx, q, Entry, emit…)` with the `q` bound to their own
  transaction; `Recorder.Emit` is the narrow path for infrastructure topics
  (`provider.*`) that have no business command behind them.
  `server/internal/arch_test.go` fails on a direct insert from anywhere else.
- `server/internal/service/audit_coverage_test.go` lists every command that must
  audit and fails in both directions — a missing command, and an action nobody
  calls. Add the command and its row there together.
- Domain events reach clients through the outbox, never `EventPublisher.Publish`.
  Direct publish is only for ephemeral signals, and the bar is one sentence:
  losing it costs nobody anything (typing, voice signalling, a transcript line
  the next one supersedes). `docs/events/CATALOGUE.md` marks each one.
- Event names are `<entity>.<verb>`; the version is the `event_version` column,
  never part of the name; payloads carry ids only. The catalogue exists three
  times — that file, `server/internal/outbox/catalogue.go`,
  `packages/core/types/events.ts` — and `scripts/events-catalogue.test.mjs`
  fails when they disagree.
- Every request carries a `correlation_id` (`middleware.Correlation`), and it
  reaches the audit row, the events and the access log. `docs/ops/RUNBOOK_OUTBOX.md`
  is the runbook.
- Every LLM call goes through `ai.Gateway` in `server/internal/ai/` (ADR 0010,
  spec F-09). Only `server/internal/ai/provider` imports a vendor SDK or opens
  a connection to a model host; `internal/ai` never imports `internal/service`
  and only calls sqlc queries named `Ai*`, so the model side of the house
  cannot reach a business table. `TestProviderSDKOnlyInAIProvider` and
  `TestAIPackageOnlyCallsAiQueries` in `server/internal/arch_test.go` hold it;
  `TestAskUniToolsAreReadOnly` keeps Ask UNI's tool registry free of writes.

## Platform Admin and Observability

The console (`/admin`, F-11) reads metadata across tenants, so it lives
behind its own gate and never reaches content.

- `/api/v1/admin/*` is guarded only by `middleware.RequirePlatformRole`
  (`users.platform_role`: `support` reads, `admin` writes; no role → 404). It
  never goes through `RequireMember` and never returns task bodies, messages
  or files. Only `server/internal/service/admin.go` and
  `server/internal/service/admin_flags.go` call the queries in
  `server/pkg/db/queries/admin.sql` and `server/pkg/db/queries/feature_flags.sql`, and neither
  touches a content service
  — `TestAdminQueriesStayInAdminService` in `server/internal/arch_test.go`.
- Every admin write takes a `reason` (≥ 10 characters) and lands in
  `admin_actions` and `audit_events` in one transaction, sharing the trace id.
  A platform role is granted only by `server/cmd/uniwork-admin`; there is no UI.
- A suspended organization is closed to its own members on both membership
  gates with 403 `organization_suspended` (`TestSuspendClosesBothMembershipGates`).
- `server/internal/telemetry` is the only OpenTelemetry seam: spans are always
  created (no exporter without `OTEL_EXPORTER_OTLP_ENDPOINT`), every response
  carries `X-Trace-Id`, and `correlation_id` is the trace id
  (`TestCorrelationIDIsTheTraceID`). `RequireMember` stamps organization and
  workspace on the span and the log fields. Log lines identify people by id,
  never email or name (`scripts/no-pii-log.test.mjs`; `// log-pii-ok: <why>`
  is the escape hatch).
- `/healthz` is liveness only; `/readyz` checks DB, schema version and Redis.
- Every variable the server reads is listed in `.env.example`
  (`scripts/env-example.test.mjs`). Every alert in `deploy/alerts.yml` has a
  runbook in `docs/runbooks/` with the four sections
  (`scripts/alerts-runbooks.test.mjs`). Every flag is declared in
  `server/internal/featureflags/keys.go` with a `review_at`;
  `TestFlagsAreReviewed` fails once it passes. Overrides
  (`feature_flag_overrides`, user > organization > global) win over the
  static file and `FF_*` env; flags hide capability, never grant permission.

## Coding Rules

- TypeScript strict; keep types explicit. ESLint runs with `--max-warnings 0`,
  so a warning fails `pnpm lint`. Go: `gofmt`, `go vet`, `staticcheck`
  (`go tool staticcheck`, pinned in `server/go.mod`), checked errors.
- A `.ts`/`.tsx` file is at most 500 lines (`max-lines`, excluding blanks and
  comments; registry primitives and tests are exempt). Past that it is two
  modules.
- No unused exports, files or dependencies: `pnpm knip` (`knip.json`) runs
  in `make check`. Test-only helpers are not exported unless a test imports
  them.
- Coverage only goes up. Each package's vitest config carries integer
  `thresholds`; Go has `server/coverage.floor`, checked by
  `scripts/go-cover-floor.sh` — over the whole profile locally, over the merged
  shard profiles in CI. Raise the floor by hand, with the change that earned it
  — the numbers never go down. At `GATE_LEVEL=fast` a TypeScript package under
  its thresholds prints the summary and passes instead of failing `pnpm test`
  (`scripts/coverage-gate.ts`, ADR 0014); the Go floor blocks at every level.
- Code comments in English. Specs and plans (`docs/superpowers/`) are in
  Vietnamese and carry a `> **Trạng thái:**` line (shipped / in-progress /
  superseded / abandoned) under the title.
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

## Backend HTTP Rules

- Every JSON body goes through `decode(w, r, &in, limit)` in
  `server/internal/handler/json.go`; it caps the body (`maxJSONBody`, 1 MiB)
  and writes the 400/413 itself. Multipart uploads set their own cap.
  `server/internal/handler/json_test.go` proves the cap on the public login route.
- Nothing rewrites `r.RemoteAddr` from a forwarded header — no `RealIP`
  middleware. Each consumer of the client address (rate limiter, WebSocket
  origin check) applies `TRUSTED_PROXIES` itself. `server/internal/handler/router_test.go` pins it.
- Rate limits exist only with Redis and are keyed by IP and path; the
  credential routes carry their own small budget in `server/internal/handler/router/router.go`.
- `FRONTEND_ORIGIN` must be an absolute origin; its scheme decides the
  refresh cookie's `Secure` flag (`config.Config.SecureCookies`).
- `server/cmd/server/main.go` shuts down on SIGTERM/SIGINT: in-flight requests get
  10s, then the relay and metrics listener stop. Add new background workers
  to that sequence, not as a bare goroutine.
- REST routes register through the `api` wrapper in
  `server/internal/handler/router/` (auth, me, tasks, … +
  `apiOp{sdi, sdo, …}`). `handler.New` maps handler methods onto
  `router.Routes`. OpenAPI is built at process start from that
  catalog — no checked-in swagger spec, no swag comments, no `make swag`. SDI/SDO
  live in `server/internal/handler/dto/sdi/` and
  `server/internal/handler/dto/sdo/` with `description` and `example`
  tags. A new `{param}` name needs a `pathParamSDI` case in
  `server/internal/handler/router/openapi.go`. Full checklist:
  `docs/api-sdi-sdo.md`. `GET /api/v1/ws` stays off the spec.

## Web Features

The workspace shell is `DashboardLayout` in `packages/views/layout/`: the
gate (`DashboardGuard`: auth → onboarding → workspace), `WorkspaceProvider`
(`useWorkspace()` / `useWorkspaceId()`), `WSProvider`, `AppSidebar`
(`WorkspaceSwitcher` + one nav group) and `NavigationProgress`. The web
layout at `apps/web/app/[orgSlug]/[workspaceSlug]/layout.tsx` only reads the
route params and renders it.

When adding a shared screen:

1. Put the screen in `packages/views/<domain>/`.
2. Head it with the shell headers: `CollectionPageHeader` (icon, title,
   count, actions) and `CollectionPageState` (empty / error, never mock
   rows) for list screens; `BreadcrumbHeader` (`segments` › `leaf`,
   `actions`) for detail screens; `PageHeader` for anything else. All in
   `packages/views/layout/`.
3. Wire the route in `apps/web/app/` — a page reads `useParams()` and renders
   the view; the layout already provides the shell.
4. Navigate with `useNavigation().push()` or `<AppLink>` in shared code.
5. Keep platform-only UI in the app or inject it through props.
6. Hooks that need workspace context accept `wsId`; screens rendered inside
   the shell may read `useWorkspace()` for the slugs.

## UI Rules

- Prefer the registry primitives in `packages/ui/components/ui/` over custom
  implementations; add new ones with `pnpm ui:add`. Every primitive is
  mounted by `packages/ui/components/ui/render-smoke.test.tsx`.
- Tokens: `packages/ui/styles/tokens.css` is the single source. Use semantic
  classes (`bg-background`, `text-muted-foreground`); never a hardcoded
  colour. Font sizes come from the role-named `--text-*` scale
  (`text-caption`, `text-body`, `text-title`, …), not Tailwind's default ramp.
- Every themed token is declared in BOTH `:root` and `.dark`; writing it as
  `var(--other-slot)` does not exempt it (custom properties are computed, then
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
- Static accessibility and unhandled promises are lint errors
  (`packages/eslint-config/react.js` — `jsx-a11y` recommended;
  `packages/eslint-config/base.js` — `no-floating-promises`,
  `no-misused-promises`). `void p` is the explicit opt-out for fire-and-forget.
  An `eslint-disable` on a primitive carries the reason on the line above it.
- `scripts/fec-review.sh --min high <files>` runs the Front-End Checklist
  (`mcp.frontendchecklist.io` — it sends the file's source to that service)
  as an advisory review; it is not a gate and its regex findings are verified
  against the code before being acted on.
- The semantic slots are the only tokens. `scripts/no-legacy-tokens.test.mjs`
  fails on any `--uw-*` reference or pre-port utility (`bg-canvas`,
  `text-tertiary`, `border-line`, …); `cn()` in `packages/ui/lib/utils.ts`
  lists the colour names so tailwind-merge keeps colour and size apart.

## Testing

| What is tested | Location |
| --- | --- |
| Shared logic, stores, endpoints, hooks | `packages/core/**/*.test.ts(x)` |
| Shared screens, components | `packages/views/**/*.test.tsx` |
| Primitives, tokens | `packages/ui/**/*.test.ts(x)` |
| Repo contracts (catalog, usf leak, legacy tokens, turbo hash, governance, ADRs, plan status, env example, no-PII logs, alerts ↔ runbooks) | `scripts/*.test.mjs`, `scripts/turbo-cache-check.sh` |
| Go layering, membership gate, profile writes | `server/internal/arch_test.go` |
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

## Gate Level

The process gates tighten or loosen with one word in `GATE_LEVEL` at the repo
root: `fast`, `standard` or `strict`; anything else reads as `strict`.
`docs/engineering/GATE_LEVELS.md` is the table of what each level changes and
when to move. What it does not change: everything under Database and
Migration Rules, Audit and Events, secrets scanning, the coverage numbers
themselves and the `commit-msg` hook — those are data safety, not process.
(ADR 0014 is the one loosening of that list: at `fast` a TypeScript coverage
drop and a lint error report instead of failing. The thresholds do not move.) Change the level with
a PR that edits the file and says why in the commit body; `make gate` shows
the current one. `scripts/governance.test.mjs` checks the file, the readers
and this section agree.

## Local Gates

`pnpm install` points `core.hooksPath` at `.githooks/` (the root `prepare`
script) — git hooks are not cloned, so this is the only moment every checkout
is guaranteed to pass through. Two hooks then run unasked:

- `pre-commit` — refuses any `.env` file, runs `gofmt` on staged Go files, and
  above `GATE_LEVEL=fast` runs `turbo lint typecheck` for the workspaces the
  commit touches. Seconds,
  not minutes: it is not `make check`, it only stops a commit that cannot
  compile or that breaks a package boundary.
- `commit-msg` — enforces the prefixes below.

`git commit --no-verify` bypasses both; if you use it, `make check` before you
push is not optional. Agents do not get that escape hatch:
`.claude/hooks/block-no-verify.sh` (wired in `.claude/settings.json`) refuses
the flag. There is no second ruleset for any editor — Cursor, Codex and
Copilot read `AGENTS.md`; do not add an editor-specific rules tree beside it. `make doctor` reports whether the hooks are wired and
whether your Node/Go/pnpm match what the repo pins (`.nvmrc`, `server/go.mod`,
`packageManager`). `scripts/governance.test.mjs` pins the wiring itself.

## Project Tracking (UniAI)

Work state lives in UniAI (workspace `uni2026`, project UniWork), reached
through the `uniai` CLI; the repo holds code and docs. The full rules are
`docs/engineering/UNIAI_TRACKING.md`. The ones enforced here:

- No issue, no code. A PR into `develop`/`main` must name its issue
  (`UNI-nnn`) in the title or body — `.github/workflows/uniai-link.yml`
  fails otherwise at every level (label `no-issue` downgrades it to a
  warning at `fast`/`standard`; at `strict` it fails regardless of label).
- Branches carry the key: `feature/UNI-423-<slug>`; `make issue-start
  KEY=UNI-423` creates them and moves the issue to `in_progress`.
- Commits on an issue branch get a `Refs: UNI-nnn` trailer from
  `.githooks/prepare-commit-msg`; do not type or strip it.
- `make issue-pr` opens the PR as `UNI-nnn: <title>` and sets `in_review`;
  `make issue-done` runs after merge. Only a human sets `done`.
- Agents open a session with `uniai issue get UNI-nnn --output json`, leave
  a `[agent]` comment on every stop, and never create issues beyond
  sub-issues of the one they hold.
- `scripts/governance.test.mjs` checks that the script, hook, workflow and
  Makefile targets behind these rules exist.

## Commits

Conventional prefixes: `feat(scope)`, `fix(scope)`, `refactor(scope)`,
`test(scope)`, `docs`, `chore(scope)`, `ci`, `style(scope)`. Atomic, grouped by
intent; the body carries the reason and what was deliberately left out.
`.githooks/commit-msg` rejects anything else, and `scripts/governance.test.mjs`
fails if that hook's list and this line stop agreeing. GitHub squash-merge of
a UniAI PR keeps the PR title (`UNI-nnn: …`); the hook accepts that subject
the same way it accepts Merge and Revert.

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
