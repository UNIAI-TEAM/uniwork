# Calendar hub — Lát 3 (Panel + create-from-slot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** shipped — Lát 3 của spec C-02 / UNI-718. Lát 1–2 shipped trên cùng nhánh / PR. Lát 4 (ICS) = plan riêng.

**Goal:** Panel trái 5 section (map A); kéo task từ panel lên ngày để gán `due_date`; click/select ô trống → tạo task hoặc meeting với ngày/giờ prefill.

**Architecture:** Một `GET …/calendar/sidebar` trả đủ 5 section (không fan-out list từ client). UI `CalendarSidebar` + `CreateFromSlot` trong `packages/views/calendar/`. Prefill qua `CreateTaskDialog` `defaults` và mở rộng `NewMeetingDialog` với schedule defaults. External drag: FullCalendar `Draggable` / `droppable` (interaction đã có) — không Schedule-X. Ghi vẫn qua PATCH/create task & meeting hiện có.

**Tech Stack:** Go + sqlc; Chi `apiOp` + SDO; TanStack Query; FullCalendar interaction; Vitest; existing create dialogs.

**Spec:** `docs/superpowers/specs/2026-09-22-calendar-design.md` §3.1 panel, §4.3 sidebar API, §5.2–5.3, §8 lát 3  
**Issue:** UNI-718 (sub mới Lát 3 T1–Tn)

## Scope check

Lát 3: sidebar API + panel UI + drop panel→grid + create-from-slot. **Không:** ICS, Export ICS toolbar, Google sync, TaskViewMode calendar, optimistic create.

## Global Constraints

- Sidebar sections (map A): `priorities` (urgent|high, open) · `meet_with` (upcoming meetings + CTA) · `assigned` (assignee=me, open) · `today_overdue` (due ≤ today, open) · `backlog` (status/category backlog, open).
- “Open” = `COALESCE(task_statuses.category, tasks.status) NOT IN ('done','cancelled')` — cùng pattern `home.sql`.
- Một payload `GET /api/v1/workspaces/{workspaceID}/calendar/sidebar`; RequireMember; filter `organization_id` + `workspace_id`.
- Panel task row drag → drop lên ngày lưới → `PATCH` task `{ due_date }` (và giữ span nếu đã có start/due — cùng rule Lát 2 drop). Await + invalidate `calendarKeys` + sidebar keys.
- `dateClick` / `select` → menu tạo việc | tạo cuộc họp; task prefill `due_date` (+ `start_date` nếu range); meeting prefill local schedule.
- Create: await server (không optimistic).
- Mọi chữ views qua `t()`; vi + en. File `.ts`/`.tsx` ≤ 500 dòng. `Refs: UNI-718` từ hook nhánh.
- Vitest: `NODE_OPTIONS="--no-experimental-webstorage"`.
- **Không chạy `make check`** trong lát này — chỉ vitest/go test hẹp theo từng task.
- Không Schedule-X.

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `server/pkg/db/queries/calendar.sql` | Sidebar list queries (hoặc một query + filter trong service — ưu tiên vài `:many` rõ section) |
| `server/internal/service/calendar.go` (+ test) | `ListSidebar` |
| `server/internal/handler/calendar.go`, `dto/sdo/calendar.go`, `router/calendar.go` | HTTP + SDO |
| `packages/core/api/endpoints/calendar.ts` (+ test) | `getCalendarSidebar` + schema + malformed |
| `packages/core/calendar/keys.ts`, `hooks.ts` | `calendarKeys.sidebar`, `useCalendarSidebar` |
| `packages/views/meetings/new-meeting-dialog.tsx` | Optional `scheduleDefaults` / `defaultDate`+times |
| `packages/views/calendar/create-from-slot.tsx` | Menu + mở dialogs với prefill |
| `packages/views/calendar/calendar-sidebar.tsx` | 5 sections collapsible + rows + empty |
| `packages/views/calendar/fullcalendar-host.tsx` | `selectable`, `dateClick`/`select`, `droppable` + external receive |
| `packages/views/calendar/calendar-page.tsx` | Layout panel \| grid; wire hooks + dialogs |
| `packages/core/i18n/locales/{vi,en}.json` | `calendar.sidebar_*`, `calendar.create_*` |

