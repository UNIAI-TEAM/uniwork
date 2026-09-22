# Calendar hub — Lát 1 (Month + feed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** in-progress — plan Lát 1 của spec C-02. Lát 2 (Week/Day + kéo), Lát 3 (panel + tạo từ ô), Lát 4 (ICS + polish) = plan riêng sau khi Lát 1 merge.

**Goal:** Member mở `/{org}/{ws}/calendar`, xem Month grid có task (due/span) + meeting trong khoảng tháng, filter Của tôi, click mở detail — đọc-only, chưa kéo/tạo/ICS/panel trái.

**Architecture:** Hybrid theo spec: `packages/core/calendar` normalize + hooks; `GET …/calendar/events`; `packages/views/calendar` shell + FullCalendar `dayGridMonth` only; page mỏng trong `apps/web`. Ghi không có trong lát này.

**Tech Stack:** Go (Chi, sqlc, pgx), TypeScript strict, React 19, TanStack Query, FullCalendar 6 community (`@fullcalendar/core` / `react` / `daygrid`), Vitest, date-fns (đã có).

**Spec:** `docs/superpowers/specs/2026-09-22-calendar-design.md` §3.1 (phần đọc), §4, §8 lát 1, §10 (subset)

**Issue:** UNI-718 · sub-issues UNI-719…UNI-725 (T1–T7). Commit trên `feature/UNI-718-…` để hook gắn `Refs:`.

## Scope check

Spec C-02 gồm 4 lát phụ thuộc tuần tự. Plan này **chỉ Lát 1**. Không implement drag, create-from-slot, sidebar, ICS, timeGrid trong plan này.

## Global Constraints

- Spec quyết định: hub độc lập, FullCalendar community (không Schedule-X), `from`/`to` là **`YYYY-MM-DD` inclusive** (ngày lịch, không RFC3339).
- Overlap task: có `due_date`; khoảng `[coalesce(start_date, due_date), due_date]` giao `[from, to]`.
- Meeting: không canceled; `starts_at`/`ends_at` giao `[from 00:00 UTC, to+1day 00:00 UTC)` — implement đúng trong service test; document trong comment query.
- `mine=true`: task `assignee_id = caller` (human); meeting caller là host hoặc participant (dùng query membership meeting hiện có / join participants).
- Package boundaries: `core` không import FullCalendar; `views` không `next/*`; mọi JSX text qua `t()`.
- File `.ts`/`.tsx` ≤ 500 dòng (max-lines).
- Catalog pin FullCalendar trong `pnpm-workspace.yaml`; khai báo deps trong `packages/views/package.json`.
- `pnpm generate:reserved-slugs` sau khi sửa `reserved_slugs.json`.
- Coverage floors không hạ. Vitest: `NODE_OPTIONS="--no-experimental-webstorage"`.
- Commit prefixes: `feat(scope)`, `fix(scope)`, `test(scope)`, `chore(scope)`, `docs`.
- SDI/SDO + `apiOp`; client `parseWithFallback` + malformed test.

## Cấu trúc file đích (Lát 1)

| File | Trách nhiệm |
| --- | --- |
| `server/internal/service/reserved_slugs.json` | Thêm `calendar` |
| `packages/core/paths/reserved-slugs.ts` | Generated |
| `packages/core/paths/paths.ts` | `calendar()` |
| `packages/core/calendar/types.ts` | `CalendarEvent` |
| `packages/core/calendar/normalize.ts` | task/meeting → event |
| `packages/core/calendar/keys.ts` | query keys |
| `packages/core/calendar/hooks.ts` | `useCalendarEvents` |
| `packages/core/api/endpoints/calendar.ts` | GET events client |
| `packages/core/api/endpoints/calendar.test.ts` | schema + malformed |
| `server/pkg/db/queries/calendar.sql` | List tasks/meetings in range |
| `server/internal/service/calendar.go` | `ListCalendarEvents` |
| `server/internal/service/calendar_test.go` | isolation + mine + overlap |
| `server/internal/handler/dto/sdo/calendar.go` | SDO |
| `server/internal/handler/calendar.go` | HTTP |
| `server/internal/handler/router/calendar.go` | register route |
| `packages/views/calendar/calendar-page.tsx` | shell |
| `packages/views/calendar/calendar-toolbar.tsx` | month nav + mine + Today |
| `packages/views/calendar/fullcalendar-host.tsx` | dayGridMonth |
| `packages/views/calendar/fullcalendar-theme.css` | token bridge |
| `apps/web/app/[orgSlug]/[workspaceSlug]/calendar/page.tsx` | route |
| `packages/views/layout/app-sidebar.tsx` | nav item |
| `packages/core/i18n/locales/{vi,en}.json` | `nav.calendar`, `calendar.*` |

