# UniWork — Calendar hub (C-02)

> **Trạng thái:** đã duyệt — Lát 1–3 shipped trên nhánh UNI-718 / PR (Lát 3: `../plans/2026-09-22-calendar-slice-3-panel-create.md`); Lát 4 plan riêng

**Ngày:** 2026-09-22  
**Roadmap:** C-02 (`docs/roadmap/FEATURE_ROADMAP.md`)  
**Issue:** UNI-718 (sub: UNI-719…UNI-725 = plan Lát 1 T1–T7)  
**Baseline tham chiếu:** ClickUp Planner (`app.clickup.com/.../calendar`) — khảo sát 2026-09-22  
**Umbrella liên quan:** meetings ICS đã ship; tasks collection surfaces (modes, không gồm calendar mode)

## 1. Mục tiêu

Ship **trang Calendar độc lập** trong workspace: gộp **task có ngày** và **meeting**, hành vi gần ClickUp Planner (lưới đa chế độ, panel trái kéo-gán ngày, tạo từ ô, xuất ICS). Dùng component/shell UniWork sẵn có; lưới thời gian nhờ **FullCalendar community** (MIT), không tự vẽ Week/Day như Gantt trừ khi cần adapter mỏng.

## 2. Quyết định đã chốt (brainstorm 2026-09-22)

| Chủ đề | Quyết định |
| --- | --- |
| Bề mặt sản phẩm | Trang hub độc lập (không phải `TaskViewMode` mới trên Task Surface) |
| Phạm vi dữ liệu | Lịch **nhóm workspace**; filter toolbar **Của tôi** |
| Neo ngày task | `due_date` chính; có `start_date` → span start→due |
| Chế độ xem v1 | Day · Work week · Week · Month (+ ẩn cuối tuần). Chưa: Number of days, Side by side |
| Panel trái | Layout parity ClickUp; map dữ liệu UniWork (A) — xem §3.2 |
| ICS / sync ngoài | Xuất / subscribe ICS workspace; **không** Google/Outlook 2 chiều v1 |
| Tương tác | Xem + kéo đổi ngày/giờ + tạo từ ô (task hoặc meeting) + mở detail |
| Approach kỹ thuật | Hybrid: shell UniWork + FullCalendar (dayGrid + timeGrid + interaction) |
| Thư viện | FullCalendar community — **không** Schedule-X (drag / drag-to-create là premium) |

## 3. Phạm vi

### 3.1 Trong phạm vi (v1)

**Sản phẩm**

- Route `/{orgSlug}/{workspaceSlug}/calendar` + `paths.workspace(…).calendar()` + reserved slug `calendar`.
- Nav sidebar: mục **Calendar** trong nhóm Work.
- Lưới: task + meeting trong workspace; filter `mine` (assignee / participant = caller).
- Toolbar: prev/next period, nhảy tháng/ngày, Today, chọn view, Của tôi, Export ICS, tạo nhanh.
- Panel trái (kéo task lên ngày để gán/đổi `due_date`):
  - **Priorities** → task `priority` ∈ {`urgent`, `high`} (đang mở).
  - **Meet with** → meeting sắp tới + CTA tạo meeting (không invent scheduling “Meet with” mới).
  - **Assigned to me** → assignee = me.
  - **Today & overdue** → `due_date` ≤ hôm nay, chưa hoàn thành.
  - **Backlog** → status backlog (theo catalog workspace).
- Click event → detail task / meeting (navigation adapter).
- Kéo / resize trên lưới → `PATCH` task hoặc meeting hiện có.
- Click / select ô trống → menu tạo việc | tạo cuộc họp (prefill ngày/giờ).
- `GET …/calendar.ics` — ICS workspace (task due all-day + meeting VEVENT).

**Kỹ thuật**

- `packages/views/calendar/` — UI shell, panel, FullCalendar host, dialogs.
- `packages/core/calendar/` — model event, normalize, hooks, query keys, endpoint client.
- `apps/web/.../calendar/page.tsx` — trang mỏng.
- Server: feed theo khoảng ngày + ICS; ghi chỉ qua service task/meeting (audit/outbox giữ nguyên).
- Catalog pnpm: `@fullcalendar/core`, `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`.
- i18n: mọi chữ views qua `t()`; keys `calendar.*` (vi + en).
- Theme FullCalendar map token `packages/ui` (light + dark).

### 3.2 Ngoài phạm vi (v1)

