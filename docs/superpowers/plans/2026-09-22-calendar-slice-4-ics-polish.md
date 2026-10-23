# Calendar hub — Lát 4 (ICS + polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** shipped — Lát 4 (ICS + polish) hoàn tất; C-02 v1 trên nhánh UNI-718 / PR #102.

**Goal:** `GET …/workspaces/{id}/calendar.ics` (task all-day + meeting VEVENT, auth member); nút Export ICS trên toolbar; polish nhãn kỳ theo view + sidebar “today” local; verify hẹp (không `make check` trừ khi user yêu cầu).

**Architecture:** Reuse / extract ICS helpers cạnh `renderICS` trong `server/internal/service` (cùng package — không import cross-layer). `CalendarService.WorkspaceICS` đọc cùng nguồn như feed (hoặc range rộng mặc định: từ đầu tháng trước → cuối tháng sau, hoặc query không range với cap). Handler trả `text/calendar` giống meeting ICS. Client `requestText` + blob download trên toolbar (pattern `MeetingCalendarButton`).

**Tech Stack:** Go; existing meeting ICS helpers; `requestText`; Vitest; optional Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-09-22-calendar-design.md` §3.1 Export ICS, §4.3 `calendar.ics`, §6 auth, §8 lát 4, §10  
**Issue:** UNI-718 (sub mới Lát 4 T1–Tn)  
**Reuse:** `GET /meetings/{id}/calendar.ics` — `meeting_ai.go` `CalendarICS` / `renderICS` / `icsEscape`

## Scope check

Lát 4: workspace ICS + Export button + polish nhỏ + verify. **Không:** Google/Outlook 2 chiều; public unauthenticated ICS; TaskViewMode calendar; broad e2e suite (tối đa 1 smoke hẹp nếu ổn định).

## Global Constraints

- `GET /api/v1/workspaces/{workspaceID}/calendar.ics` — RequireMember; `Content-Type: text/calendar; charset=utf-8`; `Content-Disposition: attachment; filename="uniwork-calendar.ics"`; `Cache-Control: no-store`.
- Payload: VEVENT cho mỗi task có `due_date` (VALUE=DATE all-day) + mỗi meeting non-canceled trong cửa sổ xuất (default: `from = today−30d`, `to = today+90d` UTC dates, hoặc query params `from`/`to` optional YYYY-MM-DD — nếu có thì cùng rule ListEvents).
- Không audit cho READ ICS.
- Toolbar: nút Export ICS (i18n `calendar.export_ics`); tải qua bearer `requestText` + blob (không mở URL trần mất auth).
- Polish: toolbar center label theo `viewMode` (day → ngày; week/work_week → khoảng tuần; month → `LLLL yyyy`); sidebar `ListSidebar` “today” dùng ngày local của server… **chốt:** pass `today` as calendar date in workspace — for v1 use **local date of `time.Now()` in Asia/Ho_Chi_Minh if ws has no TZ, else document UTC** — prefer `time.Now().In(loc)` with `loc = time.Local` in tests and `loadLocation` from env `TZ` or fixed `Asia/Ho_Chi_Minh` constant for UniWork VN product. Simplest correct fix: `today := truncateDate(time.Now())` using **local** wall date (`time.Now()` year/month/day in Local), not UTC truncate — document in service comment.
- Theme/a11y: theme bridge đã có — chỉ sửa nếu regression; đảm bảo Export button ≥44px touch / focus-visible (primitive Button).
- File ≤500 dòng; `t()`; vi+en; `Refs: UNI-718`.
- Vitest: `NODE_OPTIONS="--no-experimental-webstorage"`.
- **Không chạy `make check`** trừ khi user bảo — chỉ test hẹp từng task.

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `server/internal/service/ics.go` (hoặc extract từ `meeting_ai.go`) | `icsEscape`, shared VEVENT builders cho meeting + all-day task |
| `server/internal/service/calendar.go` (+ test) | `WorkspaceICS(ctx, wsID, userID, from, to)` |
| `server/internal/handler/calendar.go`, `router/calendar.go` | HTTP raw ICS (không JSON SDO) |
| `packages/core/api/endpoints/calendar.ts` (+ test) | `fetchWorkspaceCalendarIcs(wsId, { from?, to? })` |
| `packages/views/calendar/calendar-export-button.tsx` | Download blob |
| `packages/views/calendar/calendar-toolbar.tsx` | Export control + period label by viewMode |
| `packages/core/i18n/locales/{vi,en}.json` | `export_ics`, `export_ics_error` |
| Optional `e2e/calendar-ics.spec.ts` | Smoke download nếu app sẵn |

---

### Task 1: Extract shared ICS helpers + WorkspaceICS (Go)

**Files:**
- Create/Modify: `server/internal/service/ics.go` — move `icsEscape`, add `renderAllDayTaskVEVENT`, keep `renderICS` meeting calling shared escape
- Modify: `calendar.go`, `calendar_test.go`
- Modify: `meeting_ai.go` — call extracted helpers (không đổi hành vi meeting ICS)

**Interfaces:**
```go
func (s *CalendarService) WorkspaceICS(ctx context.Context, workspaceID, userID string, from, to time.Time) ([]byte, error)
```
- RequireMember; reuse ListEvents-style queries (or call internal list then render).
- UID: `task-{id}@uniwork` / `meeting-{id}@uniwork`.
- All-day task: `DTSTART;VALUE=DATE:YYYYMMDD`, `DTEND;VALUE=DATE:` exclusive end (due+1).

- [ ] **Step 1: RED tests** — member-only; body contains `BEGIN:VCALENDAR`, task SUMMARY, meeting SUMMARY; non-member error.

- [ ] **Step 2: Implement → GREEN** — `go test ./internal/service/ -run 'Calendar|RenderICS|WorkspaceICS' -count=1`

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): generate workspace calendar.ics for tasks and meetings

Auth-gated text/calendar feed reusing shared ICS escape helpers.
EOF
)"
```