---

### Task 1: Path + reserved slug

**Files:**
- Modify: `server/internal/service/reserved_slugs.json`
- Modify: `packages/core/paths/paths.ts`
- Modify: `packages/core/paths/consistency.test.ts`, `packages/core/paths/resolve.test.ts`
- Generate: `packages/core/paths/reserved-slugs.ts`

**Interfaces:**
- Produces: `paths.workspace(org, ws).calendar(): string` → `/{org}/{ws}/calendar`

- [ ] **Step 1: Write the failing path test**

In `packages/core/paths/resolve.test.ts` add:

```ts
it("builds calendar under the workspace", () => {
  expect(paths.workspace("acme", "team").calendar()).toBe("/acme/team/calendar");
});
```

In `consistency.test.ts`, add `ws.calendar()` to the `scoped` array next to `ws.meetings()`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run paths/resolve.test.ts paths/consistency.test.ts
```

Expected: FAIL — `calendar` is not a function / missing from scoped list.

- [ ] **Step 3: Implement path + reserved slug**

Add `"calendar"` to `server/internal/service/reserved_slugs.json` (alphabetically near `chat` / after related slugs is fine; keep JSON valid).

In `paths.ts` workspace return object, after `myTasks`:

```ts
calendar: () => `${base}/calendar`,
```

Run:

```bash
pnpm generate:reserved-slugs
```

- [ ] **Step 4: Run tests to verify they pass**

Same vitest command as Step 2. Expected: PASS. Also ensure `RESERVED_SLUGS` contains `"calendar"`.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/reserved_slugs.json packages/core/paths/
git commit -m "$(cat <<'EOF'
feat(paths): add workspace calendar route builder

Reserve the calendar slug and expose paths.workspace().calendar() for the C-02 hub.
EOF
)"
```

---

### Task 2: Core `CalendarEvent` normalize (TDD)

**Files:**
- Create: `packages/core/calendar/types.ts`, `normalize.ts`, `normalize.test.ts`
- Modify: `packages/core/package.json` exports — add `"./calendar": "./calendar/hooks.ts"` later in Task 4; for now export is optional if tests import relative. Prefer adding `"./calendar/*": "./calendar/*.ts"` now:

```json
"./calendar": "./calendar/hooks.ts",
"./calendar/*": "./calendar/*.ts",
```

(hooks stub empty until Task 4 is OK — or only add export in Task 4 to avoid knip unused. **Do not** add export until hooks exist; tests import `./normalize` relatively.)

**Interfaces:**
- Produces:

```ts
export type CalendarEventKind = "task" | "meeting";

export type CalendarEvent = {
  id: string; // `task:${entityId}` | `meeting:${entityId}`
  kind: CalendarEventKind;
  entityId: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  status?: string;
  priority?: string;
  projectId?: string | null;
};

export function taskToCalendarEvent(task: {
  id: string;
  title: string;
  start_date?: string | null;
  due_date?: string | null;
  status?: string;
  priority?: string;
  project_id?: string | null;
}): CalendarEvent | null;

export function meetingToCalendarEvent(meeting: {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status?: string;
}): CalendarEvent | null;
```

- [ ] **Step 1: Write the failing normalize tests**