- Calendar **mode** trên Task Surface (`TaskViewMode = "calendar"`).
- Google / Outlook sync 2 chiều; public ICS không auth.
- ClickUp “Prioritize” pin riêng; AI Notes; Side by side; Number of days.
- Recurring meeting nâng cao (ngoài những gì meeting đã có).
- Mobile host / desktop host riêng.
- Optimistic update cho meeting timed hoặc create (await server theo rule UniWork).

## 4. Kiến trúc

```text
apps/web /[org]/[ws]/calendar
  → packages/views/calendar (CalendarPage)
       → panel trái + toolbar + FullCalendarHost
       → @uniwork/core/calendar hooks (wsId, from, to, mine)
       → PATCH via existing task / meeting mutations
server
  → GET /workspaces/{id}/calendar/events
  → GET /workspaces/{id}/calendar.ics
  → (sidebar: endpoint riêng hoặc reuse task query có filter)
```

### 4.1 Ranh giới package

| Package | Được | Không |
| --- | --- | --- |
| `core/calendar` | kiểu `CalendarEvent`, normalize, API parse, hooks, keys | import FullCalendar / `react-dom` / `next` |
| `views/calendar` | UI, FullCalendar, dnd panel→grid | `next/*`; gọi HTTP trực tiếp (chỉ qua core) |
| `ui` | primitive + token | logic calendar domain |
| `handler` | decode, map lỗi, RequireMember qua service | query DB trực tiếp |

### 4.2 Model `CalendarEvent`

```ts
type CalendarEvent = {
  id: string;              // "task:{ulid}" | "meeting:{ulid}"
  kind: "task" | "meeting";
  entityId: string;
  title: string;
  start: string;           // YYYY-MM-DD hoặc ISO datetime
  end?: string;
  allDay: boolean;         // task luôn all-day; meeting theo starts/ends
  status?: string;
  priority?: string;
  projectId?: string | null;
};
```

- Task không `due_date` → không vào feed lưới (chỉ panel nếu khớp section).
- Task có `start_date` + `due_date` → `start`/`end` all-day span.
- Meeting `canceled` / không còn lịch → **ẩn** khỏi feed.
- Meeting dùng timezone của meeting (fallback workspace); task date không shift TZ.

### 4.3 API

| Method | Path | Việc |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/{workspaceID}/calendar/events?from=&to=&mine=` | Envelope `{ events: CalendarEvent[] }` (hoặc tương đương SDO). `from`/`to` inclusive bound theo UTC date hoặc RFC3339 — chốt một convention trong plan + test. `mine=true` lọc server-side. |
| `GET` | `/api/v1/workspaces/{workspaceID}/calendar/sidebar` | **Một** payload cho 5 section (priorities, meet_with, assigned, today_overdue, backlog). Không fan-out nhiều list task từ client. |
| `GET` | `/api/v1/workspaces/{workspaceID}/calendar.ics` | `text/calendar`; chỉ member đã auth. |
| Ghi | existing | `PATCH /tasks/{id}`, create task, create/update meeting — không có “calendar PATCH”. |

SDI/SDO + `apiOp` theo `docs/api-sdi-sdo.md`. Malformed-response tests trên endpoint client.

Realtime: invalidate `calendarKeys` khi frame task/meeting liên quan (cùng pattern Query; không ghi payload WS vào store).

### 4.4 Cấu trúc thư mục gợi ý

```text
packages/core/calendar/
  types.ts
  normalize.ts
  keys.ts
  hooks.ts
packages/core/api/endpoints/calendar.ts
packages/views/calendar/
  calendar-page.tsx
  calendar-toolbar.tsx
  calendar-sidebar.tsx
  fullcalendar-host.tsx
  fullcalendar-theme.css   # token bridge
  create-from-slot.tsx
