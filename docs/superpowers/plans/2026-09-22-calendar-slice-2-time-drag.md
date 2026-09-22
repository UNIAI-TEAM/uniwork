# Calendar hub — Lát 2 (Week/Day + drag) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** in-progress — Lát 2 của spec C-02 / UNI-718. Lát 1 đã ship trên cùng nhánh (`2026-09-22-calendar-slice-1-month-feed.md`). Lát 3 (panel + tạo từ ô) và Lát 4 (ICS) = plan riêng.

**Goal:** Toolbar chọn Day / Work week / Week / Month; lưới timeGrid; kéo/resize event → PATCH task (`due_date` / span) hoặc meeting (`starts_at`/`ends_at`); prev/next theo period đang xem.

**Architecture:** Mở rộng `FullCalendarHost` với `@fullcalendar/timegrid` + `@fullcalendar/interaction`. Pure mapper `fcDropToPatch` trong `packages/views/calendar/` (hoặc `packages/core/calendar/` nếu không phụ thuộc FC types — ưu tiên views + test với plain dates). Mutations reuse `useUpdateTask` / `useUpdateMeeting`. View mode sống trong page state (chưa persist server).

**Tech Stack:** FullCalendar 6.1.x (đã pin daygrid), thêm `timegrid` + `interaction` cùng minor; React 19; TanStack Query; Vitest; existing task/meeting PATCH APIs.

**Spec:** `docs/superpowers/specs/2026-09-22-calendar-design.md` §2 views/tương tác, §5.2, §8 lát 2  
**Issue:** UNI-718 (sub mới cho Lát 2 T1–Tn)

## Scope check

Lát 2 chỉ time views + drag/resize. **Không:** panel trái, create-from-slot, ICS, Number of days, Side by side, Google sync, TaskViewMode calendar.

## Global Constraints

- Views: `timeGridDay` · work week (`timeGridWeek` + `hiddenDays: [0, 6]`) · `timeGridWeek` · `dayGridMonth`.
- Task all-day: drag đổi `due_date` (và `start_date` nếu span — giữ độ dài ngày khi move). Resize all-day span cập nhật start/due.
- Meeting timed: drag/resize → ISO `starts_at`/`ends_at`. Await server (không optimistic timed meeting).
- Task all-day drag: optimistic OK (cùng rule UniWork: predictable + cùng màn).
- `editable: true` chỉ khi Lát 2; Month vẫn editable all-day.
- Mọi chữ views qua `t()`; vi + en.
- File `.ts`/`.tsx` ≤ 500 dòng. Commit `Refs: UNI-718` từ hook nhánh.
- Vitest: `NODE_OPTIONS="--no-experimental-webstorage"`.
- Không Schedule-X; interaction MIT only.

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `pnpm-workspace.yaml` + `packages/views/package.json` | Catalog `@fullcalendar/timegrid`, `@fullcalendar/interaction` |
| `packages/views/calendar/calendar-view-mode.ts` | `"day" \| "work_week" \| "week" \| "month"` + FC view name / hiddenDays |
| `packages/views/calendar/calendar-drop-patch.ts` | Pure: drop/resize → task patch hoặc meeting body |
| `packages/views/calendar/fullcalendar-host.tsx` | Plugins, view, editable, eventDrop/Resize callbacks |
| `packages/views/calendar/calendar-toolbar.tsx` | View switcher + period nav (day/week/month aware) |
| `packages/views/calendar/calendar-page.tsx` | Wire viewMode + mutations + invalidate calendarKeys |
| `packages/core/i18n/locales/{vi,en}.json` | `calendar.view_*` keys |

---

### Task 1: Catalog timegrid + interaction

**Files:**
- Modify: `pnpm-workspace.yaml`, `packages/views/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: deps `@fullcalendar/timegrid` and `@fullcalendar/interaction` at same ^6.1.19 catalog as daygrid.

- [ ] **Step 1: Add catalog entries**

```yaml
"@fullcalendar/timegrid": "^6.1.19"
"@fullcalendar/interaction": "^6.1.19"
```

In `packages/views/package.json` dependencies:

```json
"@fullcalendar/timegrid": "catalog:",
"@fullcalendar/interaction": "catalog:"
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Run catalog-check if part of scripts.

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/views/package.json
git commit -m "$(cat <<'EOF'
chore(views): pin FullCalendar timegrid and interaction plugins