```ts
import { describe, expect, it } from "vitest";
import { meetingToCalendarEvent, taskToCalendarEvent } from "./normalize";

describe("taskToCalendarEvent", () => {
  it("returns null without due_date", () => {
    expect(taskToCalendarEvent({ id: "t1", title: "A" })).toBeNull();
  });

  it("maps due-only as all-day single day", () => {
    expect(taskToCalendarEvent({ id: "t1", title: "A", due_date: "2026-09-10" })).toEqual({
      id: "task:t1",
      kind: "task",
      entityId: "t1",
      title: "A",
      start: "2026-09-10",
      end: "2026-09-11", // FullCalendar exclusive end for all-day
      allDay: true,
      status: undefined,
      priority: undefined,
      projectId: undefined,
    });
  });

  it("maps start+due as all-day span with exclusive end", () => {
    const ev = taskToCalendarEvent({
      id: "t1",
      title: "A",
      start_date: "2026-09-08",
      due_date: "2026-09-10",
      priority: "high",
    });
    expect(ev?.start).toBe("2026-09-08");
    expect(ev?.end).toBe("2026-09-11");
    expect(ev?.allDay).toBe(true);
    expect(ev?.priority).toBe("high");
  });
});

describe("meetingToCalendarEvent", () => {
  it("returns null when canceled", () => {
    expect(
      meetingToCalendarEvent({
        id: "m1",
        title: "Sync",
        starts_at: "2026-09-10T03:00:00Z",
        ends_at: "2026-09-10T04:00:00Z",
        status: "CANCELED",
      }),
    ).toBeNull();
  });

  it("maps timed meeting", () => {
    const ev = meetingToCalendarEvent({
      id: "m1",
      title: "Sync",
      starts_at: "2026-09-10T03:00:00Z",
      ends_at: "2026-09-10T04:00:00Z",
      status: "SCHEDULED",
    });
    expect(ev).toMatchObject({
      id: "meeting:m1",
      kind: "meeting",
      entityId: "m1",
      allDay: false,
      start: "2026-09-10T03:00:00Z",
      end: "2026-09-10T04:00:00Z",
    });
  });
});
```

Note: exclusive `end` for all-day is FullCalendar convention (`end` = day after last inclusive day). Document in `normalize.ts` comment.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar/normalize.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + normalize**

`types.ts` — export `CalendarEvent` / `CalendarEventKind` as above.

`normalize.ts` — implement; treat status case-insensitive `canceled` / `CANCELED` as canceled. For due-only, `end` = due + 1 day (`date-fns` `addDays` + `format` `yyyy-MM-dd`). Prefer importing `addDays`/`format`/`parseISO` from `date-fns` (add `date-fns` to `packages/core/package.json` if not already a dependency — check first; if missing, implement +1 day with pure string ULID-safe date math on `YYYY-MM-DD` to avoid new dep:

```ts
function addOneCalendarDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}
```

Use UTC date parts only.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/core/calendar/
git commit -m "$(cat <<'EOF'
feat(core): normalize tasks and meetings into calendar events

All-day tasks use FullCalendar-exclusive end dates; canceled meetings are omitted.
EOF
)"
```

---

### Task 3: Backend calendar events feed

**Files:**
- Create: `server/pkg/db/queries/calendar.sql`
- Create: `server/internal/service/calendar.go`, `calendar_test.go`
- Create: `server/internal/handler/dto/sdo/calendar.go`
- Create: `server/internal/handler/calendar.go`
- Create: `server/internal/handler/router/calendar.go`
- Modify: `server/internal/handler/router/routes.go` (add handler fields)
- Modify: `server/internal/handler/router.go` (wire)
- Modify: wherever `register*` is called (e.g. `router/router.go` or package init) to `registerCalendar`
- Run: `make sqlc`

**Interfaces:**
- Produces HTTP: `GET /api/v1/workspaces/{workspaceID}/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD&mine=true|false`
- SDO:

```go
type CalendarEventSDO struct {
  ID        string  `json:"id" example:"task:01H…"`
  Kind      string  `json:"kind" example:"task"`
  EntityID  string  `json:"entity_id" example:"01H…"`
  Title     string  `json:"title"`
  Start     string  `json:"start" example:"2026-09-10"`
  End       *string `json:"end,omitempty"`
  AllDay    bool    `json:"all_day"`
  Status    *string `json:"status,omitempty"`
  Priority  *string `json:"priority,omitempty"`
  ProjectID *string `json:"project_id,omitempty"`
}

type CalendarEventListSDO struct {
  Events []CalendarEventSDO `json:"events"`
}
```

- Service: `func (s *CalendarService) ListEvents(ctx, workspaceID, userID string, from, to time.Time, mine bool) ([]CalendarEvent, error)` after `RequireMember`.

- [ ] **Step 1: Write failing Go service test**

Follow patterns in `server/internal/service/task_test.go` / meeting tests for DB helpers. Minimal cases:

1. Member sees task due in range and meeting in range.
2. Task outside range absent.
3. Other workspace’s task absent (isolation).
4. `mine=true` hides task assigned to someone else.
5. Canceled meeting absent.

Expected: FAIL compile / missing type until implementation.

- [ ] **Step 2: SQL + sqlc**

`calendar.sql` example (adjust column names to match schema):

```sql
-- name: ListCalendarTasksInRange :many
SELECT id, title, status, priority, project_id, start_date, due_date, assignee_id, assignee_kind
FROM tasks
WHERE organization_id = $1
  AND workspace_id = $2
  AND due_date IS NOT NULL
  AND due_date >= $3::date
  AND COALESCE(start_date, due_date) <= $4::date
  AND ($5::bool = false OR (assignee_kind = 'human' AND assignee_id = $6));

