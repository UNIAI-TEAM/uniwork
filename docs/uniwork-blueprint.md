# Blueprint kiến trúc UniWork

> **Trạng thái:** in-progress — bản chốt kiến trúc rút từ multica, dùng làm
> tham chiếu cho mọi feature Phase F trở đi.

## 0. Phạm vi và vai trò của hai nguồn

| Nguồn | Lấy gì | Tuyệt đối không lấy |
| --- | --- | --- |
| `multica` | Kiến trúc, phân lớp package, tech stack, quy ước data/test/migration | Nội dung sản phẩm, domain (issues/agents-CLI), copy, thương hiệu |
| `unidigiwork` | Copy tiếng Việt, bố cục màn hình, bảng màu, font, tông thương hiệu | Kiến trúc, cách tổ chức thư mục, cách fetch data, build tooling |

Ranh giới thực thi: mọi thứ từ unidigiwork phải hạ cánh vào
`packages/ui/styles/tokens.css`, `packages/core/i18n/locales/` và các file
`packages/views/<domain>/`. Không có file nào của unidigiwork được copy nguyên
trạng vào repo — Vite/Bun/Supabase của nó không phải stack của UniWork.

Tài liệu này mô tả kiến trúc đích. Phần lớn đã tồn tại trong repo; chỗ nào còn
là dự định thì ghi rõ "chưa có".

---

## 1. Tech stack

### Frontend

- **React 19.2.3**, **TypeScript 5.9 strict**. Không có file `.js` trong source.
- **Next.js App Router** là host duy nhất hiện tại (`apps/web/`). Server
  Components chỉ dùng cho layout/route shell; mọi màn hình nghiệp vụ là client
  component nằm trong `packages/views/`.
- **TanStack Query 5** cho server state. **Zustand 5** cho client state.
- **Tailwind CSS 4** (`@theme` trong CSS, không có `tailwind.config.js`) +
  **shadcn / Base UI** registry cho primitive.
- **zod 4** cho mọi response boundary.
- **i18next 26 + react-i18next 17**, namespace JSON, mặc định `vi`.
- **lucide-react** cho icon, **motion** cho animation, **cmdk** cho command
  palette, **@tanstack/react-table** + **react-virtual** + **react-virtuoso**
  cho bảng và danh sách dài.

### Backend

- **Go**, **Chi** router, **pgx/v5** + **sqlc** (query viết tay trong
  `server/pkg/db/queries/`, code sinh vào `pkg/db/generated`).
- **PostgreSQL 16**, **Redis 7** (relay realtime + rate limit).
- **gorilla/websocket** cho realtime, **Prometheus** cho metric,
  **OpenTelemetry** qua `server/internal/telemetry`.
- ID là **ULID trong cột `TEXT`** (`util.NewID()`), không dùng UUID.

### Tooling

- **pnpm 10 workspace + catalog**, **Turborepo**, **Vitest 4**,
  **Playwright** (`e2e/`), **knip**, **ESLint flat config** chia sẻ từ
  `packages/eslint-config/`.
- Phiên bản dependency dùng chung khai báo **một lần** trong khối `catalog:`
  của `pnpm-workspace.yaml`. Mỗi workspace vẫn tự khai báo cái nó import.

---

## 2. Cấu trúc thư mục

```
uniwork/
├── apps/
│   └── web/                  # Next.js App Router — host duy nhất
│       ├── app/              # route: /(auth), /[orgSlug]/[workspaceSlug], /admin
│       └── platform/         # NƠI DUY NHẤT chạm API của Next.js
├── packages/
│   ├── core/                 # headless: api, query, store, realtime, i18n, paths
│   ├── ui/                   # primitive nguyên tử + design token
│   ├── views/                # màn hình nghiệp vụ dùng chung + navigation adapter
│   ├── eslint-config/
│   └── tsconfig/
├── server/                   # Go
│   ├── cmd/                  # server, migrate, uniwork-admin
│   ├── internal/
│   │   ├── handler/          # HTTP: decode, map lỗi, SDI/SDO
│   │   ├── service/          # nghiệp vụ, membership gate, audit
│   │   ├── ai/               # gateway LLM (provider/ là nơi duy nhất có SDK vendor)
│   │   ├── audit/ outbox/    # append-only + phát event
│   │   └── middleware/ telemetry/ realtime/
│   ├── pkg/db/{queries,generated}/
│   └── migrations/
├── e2e/                      # Playwright
├── docs/                     # adr/, conventions.md, runbooks/, superpowers/
└── scripts/                  # governance test, generator
```