---

### Task 1: Backend `GET …/calendar/sidebar`

**Files:**
- Modify: `server/pkg/db/queries/calendar.sql`, regenerate sqlc
- Modify: `server/internal/service/calendar.go`, `calendar_test.go`
- Modify: `server/internal/handler/calendar.go`, `dto/sdo/calendar.go`, `router/calendar.go`, `handler` Routes wiring
- Modify: `server/internal/service/audit_coverage_test.go` — **không** thêm nếu chỉ READ (đọc không audit)

**Interfaces:**
- Produces:

```go
type CalendarSidebar struct {
  Priorities    []CalendarSidebarTask
  MeetWith      []CalendarSidebarMeeting
  Assigned      []CalendarSidebarTask
  TodayOverdue  []CalendarSidebarTask
  Backlog       []CalendarSidebarTask
}
type CalendarSidebarTask struct {
  ID, Title, Status string
  Priority, DueDate *string // due YYYY-MM-DD
}
type CalendarSidebarMeeting struct {
  ID, Title string
  StartsAt, EndsAt string // RFC3339
}
```

Limits: mỗi section tối đa 25 hàng (constant trong service). Meet_with: `starts_at >= now`, status ≠ CANCELED, order ASC, limit 25.

- [ ] **Step 1: SQL + service tests (RED)** — member-only; priorities chỉ urgent/high open; today_overdue due≤today open; backlog open với status/category backlog; non-member 403.

- [ ] **Step 2: Implement queries + `ListSidebar` + handler SDO + route**

- [ ] **Step 3: `make sqlc` rồi `go test ./internal/service/ -run Calendar -count=1`** (không `make check`)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): add workspace calendar sidebar feed API

One payload for priorities, meet-with, assigned, today/overdue, and backlog.
EOF
)"
```

---

### Task 2: Core client + `useCalendarSidebar`

**Files:**
- Modify: `packages/core/api/endpoints/calendar.ts`, `calendar.test.ts`
- Modify: `packages/core/calendar/keys.ts`, `hooks.ts` (+ test nếu có)

**Interfaces:**
- Produces:

```ts
calendarKeys.sidebar(wsId)
getCalendarSidebar(wsId): Promise<CalendarSidebar>
useCalendarSidebar(wsId: string)
```

Lenient zod schema; malformed → empty sections fallback (không throw). Invalidate sidebar cùng `calendarKeys.all(wsId)` khi task/meeting mutate từ calendar page (Task 6).

- [ ] **Step 1: Failing malformed + happy-path endpoint tests**

- [ ] **Step 2: Implement → GREEN**

Run: `cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run api/endpoints/calendar calendar`

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(core): add calendar sidebar endpoint and React Query hook

Parse one sidebar payload with empty-section fallback on drift.
EOF
)"
```

---

### Task 3: Meeting dialog schedule defaults

**Files:**
- Modify: `packages/views/meetings/new-meeting-dialog.tsx` (+ test nếu có / thêm hẹp)
- Optional: `packages/views/meetings/meeting-datetime.ts` helper `scheduleDraftFromRange(start: Date, end: Date)`

**Interfaces:**
- Produces: props

```ts
scheduleDefaults?: { date: string; start: string; end: string }; // local wall times, same shape as defaultScheduleDraft
```

Khi mở với `scheduleDefaults`, seed state; không đổi UX meetings page (trigger-only callers).

- [ ] **Step 1: Test hoặc assert seed when defaults passed**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(meetings): allow NewMeetingDialog schedule prefill