-- name: ListCalendarMeetingsInRange :many
SELECT m.id, m.title, m.status, m.starts_at, m.ends_at
FROM meetings m
WHERE m.workspace_id = $1
  AND m.status <> 'CANCELED'
  AND m.starts_at < $3::timestamptz
  AND m.ends_at > $2::timestamptz
  AND (
    $4::bool = false
    OR m.host_user_id = $5
    OR EXISTS (
      SELECT 1 FROM meeting_participants p
      WHERE p.meeting_id = m.id AND p.user_id = $5
    )
  );
```

Verify real table/column names (`meeting_participants` vs invitations) against schema before finalizing — **read** `server/pkg/db/queries/meetings.sql` and migrations; adapt EXISTS clause to the actual participants table. If org_id is required on meetings, add it.

`make sqlc`

- [ ] **Step 3: Service + map to SDO shape**

Parse `from`/`to` as dates; reject if `to < from` or span > 366 days (`400`). Build event ids `task:` / `meeting:`. All-day end exclusive = due+1 day (same as core).

- [ ] **Step 4: Handler + router**

`decode` query params; `mine` default false; map service errors via `mapServiceError`.

Register:

```go
func registerCalendar(r api, h Routes) {
  r.Get("/workspaces/{workspaceID}/calendar/events", h.ListCalendarEvents, apiOp{
    summary: "List calendar events in a date range",
    tags:    []string{"calendar"},
    sdo:     sdo.CalendarEventListSDO{},
    auth:    true,
  })
}
```

Wire `ListCalendarEvents` on `Routes` + `handler.New`.

- [ ] **Step 5: Run Go tests**

```bash
cd server && go test ./internal/service/ -run Calendar -count=1
```

Expected: PASS for new tests. Fix participant table name if FAIL.

- [ ] **Step 6: Commit**

```bash
git add server/pkg/db/queries/calendar.sql server/pkg/db/generated/ \
  server/internal/service/calendar.go server/internal/service/calendar_test.go \
  server/internal/handler/calendar.go server/internal/handler/dto/sdo/calendar.go \
  server/internal/handler/router/calendar.go server/internal/handler/router/routes.go \
  server/internal/handler/router.go
# include any other wire files touched
git commit -m "$(cat <<'EOF'
feat(calendar): add workspace calendar events feed API

Range-query tasks and meetings for the Month hub with optional mine filter.
EOF
)"
```

---

### Task 4: Client endpoint + hooks

**Files:**
- Create: `packages/core/api/endpoints/calendar.ts`, `calendar.test.ts`
- Create: `packages/core/calendar/keys.ts`, `hooks.ts`
- Modify: `packages/core/package.json` exports

**Interfaces:**
- Produces:

```ts
export async function listCalendarEvents(
  workspaceId: string,
  params: { from: string; to: string; mine?: boolean },
): Promise<CalendarEvent[]>;

export const calendarKeys = {
  all: (wsId: string) => ["calendar", wsId] as const,
  events: (wsId: string, from: string, to: string, mine: boolean) =>
    [...calendarKeys.all(wsId), "events", from, to, mine] as const,
};

export function useCalendarEvents(
  wsId: string,
  from: string,
  to: string,
  mine: boolean,
): UseQueryResult<CalendarEvent[]>;
```

- [ ] **Step 1: Write malformed-response test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCalendarEvents } from "./calendar";

vi.mock("../http", () => ({
  request: vi.fn(),
}));

import { request } from "../http";

describe("listCalendarEvents", () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it("returns [] on malformed payload", async () => {
    vi.mocked(request).mockResolvedValue({ nope: true });
    await expect(listCalendarEvents("ws1", { from: "2026-09-01", to: "2026-09-30" })).resolves.toEqual([]);
  });

  it("parses events envelope", async () => {
    vi.mocked(request).mockResolvedValue({
      events: [
        {
          id: "task:t1",
          kind: "task",
          entity_id: "t1",
          title: "A",
          start: "2026-09-10",
          end: "2026-09-11",
          all_day: true,
        },
      ],
    });
    const ev = await listCalendarEvents("ws1", { from: "2026-09-01", to: "2026-09-30" });
    expect(ev[0]?.entityId).toBe("t1");
    expect(ev[0]?.allDay).toBe(true);
  });
});
```

