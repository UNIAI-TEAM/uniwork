# UniWork — Port lớp base từ usf

**Ngày:** 2026-08-25
**Trạng thái:** Đã duyệt thiết kế trong chat (brainstorming với chủ dự án), chờ duyệt spec
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md` (đợt 1), `2026-08-25-onboarding-organizations-design.md` (đợt 2)

## 1. Mục tiêu

Đưa lớp **hạ tầng** của uniwork lên ngang usf (`../usf`) bằng cách port có chọn lọc, giữ nguyên schema
và handler Go hiện có, đồng thời **dựng lại toàn bộ tầng frontend** (`packages/views` + `apps/web`)
trên nền mới. Kết thúc bằng bộ tài liệu agent (`AGENTS.md`, `CLAUDE.md`, `docs/conventions.md`).

**Ngoài phạm vi:** desktop (Electron), mobile (Expo), docs site (Fumadocs), và mọi nghiệp vụ riêng của
usf — agents, issues, autopilots, skills, runtimes, daemon, CLI, billing, chat, inbox, squads, các
connector Slack/Lark/WeCom/DingTalk/GitHub/Composio.

## 2. Hiện trạng — khoảng cách đo được

Kiến trúc uniwork **đã đúng hình dạng** usf (monorepo pnpm+turbo, `apps/web` + `packages/{core,ui,views,
tsconfig,eslint-config}`, `server/` Go chi+pgx+sqlc, migrations, realtime WS, e2e Playwright), nhưng độ dày
còn xa:

| Lớp | usf | uniwork |
| --- | --- | --- |
| `packages/ui` | 62 primitive + 12 common + `markdown/` + `styles/` + `types/` + `components.json` | 14 primitive, không `common/`, không markdown |
| `packages/core` | 45 module (api client + zod, ws-client, platform, paths, permissions, feature-flags, navigation, modals, shortcuts, diagnostics, analytics, i18n adapter, hooks) | 11 module, phần lớn chỉ `hooks.ts` |
| `packages/views` | 38 domain + `common/`, `layout/`, `platform/`, `rich-content/`, `editor/`, `modals/`, `locales/` | 7 domain, không `common/`/`platform/` |
| `packages/eslint-config` | `base.js` · `react.js` · `next.js` | 1 file `index.mjs` |
| `server/internal` | 31 package; middleware 9 loại, auth cache, realtime relay, storage, metrics, events, featureflags, migrations lint | 10 package; middleware chỉ `auth.go`, util chỉ `ids.go` |
| Tooling | Makefile 13KB (worktree isolation, check pipeline), 20 script, 4 CI workflow, `.env.example` 23KB | Makefile 891B, 1 script, **không CI**, `.env.example` 454B |
| Tài liệu agent | `CLAUDE.md` 16KB + `AGENTS.md` + `CONTRIBUTING.md` + conventions.mdx | **không có** |

**Kết luận:** đúng khung xương, thiếu gần hết cơ bắp và toàn bộ tầng luật lệ cho agent.

## 3. Quyết định đã chốt

1. **Port có chọn lọc**, không clone-rồi-cắt.
2. **Chỉ web**, nhưng giữ nguyên cơ chế trừu tượng đa nền (`NavigationAdapter`, `StorageAdapter`,
   `core-provider`) để thêm desktop/mobile sau chỉ cần viết lớp platform.
3. **Giữ DB + handler Go**, dựng lại toàn bộ `packages/views` + `apps/web`.
4. **Lấy toàn bộ hạ tầng nâng cao**: realtime Redis relay, storage local+S3, metrics/flags/diagnostics.
5. **Tài liệu agent viết tiếng Anh**; conventions đặt ở `docs/conventions.md`.
6. **Phương án thực thi: lai** — một đợt sweep cơ học hàng loạt cho Tầng 1, rồi viết lại theo chiều dọc (từng lát màn hình) cho Tầng 2. Đã cân nhắc và loại: bottom-up thuần theo tầng (port 31k dòng không có người tiêu thụ tới tận bước cuối) và vertical-slice thuần (base vào nhỏ giọt, `packages/ui` bị bổ sung lắt nhắt nhiều đợt).

## 4. Ba tầng độ dính nghiệp vụ

Base của usf **không** đồng nhất. Đây là phát hiện quyết định cách làm:

- **Tầng 1 — hạ tầng thuần, copy gần như nguyên.** `api/schema.ts`, `ws-client`, `platform/*`,
  `diagnostics`, `analytics`, `feature-flags`, `shortcuts/platform`, toàn bộ `packages/ui`, eslint/tsconfig;
  server: `middleware` thuần, `auth` cache, `realtime` relay, `storage`, `metrics` hạ tầng, `events`,
  `util`, `migrations` lint.
- **Tầng 2 — lấy khuôn mẫu, viết lại theo domain uniwork.** `paths`, `permissions`, `types`,
  `navigation`/`modals` store, `views/{layout,common,platform}`, `shortcuts/definitions`,
  `middleware/{auth,workspace,owner_lookup}.go`.
- **Tầng 3 — bỏ.** Toàn bộ nghiệp vụ usf.

Phương án lai tách đúng hai chế độ này: Tầng 1 an toàn để làm hàng loạt vì **domain-free và có test**;
Tầng 2 nguy hiểm để làm hàng loạt vì nó **mã hoá domain của usf**.

## 5. Kiến trúc đích

```
uniwork/
├─ apps/web/                    # Next.js App Router — DUY NHẤT được import next/*
│  ├─ app/                      # routes
│  └─ platform/                 # MỚI: NavigationAdapter, StorageAdapter, env reader,
│                               # logger sink, client identity
├─ packages/
│  ├─ ui/                       # 62 primitive + common/ + markdown/ + styles/{base,tokens}.css
│  ├─ core/                     # headless: api, platform, paths, permissions, flags, stores…
│  ├─ views/                    # màn hình dùng chung — CẤM next/*
│  ├─ tsconfig/  eslint-config/ # base.js · react.js · next.js
├─ server/                      # Go: cmd, internal (infra + handler), pkg/db, migrations
├─ e2e/                         # Playwright
├─ scripts/  .github/workflows/ # MỚI
└─ AGENTS.md  CLAUDE.md  docs/conventions.md   # MỚI
```

### 5.1 Ranh giới package (luật cứng)

- `core/` — không `react-dom`, không `localStorage` (dùng `StorageAdapter`), không `process.env`, không UI lib.
- `ui/` — không import `@uniwork/core`, không nghiệp vụ.
- `views/` — không `next/*`, không `react-router-dom`, không định nghĩa store. Dùng `useNavigation()` / `<AppLink>`.
- `apps/web/platform/` — nơi duy nhất chạm API Next.js.
- Mọi workspace khai báo dependency trực tiếp trong `package.json` của chính nó; dùng `catalog:`.

### 5.2 Quy ước đổi tên khi port

| usf | uniwork |
| --- | --- |
| `@multica/{core,ui,views}` | `@uniwork/{core,ui,views}` |
| `github.com/multica-ai/multica/server` | `github.com/unicomhub/uniwork/server` |
| `MULTICA_*` env | `UNIWORK_*` |
| `X-Workspace-ID` | giữ, **thêm** `X-Org-ID` |
| comment nhắc issue/agent/Multica | viết lại theo domain uniwork |

### 5.3 Hai chỗ cố ý lệch khỏi usf

**(a) Tách `api/client.ts`.** File của usf dài **3.906 dòng**, trộn lõi transport (~500 dòng: `ApiError`,
`errorCode`, header `X-Client-*`, fetch + refresh 401) với toàn bộ bề mặt endpoint. uniwork dùng:

```
core/api/http.ts        # ApiError, errorCode, buildHeaders, request(), refresh 401
core/api/schema.ts      # parseWithFallback — copy nguyên
core/api/ws-client.ts   # copy nguyên
core/api/endpoints/     # auth.ts, organizations.ts, workspaces.ts, tasks.ts, meetings.ts…
```

Lý do: port nguyên là nhân bản nợ kỹ thuật ngay dòng đầu. Cấu trúc này giữ đúng *hợp đồng*
(mọi response qua `parseWithFallback`) mà không giữ khuyết điểm.

**(b) `paths` hai tầng.** usf phẳng `/{ws}/issues`; uniwork lồng `/{orgSlug}/{workspaceSlug}/…`.
Builder: `paths.org(o).workspace(w).tasks()`.

### 5.4 Hợp đồng design token — thay đổi một chiều

62 primitive của usf viết theo hợp đồng shadcn/Tailwind-4: `@theme inline` với tên ngữ nghĩa
(`--color-background`, `--color-muted-foreground`, `--color-brand`), class `bg-background` /
`text-muted-foreground`. uniwork hiện dùng hệ riêng tiền tố `--uw-*`. **Hai hệ không tương thích.**

**Quyết định:** lấy hợp đồng token của usf, giữ giá trị thương hiệu của uniwork. Bê nguyên khung
`@theme inline` + thang `--text-*` role-named + `--radius-*`, rót bảng màu `--uw-*` hiện tại vào đúng
khe ngữ nghĩa (`--uw-canvas`→`--background`, `--uw-brand`→`--brand`…), rồi xoá tiền tố `--uw-*`.

Lý do: (a) điều kiện cần để 62 primitive chạy không cần sửa, và để `pnpm ui:add` còn dùng được với
shadcn/ReUI về sau; (b) tầng FE vốn phải viết lại nên chi phí gần bằng 0; (c) mọi nguyên tắc trong
`PRODUCT.md` là kỷ luật *sử dụng*, không phụ thuộc tiền tố.

## 6. Tầng 1 — đợt sweep cơ học

### 6.1 Frontend (~160 file, ~19.000 dòng)

| Nguồn | File | Dòng | Ghi chú |
| --- | ---: | ---: | --- |
| `ui/components/ui/` | 62 | 9.411 | copy nguyên |
| `ui/markdown/` | 10 | 1.717 | copy nguyên |
| `ui/{lib,hooks,styles,types}/` | 13 | 1.161 | copy nguyên |
| `ui/components/common/` | 10/12 | ~750 | bỏ `multica-icon.tsx` (branding), `submit-button.tsx` (vi phạm ranh giới) |
| `core/platform/` | 13 | 1.042 | StorageAdapter, persist, cleanup, workspace-storage, notification |
| `core/analytics/` | 8 | 1.340 | redact-exception, dedupe, benign-exceptions |
| `core/feature-flags/` | 12 | 879 | hash/chain/static provider |
| `core/diagnostics/` | 5 | 592 | freeze-watchdog |
| `core/shortcuts/` | 3/6 | ~400 | `platform.ts` + `store.ts`; bỏ `definitions.ts` → Tầng 2 |
| `core/i18n/` | 11/15 | ~400 | bỏ `localize-portal-project*` |
| `core/hooks/`, `core/constants/` | 3 | 366 | use-file-upload |
| `core/api/{schema,ws-client}` + test | 4 | 1.526 | hợp đồng chống drift |
| `core/{logger,provider,query-client,utils,config}` | 5 | 247 | |
| `packages/eslint-config/` | 4 | 94 | base/react/next |

### 6.2 Server (~75 file, ~12.000 dòng)

| Nguồn | File | Dòng | Ghi chú |
| --- | ---: | ---: | --- |
| `internal/realtime/` | 11 | 3.376 | hub + broadcaster + redis_relay + sharded + lifecycle |
| `internal/storage/` | 8 | 2.347 | local (atomic write) + S3 |
| `internal/metrics/` | 14/31 | ~2.400 | giữ `config,db,http,registry,server,realtime,record_event,testutil`; bỏ `business_*`/`wecom`/`daemonws`/`pricing`/`labels` |
| `internal/middleware/` | 10/18 | ~1.700 | `ratelimit,csp,client,request_logger,cloudfront` copy nguyên; `auth,workspace,owner_lookup` → Tầng 2 |
| `internal/auth/` | 8/13 | ~1.300 | `jwt,cookie,membership_cache,pat_cache`; bỏ `cloud_pat,daemon_token_cache` |
| `internal/{events,featureflags,logger,util,migrations}` | 24 | 1.715 | `util/mention.go` → Tầng 2 |

**Tổng: ~235 file, ~31.000 dòng.**

### 6.3 Ba luật của đợt sweep

1. **Port code kèm test, không tách rời.** Test đi kèm là lưới an toàn duy nhất chứng minh port không
   làm hỏng gì. Copy code mà bỏ test là biến đợt sweep thành 31k dòng không ai kiểm chứng.
2. **Không sửa logic trong đợt sweep.** Chỉ đổi import path, module path Go, chuỗi thương hiệu. Nếu sweep
   vừa di chuyển vừa sửa, khi test đỏ không phân biệt được lỗi do di chuyển hay do sửa.
3. **Cổng chống rò rỉ domain.** Sau mỗi lô, `grep -ri "multica\|issue\|agent\|autopilot\|squad\|skill"`
   trên file vừa port; mỗi hit phải được viết lại hoặc ghi nhận là hợp lệ.

### 6.4 Cổng kiểm chứng sau mỗi lô

```sh
pnpm typecheck && pnpm test                     # sau mỗi lô ui/core
cd server && go build ./... && go test ./...    # sau mỗi lô server
pnpm lint                                       # bắt vi phạm ranh giới package
grep -ri "multica" packages/ server/            # phải rỗng
```

Lô nào không xanh thì dừng và sửa trong lô đó, không dồn sang lô sau.

## 7. Tầng 2 — viết lại theo domain uniwork

### 7.1 Domain thật (đọc từ migration)

`users` · `organizations` + `organization_members{owner,admin,member}` · `workspaces` +
`workspace_members{owner,admin,member}` · `invitations` · `tasks` + `task_comments` · `meetings` +
`meeting_attendees` + `meeting_notes` · `refresh_tokens`.

Khác biệt bản chất so với usf: **uniwork có hai tầng thành viên** (tổ chức *và* workspace), usf chỉ có
một. Điều này lan vào `paths`, `permissions`, middleware server — và là lý do chính khiến Tầng 2 không
copy được.

### 7.2 core/ — module viết lại

| Module | Khuôn từ usf | Việc phải làm |
| --- | --- | --- |
| `paths/` | `paths.ts`, `resolve.ts`, `consistency.test.ts` | Builder 2 tầng. Port test consistency **trước**, viết builder sau |
| `permissions/` | `rules.ts`, `types.ts`, `use-resource-permissions.ts` | `PermissionContext` mang **cả** `orgRole` và `wsRole`; thêm `DecisionReason` `not_org_member`. Giữ nguyên hình dạng `Decision{allowed,reason,message}` |
| `types/` | `types/*.ts` | Tách `index.ts` (118 dòng) thành `types/{user,organization,workspace,invitation,task,meeting,events}.ts` |
| `api/endpoints/` | `client.ts` (chỉ lấy hình dạng) | 1 file/domain trên `http.ts`. Mọi response qua `parseWithFallback` + test "server trả rác" |
| `auth/store.ts` | usf auth store | Ghép với luồng refresh-token hiện có |
| `realtime/` | `provider.tsx`, `use-realtime-sync.ts` | Thay `use-workspace-events.ts`. WS chỉ patch/invalidate Query, **không** mirror vào Zustand |
| `navigation/`, `modals/` | `store.ts` | Copy khuôn, nội dung theo route uniwork |
| `shortcuts/definitions.ts` | `definitions.ts` | Phím tắt uniwork (`g t` tasks, `g m` meetings…) |
| `i18n/locales/` | `views/locales/` | `vi` + `en`, giữ `parity.test.ts` đã có |

### 7.3 views/ — ba thư mục hạ tầng

- **`views/platform/`** — `NavigationAdapter`, `useNavigation()`, `<AppLink>`, `scroll-restoration`.
  Không có nó thì luật "views không đụng `next/*`" chỉ là khẩu hiệu.
- **`views/layout/`** — `app-shell`, `sidebar`, `breadcrumb-header`, `page-header`, `dashboard-guard` +
  `use-dashboard-guard`, `workspace-loader`, `global-shortcuts`, `navigation-progress`, `collection-page`.
  Điều hướng theo IA của `PRODUCT.md` (My Work / Communication / Knowledge / Automation / Insights).
- **`views/common/`** — 13/47 file generic của usf: `color-utils`, `date-only-picker`,
  `deferred-tooltip`, `deferred-popup`, `expandable-description`, `format-in-time-zone`, `picker-keys`,
  `pill-button`, `prop-row`, `segmented-toggle`, `shortcut-keycaps`, `use-debounced-value`,
  `avatar-crop` + `avatar-upload-control`, `timezone-select`. Bỏ phần dính usf.

### 7.4 server/ — Tầng 2

`middleware/{auth,workspace,owner_lookup}.go` chạm `db/generated` nên viết lại theo query uniwork, và mở
rộng thêm một tầng: `RequireOrgMember` → `RequireWorkspaceMember`.

### 7.5 Dựng lại FE theo 5 lát dọc

18 route, 38 file view. Mỗi lát đi trọn `paths` → `permissions` → `api/endpoints` → `views` → route → e2e:

1. **Shell + auth** — platform adapter, login/register, `DashboardGuard`, app-shell, sidebar.
   *Lát này là bài kiểm tra ranh giới*: nếu `views/` không dựng được login mà không đụng `next/*`, thiết kế
   sai và phải sửa ngay, không để đến lát thứ năm.
2. **Org + workspace** — picker, switcher, members, invitations, accept-invite.
3. **Onboarding 4 bước** — port lại trên base mới.
4. **Tasks** — list/board/detail; optimistic update chỉ patch cache xác định, không optimistic khi có điều hướng.
5. **Meetings** — detail/room/LiveKit.

## 8. Tooling và CI

### 8.1 Makefile

**Lấy:** `help` (self-documenting `##`), `setup`, `start`, `stop`, `check`, `db-up/down/reset`,
`migrate-up/down`, `sqlc`, `build`, `test`, `clean`, `dev`, `server`, và bộ worktree: `worktree-env`,
`setup-worktree`, `start-worktree`, `check-worktree`.
**Bỏ:** `cli`, `uniai`, `daemon`, `selfhost*`, helm.

Worktree isolation cấp cho mỗi git worktree một **tên DB + cổng riêng** qua `.env.worktree`, nên nhiều
agent chạy song song trên nhiều nhánh không giẫm lên DB của nhau. Nó cũng vá quirk cổng 8090 hiện phải sửa tay.

### 8.2 scripts/

Port `check.sh` (pipeline typecheck → unit → Go → E2E, tự dựng và tự dọn service, chỉ kill process do
chính nó khởi động), `local-env.sh`, `ensure-postgres.sh`, `init-worktree-env.sh`, `dev.sh`, `test-go.sh`.
Giữ `generate-reserved-slugs.mjs`.

### 8.3 CI — `.github/workflows/ci.yml`

Bốn job (cắt từ 8 của usf):

- `changes` — path filter, quyết định job nào chạy.
- `frontend-build` — build + typecheck + lint, turbo cache restore, **verify `reserved-slugs.ts` đã đồng bộ**.
- `frontend-test` — vitest, turbo cache.
- `backend` — Go build + migrate + `go test`, service `postgres:17` + `redis`.

Bỏ `windows-execenv`, `installer`, `desktop-smoke`, `mobile-verify`.

### 8.4 turbo.json — hai sửa lỗi tinh vi

1. `globalDependencies: [".github/workflows/ci.yml"]` — không có nó, nâng Node trong CI sẽ replay cache của
   runtime cũ và giấu lỗi tương thích sau dấu tích xanh.
2. Task trung chuyển `cache-inputs` + `test: { dependsOn: ["^cache-inputs"] }` — không có nó, sửa
   `packages/views` hay `packages/ui` để lại hash của `web#test` y hệt và turbo replay một lượt pass cũ
   trên code đã đổi. `turbo.json` hiện tại của uniwork (`"test": {}`) đang dính đúng lỗi này.

## 9. Bộ tài liệu agent

**Tên file: `AGENTS.md`** (số nhiều) — quy ước usf đang dùng và là tên các công cụ khác đọc được.

### 9.1 `CLAUDE.md` (gốc repo) — nguồn sự thật, tiếng Anh

16 mục theo cấu trúc usf, nội dung uniwork: Conventions (trỏ `docs/conventions.md`) · Project Shape ·
State Rules · Package Boundaries · Sharing Rules · Commands · Database & Migration Rules · Coding Rules ·
API Compatibility · Backend UUID Rules · Web Features · UI Rules · Testing · Verification · Commits ·
Domain Reminders.

Luật **riêng của uniwork**, không có ở usf:

- Mọi truy vấn lọc theo `workspace_id`; **quyền là hai tầng** — tư cách thành viên tổ chức gác trước, rồi
  tới workspace. `X-Org-ID` + `X-Workspace-ID`.
- Route dạng `/{orgSlug}/{workspaceSlug}/…`; slug tổ chức và slug workspace dùng **chung** không gian tên
  dành riêng (`reserved_slugs.json`).
- i18n: `vi` là ngôn ngữ gốc, `en` là bản dịch — không phải chiều ngược lại. Có parity test.
- Token: chỉ dùng tên ngữ nghĩa và thang `--text-*`; cấm `text-sm`/`text-base` của Tailwind và cấm màu hardcode.

### 9.2 `AGENTS.md` (gốc repo) — con trỏ ngắn

Nêu rõ CLAUDE.md là nguồn sự thật duy nhất, rồi Quick Reference: kiến trúc, state, ranh giới package, luật
migration, lệnh hay dùng. Không lặp lại CLAUDE.md.

`apps/web/AGENTS.md` giữ nguyên khối `nextjs-agent-rules` do `next dev` tự sinh.

### 9.3 `docs/conventions.md`

Đặt tên (route/package/file/cột DB/type), **glossary i18n Việt–Anh** (task/nhiệm vụ, workspace/không gian
làm việc, organization/tổ chức…), giọng văn tiếng Việt cho UI (xưng hô, câu lệnh, thông báo lỗi), quy ước commit.

### 9.4 Nguyên tắc viết

**Viết sau cùng, mô tả cái đã tồn tại.** Tài liệu agent viết trước khi code xong là mô tả ước muốn — agent
sẽ theo nó và trật. Mỗi luật phải kiểm chứng được bằng một lệnh hoặc một test đang chạy thật.

Ngoại lệ có chủ đích: một bản **CLAUDE.md nháp** ra đời ở pha 0 (chỉ Project Shape + Package Boundaries +
Commands), vì chính các agent làm đợt port cần luật ranh giới để không vi phạm. Bản nháp được viết lại ở pha 6.

## 10. Kiểm thử

### 10.1 Test nằm cạnh code

| Kiểm cái gì | Ở đâu |
| --- | --- |
| Logic nghiệp vụ, store, query, hook dùng chung | `packages/core/*.test.ts` |
| Component/màn hình/form dùng chung | `packages/views/*.test.tsx` |
| Nối nền tảng (cookie, redirect, search param) | `apps/web/*.test.tsx` |
| Luồng đầu-cuối | `e2e/*.spec.ts` |
| Backend | `server/` Go test |

Luật: cấm test hành vi component dùng chung trong file test của app; `packages/views/` test **không được**
mock `next/*`.

### 10.2 Bốn test-contract bắt buộc

1. `paths/consistency.test.ts` — quét `apps/web/app/`, ép mọi route có builder tương ứng. Bắt hardcode string path.
2. **Malformed-response test cho mọi endpoint** — server trả rác thì UI degrade chứ không trắng màn. Không
   có test này thì `parseWithFallback` chỉ là lớp trang trí.
3. `i18n parity.test.ts` — vi/en đủ cặp khoá (đã có, giữ).
4. `migrations_lint_test.go` — ép luật **không FOREIGN KEY** và **mọi index dùng `CREATE INDEX CONCURRENTLY`
   trong file một câu lệnh**. Đây là luật cứng duy nhất không thể tự kiểm bằng mắt.

### 10.3 Migration hiện có vi phạm cả hai luật — xử lý forward-only

Audit thực tế: 4 migration hiện có chứa **20 `REFERENCES`** và **0/7 index dùng `CONCURRENTLY`**.

Vì đã chốt giữ DB, luật áp dụng **chỉ cho migration mới**. `migrations_lint_test.go` dùng đúng cơ chế
baseline của usf (`maxLegacyMigrationPrefix`): đặt ngưỡng ở `004`, mọi migration từ `005` trở đi phải tuân thủ.
Không sửa ngược 001–004.

## 11. Thứ tự thực thi — 7 pha

| Pha | Nội dung | Cổng ra |
| --- | --- | --- |
| 0 | Nền tảng build: pnpm 10, catalog mở rộng, eslint 3 tầng, `turbo.json` (2 sửa lỗi cache), CLAUDE.md nháp | `pnpm install` + `typecheck` xanh |
| 1 | Hợp đồng token: khung `@theme inline` của usf + giá trị màu uniwork, xoá `--uw-*` | app dựng được, không trắng màn |
| 2 | Sweep Tầng 1 — FE (~160 file) | `typecheck` + `test` + `lint` xanh, `grep multica` rỗng |
| 3 | Sweep Tầng 1 — server (~75 file) | `go build ./... && go test ./...` xanh |
| 4 | Tầng 2 core: `paths` 2 tầng, `permissions` 2 tầng, `types` tách file, `api/http.ts` + `endpoints/`, realtime provider | test-contract 1+2 xanh |
| 5 | Dựng lại FE theo 5 lát dọc | e2e hiện có xanh trở lại |
| 6 | Tooling + CI + `AGENTS.md`/`CLAUDE.md`/`docs/conventions.md` bản chính thức | `make check` xanh trên CI |

Pha 2 và 3 độc lập → chạy song song được.

**Trạng thái FE giữa chừng.** Từ pha 1 tới hết pha 4, `packages/views` và `apps/web` hiện tại chạy trên hợp
đồng token mới nhưng chưa được dựng lại — giao diện sẽ lệch và xấu. Đây là **trạng thái tạm được chấp nhận
có chủ ý**, không phải hồi quy cần sửa: pha 5 dựng lại toàn bộ. Cổng chất lượng giao diện duy nhất là cuối
pha 5, khi 5 spec e2e onboarding (gồm contrast/focus/mobile) phải xanh trở lại.

## 12. Rủi ro và cách chặn

**1. Bùng nổ dependency.** `packages/ui` kéo theo ~30 gói mới (`@base-ui/react`, `cmdk`, `motion`,
`recharts`, `shiki`, `emoji-mart`, chuỗi `react-markdown`/`remark`/`rehype`, `vaul`, `sonner`,
`react-day-picker`, `embla-carousel-react`, `input-otp`, `katex`, `linkify-it`, `next-themes`,
`@number-flow/react`, `react-resizable-panels`, `@tanstack/react-table`, `@tanstack/react-virtual`,
`date-fns`, `tw-animate-css`, `unicode-animations`); server kéo `aws-sdk-go-v2` + `prometheus/client_golang`.
→ Đưa hết vào `catalog:` ở pha 0, chốt phiên bản một lần.

**2. Lệch công cụ.** uniwork đang pnpm **9.15**, usf pnpm **10.28** và dùng trường `onlyBuiltDependencies`
(chỉ pnpm 10 hiểu). → Nâng uniwork lên pnpm 10 ở pha 0. Go 1.27 của uniwork biên dịch được code Go 1.26 của
usf; React đã trùng 19.2.3.

**3. 31.000 dòng code không có người dùng** — rủi ro lớn nhất của phương án lai. Sweep xong thì `metrics`,
`storage`, `realtime relay` là ~8k dòng chưa ai gọi.
→ **Luật nghiệm thu:** mỗi module port sang phải hoặc (a) còn nguyên test đi kèm và test đó xanh, hoặc
(b) có ít nhất một consumer thật trong cùng pha. Không đạt cả hai thì **không port**. Cụ thể: `realtime relay`
nối vào hub, `storage` nối vào upload avatar, `metrics` phơi `/metrics`. Module nào không tìm được consumer
thì cắt khỏi phạm vi và **báo rõ**, không lẳng lặng để đó.

**4. Tách `client.ts` 3.9k dòng làm rơi chi tiết transport.** → `schema.ts` và `ws-client.ts` copy nguyên
kèm test; `http.ts` viết tay đối chiếu vùng transport của usf, port test của usf cho phần đó **trước** khi viết.

**5. Mất thành quả đợt 1.** e2e onboarding hiện có (5 spec: smoke/shell/contrast/focus/mobile) là hợp đồng
hồi quy — phải xanh trở lại ở cuối pha 5, **không được sửa test cho vừa code mới**.

## 13. Quy mô

~235 file sweep + ~40 file Tầng 2 viết mới + 38 view dựng lại. Nhiều đợt làm việc, không phải một buổi.
Pha 0–3 phần lớn cơ học và verify được bằng máy; pha 4–5 cần suy xét thật.