apps/web/app/[orgSlug]/[workspaceSlug]/calendar/page.tsx
```

## 5. UI & data flow

### 5.1 Layout

- `PageHeader` / `CollectionPageHeader` + title `calendar.title`.
- Cột trái: sections collapsible (primitive hiện có: button, scroll, empty).
- Cột phải: toolbar + FullCalendar.
- Không card trang trí; empty state qua copy i18n + `Empty` nếu cần.

### 5.2 FullCalendar

- Plugins: `dayGrid`, `timeGrid`, `interaction`.
- Views: `timeGridDay`, `timeGridWeek` (work week = `hiddenDays: [0,6]` hoặc tương đương), `dayGridMonth`.
- `editable` / `selectable` / `droppable` cho kéo và tạo.
- `eventClick` → `navigation.push` detail.
- `eventDrop` / `eventResize` → mutation; thất bại → revert + toast.
- `dateClick` / `select` → `create-from-slot` (task | meeting).
- External drag từ panel: FullCalendar drop + HTML5/`@dnd-kit` trên row (đã có trong catalog).

### 5.3 Tạo / chỉnh

- Task: reuse `NewTaskDialog` / create flow với prefill `due_date` (và `start_date` nếu select range).
- Meeting: reuse create meeting flow với `starts_at` / `ends_at` theo slot.
- Optimistic: chỉ kéo task all-day đổi ngày (predictable + cùng màn); còn lại await server.

### 5.4 Loading / error

- Skeleton toolbar + lưới khi fetch đầu.
- Lỗi feed: state + retry; không crash host.
- Lưới trống vẫn hiện (không mock rows).

## 6. Bảo mật

- Mọi route calendar: membership workspace (`RequireMember`); 403 `organization_suspended` / `member_deactivated` như gate hiện có.
- `mine` và phạm vi `from`/`to` áp trên server; không phụ thuộc client filter để giấu bản ghi.
- ICS workspace không public v1; auth giống API khác; cân nhắc rate limit đọc.
- Calendar không đọc/ghi bảng ngoài quyền service task/meeting; không bypass audit.
- Log: id only, không PII (email/tên) — `scripts/no-pii-log.test.mjs`.

## 7. Kiểm thử

| Lớp | Nội dung |
| --- | --- |
| Unit `core` | normalize span/due; mine; overlap range; id encoding |
| Endpoint tests | schema + malformed `calendar/events` (+ ICS text smoke) |
| Go | isolation workspace; range; ICS contents; RequireMember |
| Views | toolbar views; sidebar sections; host callbacks với http mock |
| E2E (lát muộn) | mở calendar, thấy event, kéo due, tạo từ ô |

Coverage floors không hạ. Views không mock `next/*`.

## 8. Lát cắt triển khai (gợi ý cho plan)

1. **Nền:** path, nav, reserved slug, i18n stub, feed API + Month read-only + mở detail.  
2. **Time views + kéo:** Week / Work week / Day + PATCH qua drag.  
3. **Panel + tạo:** sidebar map A, drop vào ngày, create-from-slot.  
4. **ICS + polish:** `calendar.ics`, theme dark/light, a11y, e2e hẹp.

Mỗi lát có issue UniAI con (hoặc checklist trong plan) và PR riêng nếu cần giữ diff nhỏ.

## 9. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
| --- | --- |
| FullCalendar CSS lệch token / dark | Theme bridge + kiểm contrast (pattern onboarding e2e nếu đụng màu) |
| Bundle lớn | Chỉ import plugin dùng; không fullcalendar bundle thừa |
| Panel map A ≠ kỳ vọng ClickUp | Copy vi giải thích (“Ưu tiên cao”, không “Prioritize”) |
| Trùng icon Meetings (`CalendarDays`) | Icon Calendar riêng trên nav; Meetings giữ hoặc đổi icon họp |
| Thiếu issue UniAI | Không merge `develop`/`main` khi chưa có `UNI-nnn` |

## 10. Tiêu chí xong v1

- Member mở `/calendar`, đổi 4 view, thấy task + meeting đúng range.
- Filter Của tôi đúng (server).
- Kéo task đổi `due_date` (và span nếu có start); kéo/resize meeting đổi giờ khi time view.
- Tạo task/meeting từ ô với ngày/giờ prefill.
- Năm section panel trái hoạt động (kể cả empty copy).
- Tải / subscribe ICS workspace (auth).
- Gate: typecheck, lint, test packages đụng; không lộ secret; i18n không literal trong views.

## 11. Tham chiếu

- ClickUp Planner UI (nav Planner, Month menu: Day / Work week / Week / Month / weekends, panel Priorities…Backlog) — 2026-09-22.
- Meeting ICS đơn lẻ: `GET /meetings/{id}/calendar.ics`.
- Task dates: `start_date`, `due_date`; Gantt geometry trong `packages/views/tasks/modes/gantt-*` (tham khảo date UTC, không reuse làm calendar hub).
- ADR / DoD: membership, audit, API compatibility (`parseWithFallback`).