**Hướng phụ thuộc** (lint chặn, không phải quy ước miệng):

```
apps/web  →  views  →  core + ui
                       core ⊥ ui   (độc lập nhau)
```

`packages/core/` cấm `react-dom`, cấm `localStorage`/`sessionStorage` (đi qua
`StorageAdapter`), cấm `process.env` (origin đi qua `configureRuntime()`).
`packages/ui/` cấm import `@uniwork/core` và cấm logic nghiệp vụ.
`packages/views/` cấm `next/*` và `react-router-dom` — điều hướng qua
`useNavigation()` / `<AppLink>`.

**Lý do giữ 3 lớp dù hiện chỉ có một host:** ba adapter
(`NavigationAdapter`, `StorageAdapter`, `CoreProvider`) là chỗ duy nhất cần
viết lại khi thêm host desktop. Nếu gộp views vào apps/web thì không thể tách
lại về sau mà không viết lại toàn bộ màn hình.

---

## 3. Quy ước component

### Đặt file ở đâu

1. Primitive không biết nghiệp vụ → `packages/ui/components/ui/`, thêm bằng
   `pnpm ui:add <name>`.
2. Thành phần ghép có ngữ cảnh nghiệp vụ → `packages/views/<domain>/`.
3. Thứ dùng lại giữa nhiều domain nhưng vẫn là nghiệp vụ →
   `packages/views/common/`.
4. UI chỉ tồn tại trên web → `apps/web/`, hoặc inject qua props.

### Đặt tên và kích thước

- File `kebab-case.tsx`, component `PascalCase`, hook `use-*.ts`.
- Test nằm cạnh file: `board-view.tsx` ↔ `board-view.test.tsx`.
- **Tối đa 500 dòng** mỗi file `.ts`/`.tsx` (`max-lines`, bỏ dòng trống và
  comment). Quá ngưỡng nghĩa là hai module.
- Không export thứ không ai import (`pnpm knip` chạy trong `make check`).

### Bộ khung màn hình

Mọi màn hình trong shell workspace dùng đúng ba header trong
`packages/views/layout/`:

| Loại màn hình | Header |
| --- | --- |
| Danh sách / bộ sưu tập | `CollectionPageHeader` + `CollectionPageState` |
| Chi tiết một thực thể | `BreadcrumbHeader` (`segments` › `leaf`, `actions`) |
| Còn lại | `PageHeader` |

`CollectionPageState` xử lý empty và error. **Không bao giờ render hàng giả để
lấp trống** — trạng thái rỗng là một thiết kế, không phải chỗ trống.

Shell là `DashboardLayout`: `DashboardGuard` (auth → onboarding → workspace) →
`WorkspaceProvider` → `WSProvider` → `AppSidebar` → `NavigationProgress`.
Route trong `apps/web/app/` chỉ đọc params và render view.

### i18n

Mọi JSX text node trong `packages/views/` phải đi qua `t()`
(`i18next/no-literal-string` là lỗi lint). Locale là JSON theo namespace trong
`packages/core/i18n/locales/`, tiếng Việt là bản gốc, tiếng Anh là bản dịch.
Glossary vi–en và tông giọng nằm trong `docs/conventions.md` — đọc trước khi
viết copy. Đây là cửa duy nhất mà nội dung unidigiwork được đi vào.

---

## 4. Styling

- **`packages/ui/styles/tokens.css` là nguồn duy nhất.** Không có màu hardcode
  trong bất kỳ file nào khác.
