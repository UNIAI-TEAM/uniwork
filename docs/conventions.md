# Conventions

Single source of truth for code naming, the vi–en translation glossary, the
Vietnamese voice guide and icon use. `CLAUDE.md` points here; nothing else
overrides this page. Every example below is taken from the repository as it is
— if you find one that no longer matches, the page is wrong, fix the page.

---

## 1. Code naming

### Routes

- Global routes (before the user is inside a workspace) are a single word or
  `/{noun}/{verb}`: `/login`, `/register`, `/onboarding`, `/invitations`,
  `/workspaces/new`, `/invite/{token}`. A hyphenated root (`/new-workspace`)
  is normally wrong: it collides with organization slugs and forces endless
  reserved-slug audits. Reserving the noun protects the whole subtree. Three
  exceptions exist and every one of them is in `reserved_slugs.json`:
  `/forgot-password`, `/reset-password` and `/why-uniwork` — a public page
  whose URL is read by people, where the hyphenated phrase is the name.
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
  unique numeric prefix. The three-digit space ends at `998`; every later
  migration is `999<unix-milliseconds>_descriptive_name` (e.g.
  `9991790517656310_idempotency_keys_payload_fingerprint`), because sqlc reads
  the directory in string order and that shape sorts the same as strings and
  as numbers. Never `999_` and never a bare four-digit prefix;
  `TestMigrationPrefixesSortTheSameAsStringsAndNumbers` refuses both. From `005` on: **no `FOREIGN KEY` / `REFERENCES`**
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
- Every command that changes business state calls
  `audit.Recorder.Record(ctx, q, Entry, emit…)` with the `q` bound to its own
  transaction, so the change, its audit row and its events commit together.
  Nothing outside `internal/audit` writes those two tables.
- Domain events reach clients through the outbox, not `EventPublisher.Publish`.
  Direct publish is reserved for ephemeral signals, and the test is one
  sentence: **losing it costs nobody anything** — typing indicators, voice
  signalling, a transcript line the next one supersedes. Anything a user might
  ask about later goes through the outbox.
- Event names are `<entity>.<verb>` (`task.updated`, `meeting.deleted`), the
  payload carries ids only, and the version is the `event_version` column
  rather than part of the name. Every event is listed in
  [`docs/events/CATALOGUE.md`](events/CATALOGUE.md).
- Handler errors go through `mapServiceError`; a new error kind is added there
  once, not translated per handler.
