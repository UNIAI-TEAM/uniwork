# UniWork — Trang chủ (Home): My Work · Sắp tới · Hộp việc · Tóm tắt hôm nay

> **Trạng thái:** Đề xuất — chờ duyệt (viết 2026-09-14 trong phiên tự động, chưa có
> lượt duyệt của chủ sở hữu sản phẩm; các quyết định ở §2 là lựa chọn của người viết
> spec, câu hỏi cần quangpd quyết nằm ở §11). Lát 1 đã triển khai trên nhánh
> `feature/UNI-451-home-trang-chu` (plan `../plans/2026-09-14-home-trang-chu.md`), chưa merge.
> Làm lại giao diện 2026-09-24: khối "Tóm tắt hôm nay" đã bỏ, nội dung chuyển vào dòng
> dưới lời chào; xem §"Làm lại 2026-09-24" cuối file — mục đó thắng các chỗ cũ bên trên.

**Ngày:** 2026-09-14
**Issue:** UNI-451 (A-05 · Insights: home brief, dashboard inline, work economics) — lát 1
"Trang chủ". Nhánh `feature/UNI-451-home-trang-chu`. Chưa chạy `make issue-start`
(xem §11 câu 1).
**Parent roadmap:** A-05 (Insights) — phần "home brief"; kế thừa My Work của F-05.
**Spec liên quan:** `2026-09-07-tasks-work-management-parity-design.md` (My Tasks, API
`my-tasks`, batch update), `2026-09-04-notifications-design.md` (hộp việc, `resourceHref`),
`2026-08-29-meeting-world-class-design.md` (trạng thái cuộc họp), `2026-09-04-platform-admin-observability-design.md`
(feature flag theo organization), `2026-09-04-ai-platform-gateway-design.md` (điều kiện
để có tóm tắt AI ở lát 2).
**Tham chiếu:** `packages/views/my-tasks/`, `packages/views/notifications/inbox-view.tsx`,
`packages/core/tasks/hooks.ts` (`useUpdateTask`, `useBatchUpdateTasks`),
`server/internal/service/task_view.go` (`task_view_preferences` — mẫu prefs JSONB theo user),
`server/internal/featureflags/keys.go`. Bản cũ (đối chiếu hành vi, **không copy mã**):
`../unidigiwork/src/routes/_authenticated/home.tsx`, `src/components/home/*`,
`src/lib/home-prefs.ts`, `src/lib/api/home.server.ts`, `home-brief.server.ts`,
`.lovable/plan/tùy-biến-view-home-theo-từng-người-dùng-2026-08-28.md`.

## 1. Mục tiêu

Một người mở UniWork biết **ngay việc gì cần mình hôm nay** mà không đi qua Tasks,
Meetings và Inbox lần lượt: việc quá hạn và đến hạn, cuộc họp sắp tới, thông báo chưa
đọc, và ba câu tóm tắt rút từ chính dữ liệu đó. Đây là "Home" trong kiến trúc thông
tin V2 (Vision §5: Home · Work · Communication · Knowledge · Automation · Insights).

Nghiệp vụ kế thừa từ Home V2 của bản cũ:

1. **Một request cho cả màn hình.** Trang chủ gọi một endpoint tổng hợp; từng nguồn
   (công việc, cuộc họp, hộp việc) có thể lỗi riêng và trang vẫn hiển thị phần còn
   lại kèm nhãn "nguồn tạm thời không khả dụng" và nút thử lại.
2. **Năm khối, tuỳ biến theo người dùng.** Tổng quan hôm nay · Công việc của tôi ·
   Sắp tới · Hộp việc · Tóm tắt hôm nay. Người dùng bật/tắt khối, đổi thứ tự, chọn
   mật độ (gọn / cân bằng / rộng), hoặc chọn một preset (Điều hành · Người thực thi ·
   Tối giản). Tuỳ chọn lưu trên server, đồng bộ mọi thiết bị.
3. **Hành động ngay trên Home.** Hoàn thành một việc (lạc quan, rollback khi lỗi),
   chọn nhiều việc và hoàn thành hàng loạt, mở việc, đánh dấu thông báo đã đọc rồi đi
   tới đúng tài nguyên, vào phòng họp đang diễn ra. Phím tắt J/K di chuyển, X chọn,
   C hoàn thành, O/Enter mở.
4. **Tóm tắt từ dữ liệu thật, không bịa.** Khối "Tóm tắt hôm nay" là các câu suy ra
   xác định từ số liệu (quá hạn, họp, đến hạn, chưa đọc). Không có gì để nói thì khối
   ẩn — không hiện "0". Tóm tắt bằng LLM qua `ai.Gateway` là lát 2 (§11 câu 4).
5. **Empty state trung thực.** Mỗi khối rỗng nói rõ vì sao và bước tiếp theo (tạo
   việc, tạo cuộc họp, mở hộp việc).

**Ngoài phạm vi đợt này:** tóm tắt bằng LLM; work economics và dashboard inline (phần
còn lại của A-05); hộp việc gộp email (Email Hub bản cũ không mang sang, A-10 sẽ có
email thật); mục "chờ duyệt" (workflow/proposal chưa có); mobile (`/m/home` bản cũ —
app Expo theo ADR 0011 sẽ có tab Home riêng); "màn hình mở đầu sau đăng nhập" và "bộ
lọc cá nhân cho Việc của tôi" (giai đoạn 3 của plan tuỳ biến bản cũ); phân loại task theo
tiêu đề (`home-task-kind.ts`: email/họp/chat/tài liệu) và phím R "trang liên quan".