- Token dùng qua **class ngữ nghĩa**: `bg-background`, `text-muted-foreground`,
  `border-border`. Không `bg-[#123456]`, không `text-gray-500`.
- Cỡ chữ dùng thang **đặt tên theo vai trò**: `text-micro`, `text-caption`,
  `text-label`, `text-body`, `text-title`, `text-display`. Không dùng thang
  mặc định của Tailwind (`text-sm`, `text-base`).
- **Mọi token có theme phải khai báo ở CẢ `:root` và `.dark`.** Viết
  `var(--slot-khac)` không miễn trừ: custom property được tính rồi mới kế thừa,
  nên slot chỉ có ở `:root` sẽ mang giá trị sáng xuống toàn bộ cây `.dark`.
  `packages/ui/styles/tokens.test.ts` chặn việc này.
- Mỗi thay đổi màu được kiểm chứng ở cả hai chế độ bằng
  `e2e/onboarding-contrast.spec.ts`, đo tương phản trên trang đã render. Đọc
  giá trị token không phải là kiểm chứng.
- Bốn hợp đồng accessibility nằm trong primitive và có test: `aria-disabled`
  giữ nút trong tab order, touch target ≥ 44px trên con trỏ thô, outline
  `:focus-visible` toàn cục là chỉ báo focus duy nhất, `StepperTitle` render
  `span` chứ không phải heading.

**Nơi bảng màu/font của unidigiwork hạ cánh:** chỉ trong khối `:root` và
`.dark` của `tokens.css`, cộng với biến font. Không có class utility mới, không
có file CSS thứ hai. Nếu một màu của unidigiwork không ánh xạ được vào slot
ngữ nghĩa nào thì thiếu slot, không phải thiếu ngoại lệ.

---

## 5. Xử lý dữ liệu

### Ranh giới mạng

```
component → hook (query/mutation) → api/endpoints/<domain>.ts → api/http.ts → HTTP
```

- `packages/core/api/http.ts` trả về `unknown`. Không bao giờ ép kiểu JSON
  mạng thành `T`.
- Chỉ `packages/core/api/endpoints/` được định hình response, qua
  `parseWithFallback(raw, schema, fallback, { endpoint })`.
- Schema **khoan dung**: enum của server là `z.string()`. Type export mới là
  chỗ thu hẹp. Do đó mọi `switch` trên enum server phải có `default`, và UI
  optional-chain field của server.
- Mỗi endpoint có một test response méo, chứng minh nó suy giảm chứ không ném
  lỗi. Ngoại lệ cố ý: login, register, complete-onboarding — không có session
  thì không có gì để render.

Thêm endpoint = thêm ba thứ cùng lúc: hàm, schema, và một case
malformed-response trong `api/endpoints/<domain>.test.ts`.

### Server state — TanStack Query

- Query key sinh từ factory `<feature>Keys` đặt cạnh hook.
- Key phạm vi workspace **luôn** chứa workspace id. Hook cần workspace thì nhận
  `wsId` làm tham số, không tự gọi `useWorkspaceId()` bên trong.
- Tách rõ key prefix (dùng để invalidate) và key đầy đủ (dùng cho
  `queryOptions`) — mẫu `list()` / `listSorted()` của multica là mẫu chuẩn.

### Client state — Zustand

- Store nằm trong `packages/core/`, không bao giờ trong `views` hay app.
- Chỉ auth store và `api/endpoints/*` được chạm transport. Mọi tương tác server
  khác là query hoặc mutation.
- Selector trả về tham chiếu ổn định (`useShallow` cho object).
- Persist: preference, draft, layout. Không persist dữ liệu server, không
  persist UI ephemeral.

### Realtime

- Event WebSocket **invalidate** query key
  (`packages/core/realtime/use-realtime-sync.ts`). Payload của frame **không
  bao giờ** được ghi vào cache hay store — cache được làm mới từ API.
- Tên event là `<entity>.<verb>`, payload chỉ chứa id, version nằm ở cột
  `event_version` chứ không nằm trong tên.
- Catalogue event tồn tại ba chỗ (`docs/events/CATALOGUE.md`,
  `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`) và
  `scripts/events-catalogue.test.mjs` fail khi chúng lệch nhau.