- HTTP request/response types are SDI/SDO in
  `../server/internal/handler/dto/sdi/` and
  `../server/internal/handler/dto/sdo/` (one `{domain}.go` per package).
  REST routes live in `server/internal/handler/router/`.
  OpenAPI is reflected from the Chi `api` wrapper at process start. The
  checklist is [`docs/api-sdi-sdo.md`](api-sdi-sdo.md).

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
| subtask | **công việc con** | Sub-task | `tasks.detail.child_of = "Công việc con của"`; always the full term, never the short "việc con", even where "việc" alone stands for the task |
| meeting | **cuộc họp** | Meeting | `meetings.title = "Cuộc họp"` |
| workspace | **workspace** | Workspace | kept in English in vi copy: `workspace.create = "Tạo workspace"` |
| organization | **tổ chức** | Organization | `"tên tổ chức không được để trống"` |
| member | **thành viên** | Member | `workspace.members = "Thành viên"` |
| invitation | **lời mời** / **mời** | Invitation / Invite | `workspace.invite = "Mời thành viên"` |
| comment | **bình luận** | Comment | |
| channel (chat) | **kênh** | Channel | `chat.channel.*`; first-class room linked to a project |
| thread (chat) | **thread** | Thread | kept English in vi when product/schema; not “chủ đề” for room threads |
| link (attach project) | **gắn** | Link | `chat.channel.project_label = "Gắn project"` |
| inbox (the notification screen) | **hộp việc** | Inbox | `nav.inbox = "Hộp việc"`; route stays `/inbox` (OPEN_QUESTIONS N5) |
| Ask UNI (the read-only copilot) | **Hỏi UNI** | Ask UNI | `ai.title = "Hỏi UNI"`; UNI is the assistant's name, never "trợ lý ảo" |
| channel (chat work hub) | **kênh** | channel | `chat.channel.*`; first-class chat room kind attached to a Project |
| thread (chat) | **thread** | thread | keep English — internal users say "thread", not "luồng" |
| link (message ↔ work item) | **gắn** | link | `chat.message.linked` / message↔task attachment |
| source / citation (what an answer points at) | **nguồn** / **trích dẫn** | source / citation | `ai.sources = "Nguồn"`; rendered as `[S1]` links |
| notification | **thông báo** | Notification | `notifications.*`; one row in the inbox is a "thông báo" |
| mention (@someone) | **nhắc** / **nhắc đến** | Mention | `notifications.kind.mentioned = "… đã nhắc đến bạn …"` |
| note (meeting) | **ghi chú** | Note | |
| attendance | **điểm danh** | Attendance | `meetings.governance.attendanceTitle` |
| observer | **dự thính** | Observer | `meetings.governance.standing_OBSERVER`; the other standing is **thành viên** / Member |
| secretary | **thư ký** | Secretary | `meetings.governance.secretary`; code calls whoever runs attendance and votes (host, secretary, workspace admin) the "clerk" (`useMeetingClerk`, `requireMeetingClerk`) — never a user-facing word |
| quorum | **tỉ lệ có mặt tối thiểu** | Minimum attendance | `meetings.quorumLabel`; spell "tỉ lệ", not "tỷ lệ"; never the loanword "quorum" in vi copy |
| motion (an item put to a vote) | **nội dung biểu quyết** | Vote item | `meetings.governance.motionAdd = "Thêm nội dung"`; the section and room tab are **Biểu quyết** / Votes; not "kiến nghị", not "đề xuất" |
| ballot | **phiếu** | Vote | `meetings.governance.voteSubmit = "Gửi phiếu"`; one per member on the roll |
| vote (verb) | **bỏ phiếu** | Vote | `meetings.governance.motionStatus_OPEN = "Đang bỏ phiếu"` |
| pass / passed | **thông qua** | Pass / Passed | `outcome_PASSED = "Thông qua"`, `outcome_FAILED = "Không thông qua"` |
| abstain | **không ý kiến** | Abstain | `choice_ABSTAIN`; for / against are **tán thành** / **không tán thành** |
| secret ballot | **bỏ phiếu kín** | Secret ballot | `ballotMode_SECRET`; the other mode is **công khai** / Open ballot |
| onboarding | **onboarding** | Onboarding | section name stays English |
| related (Work Graph panel) | **liên quan** | Related | `graph.related.title = "Liên quan"` |
| originated from | **xuất phát từ** | Originated from | nguồn gốc của một việc (Work Graph) |
| graph timeline | **dòng thời gian** | Timeline | khác "Hoạt động" (audit + bình luận) của trang việc |
| Work Graph | **Work Graph** | Work Graph | tên hệ thống, không dịch |

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
| Table / Cards | Bảng / Thẻ |
| Filter / Display / View | Bộ lọc / Hiển thị / Chế độ xem |
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

## 4. Icons

One library (`lucide-react`), one glyph per meaning, one size per role.

### Names

Import the canonical name: `CircleAlert`, not `AlertCircle`; `LoaderCircle`,
not `Loader2`; `Ellipsis`, not `MoreHorizontal`; `RotateCcwClock`, not
`History`. Lucide keeps a renamed icon importable under its old name, and the
two spellings hide each other from search. `no-restricted-imports` names the
canonical import for every alias, and `scripts/lucide-aliases.test.mjs` fails
on one at every gate level. The list is generated from the installed package —
after bumping lucide-react run `pnpm generate:lucide-aliases`. The registry
primitives in `packages/ui/components/ui/` keep shadcn's `XIcon` suffix
(`CircleAlertIcon`); that is the canonical name with a suffix, not an alias.