Calendar create-from-slot can open with slot date and times.
EOF
)"
```

---

### Task 4: Create-from-slot (dateClick / select)

**Files:**
- Create: `packages/views/calendar/create-from-slot.tsx`, `create-from-slot.test.tsx`
- Modify: `fullcalendar-host.tsx` — `selectable`, `selectMirror` optional, `dateClick` + `select` → callback với `{ start: Date; end: Date | null; allDay: boolean }`
- Modify: `calendar-page.tsx` — mount menu + `CreateTaskDialog` / `NewMeetingDialog`

**Interfaces:**
- Host: `onSlotSelect?: (slot: { start: Date; end: Date | null; allDay: boolean }) => void`
- CreateFromSlot: controlled open + slot → actions “New task” / “New meeting” (i18n); closes menu then opens dialog with prefill.
- Task: `defaults={{ due_date, start_date? }}` — single day → due only; multi-day all-day select → start + due (inclusive end − 1 day, cùng rule Lát 2).
- Meeting timed: derive local date/start/end từ slot; all-day slot → defaultScheduleDraft on that date (1h block).

- [ ] **Step 1: Host + CreateFromSlot tests (mock FC callback)**

- [ ] **Step 2: Implement**

Run: `cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar`

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): create task or meeting from empty calendar slot

Wire dateClick/select to CreateTaskDialog and NewMeetingDialog prefills.
EOF
)"
```

---

### Task 5: Calendar sidebar UI (read-only sections first)

**Files:**
- Create: `calendar-sidebar.tsx`, `calendar-sidebar.test.tsx`
- Modify: i18n vi/en — `sidebar_priorities`, `sidebar_meet_with`, `sidebar_assigned`, `sidebar_today_overdue`, `sidebar_backlog`, empty copies, `create_meeting`
- Modify: `calendar-page.tsx` — flex row: sidebar | (toolbar+grid)

**Interfaces:**
- Props: `workspaceId`, `sections` from hook (or data + loading/error), `onOpenTask`, `onOpenMeeting`, `onCreateMeeting` (CTA Meet with).
- Collapsible sections (existing Collapsible / Accordion primitive nếu có; không invent card).
- Empty: i18n short copy per section.
- Rows: title + due/priority badge nhẹ bằng token; click → open detail (chưa drag ở task này).

- [ ] **Step 1: Render tests — 5 headings + empty**

- [ ] **Step 2: Implement + wire page**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): add left sidebar with five planner sections

Show priorities, meet-with, assigned, today/overdue, and backlog lists.
EOF
)"
```

---

### Task 6: Panel → grid external drop (assign due_date)

**Files:**
- Modify: `calendar-sidebar.tsx` — `data-event` / Draggable per task row (`@fullcalendar/interaction` `Draggable`, hoặc HTML5 drag với FC `droppable`)
- Modify: `fullcalendar-host.tsx` — `droppable: true`, `eventReceive` / `drop` → callback `{ taskId, dueDate: string }` (YYYY-MM-DD local)
- Modify: `calendar-mutations.ts` / page — PATCH task due_date; invalidate `calendarKeys.all` + sidebar; toast + revert visual if needed
- Test: host receive → patch shape; mutations invalidate sidebar key

**Rules:**
- Chỉ task rows (không drag meeting từ Meet with vào lưới ở Lát 3 — Meet with là CTA/open).
- Drop ngày → `due_date`; nếu task đã có start+due span, giữ độ dài ngày khi gán due mới (reuse logic gần `dropToPatch` hoặc helper `assignDueDate(task, dueYmd)`).
- Await server.

- [ ] **Step 1: Failing tests for receive → due_date**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): drag sidebar tasks onto the grid to set due dates

External FullCalendar drops PATCH due_date and refresh sidebar plus feed.
EOF
)"
```

---

### Task 7: Polish + focused verify

**Files:**
- i18n gaps; optional mobile collapse sidebar (nếu trivial — else skip)
- Spec status line → Lát 3 plan shipped/in-progress
- Run focused tests only:

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar api/endpoints/calendar
cd server && go test ./internal/service/ -run Calendar -count=1
```

**Không** `make check`.

- [x] **Step 1: Fix failures**

- [x] **Step 2: Commit** nếu còn diff docs/tests

```bash
git commit -m "$(cat <<'EOF'
test(calendar): cover Lát 3 sidebar and create-from-slot edges
EOF
)"
```

---

## Self-review (plan vs spec Lát 3)

| Spec item | Task |
| --- | --- |
| Sidebar API một payload | 1–2 |
| 5 section map A | 1, 5 |
| Drop panel → due | 6 |
| Create-from-slot task/meeting | 3–4 |
| ICS / Export | Out (Lát 4) |

## After Lát 3

- Plan Lát 4: ICS + polish/e2e