### Optimistic update

Chỉ khi **cả bốn** điều kiện đúng: kết quả đoán được cục bộ, người dùng ở lại
màn hình, thất bại là hiếm, rollback chỉ là khôi phục cache. Ví dụ chuẩn:
status/position của task trên board. Create, delete và mọi thứ có điều hướng
phải đợi server.

### Backend

- Ba lớp một chiều: `internal/handler` → `internal/service` → `pkg/db`.
  `server/internal/arch_test.go` fail nếu import đi ngược.
- Handler **không bao giờ** query database và không tiết lộ sự tồn tại của id
  cho người ngoài workspace. Path param được đưa thẳng cho service; service
  quyết định khả kiến qua `RequireMember`, trả `ErrForbidden`/`ErrNotFound`.
- Mọi body JSON đi qua `decode(w, r, &in, limit)` với trần 1 MiB.
- Mọi lệnh đổi trạng thái nghiệp vụ ghi một dòng `audit_events` và các dòng
  `outbox_events` **trong cùng transaction** với thay đổi đó. Chỉ package
  `internal/audit` được ghi hai bảng này.
- Mọi query lọc theo `workspace_id`; mọi bảng nghiệp vụ mới mang
  `organization_id TEXT NOT NULL`.
- Migration: **không FOREIGN KEY, không CASCADE**, quan hệ và dọn dẹp phụ thuộc
  giải quyết trong service, trong transaction khi cần. Mọi index là
  `CREATE INDEX CONCURRENTLY`, một câu lệnh một file.
- Route đăng ký qua wrapper `api` với `apiOp{sdi, sdo}`; OpenAPI dựng lúc khởi
  động process, không có file swagger commit vào repo.

---

## 6. Kiểm thử và cổng chất lượng

| Kiểm thử cái gì | Ở đâu |
| --- | --- |
| Logic dùng chung, store, endpoint, hook | `packages/core/**/*.test.ts(x)` |
| Màn hình, component | `packages/views/**/*.test.tsx` |
| Primitive, token | `packages/ui/**/*.test.ts(x)` |
| Hợp đồng repo (catalog, token cũ, governance, ADR) | `scripts/*.test.mjs` |
| Phân lớp Go, membership gate | `server/internal/arch_test.go` |
| Luồng đầu-cuối | `e2e/*.spec.ts` |

Quy tắc: test trong `packages/views/` **không mock `next/*`** — chúng mock
transport (`@uniwork/core/api/http`) để schema thật vẫn nằm trong vòng lặp.
Coverage chỉ đi lên: ngưỡng số nguyên trong vitest config mỗi package và
`server/coverage.floor`.

`make check` là cổng: typecheck → lint → unit + contract → Go → E2E.
Mức độ ngặt điều khiển bằng một từ trong file `GATE_LEVEL` (`fast` /
`standard` / `strict`).

---

## 7. Những gì của multica KHÔNG mang sang

