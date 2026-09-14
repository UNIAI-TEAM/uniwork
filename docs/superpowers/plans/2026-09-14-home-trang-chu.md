# Trang chủ (Home) — Plan triển khai

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gốc workspace `/{org}/{ws}` thành Trang chủ (khi flag `home_page` bật): tổng quan hôm nay, công việc của tôi, cuộc họp sắp tới, hộp việc, tóm tắt hôm nay; tuỳ biến khối theo người dùng.

**Architecture:** Một endpoint tổng hợp `GET /workspaces/{id}/home` (service `HomeService` cho task + meeting, handler ghép `notification.Service`), bảng `home_preferences` cho tuỳ chọn, module `packages/core/home` (schema, hooks, prefs, brief) và `packages/views/home` (các khối). Không có sự kiện mới; realtime chỉ invalidate.

**Tech Stack:** Go (chi, pgx, sqlc), TypeScript strict, TanStack Query, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-home-trang-chu-design.md`

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go chạy trong `bash -c`, nạp env như `scripts/check.sh`, `TZ=UTC`, `-v`, trích `--- PASS` (dưới zsh test DB lặng lẽ SKIP).
- Migration `185_home_preferences`: không FK, có `organization_id TEXT NOT NULL`, có `.down.sql`, không index thêm.
- Membership chỉ qua `WorkspaceService.requireActorMember`; mọi query task lọc `organization_id` + `workspace_id`; meeting lọc `workspace_id` (bảng còn nợ `organization_id`).
- Prefs không audit, không outbox (spec §2 #13).
- Response client qua `parseWithFallback`; mỗi endpoint mới có case malformed.
- JSX trong `packages/views` qua `t()`; vi trước, en cùng khoá; không khoá trùng.
- Màu chỉ bằng token ngữ nghĩa (`text-destructive`, `text-muted-foreground`…); cỡ chữ `text-caption` / `text-body` / `text-title`.
- File `.ts/.tsx` ≤ 500 dòng; comment tiếng Anh; không export thừa (`pnpm knip`).
- Commit sau mỗi task, tiền tố `feat(home)`, `feat(db)`, `test(e2e)`, `docs`.

## File map

| Vùng | File |
| --- | --- |
| DB | `server/migrations/185_home_preferences.{up,down}.sql`, `server/pkg/db/queries/home.sql`, `server/pkg/db/generated/*` (sqlc), `server/internal/testutil/db.go` |
| Service | `server/internal/service/home.go`, `home_test.go` |
| HTTP | `server/internal/handler/home.go`, `home_test.go`, `dto/sdi/home.go`, `dto/sdo/home.go`, `router/home.go`, `router/routes.go`, `router/router.go`, `handler/router.go`, `handler/auth_test.go` (deps), `cmd/server/main.go` |
| Flag | `server/internal/featureflags/keys.go`, `packages/core/feature-flags/{keys,index}.ts` |
| Core | `packages/core/types/home.ts`, `types/index.ts`, `api/endpoints/home.ts` + test, `home/hooks.ts`, `home/prefs.ts` + test, `home/brief.ts` + test, `realtime/use-realtime-sync.ts` + test, `package.json`, `i18n/locales/{vi,en}.json` |
| Views | `packages/views/home/{index.ts,home-view.tsx,home-greeting.tsx,home-stats.tsx,home-my-work.tsx,home-my-work-row.tsx,home-upcoming.tsx,home-inbox.tsx,home-brief.tsx,home-customize-panel.tsx,home-partial-notice.tsx,home-layout.ts}` + tests, `layout/app-sidebar.tsx` + test, `layout/module-tones.ts`, `package.json` |
| Web | `apps/web/app/[orgSlug]/[workspaceSlug]/page.tsx` |
| E2E | `e2e/home.spec.ts`, `e2e/db.ts` |
| Docs | `docs/roadmap/FEATURE_ROADMAP.md`, `docs/roadmap/LEGACY_REFERENCE_MAP.md`, plan này |

---

## Task 1: DB, flag và `HomeService`

**Interfaces — Produces:**

```go
type HomeLimits struct{ Tasks, Meetings int32 }                 // 0 → mặc định 8 / 5; trần 20 / 10
type HomeCounts struct{ Open, Overdue, DueToday, MeetingsToday int64 }
type HomeSummary struct {
	Today, Timezone string        // "2026-09-14", "Asia/Ho_Chi_Minh"
	Counts          HomeCounts
	MyWork          []db.Task
	Meetings        []db.Meeting
	Partial         []string       // "tasks" | "meetings"
	GeneratedAt     time.Time
}
type HomePreferenceView struct{ Prefs json.RawMessage; UpdatedAt pgtype.Timestamptz }
func NewHomeService(q *db.Queries, ws *WorkspaceService) *HomeService
func (s *HomeService) Summary(ctx context.Context, actor Actor, workspaceID string, lim HomeLimits) (HomeSummary, error)
func (s *HomeService) GetPreference(ctx context.Context, actor Actor, workspaceID string) (HomePreferenceView, error)
func (s *HomeService) PutPreference(ctx context.Context, actor Actor, workspaceID string, prefs json.RawMessage) (HomePreferenceView, error)
const maxHomePrefsBytes = 8 << 10
```

Queries (`home.sql`): `ListHomeMyWork`, `CountHomeMyWork` (open/overdue/due_today), `ListHomeMeetings`, `CountHomeMeetingsToday`, `GetHomePreference`, `UpsertHomePreference` — điều kiện đúng như spec §3.2. "Mở" = `COALESCE(ts.category, t.status) NOT IN ('done','cancelled')` với `LEFT JOIN task_statuses ts ON ts.workspace_id = t.workspace_id AND ts.key = t.status`.

- [ ] Viết `home_test.go` với `TestHomeSummaryOrdersMyWorkByUrgency`, `TestHomeSummaryCountsFollowUserTimezone`, `TestHomeSummaryMeetingsOnlyMineTodayTomorrow`, `TestHomeSummaryForbiddenForNonMember`, `TestHomePreferenceRoundTripAndValidation` (spec §8).
- [ ] Chạy, xác nhận FAIL vì thiếu `HomeService`.
- [ ] Migration, `home.sql`, `sqlc generate`, TRUNCATE, flag `home_page`, `home.go`.
- [ ] Chạy lại, 5 `--- PASS`, migration lint và `TestFlagsAreReviewed` xanh.
- [ ] Commit `feat(home): HomeService, bảng home_preferences và flag home_page`.

## Task 2: HTTP

**Interfaces — Consumes:** Task 1. **Produces:** `GET /api/v1/workspaces/{workspaceID}/home?limit_tasks&limit_meetings&limit_inbox`, `GET|PUT /api/v1/workspaces/{workspaceID}/home/preferences`; SDO `HomeSummarySDO{today, timezone, counts{open,overdue,due_today,meetings_today,unread}, my_work[TaskDTO], upcoming_meetings[MeetingDTO], inbox[NotificationDTO], partial[], generated_at}`, `HomePreferenceSDO{prefs, updated_at}`; SDI `PutHomePreferenceSDI{prefs}`. Handler: `Notifications.List(UnreadOnly, WorkspaceID, limit)` + `UnreadCount().ByWorkspace[ws]`; lỗi → `partial += "notifications"`; lỗi `taskDTOs` → `partial += "tasks"`.

- [ ] `TestHomeEndpoints`: owner giao task cho member (hạn hôm nay), chạy outbox consumer; member GET home → `my_work[0].identifier`, `inbox[0].kind == task_assigned`, `counts.unread == 1`, `counts.due_today == 1`, `partial == []`; người ngoài workspace → 403/404; PUT prefs `[]` → 400; PUT `{layout:"compact"}` rồi GET trả lại.
- [ ] FAIL → implement DTO, handler, router, Routes, main, test deps → PASS; `TestEveryRouteFieldIsBound`, `swagger_test` xanh.
- [ ] Commit `feat(home): API tổng hợp trang chủ và tuỳ chọn`.

## Task 3: Core

**Produces:**

```ts
// types/home.ts
HomeSummarySchema; type HomeSummary = { today; timezone; counts: HomeCounts; my_work: Task[]; upcoming_meetings: Meeting[]; inbox: Notification[]; partial: string[]; generated_at }
HomePreferenceSchema; type HomePreference = { prefs: Record<string, unknown>; updated_at: string }
// api/endpoints/home.ts
getHomeSummary(wsId): Promise<HomeSummary | null>   // mảng/số lệch → [] / 0; không phải object → null
getHomePreference(wsId): Promise<HomePreference>    // lệch → { prefs: {}, updated_at: "" }
putHomePreference(wsId, prefs: HomePrefs): Promise<HomePreference | null>
// home/prefs.ts
HOME_SECTION_KEYS = ["stats","mywork","upcoming","inbox","brief"]; HOME_LAYOUTS = ["compact","balanced","wide"]
DEFAULT_HOME_PREFS; HOME_PRESETS: { key: "executive"|"doer"|"minimal"; prefs: HomePrefs }[]
normalizeHomePrefs(raw: unknown): HomePrefs; moveSection(order, key, -1|1); visibleSections(prefs)
// home/brief.ts
overdueDays(today: string, due: string): number
buildHomeBrief(summary: HomeSummary): { key: string; params: Record<string, string | number> }[]  // ≤ 3
// home/hooks.ts
homeKeys.summary(wsId) = ["home", wsId, "summary"]; homeKeys.prefs(wsId) = ["home", wsId, "prefs"]
useHomeSummary(wsId); useHomePrefs(wsId) → { prefs, saving, update, reset }
useCompleteHomeTask(wsId) (mutate(taskId)); useBulkCompleteHomeTasks(wsId) (mutate(taskIds))
// feature-flags/keys.ts
HOME_PAGE_FLAG = "home_page"
```

- [ ] Test trước: `home.test.ts` (3 endpoint, case malformed), `prefs.test.ts`, `brief.test.ts`, case realtime (task / meeting / notification invalidate `["home","ws1","summary"]`).
- [ ] Implement; i18n `nav.home` + nhóm `home.*` (spec §10) cả vi và en; exports `./home`, `./home/*`.
- [ ] `vitest run` các file trên, `parity.test.ts`, `pnpm --filter @uniwork/core typecheck`.
- [ ] Commit `feat(home): core trang chủ — schema, hooks, tuỳ chọn, tóm tắt`.

## Task 4: Views, sidebar và route

- [ ] Test trước: `home-view.test.tsx` (có dữ liệu; rỗng; lỗi + thử lại; partial; ẩn hết khối), `home-my-work.test.tsx` (Hoàn thành → PATCH `status: done`; chọn 2 → batch-update; `j` rồi `c` trên listbox), `home-customize-panel.test.tsx` (tắt khối, lên/xuống, preset), `home-layout.test.ts`, sidebar (có `Trang chủ` khi flag bật, active chỉ khi đúng gốc).
- [ ] Implement các khối; sidebar đọc `useFlag(HOME_PAGE_FLAG, false)`, mục Home active khi `pathname === ws.root()`; `module-tones` thêm `home: "gray"`; page gốc đợi `usePublicConfig` rồi render `HomeView` hoặc redirect `/tasks`.
- [ ] `vitest run packages/views/home layout/app-sidebar`, typecheck, lint các file chạm.
- [ ] Commit `feat(home): màn Trang chủ và mục sidebar sau flag home_page`.

## Task 5: E2E, docs, kiểm chứng

- [ ] `e2e/home.spec.ts` + helper `setGlobalFlagOverride` trong `e2e/db.ts`: bật flag, đăng ký, onboarding, tạo task giao cho mình hạn hôm nay, mở gốc workspace, thấy task trong "Công việc của tôi", bấm Hoàn thành, dòng mờ đi; xoá override.
- [ ] Roadmap A-05 và bản đồ bản cũ trỏ spec.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm knip`, `bash scripts/test-go.sh` (hoặc gói chạm tới với `-race`), `node --test scripts/*.test.mjs`.
- [ ] Commit `test(e2e): luồng vàng trang chủ` và `docs: roadmap A-05 lát Trang chủ`.
