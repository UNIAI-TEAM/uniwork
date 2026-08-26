# Conventions

Single source of truth for code naming, the vi–en translation glossary, and the
Vietnamese voice guide. `CLAUDE.md` points here; nothing else overrides this
page. Every example below is taken from the repository as it is — if you find
one that no longer matches, the page is wrong, fix the page.

---

## 1. Code naming

### Routes

- Global routes (before the user is inside a workspace) are a single word or
  `/{noun}/{verb}`: `/login`, `/register`, `/onboarding`, `/invitations`,
  `/workspaces/new`, `/invite/{token}`. Never a hyphenated root
  (`/new-workspace`): it collides with organization slugs and forces endless
  reserved-slug audits. Reserving the noun protects the whole subtree.
- Workspace routes live under `/{orgSlug}/{workspaceSlug}/{section}`:
  `/acme/team/tasks`, `/acme/team/meetings/{id}/room`, `/acme/team/members`.
  Workspaces nest inside organizations; a workspace slug is unique only within
  its organization.
- Every route has a builder in `packages/core/paths/paths.ts` and every builder
  has a route — `paths/consistency.test.ts` walks `apps/web/app` and fails on
  either direction of drift. Shared code never writes a path string.
- The first segment of every global route is in
  `server/internal/service/reserved_slugs.json`. Edit the JSON, run
  `pnpm generate:reserved-slugs`, commit `packages/core/paths/reserved-slugs.ts`.

### Packages and modules

| Package | May depend on | Must NOT depend on |
| --- | --- | --- |
| `packages/core` | nothing app-specific | `react-dom`, `localStorage`, `process.env`, `next/*`, UI libraries |
| `packages/ui` | nothing | `@uniwork/core`, business logic |
| `packages/views` | `core/`, `ui/` | `next/*`, `react-router-dom`, store definitions |
| `apps/web/platform/` | `next/*` | — |

These are lint errors (`pnpm lint`), not conventions. Exceptions that exist
and why: `packages/core/platform/**` is the `StorageAdapter` implementation
and may touch `localStorage`; `analytics/exception-dedupe.ts` reads
`sessionStorage` directly because it runs on the crash path, before the
adapter is wired.

If logic exists in the app and would be needed by a second host, it belongs in
a shared package; there is no "small enough to duplicate".

### Files and components

- Files: `kebab-case.tsx` / `kebab-case.ts` (`use-dashboard-guard.ts`, `app-link.tsx`).
- Components: `PascalCase` (`DashboardGuard`, `AppLink`).
- Hooks: `useCamelCase` (`useCurrentMember`, `useWorkspaceEvents`).
- Tests: colocated as `<file>.test.ts(x)`. Repo-level contract tests live in
  `scripts/*.test.mjs` and run with `node --test`.
- Zustand stores: `<feature>/store.ts`, exported as `use<Feature>Store`
  (`auth/store.ts` → `useAuthStore`).
- Query keys: a `<feature>Keys` factory next to the hooks
  (`taskKeys.list(wsId)`, `meetingKeys.detail(id)`); workspace-scoped keys
  always carry the workspace id.
- API endpoints: `packages/core/api/endpoints/<domain>.ts`, one function per
  call, named as a verb (`listTasks`, `createMeeting`, `acceptInvite`).

### Database (Go + sqlc)

- Tables: `snake_case`, plural as they are today (`users`, `workspaces`,
  `workspace_members`, `tasks`, `meeting_notes`).
- Columns: `snake_case`; references are `<table-singular>_id`
  (`workspace_id`, `created_by`); state changes as timestamps
  (`onboarded_at`, `accepted_at`) rather than booleans.
- Ids are ULIDs stored as `TEXT` (`util.NewID()`), never UUID columns.
- Migrations: `NNN_descriptive_name.up.sql` + `.down.sql`, both directions,
  unique numeric prefix. From `005` on: **no `FOREIGN KEY` / `REFERENCES`**
  (relationships and dependent cleanup live in service code) and every index
  is `CREATE [UNIQUE] INDEX CONCURRENTLY` alone in its file.
  `server/migrations/lint_test.go` enforces both; `001`–`004` are frozen.
- sqlc queries in `server/pkg/db/queries/<table>.sql`; regenerate with
  `make sqlc` and commit `server/pkg/db/generated/`.