| Không mang | Lý do |
| --- | --- |
| `apps/desktop/` (Electron) và toàn bộ Desktop Rules: `WindowOverlay`, `DragStrip`, tab group, `setCurrentWorkspace` | UniWork hiện có một host. Ba adapter đã đủ để thêm host sau. Mang Electron vào lúc chưa cần là gánh một router thứ hai, một pipeline release thứ hai và một lớp quy tắc routing thứ ba mà không ai chạy. |
| `apps/mobile/` (Expo/React Native) trong cùng cây phụ thuộc | Mobile của UniWork sẽ là app Expo riêng chỉ import type và pure function từ `packages/core/` (ADR 0011). Để nó trong workspace này kéo theo React Native vào lockfile, vào turbo graph và vào mọi `--filter=!` của multica — chính lý do multica phải viết `--filter=!@multica/mobile` trong sáu script khác nhau. |
| `apps/docs/` (Fumadocs) | Tài liệu UniWork là Markdown trong `docs/`, đọc trong repo. Một site docs với `fumadocs-mdx` kéo theo task `mdx` trong turbo và một vòng đua sinh `.source/` mà multica phải viết 15 dòng comment để giải thích. |
| `packages/plugin-sdk/`, `core/plugins`, `core/skills`, `core/runtimes`, `internal/daemon`, `internal/cloudruntime`, `pkg/agent`, `cmd/multica` (CLI) | Đây là mô hình agent của multica: agent chạy CLI thật trên máy người dùng qua một daemon. UniWork theo ADR 0010 — agent đi qua `ai.Gateway`, ghi nghiệp vụ theo đường proposal → human confirm → execute, và runtime không bao giờ ghi bảng nghiệp vụ. Hai mô hình bảo mật khác nhau; mang nửa này sang nửa kia tạo ra một đường ghi không ai kiểm toán. |
| `packages/core/api/client.ts` dạng monolith (**4.728 dòng**) và `schemas.ts` (**3.340 dòng**) | Đã thay bằng `api/endpoints/<domain>.ts` + `api/http.ts` với trần 500 dòng/file. Một file 4.700 dòng là điểm xung đột merge của mọi feature và không có ranh giới review. Bản thân `parseWithFallback` thì **giữ nguyên** — đó là phần đúng. |
| Component khổng lồ: `issue-detail.tsx` (**3.502 dòng**), `table-view.tsx` (2.528), `issues-header.tsx` (2.400) | Cùng lý do. Quy tắc 500 dòng là cách chặn nó tái diễn, không phải mục tiêu thẩm mỹ. |
| Quy tắc UUID ở handler: `parseUUIDOrBadRequest`, `loadIssueForUser`, `loadAgentForUser`, `util.ParseUUID` | UniWork dùng ULID trong `TEXT` và handler không query DB. Toàn bộ họ loader này tồn tại vì handler multica tự tra cứu thực thể — chính thứ `arch_test.go` của UniWork cấm. |
| Tầng workspace đơn với header `X-Workspace-ID` | UniWork có hai tầng thành viên: organization và workspace. Slug workspace chỉ duy nhất trong một organization, nên URL và handshake WebSocket mang cặp `/{orgSlug}/{wsSlug}`. Bê một tầng sang là phải viết lại toàn bộ permission và routing sau này. |
| Vườn tích hợp: `slack`, `lark`, `dingtalk`, `wecom`, `telegram`, `github`, `composio`, `discord` (mỗi cái một module ở core, views và server) | Chưa có nhu cầu nào của UniWork gọi tên chúng. Mỗi tích hợp là một bảng, một luồng OAuth, một webhook và một mặt phẳng bảo mật. Thêm khi có yêu cầu thật, một cái một lần, không port cả cụm. |
| Domain "issue" và từ vựng của nó (`issue-statuses`, `issue-views`, `labels`, `squads`, `pins`, `autopilots`) | Đây là nội dung sản phẩm, không phải kiến trúc. UniWork là task/meeting/document. Cấu trúc module (`queries.ts` / `mutations.ts` / `stores/` / `config/` cạnh nhau) thì giữ; tên và ngữ nghĩa thì không. |
| i18n landing dạng object TypeScript khổng lồ (`apps/web/features/landing/i18n/{en,zh,ko,ja}.ts`, mỗi file ~3.000 dòng) | UniWork dùng JSON theo namespace trong `packages/core/i18n/locales/`, kiểm được parity bằng test. Object TS 3.000 dòng không diff được, không giao cho người viết nội dung được, và nhân bốn theo số ngôn ngữ. |
| Bộ locale `zh-Hans` / `ja` / `ko` và tông giọng tiếng Trung | UniWork là **vi trước, en sau**. Voice guide tiếng Việt trong `docs/conventions.md` là nguồn duy nhất. |
| Registry trả phí `@reui` và `REUI_LICENSE_KEY` | Ràng buộc giấy phép và một biến môi trường bí mật trong quy trình `ui:add`. shadcn/Base UI đủ cho 67 primitive hiện có. |
| 455 migration lịch sử và các `cmd/backfill_*` | Lịch sử của một sản phẩm khác. UniWork bắt đầu từ schema của mình; `001`–`004` là lịch sử đã áp dụng và không viết lại. |
| Thư mục backfill một lần trong `internal/`: `attributionbackfill`, `chatoriginbackfill`, `issueactivitybackfill`, `taskusagebackfill`, `delegatedrecoverybackfill` | Nợ vận hành của multica, không phải mẫu. Backfill của UniWork là migration cộng một lệnh, xoá sau khi chạy. |
| `make up` / `make list` / `make destroy` với registry môi trường trong `~/.multica/dev/` | Giải bài toán nhiều môi trường song song trên một máy dev đông người. UniWork dùng `.env.worktree` + một container PostgreSQL dùng chung, đơn giản hơn và đã đủ. Nếu sau này đau thì lấy lại — mẫu này tốt, chỉ là chưa cần. |