Enable Week/Day grids and drag for calendar hub Lát 2.
EOF
)"
```

---

### Task 2: View mode model + toolbar switcher (read-only switch first)

**Files:**
- Create: `packages/views/calendar/calendar-view-mode.ts`, `calendar-view-mode.test.ts`
- Modify: `calendar-toolbar.tsx`, `calendar-page.tsx`, `fullcalendar-host.tsx`
- Modify: i18n vi/en

**Interfaces:**
- Produces:

```ts
export type CalendarViewMode = "day" | "work_week" | "week" | "month";

export function fcViewForMode(mode: CalendarViewMode): string; // timeGridDay | timeGridWeek | dayGridMonth
export function fcHiddenDays(mode: CalendarViewMode): number[]; // [0,6] for work_week else []
export function shiftAnchor(mode: CalendarViewMode, anchor: Date, dir: -1 | 1): Date;
// day → ±1 day; week/work_week → ±7 days; month → ±1 month
```

- [ ] **Step 1: Failing tests for view-mode helpers**

```ts
import { describe, expect, it } from "vitest";
import { fcHiddenDays, fcViewForMode, shiftAnchor } from "./calendar-view-mode";

describe("calendar-view-mode", () => {
  it("maps modes to FC views", () => {
    expect(fcViewForMode("day")).toBe("timeGridDay");
    expect(fcViewForMode("work_week")).toBe("timeGridWeek");
    expect(fcViewForMode("week")).toBe("timeGridWeek");
    expect(fcViewForMode("month")).toBe("dayGridMonth");
  });
  it("hides weekends only for work_week", () => {
    expect(fcHiddenDays("work_week")).toEqual([0, 6]);
    expect(fcHiddenDays("week")).toEqual([]);
  });
  it("shifts anchor by period", () => {
    const d = new Date("2026-09-15T12:00:00Z");
    expect(shiftAnchor("day", d, 1).toISOString().slice(0, 10)).toBe("2026-09-16");
  });
});
```

- [ ] **Step 2: Run RED → implement → GREEN**

- [ ] **Step 3: i18n**

```json
"view_day": "Ngày",
"view_work_week": "Tuần làm việc",
"view_week": "Tuần",
"view_month": "Tháng",
"prev_period": "Kỳ trước",
"next_period": "Kỳ sau"
```

(en equivalents). Replace prev_month/next_month aria with period-aware keys or keep both.

- [ ] **Step 4: Toolbar + host**

- Toolbar: segmented buttons for 4 modes; `onViewModeChange`; prev/next call `shiftAnchor`.
- Host props: `viewMode: CalendarViewMode`; `plugins={[dayGrid, timeGrid, interaction]}`; `initialView={fcViewForMode(viewMode)}`; `key={`${viewMode}-${initialDate}`}` so view remounts; `hiddenDays={fcHiddenDays(viewMode)}`.
- Page: `useState<CalendarViewMode>("month")`.

**Not yet:** eventDrop (Task 3–4).

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): add Day Work-week Week Month view switcher

Wire timeGrid views and period-aware toolbar navigation for Lát 2.
EOF
)"
```

---

### Task 3: Pure drop/resize → patch mapper (TDD)

**Files:**
- Create: `calendar-drop-patch.ts`, `calendar-drop-patch.test.ts`

**Interfaces:**
- Produces:

```ts
export type CalendarDropPatch =
  | { kind: "task"; entityId: string; patch: { due_date?: string | null; start_date?: string | null } }
  | { kind: "meeting"; entityId: string; body: { starts_at: string; ends_at: string } };

/** Input is already decoded from FC (no FC imports in this module). */
export function dropToPatch(input: {
  event: CalendarEvent;
  start: Date; // new start
  end: Date | null; // new end exclusive for all-day, exclusive/inclusive match FC
  allDay: boolean;
}): CalendarDropPatch | null;
```