Map snake_case JSON → camelCase `CalendarEvent` in the endpoint (or zod transform). Prefer zod schema with `.transform`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement endpoint + hooks + package export**

```ts
// hooks.ts
export function useCalendarEvents(wsId: string, from: string, to: string, mine: boolean) {
  return useQuery({
    queryKey: calendarKeys.events(wsId, from, to, mine),
    queryFn: () => listCalendarEvents(wsId, { from, to, mine }),
    enabled: Boolean(wsId && from && to),
  });
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/core/api/endpoints/calendar.ts packages/core/api/endpoints/calendar.test.ts \
  packages/core/calendar/ packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(core): calendar events client and React Query hook

Lenient parseWithFallback keeps the Month grid up when the envelope drifts.
EOF
)"
```

---

### Task 5: FullCalendar deps + Month host

**Files:**
- Modify: `pnpm-workspace.yaml` catalog — pin e.g. `@fullcalendar/core`: `^6.1.19` (resolve exact latest 6.1.x at install time; same version for react/daygrid/interaction — interaction unused until Lát 2 but pin now to avoid version skew, **or** omit interaction until Lát 2 — **omit interaction in Lát 1**)
- Modify: `packages/views/package.json` — dependencies `@fullcalendar/core`, `@fullcalendar/react`, `@fullcalendar/daygrid` via `catalog:`
- Create: `packages/views/calendar/fullcalendar-theme.css`, `fullcalendar-host.tsx`, `fullcalendar-host.test.tsx`
- Modify: `packages/views/package.json` exports `"./calendar/*": "./calendar/*.tsx"`

**Interfaces:**
- Produces:

```tsx
export function FullCalendarHost(props: {
  events: CalendarEvent[];
  initialDate: string; // YYYY-MM-DD
  onDatesSet: (range: { from: string; to: string }) => void;
  onEventClick: (event: CalendarEvent) => void;
  className?: string;
}): JSX.Element;
```

- [ ] **Step 1: Add catalog + install**

```yaml
# pnpm-workspace.yaml catalog:
"@fullcalendar/core": "^6.1.19"
"@fullcalendar/react": "^6.1.19"
"@fullcalendar/daygrid": "^6.1.19"
```

```bash
pnpm install
```

Run `scripts/catalog-check` if part of check — keep versions aligned.

- [ ] **Step 2: Write host smoke test**

Render with one event; assert `data-testid="calendar-grid"` present; click event fires `onEventClick` (mock FullCalendar is heavy — prefer testing a thin mapper `toFcEvent(ev)` unit test instead of full FC mount if jsdom struggles):

```ts
// calendar-fc-map.ts
export function toFcEvent(ev: CalendarEvent) {
  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    extendedProps: { kind: ev.kind, entityId: ev.entityId },
  };
}
```

Test `toFcEvent` thoroughly; host test can be light render with mocked `@fullcalendar/react` if needed.

- [ ] **Step 3: Implement theme CSS**

Map `.fc` colors to `hsl(var(--background))` / `var(--primary)` / `var(--border)` / `var(--muted-foreground)` — both light and dark inherit from tokens (no hardcoded hex).

- [ ] **Step 4: Implement `FullCalendarHost`**

- plugins: `[dayGridPlugin]`
- initialView: `dayGridMonth`
- `datesSet` → compute `from`/`to` as `YYYY-MM-DD` from `start`/`end` (FC end exclusive → subtract 1 day for `to` **or** pass FC’s active range start/end exclusive consistently with API — **chốt:** API `from`/`to` inclusive; from `datesSet`, `from = format(arg.start)`, `to = format(addDays(arg.end, -1))`).
- `eventClick` → lookup by `info.event.id` in props.events.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/views/package.json packages/views/calendar/
git commit -m "$(cat <<'EOF'
feat(views): add FullCalendar month host for calendar hub

Pin community dayGrid plugins and bridge FC chrome to design tokens.
EOF
)"
```

---

### Task 6: Page shell, toolbar, nav, i18n, route

**Files:**
- Create: `packages/views/calendar/calendar-page.tsx`, `calendar-toolbar.tsx`, `calendar-page.test.tsx`
- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/calendar/page.tsx`
- Modify: `packages/views/layout/app-sidebar.tsx` — nav item `nav.calendar`, module `calendar` (tone already `yellow`), icon `Calendar` from lucide (keep Meetings on `CalendarDays`)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Modify: `packages/views/layout/app-sidebar.tsx` NavItem key union