### Modules

A module is drawn with one glyph everywhere it appears: sidebar, page header,
empty state, search, the work graph, notifications, auth and onboarding.
`MODULE_ICONS` in `packages/views/layout/module-icons.ts` holds them beside
`MODULE_TONES`; read the map, never pick the glyph again at the call site.

| Module | Glyph | Module | Glyph |
| --- | --- | --- | --- |
| home | `House` | meetings | `Video` |
| inbox | `Inbox` | chat | `MessageSquare` |
| email | `Mail` | people | `Users` |
| tasks | `SquareCheckBig` | documents | `FileText` |
| my_tasks | `ListTodo` | calendar | `Calendar` |
| projects | `FolderKanban` | settings | `Settings` |

Meetings is a camera, not a calendar: Calendar sits one row above it in the
sidebar. A glyph that names a part of a module rather than the module (a
meeting's participants panel, a date field's `CalendarDays`) keeps its own.

### Size

`size-*`, never `h-* w-*`. The role decides the size, not the screen:

| Size | Class | Role |
| --- | --- | --- |
| 12px | `size-3` | inside a chip or badge, `IconTile size="xs"` |
| 14px | `size-3.5` | metadata beside caption text, `IconTile size="sm"` |
| 16px | `size-4` | buttons, menu items, inputs, page-header glyph (`Button` sizes a bare svg to this) |
| 20px | `size-5` | header tiles, `IconTile size="md"` |
| 24px+ | `size-6` and up | empty states, `IconTile size="lg"` (`CollectionPageState`) |

### Stroke

Lucide's default 2. Do not set `strokeWidth` on an icon to make it look lighter
or heavier; pick the role's size instead. The one exception is the brand
surfaces of auth and onboarding (`auth-shell.tsx`, `step-welcome.tsx`,
`auth-controls.tsx`), whose raised cards use a hairline 1.5–1.75 on tiles of
`size="sm"` and up.

### Meaning

| Meaning | Glyph | Not |
| --- | --- | --- |
| Error: a failed load, save or send, invalid input, a destructive notice | `CircleAlert` | `TriangleAlert`, `OctagonX` |
| Warning: needs attention but nothing failed — a conflict, past due, a permission the browser denied | `TriangleAlert` | `CircleAlert` |
| Refresh, retry, reconnect | `RefreshCw` | `RotateCw` |
| Rotate | `RotateCw` / `RotateCcw` | — |
| Reset, reopen | `RotateCcw` | `RefreshCw` |
| View options: display, density, columns, customize | `SlidersHorizontal` | `Settings2`, `Cog` |
| Settings and configuration | `Settings` | `Settings2`, `Cog` |
| The system as an actor (audit, avatars) | `Cog` | `Settings` |
| AI: Ask UNI, copilots, AI summaries and insights | `Sparkles` | anything else — not "auto", animations or decoration |
| Loading | `<Spinner />` | a raw `LoaderCircle animate-spin` |

`Spinner` (`packages/ui/components/ui/spinner.tsx`) is decorative unless it is
the only sign of progress; then pass `label`. Under reduced motion it keeps
turning at half speed (`packages/ui/styles/base.css`), because one turn and a
stop reads as done. `scripts/lucide-aliases.test.mjs` fails on a raw
`LoaderCircle`. A refresh glyph may turn while its own refetch runs.

### Accessibility

An icon beside text is `aria-hidden`. An icon-only button carries an
`aria-label` (or `label` on the primitive that takes one) and keeps the 44px
coarse-pointer target, which `Button` already has — use it rather than a bare
`<button>`.

---

## Updating this page

A change here is a change to the product. When you change a rule: apply it in
the locale files / `CLAUDE.md` in the same PR, and say so in the PR body so
the reviewer knows to look for the sweep.