### Go

- `gofmt`, `go vet`, `staticcheck` (pinned as a `tool` in `go.mod`), checked
  errors; `bash scripts/test-go.sh --race` runs all of them before the tests.
- Layers: `internal/handler` (HTTP, chi) → `internal/service` (rules,
  membership, events) → `pkg/db` (sqlc). Handlers never query the database.
- Membership is decided in one place: `WorkspaceService.RequireMember`.
  Organization owners/admins are implicit workspace admins there. No other
  service reads `workspace_members`.
- Every mutation that other clients should see publishes a
  `service.Event{Type, Payload}` through `EventPublisher`; event names are
  `<entity>.<verb>` (`task.updated`, `meeting.deleted`) and the payload
  carries ids only.
- Handler errors go through `mapServiceError`; a new error kind is added there
  once, not translated per handler.

### TypeScript

- API JSON is `snake_case` on the wire **and** in the types
  (`created_at`, `organization_slug`). There is no camelCase conversion layer
  — the zod schemas are the wire shape. Local variables and functions are
  camelCase.
- Types: `PascalCase`, no `I` prefix. Enums are string literal unions
  (`TaskStatus`) with a `TASK_STATUSES` const array beside them.
- Responses are lenient: enums parse as `z.string()`, and the exported type
  narrows them. Every `switch` over a server enum has a `default`.
- Only `packages/core/api/endpoints/*` shapes a response, through
  `parseWithFallback(raw, schema, fallback, { endpoint })`. The transport
  returns `unknown`. Each endpoint has a malformed-response test.

### Comments in code

English only, in Go and TypeScript. A comment explains why, not what.
Vietnamese belongs in `docs/superpowers/` (specs and plans) and in the locale
files.

### Commit messages

Conventional prefixes: `feat(scope)`, `fix(scope)`, `refactor(scope)`,
`test(scope)`, `docs`, `chore(scope)`, `ci`. Atomic commits grouped by intent;
the body says what a reader could not infer from the diff — the reason, and
what was deliberately not done.

---

## 2. i18n glossary (vi ↔ en)

`vi` is the source language; `en` is a translation. Both files in
`packages/core/i18n/locales/` must carry every key — `i18n/parity.test.ts`
fails on drift. One flat namespace, keys nested by section:
`feature.component.action` (`onboarding.step_invite.role_member`,
`workspace.inviteNotAllowed`).

### The distinction: everyday noun vs product term

- **Everyday noun** — what a user would say for it. Translate.
- **Product / schema term** — an identifier the user may type or match, or a
  concept with no settled Vietnamese word. Keep lowercase English.

### Product nouns (current locale, `vi.json`)

| Concept | vi | en | Note |
| --- | --- | --- | --- |
| task (the unit of work) | **công việc** / **việc** | Task | `tasks.title = "Công việc"`, `tasks.new = "Việc mới"` |
| meeting | **cuộc họp** | Meeting | `meetings.title = "Cuộc họp"` |
| workspace | **workspace** | Workspace | kept in English in vi copy: `workspace.create = "Tạo workspace"` |
| organization | **tổ chức** | Organization | `"tên tổ chức không được để trống"` |
| member | **thành viên** | Member | `workspace.members = "Thành viên"` |
| invitation | **lời mời** / **mời** | Invitation / Invite | `workspace.invite = "Mời thành viên"` |
| comment | **bình luận** | Comment | |
| note (meeting) | **ghi chú** | Note | |
| onboarding | **onboarding** | Onboarding | section name stays English |