Rules:
- `kind === "task"` + allDay: `due_date = inclusive end day` (FC exclusive end − 1 day); if original had start_date span length preserved when moving, or start=start and due=end-1 when resizing.
- `kind === "meeting"` + !allDay: `starts_at`/`ends_at` = ISO from Date.
- Return null if cannot map (meeting forced allDay without times — skip or treat as timed noon–1h; **prefer null + no PATCH**).

- [ ] **Step 1: Write failing tests** covering: task due-only move one day; task span move; task span resize; meeting timed move; null for unknown.

- [ ] **Step 2: Implement → GREEN**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): map FullCalendar drop and resize to task or meeting patches

Keep domain patch rules pure and free of FullCalendar imports.
EOF
)"
```

---

### Task 4: Wire editable + mutations in host/page

**Files:**
- Modify: `fullcalendar-host.tsx`, `fullcalendar-host.test.tsx`, `calendar-page.tsx`, `calendar-page.test.tsx`

**Interfaces:**
- Host adds:

```ts
editable?: boolean; // default true in Lát 2
onEventDropOrResize?: (patch: CalendarDropPatch) => void | Promise<void>;
```

On `eventDrop` / `eventResize`: build dates from `info.event`, find `CalendarEvent` by id, call `dropToPatch`, then `onEventDropOrResize`. On failure call `info.revert()`.

Page:
- `useUpdateTask(workspaceId)`
- For meetings: need mutation per id — either `meetings.updateMeeting(id, body)` via a small helper hook `useCalendarEventMutations(wsId)` that wraps updateMeeting without fixed meetingId, **or** call endpoint directly in mutationFn. Prefer:

```ts
// in calendar-page or calendar-mutations.ts
function useCalendarMutations(wsId: string) {
  const updateTask = useUpdateTask(wsId);
  const qc = useQueryClient();
  const updateMeeting = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMeetingBody }) =>
      meetings.updateMeeting(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: calendarKeys.all(wsId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.list(wsId) });
    },
  });
  // also invalidate calendar on task settle — useUpdateTask already invalidates tasks; add calendarKeys.all in onSettled wrapper
}
```

Spec: invalidate `calendarKeys.all(wsId)` after successful patch.

Optimistic: only for task allDay patches — optional thin optimistic on calendar query cache; if complex, await task mutate and rely on invalidate (acceptable for Lát 2 if drop feels laggy document in report). Prefer await + invalidate for both first; add task optimistic only if easy.

- [ ] **Step 1: Host tests** with mocked FC firing drop → callback with expected patch shape (or test integration via dropToPatch + page handler mock).

- [ ] **Step 2: Implement host editable + page wiring**

- [ ] **Step 3: Toast on error** using existing toast-api-error pattern if present.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): persist drag and resize via task and meeting PATCH

Editable time and month grids update due dates and meeting times on drop.
EOF
)"
```

---

### Task 5: Polish nav labels + verify focused tests

**Files:**
- Modify: toolbar aria labels for period; optional weekend toggle **out of scope** unless trivial (spec: hide weekends only via work_week mode — already done).
- Run:

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar
```

- Manual: after restarting server if needed, open calendar, switch views, drag a task.

- [ ] **Step 1: Run tests — fix failures**

- [ ] **Step 2: Commit** only if docs/status tweaks needed:

```bash
git commit -m "$(cat <<'EOF'
test(calendar): cover Lát 2 view mode and drop patch edge cases
EOF
)"
```

- [ ] **Step 3: Update spec status line** to mention Lát 2 plan path.

---

## Self-review (plan vs spec Lát 2)

| Spec item | Task |
| --- | --- |
| Day / Work week / Week / Month | 2 |
| timeGrid + interaction | 1, 2, 4 |
| Drag/resize → PATCH | 3, 4 |
| Hide weekends via work week | 2 |
| Optimistic task all-day | 4 (prefer await first) |
| Panel / create / ICS | Out |

## After Lát 2

- Plan Lát 3: sidebar + create-from-slot  
- Plan Lát 4: ICS + polish