### Những gì của multica **phải** mang sang (đã mang, giữ nguyên)

- Ba lớp package và hướng phụ thuộc một chiều, kèm lint chặn.
- `parseWithFallback` + schema khoan dung + test malformed response.
- Factory query key có `wsId`, tách prefix và key đầy đủ.
- Bốn điều kiện của optimistic update.
- Không FK, không CASCADE, index luôn `CONCURRENTLY` một câu một file.
- `catalog:` trong `pnpm-workspace.yaml` làm nơi ghim phiên bản duy nhất.
- Thủ thuật `cache-inputs` trong `turbo.json`: cạnh phụ thuộc chỉ để kéo hash
  file của package phụ thuộc vào task `test`, nếu không turbo sẽ replay cache
  trên code đã đổi.
- Kỷ luật tầng test: mỗi hành vi có **một** tầng chính tắc, ma trận biên nằm ở
  `.test.ts` cạnh helper, suite component giữ happy path và wiring.
- Fixture Go dùng chung (`testutil`/`dbfx`) thay cho `INSERT ... RETURNING` +
  `t.Cleanup(DELETE)` chép tay ở mỗi test.
- Token ngữ nghĩa + thang `--text-*` đặt tên theo vai trò.

---

## 8. Ánh xạ khái niệm

| multica | UniWork |
| --- | --- |
| issue | task |
| squad | project / team |
| autopilot | workflow |
| runtime / daemon / skill | agent qua `ai.Gateway` (ADR 0010) |
| workspace (một tầng) | organization + workspace (hai tầng) |
| `X-Workspace-ID` header | `/{orgSlug}/{wsSlug}` trong URL và handshake WS |
| UUID | ULID trong `TEXT` |
| `api/client.ts` | `api/endpoints/<domain>.ts` + `api/http.ts` |
| `packages/views/locales/` | `packages/core/i18n/locales/` |

## 9. UniWork thêm gì so với multica

Những thứ này không có trong multica và là quyết định riêng của UniWork:

- `audit_events` append-only (REVOKE + trigger) và `outbox_events` ghi cùng
  transaction — ADR 0009, ADR 0012.
- Tầng organization, vòng đời thành viên (`deactivated_at`), một chủ sở hữu
  tại một thời điểm.
- SDI/SDO + OpenAPI dựng lúc khởi động, không có spec commit.
- Console platform admin sau `RequirePlatformRole`, không bao giờ chạm nội dung.
- `correlation_id` là trace id, xuyên suốt audit row, event và access log.
- ADR có test governance, `GATE_LEVEL`, sàn coverage, gắn issue UniAI vào PR.
- Attribution là một cặp: `created_by` luôn đi kèm `created_by_kind`
  (`human` | `agent` | `system`).

## 10. Bước tiếp theo

1. **Bước 2** — phân tích unidigiwork: rút bảng màu, font, thang khoảng cách,
   và kiểm kê copy tiếng Việt theo màn hình. Đầu ra là một bảng ánh xạ
   `màu unidigiwork → slot token UniWork` và một danh sách namespace i18n.
2. Chốt slot token nào còn thiếu trước khi chạm `tokens.css`.
3. Chỉ sau đó mới viết code.