---

### Task 2: HTTP route for workspace ICS

**Files:**
- Modify: `handler/calendar.go`, `router/calendar.go`, Routes wiring
- Optional: handler test mirroring meeting calendar headers

**Interfaces:**
- `GET /workspaces/{workspaceID}/calendar.ics?from=&to=` optional.
- Headers giống meeting ICS; filename `uniwork-calendar.ics`.
- Không đăng ký SDO JSON — `apiOp` với raw response ok (xem meeting route).

- [ ] **Step 1: Implement + smoke test headers/body if easy**

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): expose GET workspace calendar.ics endpoint

Member-only download with text/calendar attachment headers.
EOF
)"
```

---

### Task 3: Core client + Export button

**Files:**
- Modify: `packages/core/api/endpoints/calendar.ts` (+ test — text smoke / empty fail)
- Create: `calendar-export-button.tsx` (+ test)
- Modify: `calendar-toolbar.tsx`, i18n

**Interfaces:**
```ts
fetchWorkspaceCalendarIcs(wsId: string, opts?: { from?: string; to?: string }): Promise<string>
```
Toolbar nhận `workspaceId` + optional range from page (`range.from`/`range.to`).

- [ ] **Step 1: RED endpoint/export tests**

- [ ] **Step 2: Implement download** (blob URL + revoke; toast on error)

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): add Export ICS toolbar download

Fetch auth-gated calendar.ics and save as attachment via blob.
EOF
)"
```

---

### Task 4: Polish period label + sidebar today (local)

**Files:**
- Modify: `calendar-toolbar.tsx` (+ test) — label by `viewMode`
- Modify: `calendar.go` ListSidebar today = local YMD (`time.Now()` Date in Local)
- Optional: extend Go test for today_overdue boundary comment

- [ ] **Step 1: Tests for day/week/month labels**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(calendar): show period-aware toolbar label and local sidebar today

Match Week/Day chrome to the visible period; overdue uses local calendar day.
EOF
)"
```

---

### Task 5: Focused verify (+ optional e2e)

**Files:**
- Spec/plan status → shipped
- Run:

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar api/endpoints/calendar
cd server && go test ./internal/service/ -run 'Calendar|RenderICS|WorkspaceICS' -count=1
```

Optional: `e2e/calendar-ics.spec.ts` only if app running and pattern from `meetings.spec.ts` is cheap — otherwise skip and note in report.

- [ ] **Step 1: Fix failures**

- [ ] **Step 2: Docs status commit if needed**

```bash
git commit -m "$(cat <<'EOF'
docs(calendar): mark Lát 4 ICS polish plan shipped
EOF
)"
```

---

## Self-review (plan vs spec Lát 4)

| Spec item | Task |
| --- | --- |
| Workspace calendar.ics | 1–2 |
| Export ICS toolbar | 3 |
| Auth member only | 1–2 |
| Theme / a11y | 3 (Button) + existing theme |
| Period polish | 4 |
| E2E hẹp | 5 optional |

## After Lát 4

- C-02 v1 complete trên nhánh; merge PR #102 khi CI xanh.