`workspace` stays English on purpose: the Vietnamese candidates ("không gian
làm việc") are long, and the URL, the slug field and the product name all say
workspace already. Do not translate it in one place and not another.

### Don't translate — brands, acronyms, identifiers

- Brands: **UniWork**, UNICOM, Google, LiveKit, GitHub.
- Acronyms: API, URL, JWT, WebSocket, HTTP, JSON, SQL.
- Roles and statuses are schema identifiers and render as lowercase English
  even inside Vietnamese text: `owner` / `admin` / `member`;
  `todo` / `in_progress` / `done` / `cancelled`; `low` / `medium` / `high` /
  `urgent`. Their *labels* are translated (`tasks.status = "Trạng thái"`), the
  *values* are not.

### Generic UI words

| en | vi |
| --- | --- |
| Save / Cancel / Delete | Lưu / Hủy / Xóa |
| Create / New | Tạo / mới (`Việc mới`, `Workspace mới`) |
| Continue / Back / Skip / Done | Tiếp tục / Quay lại / Bỏ qua / Xong |
| Copy / Copied / Retry / Later | Sao chép / Đã sao chép / Thử lại / Để sau |
| Log in / Sign up / Log out | Đăng nhập / Đăng ký / Đăng xuất |
| Email / Password / Display name | Email / Mật khẩu / Tên hiển thị |
| Title / Description / Status / Priority | Tiêu đề / Mô tả / Trạng thái / Độ ưu tiên |
| Board / List | Bảng / Danh sách |
| Upcoming / Past | Sắp diễn ra / Đã diễn ra |
| Loading… / Error / Empty | Đang tải… / Có lỗi xảy ra / Chưa có dữ liệu |

### Plurals and counts

i18next uses `_one` / `_other`. Vietnamese has no grammatical number, but the
parity test requires the same key set in both files, so `vi.json` carries
both keys with identical text. Put the count first.

```json
// vi.json
"invite_invalid_summary_one":   "{{count}} địa chỉ chưa đúng định dạng — sửa hoặc xoá trước khi gửi.",
"invite_invalid_summary_other": "{{count}} địa chỉ chưa đúng định dạng — sửa hoặc xoá trước khi gửi."
// en.json
"invite_invalid_summary_one":   "{{count}} address isn't formatted correctly — fix or remove it before sending.",
"invite_invalid_summary_other": "{{count}} addresses aren't formatted correctly — fix or remove them before sending."
```

### Interpolation

`{{var}}`. Vietnamese may reorder for natural flow:
`"invalidEmail": "Email không hợp lệ: {{email}}"`.

### Adding a key

1. Add it to `vi.json` first — Vietnamese is what the product is written in.
2. Add the `en` counterpart. Run `pnpm test --filter @uniwork/core` — parity fails otherwise.
3. In `packages/views`, JSX text must go through `t()`;
   `i18next/no-literal-string` makes a raw string a lint error.

---

## 3. Vietnamese voice and style

### Register

- Written to a colleague, not to a customer: no "quý khách", no "vui lòng"
  padding. "bạn" only when the sentence needs a subject.
- Calm, specific, short. UniWork's brand is restraint; copy follows.
- Agent copy uses the same register as human copy — a colleague, never a mascot.

### Punctuation and typography

- Vietnamese punctuation is ASCII: `,` `.` `:` `;` `!` `?` — no full-width forms.
- Ellipsis is the single character `…` (used throughout `vi.json`:
  `"loading": "Đang tải…"`), not three dots.
- A single space on each side of an English word inside Vietnamese text:
  "Tạo workspace", "Mời thành viên vào workspace".
- Quotes are straight double quotes `"…"`.

### Kinds of copy

- **Buttons**: verb first, two to four words — "Lưu", "Mời thành viên",
  "Tạo cuộc họp". Never a full sentence.
- **Error messages**: say what did not happen and what to do, without
  exclamation: "Không thể lưu thay đổi. Thử lại." beats "Lưu thất bại!".
  Never colour-only; the sentence must stand alone.
- **Empty states**: truthful and pointing at the next step —
  "Chưa có việc nào. Tạo việc đầu tiên." Never mock data.
- **Tooltips / hints**: one short sentence, no trailing period on fragments.
- **Placeholders**: an example, not an instruction — "Nhập email, cách nhau bằng dấu phẩy hoặc Enter".
- **Permission denials**: come from the `Decision.message` in
  `packages/core/permissions` so the same reason reads the same everywhere
  (`workspace.inviteNotAllowed`).

### Where to look when in doubt

1. `packages/core/i18n/locales/vi.json` — the voice as shipped.
2. `PRODUCT.md` — brand personality and the anti-references.
3. `packages/views/onboarding/` — the most complete screens in the current
   register.

---

## Updating this page

A change here is a change to the product. When you change a rule: apply it in
the locale files / `CLAUDE.md` in the same PR, and say so in the PR body so
the reviewer knows to look for the sweep.