**Interfaces:**
- Produces: `CalendarPageView({ workspaceId, orgSlug, wsSlug, onOpenTask, onOpenMeeting })`

- [ ] **Step 1: i18n keys (vi + en)**

```json
"nav": {
  "calendar": "Lịch"
},
"calendar": {
  "title": "Lịch",
  "today": "Hôm nay",
  "mine": "Của tôi",
  "loading": "Đang tải lịch…",
  "error": "Không tải được lịch.",
  "retry": "Thử lại",
  "view_month": "Tháng"
}
```

English equivalents in `en.json`.

- [ ] **Step 2: Failing page test**

Mock `@uniwork/core/calendar` `useCalendarEvents` → return one task event; render `CalendarPageView`; assert title via `t` and grid testid.

- [ ] **Step 3: Implement toolbar + page**

State: `anchorDate` (Date), `mine` boolean. Derive `from`/`to` for current month (or from `onDatesSet`). Header via `PageHeader` / `CollectionPageHeader` with `moduleTone("calendar")`.

Wire `onEventClick`: if `kind === "task"` → `onOpenTask(entityId)` else `onOpenMeeting`.

- [ ] **Step 4: App route** (mirror my-tasks lazy page)

```tsx
"use client";
import { Suspense, lazy } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

const CalendarPageView = lazy(() =>
  import("@uniwork/views/calendar/calendar-page").then((m) => ({ default: m.CalendarPageView })),
);

export default function CalendarPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return (
    <Suspense fallback={null}>
      <CalendarPageView
        workspaceId={workspace.id}
        onOpenTask={(id) => push(ws.task(id))}
        onOpenMeeting={(id) => push(ws.meeting(id))}
      />
    </Suspense>
  );
}
```

- [ ] **Step 5: Sidebar nav**

Add to work group after projects:

```ts
{ key: "nav.calendar", module: "calendar", href: ws.calendar(), icon: Calendar },
```

Extend `NavItem` key union + i18n.

Update `app-sidebar` tests that snapshot nav labels if they assert exact item lists.

- [ ] **Step 6: Run views + paths tests**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar layout/app-sidebar
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run calendar api/endpoints/calendar paths
```

- [ ] **Step 7: Commit**

```bash
git add packages/views/calendar/ packages/views/layout/app-sidebar.tsx \
  packages/views/layout/app-sidebar.test.tsx \
  packages/core/i18n/locales/ apps/web/app/
git commit -m "$(cat <<'EOF'
feat(calendar): ship Month hub page with nav and mine filter

Wire the workspace calendar route to the events feed for read-only Month view.
EOF
)"
```

---

### Task 7: Realtime invalidation (minimal) + spec/plan status

**Files:**
- Modify: `packages/core/realtime/use-realtime-sync.ts` (or adjacent) — on `task.updated` / meeting events that already invalidate task/meeting keys, also `queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) })` when workspace id present on frame.
- Test: extend existing realtime test if cheap; else unit test a small helper `shouldInvalidateCalendar(eventName)`.
- Modify: `docs/superpowers/specs/2026-09-22-calendar-design.md` — status line note Lát 1 plan path.
- Modify: this plan status → note verification command.

- [ ] **Step 1: Identify event names** already handled for tasks/meetings; add calendar key invalidation beside them (do not invent new WS payloads).

- [ ] **Step 2: Test + implement**

- [ ] **Step 3: Manual smoke** (human or agent with app up): `make start`, open `/…/calendar`, create a dated task elsewhere, refresh/see event, toggle Của tôi, click through to detail.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(calendar): invalidate calendar queries on task and meeting events

Keep the Month grid fresh without writing WebSocket payloads into stores.
EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement (Lát 1) | Task |
| --- | --- |
| Route + paths + reserved slug | 1 |
| Nav Calendar | 6 |
| Feed API from/to/mine | 3 |
| Normalize due/span + hide canceled | 2 |
| Client parseWithFallback | 4 |
| Month FullCalendar + tokens | 5 |
| Open detail | 6 |
| Realtime invalidate | 7 |
| Drag / create / panel / ICS / Week/Day | **Out — Lát 2–4** |

Placeholders: none intentional beyond issue key (process). Participant table name must be verified in Task 3 against live schema.

## After Lát 1

Write follow-on plans:

- `2026-09-22-calendar-slice-2-time-drag.md` — timeGrid + interaction + PATCH
- `…-slice-3-sidebar-create.md`
- `…-slice-4-ics-polish.md`

Update spec §8 checkboxes when each lands.