## 2. Quyết định đã chốt

| # | Quyết định | Vì sao |
| --- | --- | --- |
| 1 | Home nằm ở **route gốc workspace** `/{org}/{ws}` (builder `ws.root()` đã có). Không thêm `/home` | Không thêm slug, không đổi `paths`; gốc workspace hiện chỉ redirect sang `/tasks` — chính là chỗ của Home |
| 2 | Bọc bằng flag server **`home_page`** (Public, mặc định tắt, owner `insights`, review 2026-12-31). Flag tắt: gốc workspace vẫn redirect `/tasks`, sidebar không có "Trang chủ" | FEATURE_WORKFLOW bước 4; bật cho org UNICOM trước |
| 3 | Đích sau đăng nhập / onboarding / nhận lời mời **giữ `/tasks`** đợt này | 12 spec e2e neo vào `/tasks`; đổi đích là quyết định sản phẩm (§11 câu 2) |
| 4 | **Một endpoint tổng hợp** `GET /workspaces/{id}/home`, handler ghép `HomeService` (công việc, cuộc họp, đếm) với `notification.Service` (hộp việc). Mỗi nguồn lỗi độc lập → `partial[]` | Kế thừa "1 request duy nhất"; `internal/service` không import `internal/notification` (arch_test) nên handler là chỗ ghép |
| 5 | "Công việc của tôi" = **việc mở được giao cho tôi** (`assignee_id = tôi`, `assignee_kind = human`), sắp theo: quá hạn (cũ nhất trước) → đến hạn hôm nay → có hạn xa hơn → không hạn; cùng nhóm thì theo độ ưu tiên rồi ngày tạo; tối đa 8 | Rộng hơn bản cũ (chỉ quá hạn + đến hạn) để Home không trống với người chưa đặt hạn; vẫn đưa việc gấp lên đầu |
| 6 | "Mở" = category của status **không thuộc `done`, `cancelled`** — `LEFT JOIN task_statuses` theo `(workspace_id, key)`, `COALESCE(category, status)` | Workspace có status tuỳ biến (key ≠ category); `LEFT JOIN` để workspace thiếu catalog không mất task |
| 7 | "Hôm nay" tính theo **`users.timezone`** (mặc định `Asia/Ho_Chi_Minh`) trên server; `due_date` là `DATE` nên so bằng ngày | `due_date` không có giờ; múi giờ người dùng đã có từ F-07 |
| 8 | "Sắp tới" = **cuộc họp** của workspace bắt đầu từ đầu hôm nay đến hết ngày mai, `status ∈ {SCHEDULED, IN_PROGRESS}`, mà tôi là host, người tạo, hoặc participant còn hiệu lực; IN_PROGRESS (đang diễn ra) luôn vào; tối đa 5. **Không** gộp deadline task | Deadline đã nằm trong "Công việc của tôi" (#5); gộp gây trùng dòng |
| 9 | "Hộp việc" = **8 thông báo chưa đọc** của workspace này, dùng `notification.Service.List` và `NotificationRow`/`resourceHref` sẵn có; mở dòng = đánh dấu đã đọc rồi đi tới tài nguyên | Không viết lại logic deep link; nhất quán với `/inbox` |
| 10 | Tổng quan hôm nay là **bốn ô số** (đến hạn hôm nay · quá hạn · họp hôm nay · chưa đọc), mỗi ô một ký hiệu: đến hạn/quá hạn mang màu tín hiệu (warning/destructive, về xám khi bằng 0), họp/chưa đọc mang tint module như sidebar. *Sửa 2026-09-18 (UNI-704): ban đầu là dải số inline, không KPI card* | PRODUCT.md 2026-09-17 cho phép thẻ chỉ số khi đếm record thật của màn đang xem; số chưa đọc lấy từ `unread-count` theo workspace |
| 11 | Tóm tắt hôm nay là **hàm thuần phía client** (`packages/core/home/brief.ts`) sinh `{key, params}` render qua `t()`; tối đa 3 dòng; không dòng nào → ẩn khối | Không có nội dung server-side cần dịch; test được không cần DB; "không có dữ liệu" thay vì 0 |
| 12 | Tuỳ chọn Home lưu ở bảng mới **`home_preferences`** `(organization_id, workspace_id, user_id, prefs JSONB)`, PK `(workspace_id, user_id)`; server chỉ kiểm `prefs` là object ≤ 8 KiB; client chuẩn hoá bằng zod với fallback mặc định | Theo mẫu `task_view_preferences`; bản cũ dùng chung bảng dashboard với tiền tố `home.` — UniWork chưa có dashboard nên bảng riêng rõ hơn |
| 13 | Ghi prefs **không audit, không outbox** | Cài đặt cá nhân về cách hiển thị, không phải trạng thái nghiệp vụ; cùng cách xử lý với `task_view_preferences` và `notification_preferences` |
| 14 | Realtime: client **invalidate** `homeKeys.summary(wsId)` khi nhận `task.created/updated/deleted`, mọi `meeting.*`, `notification.created`; không có sự kiện mới | Frame chỉ mang id; Home là view tổng hợp nên refetch là đủ |
| 15 | Hoàn thành việc dùng `useUpdateTask` (PATCH `status: "done"`), hàng loạt dùng `useBatchUpdateTasks`; Home patch cache tóm tắt lạc quan, rollback khi lỗi | Đúng bốn điều kiện optimistic của CLAUDE.md; tái dùng đường lệnh đã có audit |
| 16 | Tint module `home` = `gray` trong `module-tones.ts` | Home gom nhiều module; tint trung tính, không tranh với tint của module con |
| 17 | Không port `home-task-kind.ts` (đoán loại việc từ tiêu đề) | Heuristic regex tiếng Việt/Anh, không có nguồn dữ liệu thật; email/tài liệu chưa có trong UniWork |

## 3. Data model

### 3.1 `185_home_preferences.up.sql` (số thật lấy lúc implement; `184` là mới nhất trên `develop` ngày 2026-09-14)

```sql
-- Personal Home layout (sections on/off, order, density) per person per
-- workspace. No FK: a row outlives nothing it points at and is dropped by the
-- workspace/member cleanup in service code. Not audited: a display setting.
CREATE TABLE IF NOT EXISTS home_preferences (
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  prefs           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prefs) = 'object'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
```

`.down.sql`: `DROP TABLE IF EXISTS home_preferences;`. Không index thêm (PK đủ).
Thêm `home_preferences` vào `TRUNCATE` của `server/internal/testutil/db.go`.

Hình dạng `prefs` (client chuẩn hoá, server không ép):

```json
{
  "enabled": { "stats": true, "mywork": true, "upcoming": true, "inbox": true, "brief": true },
  "order":   ["stats", "mywork", "upcoming", "inbox", "brief"],
  "layout":  "balanced"
}
```

Khoá khối: `stats | mywork | upcoming | inbox | brief`. Mật độ: `compact | balanced | wide`.
Preset: `executive` (stats, brief, inbox, mywork; tắt upcoming), `doer` (stats, mywork,
upcoming, inbox; tắt brief), `minimal` (chỉ mywork, compact). Khoá lạ bị bỏ, khoá thiếu
lấy mặc định, thứ tự thiếu khoá thì nối phần còn lại theo mặc định.

### 3.2 Query mới — `server/pkg/db/queries/home.sql`

| Tên | Trả về | Điều kiện |
| --- | --- | --- |
| `ListHomeMyWork` | `[]Task` | `organization_id`, `workspace_id`, `assignee_id = actor`, `assignee_kind = 'human'`, category mở (§2 #6); `ORDER BY` nhóm hạn theo `today`, `due_date`, hạng ưu tiên (`urgent`<`high`<`medium`<`low`), `created_at`; `LIMIT` |
| `CountHomeMyWork` | `open, overdue, due_today` (một hàng, `count(*) FILTER`) | cùng điều kiện, tham số `today DATE` |
| `ListHomeMeetings` | `[]Meeting` | `workspace_id`; `status = 'IN_PROGRESS' OR (status = 'SCHEDULED' AND starts_at >= from AND starts_at < to)`; tôi là `host_user_id`/`created_by`/participant `removed_at IS NULL`; `ORDER BY starts_at`; `LIMIT` |
| `CountHomeMeetingsToday` | `bigint` | như trên, `starts_at` trong hôm nay |
| `GetHomePreference` | `HomePreference` | `organization_id`, `workspace_id`, `user_id` |
| `UpsertHomePreference` | `HomePreference` | `ON CONFLICT (workspace_id, user_id) DO UPDATE SET prefs, organization_id, updated_at = now()` |

`meetings` chưa có `organization_id` (`tenantBackfillDebt`) nên lọc theo `workspace_id`
như mọi query meeting hiện có; `workspace_id` đến từ `RequireMember`, không từ body.

## 4. API

Tag mới **`home`** (`server/internal/handler/router/home.go`, gọi từ `router.New` sau
`registerTasksSuite`). Path dùng `{workspaceID}` đã có `pathParamSDI`.

| Method | Path | SDI | SDO | Lỗi |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/workspaces/{workspaceID}/home` | — (query `limit_tasks` ≤ 20, `limit_meetings` ≤ 10, `limit_inbox` ≤ 20, mặc định 8/5/8) | `HomeSummarySDO` | 401; 403/404 qua `mapServiceError` (non-member); nguồn phụ lỗi → `partial` |
| GET | `/api/v1/workspaces/{workspaceID}/home/preferences` | — | `HomePreferenceSDO` | 401; 403/404; agent → 403 |
| PUT | `/api/v1/workspaces/{workspaceID}/home/preferences` | `PutHomePreferenceSDI{prefs}` | `HomePreferenceSDO` | 400 `invalid_request` khi `prefs` không phải object hoặc > 8 KiB; 401; 403/404 |

```go
// sdo/home.go
type HomeCountsDTO struct {
	Open         int64 `json:"open"`
	Overdue      int64 `json:"overdue"`
	DueToday     int64 `json:"due_today"`
	MeetingsToday int64 `json:"meetings_today"`
	Unread       int64 `json:"unread"`
}
type HomeSummarySDO struct {
	Today            string            `json:"today"`     // YYYY-MM-DD theo timezone người gọi
	Timezone         string            `json:"timezone"`
	Counts           HomeCountsDTO     `json:"counts"`
	MyWork           []TaskDTO         `json:"my_work"`
	UpcomingMeetings []MeetingDTO      `json:"upcoming_meetings"`
	Inbox            []NotificationDTO `json:"inbox"`
	Partial          []string          `json:"partial"`   // "tasks" | "meetings" | "notifications"
	GeneratedAt      string            `json:"generated_at"`
}
type HomePreferenceSDO struct {
	Prefs     json.RawMessage `json:"prefs"`
	UpdatedAt string          `json:"updated_at,omitempty"`
}
```

`my_work` dùng `TaskDTO` (qua `taskDTOs` để có `identifier` và `assignee`),
`upcoming_meetings` dùng `MeetingDTO`, `inbox` dùng `NotificationDTO` — client tái dùng
`TaskSchema`, `MeetingSchema`, `NotificationSchema`.

Ngữ nghĩa `partial`: `HomeService.Summary` chạy ba nhóm truy vấn (my work + counts,
meetings + count) độc lập; nhóm nào lỗi thì ghi log (id, không PII), trả rỗng và thêm
tên vào `Partial`. Handler gọi `Notifications.List` và `Notifications.UnreadCount`;
lỗi → `partial += "notifications"`, `inbox = []`, `counts.unread = 0`. Lỗi membership
(`ErrForbidden`/`ErrNotFound`) và lỗi tải người dùng/workspace **không** được nuốt —
trả 403/404/500 như thường.

## 5. Sự kiện outbox và realtime

Không có sự kiện mới. Không ghi audit/outbox (§2 #13). Client (`use-realtime-sync.ts`)
thêm `homeKeys.summary(wsId)` vào danh sách invalidate khi `type` là
`task.created|updated|deleted`, bất kỳ `meeting.*` trong catalogue, hoặc
`notification.created`. `packages/core/realtime/use-realtime-sync.test.tsx` có case cho
ba nhóm này.

## 6. Quyền

- Cả ba endpoint: `WorkspaceService.requireActorMember` (tổ chức bị đình chỉ và thành
  viên bị vô hiệu hoá đều bị chặn ở đó). Dữ liệu trả về **chỉ của người gọi** (task
  được giao cho tôi, cuộc họp tôi có mặt, thông báo của tôi); không có tham số `user_id`.
- Prefs: chỉ actor `human` (agent → `ErrForbidden`), như `task_view_preferences`.
- Flag `home_page` **ẩn** trang, không cấp quyền; endpoint không kiểm flag (một người
  gọi API khi flag tắt vẫn chỉ thấy dữ liệu của mình).
- Không có rule mới trong `packages/core/permissions/rules.ts`.

## 7. FE file map

**`packages/core`**
- `types/home.ts` — `HomeCountsSchema`, `HomeSummarySchema`, `HomePreferenceSchema`,
  `HOME_SECTION_KEYS`, `HOME_LAYOUTS`, kiểu `HomePrefs`; thêm vào `types/index.ts`.
- `api/endpoints/home.ts` + `home.test.ts` — `getHomeSummary(wsId, limits?)`,
  `getHomePreference(wsId)`, `putHomePreference(wsId, prefs)`; case malformed cho cả ba.
- `home/keys.ts` — `homeKeys.summary(wsId)`, `homeKeys.prefs(wsId)`.
- `home/hooks.ts` — `homeKeys`, `useHomeSummary(wsId)` (staleTime 60 s), `useHomePrefs(wsId)` (đọc + ghi lạc
  quan, `reset`), `useCompleteHomeTasks(wsId)` (một id → PATCH, nhiều id → batch-update; patch `homeKeys.summary`
  lạc quan, rollback khi lỗi), `useReadHomeNotification(wsId)` (đánh dấu đã đọc và bỏ dòng khỏi tóm tắt đã cache).
- `home/prefs.ts` + `prefs.test.ts` — `DEFAULT_HOME_PREFS`, `HOME_PRESETS`,
  `normalizeHomePrefs(unknown)`, `moveSection`, `visibleSections`.
- `home/brief.ts` + `brief.test.ts` — `buildHomeBrief(summary): HomeBriefLine[]`.
- `feature-flags/keys.ts` — `HOME_PAGE_FLAG = "home_page"`, export qua `index.ts`.
- `realtime/use-realtime-sync.ts` (+ test).
- `package.json` exports: `"./home": "./home/hooks.ts"`, `"./home/*": "./home/*.ts"`.
- `i18n/locales/vi.json`, `en.json` — nhóm `home.*`, `nav.home`.

**`packages/views`**
- `home/home-view.tsx` — ghép khối theo prefs, lưới theo `layout`, thông báo `partial`.
- `home/home-view.tsx` cũng chứa lời chào theo giờ và phụ đề theo `counts`; header dùng `CollectionPageHeader`
  với hai hành động Tuỳ chỉnh và Làm mới (không có nút tạo nhanh: tạo việc đã có ở top bar).
- `home/home-stats.tsx` — bốn ô số (đến hạn/quá hạn đưa focus tới việc đầu tiên trong Công việc của tôi; họp → `/meetings`, chưa đọc → `/inbox`); ký hiệu dùng chung với tóm tắt ở `home/home-marks.ts`.
- `home/home-my-work.tsx`, `home/home-my-work-row.tsx`, `home/use-my-work-keys.ts` —
  danh sách, chọn nhiều, hoàn thành, hàng loạt, phím tắt.
- `home/home-upcoming.tsx` — cuộc họp; IN_PROGRESS có nút "Vào họp" tới `ws.room(id)`.
- `home/home-inbox.tsx` — `NotificationRow compact` + `resourceHref`, đánh dấu đã đọc.
- `home/home-brief.tsx` — render `buildHomeBrief`.
- `home/home-customize-panel.tsx` — bật/tắt, lên/xuống, mật độ, preset, đặt lại.
- `home/home-partial-notice.tsx` — nhãn nguồn lỗi + nút thử lại; mỗi khối dùng `PanelCard` (`common/panel-card.tsx`).
- `home/home-layout.ts` + `home-layout.test.ts` — `homeGridClass(layout)`, `homeSpanClass(key, layout)` cho gọn/rộng (chuỗi class Tailwind phải nằm trong `views` để được quét); cân bằng dùng `homeBalancedBands(keys)`: công việc + hộp việc ở cột chính, sắp tới + tóm tắt ở cột phụ, dưới `xl` gộp một cột theo thứ tự người dùng chọn.
- Test: `home-view.test.tsx` (loading / lỗi / rỗng / có dữ liệu / partial / prefs ẩn hết),
  `home-my-work.test.tsx` (hoàn thành gọi PATCH, hàng loạt gọi batch-update, phím tắt),
  `home-customize-panel.test.tsx`, `home-brief.test.tsx`, `home-layout.test.ts`.
- `layout/app-sidebar.tsx` — mục `nav.home` (đầu danh sách) khi `useFlag(HOME_PAGE_FLAG)`;
  `layout/module-tones.ts` thêm `home: "gray"`.
- `package.json` exports: `"./home/*": "./home/*.tsx"`.

**`apps/web`**
- `app/[orgSlug]/[workspaceSlug]/page.tsx` — flag bật: `lazy(HomeView)`; tắt: redirect
  `/tasks` như hiện tại.

**`server`**
- `migrations/185_home_preferences.{up,down}.sql`; `pkg/db/queries/home.sql`; `make sqlc`.
- `internal/service/home.go` + `home_test.go` — `HomeService{Summary, GetPreference,
  PutPreference}`, `NewHomeService(pool, q, ws)`.
- `internal/handler/home.go` + `home_test.go`; `dto/sdi/home.go`; `dto/sdo/home.go`;
  `router/home.go`; `router/routes.go` (3 field); `handler/router.go` (`Deps.Home`, map);
  `cmd/server/main.go` (`service.NewHomeService`); `internal/featureflags/keys.go`;
  `internal/testutil/db.go` (TRUNCATE).

**`e2e`**
- `e2e/home.spec.ts` — bật `home_page` bằng một hàng `feature_flag_overrides` scope
  `global` (helper trong `e2e/db.ts`), đăng ký → onboarding → vào `/{org}/{ws}` → thấy
  tiêu đề Trang chủ, khối "Công việc của tôi" rỗng nói bước tiếp theo, tạo task có hạn
  hôm nay ở `/tasks` → quay về Home thấy trong "Công việc của tôi" → bấm Hoàn thành →
  dòng biến mất. Xoá override ở cuối.

**Docs**
- `docs/roadmap/FEATURE_ROADMAP.md` — A-05: `MỘT PHẦN` + lát 1 Trang chủ; F-05 ghi chú
  My Work có mặt trên Home.
- `docs/roadmap/LEGACY_REFERENCE_MAP.md` — dòng A-05/F-05 trỏ spec này.

## 8. Kiểm thử bắt buộc

| Lớp | Test | Chứng minh |
| --- | --- | --- |
| Migration | `lint_test.go` (tự động) | không FK, có `organization_id`, có `.down.sql` |
| Service | `home_test.go`: `TestHomeSummaryOrdersMyWorkByUrgency` (quá hạn → hôm nay → xa hơn → không hạn; `done`/`cancelled` bị loại; task giao người khác bị loại); `TestHomeSummaryCountsFollowUserTimezone` (một task hạn = hôm nay theo `Asia/Ho_Chi_Minh` nhưng là ngày mai theo UTC vẫn tính "hôm nay"); `TestHomeSummaryMeetingsOnlyMineTodayTomorrow` (host / participant / IN_PROGRESS vào; người ngoài, ENDED, ngày kia bị loại); `TestHomeSummaryForbiddenForOtherOrg`; `TestHomePreferenceRoundTripAndValidation` (mặc định `{}`; upsert; không phải object → `ValidationError`; > 8 KiB → `ValidationError`; agent → `ErrForbidden`) | luật §2 #5–#8, #12, §6 |
| Handler | `home_test.go`: `TestHomeEndpoints` — 200 đúng hình dạng (`my_work[0].identifier`, `inbox` có thông báo `task_assigned` sinh qua outbox consumer như `notification_test.go`, `counts.unread = 1`, `partial = []`); non-member org B → 403/404; PUT prefs sai → 400; Swagger có 3 route (`swagger_test.go` tự động) | API §4 |
| Core | `api/endpoints/home.test.ts` (3 case malformed → fallback rỗng, không throw); `home/prefs.test.ts` (chuẩn hoá khoá lạ/thiếu, preset, moveSection biên); `home/brief.test.ts` (0 dòng khi mọi count = 0; tối đa 3; ưu tiên quá hạn → họp → đến hạn → chưa đọc); `realtime/use-realtime-sync.test.tsx` (3 nhóm sự kiện invalidate `homeKeys.summary`) | §2 #11, #14, hợp đồng API |
| Views | `home-view.test.tsx` (skeleton ≤ 500 ms; lỗi có nút thử lại; rỗng nói bước tiếp; có dữ liệu; `partial` hiện nhãn; prefs ẩn hết → lời nhắc mở tuỳ chỉnh); `home-my-work.test.tsx` (Hoàn thành → PATCH `status: done` và dòng mờ ngay; lỗi → rollback + toast; chọn 2 → batch-update; J/K/X/C/O); `home-customize-panel.test.tsx` (toggle, lên/xuống, preset → PUT prefs) | §1 mục 2–3 |
| i18n | `parity.test.ts` (tự động) | vi/en đủ khoá |
| Paths | `consistency.test.ts` (tự động) — không đổi | gốc workspace đã có builder |
| E2E | `e2e/home.spec.ts` (§7) | luồng vàng |

Go chạy trong `bash -c` với `TZ=UTC`, `-v`, và trích `--- PASS` (test DB dưới zsh
lặng lẽ SKIP — xem memory `uniwork-go-tests-skip-under-zsh`).

## 9. Kế thừa từ bản cũ và cái gì bỏ

**Giữ (viết lại theo UniWork):** năm khối và thứ tự mặc định; lời chào theo giờ và phụ
đề theo số việc cần chú ý; `partial` theo nguồn + nút thử lại từng khối; hoàn thành lạc
quan có rollback; chọn nhiều + hoàn thành hàng loạt; phím J/K/X/C/O; đánh dấu đã đọc rồi
điều hướng; nút Vào họp cho cuộc họp có thể vào; tuỳ biến bật/tắt, thứ tự, ba mật độ, ba
preset, đặt lại, lưu theo tài khoản; tóm tắt xác định từ dữ liệu, ẩn khi không có gì;
empty state có hành động.

**Bỏ:** tóm tắt AI (LLM) — lát 2; email trong hộp việc và số email chưa đọc; ô "Chờ
duyệt"; số chat chưa đọc trên Home (chat có badge riêng, OPEN_QUESTIONS N3); deadline task
trong "Sắp tới" (§2 #8); `home-task-kind.ts` và phím R; menu "Xem trên lịch" (Calendar
là C-02); `/m/home`; `user_dashboard_prefs` dùng chung với tiền tố `home.`; deep link
`/notifications/:id`; mọi Supabase RPC (`get_home_summary`, `get_unread_counts`).

## 10. Copy tiếng Việt (nhóm `home.*`, theo `docs/conventions.md` §3)

| Khoá | vi |
| --- | --- |
| `nav.home` | Trang chủ |
| `home.greeting.morning/noon/afternoon/evening` | Chào buổi sáng / Chào buổi trưa / Chào buổi chiều / Chào buổi tối |
| `home.subtitle.loading` | Đây là công việc của bạn hôm nay |
| `home.subtitle.attention_one/_other` | Bạn có {{count}} việc cần chú ý hôm nay |
| `home.subtitle.clear` | Hôm nay bạn không có việc gấp |
| `home.actions.customize/refresh/new_task/new_meeting` | Tuỳ chỉnh / Làm mới / Việc mới / Cuộc họp |
| `home.stats.due_today/overdue/meetings_today/unread` | đến hạn hôm nay / quá hạn / cuộc họp hôm nay / chưa đọc |
| `home.mywork.title` · `home.mywork.hint` | Công việc của tôi · J/K di chuyển · X chọn · C hoàn thành · O mở |
| `home.mywork.empty_title` · `home.mywork.empty_description` | Không có việc cần xử lý · Bạn không có việc nào được giao. Tạo việc mới hoặc xem toàn bộ danh sách. |
| `home.mywork.complete` · `home.mywork.completed` · `home.mywork.bulk_complete` | Hoàn thành · Đã xong · Hoàn thành {{count}} việc |
| `home.mywork.overdue_one/_other` · `home.mywork.due_today` · `home.mywork.due_on` | Quá hạn {{count}} ngày · Hạn hôm nay · Hạn {{date}} |
| `home.upcoming.title` · `home.upcoming.empty_title` · `home.upcoming.empty_description` | Sắp tới · Không có cuộc họp · Lịch của bạn trống hôm nay và ngày mai. Tạo cuộc họp hoặc mở danh sách. |
| `home.upcoming.join` · `home.upcoming.open` · `home.upcoming.live` | Vào họp · Mở · Đang diễn ra |
| `home.inbox.title` · `home.inbox.empty_title` · `home.inbox.empty_description` | Hộp việc · Hộp việc trống · Không có thông báo nào đang chờ bạn. |
| `home.brief.title` · `home.brief.badge` | Tóm tắt hôm nay · Từ dữ liệu thật |
| `home.brief.overdue_one/_other` | {{count}} việc đang quá hạn — ưu tiên “{{title}}” (quá hạn {{days}} ngày). |
| `home.brief.meetings_one/_other` | {{count}} cuộc họp hôm nay — gần nhất “{{title}}”. |
| `home.brief.due_today_one/_other` | {{count}} việc đến hạn hôm nay. |
| `home.brief.unread_one/_other` | {{count}} thông báo chưa đọc. |
| `home.partial.tasks/meetings/notifications` | Không tải được danh sách công việc. / Không tải được lịch họp. / Không tải được hộp việc. |
| `home.partial.footer` | Một số nguồn tạm thời không khả dụng: {{sources}}. Dữ liệu còn lại vẫn hiển thị bình thường. |
| `home.error.title` · `home.error.retry` | Không tải được trang chủ · Thử lại |
| `home.customize.*` | Tuỳ chỉnh trang chủ · Bật/tắt khối, đổi thứ tự và chọn mật độ bố cục. Thay đổi được lưu theo tài khoản. · Khối hiển thị · Mật độ bố cục · Preset nhanh · Đặt lại · Đóng · Đang lưu… · Bạn đã ẩn toàn bộ khối trên trang chủ. · Mở tuỳ chỉnh |
| `home.section.stats/mywork/upcoming/inbox/brief` (+ `_description`) | Tổng quan hôm nay · Công việc của tôi · Sắp tới · Hộp việc · Tóm tắt hôm nay |
| `home.layout.compact/balanced/wide` (+ `_hint`) | Gọn (1 cột, tập trung việc cần làm) · Cân bằng (2 cột, mặc định) · Rộng (3 cột trên màn hình lớn) |
| `home.preset.executive/doer/minimal` (+ `_description`) | Điều hành (Số liệu, tóm tắt và hộp việc lên trước) · Người thực thi (Ưu tiên việc cần làm và lịch sắp tới) · Tối giản (Chỉ việc của tôi) |

## 11. Câu hỏi mở (chờ quangpd)

| # | Câu hỏi | Người viết đã chọn tạm | Ảnh hưởng nếu đổi |
| --- | --- | --- | --- |
| 1 | Gắn Trang chủ vào **UNI-451 (A-05)** hay tạo issue riêng "Trang chủ" (và dòng roadmap mới, ví dụ F-15)? Agent không tự tạo issue mới (UNIAI_TRACKING §5.4) | UNI-451, nhánh `feature/UNI-451-home-trang-chu`, chưa `make issue-start` | Đổi tên nhánh + `Refs:` trailer; roadmap ghi ở dòng mới |
| 2 | Khi flag bật, đích sau đăng nhập / onboarding / nhận lời mời chuyển về Home (`ws.root()`) không? | Giữ `/tasks` | 12 e2e spec đổi assertion; `post-auth-redirect`, `onboarding/page.tsx`, `invitations`, `workspaces` |
| 3 | Prefs theo **workspace** (đã chọn) hay theo người dùng toàn tổ chức? | Theo workspace | PK và query khác; một người nhiều workspace phải chỉnh nhiều lần |
| 4 | Tóm tắt AI (LLM qua `ai.Gateway`, grounding trên dữ liệu Home, quota `ai.tokens`) làm lát 2 của A-05 ngay sau, hay chờ work economics? | Lát 2, spec riêng | Không ảnh hưởng lát 1: khối `brief` đã có chỗ và nhãn nguồn |
| 5 | "Sắp tới" có thêm deadline task ngày mai không? | Không (tránh trùng "Công việc của tôi") | Thêm query + kiểu dòng `task` trong khối |
| 6 | Flag `home_page` bật mặc định cho org UNICOM ngay khi merge (override organization) hay chờ 48 giờ staging? | Chờ người bật qua console `/admin/flags` | Không ảnh hưởng mã |
| 7 | Phát hiện lúc triển khai: `usePublicConfig` gọi `GET /api/v1/config` không kèm `organization_id`, nên override flag cấp **organization** không tới được web (cả `home_page` lẫn `chat_work_hub`); chỉ override `user` hoặc `global` có hiệu lực ở client. Sửa trong lát này hay issue riêng? | Không sửa trong lát này (ngoài phạm vi, chạm mọi flag) | Bật cho org UNICOM hiện phải bật theo từng user hoặc global |

## Làm lại 2026-09-24

Audit `/redesign-existing-projects` (2026-09-24) tìm ra: số liệu lặp 3–4 lần (ô số, phụ đề,
Tóm tắt, huy hiệu), nguồn lỗi hiện thành "0" và "không có việc gấp", ba thẻ trống cho
workspace mới, cột phụ lệch ở cả ba mật độ. Thay đổi — các mục này thay cho chỗ tương ứng ở trên:

- **Bỏ khối `brief`.** `HOME_SECTION_KEYS` còn `stats | mywork | upcoming | inbox`; prefs cũ có
  `brief` bị `normalizeHomePrefs` bỏ như mọi khoá lạ. `buildHomeBrief` → `buildHomeHeadline`:
  **một** câu dưới lời chào, theo thứ tự nguồn lỗi → việc quá hạn lâu nhất (tên + số ngày) →
  cuộc họp đang diễn ra → cuộc họp kế tiếp hôm nay (tên + giờ) → đến hạn hôm nay → chưa đọc →
  không có việc gấp. Câu nêu điều ô số không nói được (tên, giờ), không lặp con số.
- **Nguồn lỗi không bao giờ hiện số 0 như thật.** Server vẫn trả count = 0 khi một nguồn lỗi;
  client đọc `partial`: ô số tương ứng hiện "—" + "Chưa tải được", không bấm được; khối chỉ hiện
  dòng báo lỗi, không kèm trạng thái trống; câu dưới lời chào báo dữ liệu thiếu.
- **Ô số có dòng ngữ cảnh**: Quá hạn "Lâu nhất N ngày", Cuộc họp "Kế tiếp HH:MM"/"Đang diễn ra".
  Mũi tên ↓ cho ô nhảy trong trang, ↗ cho ô sang màn khác. Ô tự xuống 2 cột theo bề rộng khối
  (container query), không theo viewport.
- **Bố cục**: Cân bằng = Việc của tôi ở cột chính, Sắp tới + Hộp việc ở cột phụ. Rộng = lưới 4
  cột thẳng với 4 ô số, Việc của tôi chiếm 2. Gọn = cả lời chào lẫn nội dung trong `max-w-3xl`.
  Khối phụ không đổ bóng, chỉ Việc của tôi nổi.
- **Workspace không có gì** (mọi nguồn trả lời, mọi danh sách và count rỗng): một panel "Hôm nay
  chưa có gì chờ bạn" với ba bước — Tạo việc (mở dialog tạo việc), Lên lịch họp, Mời đồng đội —
  thay cho ô số 0 và ba thẻ trống. Một khối rỗng giữa các khối có dữ liệu vẫn giữ trạng thái trống riêng.
- **Việc của tôi**: nhóm theo hạn (Quá hạn · Hôm nay · Sắp tới · Chưa đặt hạn; bỏ tiêu đề khi chỉ
  có một nhóm); thanh chọn chỉ hiện khi đã chọn; hàng đã chọn có nền `brand-subtle`; nút Hoàn thành
  chỉ hiện khi rê chuột/focus (luôn hiện trên màn cảm ứng); gợi ý phím chỉ hiện khi focus trong
  khối; footer "Còn N việc nữa" khi `counts.open` lớn hơn số việc trả về; tiêu đề tối đa 2 dòng.
- **Sắp tới**: tiêu đề ngày viết thường có hoa đầu câu (không còn overline mono chữ hoa), vạch 2px,
  thêm thời lượng; giờ theo múi giờ của người dùng (`summary.timezone`), như lời chào.
- **Hộp việc**: bỏ vạch "chưa đọc" (`NotificationRow unreadBar={false}`) vì mọi hàng ở đây đều chưa đọc.
- **Tuỳ chỉnh** là Sheet bên phải thay vì chèn giữa trang; preset đang khớp được đánh dấu
  (`activePreset`); "Preset nhanh" → "Mẫu có sẵn"; Đặt lại có toast Hoàn tác. Preset `doer` giờ tắt
  Hộp việc (trước đó chỉ khác mặc định ở `brief`).
- **Bỏ nút Làm mới** ở header: summary đã tự làm mới (staleTime 60s + realtime), lỗi có nút Thử lại riêng.
- Skeleton theo đúng hình hàng; lỗi toàn trang nằm trong khung viền.
- **Bỏ flag `home_page` (2026-09-25, quyết định của quangpd)** — thay §2 #2: gốc workspace luôn là
  Trang chủ, sidebar luôn có mục "Trang chủ" đứng đầu. Flag đã rời catalogue (`featureflags/keys.go`)
  và `HOME_PAGE_FLAG` rời `packages/core/feature-flags`; hàng override `home_page` còn trong DB bị
  bỏ qua như mọi khoá không có trong catalogue. Câu hỏi §11 #6 không còn.


## Audit impeccable 2026-09-25

Audit `/impeccable audit` (15/20) sau đợt làm lại ở trên. Các mục dưới đây thay chỗ tương ứng:

- **Thứ tự câu dưới lời chào**: cuộc họp **đang diễn ra** lên trước việc quá hạn (gấp theo phút),
  kèm nút "Vào họp" ngay cạnh câu (`HomeHeadline.liveMeetingId`).
- **Lời chào gọi tên**, không gọi cả họ tên: `greetingName` lấy chữ cuối khi chữ đầu là họ Việt
  phổ biến (có hay không dấu), còn lại lấy chữ đầu.
- **Bố cục theo bề rộng trang, không theo viewport**: nội dung là container `@container/home`;
  Cân bằng và Rộng chia cột từ `@5xl/home` (64rem), nên thu sidebar cũng được tính.
  DOM luôn giữ đúng thứ tự người dùng lưu (thứ tự đọc/Tab = thứ tự đã chọn); Cân bằng dùng
  lưới hai cột với Việc của tôi `row-span-full` ở cột chính, không còn `order-*`.
  Rộng: mỗi khối đang hiện một cột, Việc của tôi 2fr, không còn ô trống khi ẩn khối;
  mật độ Rộng được dùng tới `max-w-[100rem]`.
- **Chờ prefs trước khi vẽ**: trong lúc prefs tải, trang hiện khung chờ thay vì vẽ Cân bằng rồi nhảy.
- **Ô số**: số cỡ `title-lg` (nhỏ hơn lời chào); 4 cột và icon theo bề rộng khối; nhãn xuống dòng
  thay vì cắt; mũi tên luôn hiện trên màn cảm ứng.
- **Lịch họp**: khối "Sắp tới" đổi tên thành **"Lịch họp"** (en "Meetings") để không trùng nhóm
  hạn "Sắp tới" trong Việc của tôi. Cột hẹp (< 20rem) đưa "Vào họp" xuống dưới tiêu đề.
- **Khối phụ trống** (Lịch họp, Hộp việc): một dòng chữ, không icon, không nút — tiêu đề khối đã
  có "Xem tất cả".
- **Hoàn tác khi hoàn thành việc**: mọi lần hoàn thành (nút, chọn nhiều, phím C) có toast Hoàn tác,
  trả mỗi việc về trạng thái cũ (`useReopenHomeTasks`). Footer "Còn N việc nữa" đếm theo việc còn mở
  và ẩn khi nguồn việc lỗi.
- **Thông báo**: đọc/bỏ đọc/đọc hết/lưu trữ ở bất kỳ đâu đều làm mới mọi summary Trang chủ
  (`isHomeSummary`, `home/keys.ts` tách riêng để tránh vòng import).
- **Màn bắt đầu**: "Lên lịch họp" mở dialog tạo họp tại chỗ (nạp lười), "Mời đồng đội" chỉ hiện
  với người có `canManageMembers`.
- **Tuỳ chỉnh**: đưa khối lên đầu/xuống cuối giữ focus ở mũi tên còn lại của hàng; Mật độ và Mẫu có
  sẵn là nhóm radio thật (fieldset + input radio); công tắc có `aria-describedby` tới mô tả;
  mô tả sửa thành "Lưu riêng cho bạn trong workspace này".
