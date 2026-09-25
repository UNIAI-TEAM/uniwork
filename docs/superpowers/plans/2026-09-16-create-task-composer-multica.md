# Create-task composer Multica parity — Implementation Plan

> **Trạng thái:** shipped — composer Multica parity (manual + agent chrome stub); E2E create-task-parity green.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UniWork labeled create-task form with a Multica-parity composer (manual + agent chrome), keeping draft/duplicate/quota/attachment behavior.

**Architecture:** One `CreateTaskDialog` shell owns `Dialog`/`DialogContent`, `mode`, and `isExpanded`. `CreateTaskManualPanel` and `CreateTaskAgentPanel` are swappable bodies. Pills use a ported `PillButton`. Manual submit keeps `useCreateTask` + `toastCreateTaskError`. Agent submit is UI-complete but gated/`capability_unavailable` (ADR 0010 / UNI-519 cutover).

**Tech Stack:** React, `@uniwork/ui` Dialog/Button/Switch, existing task pickers + `ContentEditor`, `ShortcutKeycaps`, vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-create-task-composer-multica-design.md`

## Global Constraints

- JSX text in `packages/views/` only via `t()`; add vi+en keys together.
- `.ts`/`.tsx` ≤ 500 lines (split panels; do not grow a god-file).
- No `next/*` in views; navigate via `useOptionalNavigation` / paths.
- Semantic tokens only (`bg-background`, `text-muted-foreground`, …).
- Agent mode must not write business tables if capability unavailable (ADR 0010).
- Do not run `make check` unless the user asks; use narrow vitest/Playwright.
- Do not `git commit` unless the user explicitly asks (plan steps may stage mentally; skip commit commands).

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/views/common/pill-button.tsx` | `PillButton`, `ClearablePillButton` |
| `packages/views/common/pill-button.test.tsx` | chrome + clear affordance |
| `packages/views/tasks/create-task-dialog.tsx` | shell: Dialog, mode, expanded, re-export props |
| `packages/views/tasks/create-task-manual-panel.tsx` | Multica ManualCreatePanel layout + submit |
| `packages/views/tasks/create-task-agent-panel.tsx` | Agent chrome + stub submit |
| `packages/views/tasks/create-task-dialog-classes.ts` | `manualDialogContentClass(isExpanded)` |
| `packages/views/tasks/new-task-dialog.tsx` | thin re-export of `CreateTaskDialog` as `NewTaskDialog` |
| `packages/views/tasks/new-task-dialog.test.tsx` | update for composer selectors |
| `packages/views/tasks/create-task-dialog.test.tsx` | mode switch + agent disabled |
| `packages/core/i18n/locales/{vi,en}.json` | composer copy keys |
| `e2e/create-task-parity.spec.ts` | placeholder/switch selectors |

**Baseline to read (do not import from `multica/`):**

- `multica/packages/views/common/pill-button.tsx`
- `multica/packages/views/modals/create-issue-dialog.tsx`
- `multica/packages/views/modals/create-issue.tsx` (ManualCreatePanel JSX ~883+)
- `multica/packages/views/modals/quick-create-issue.tsx` (AgentCreatePanel header/footer)

---

### Task 1: PillButton primitive

**Files:**
- Create: `packages/views/common/pill-button.tsx`
- Create: `packages/views/common/pill-button.test.tsx`

**Interfaces:**
- Produces: `PillButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>)`, `ClearablePillButton({ onClear, clearLabel, children, className?, disabled? })`

- [ ] **Step 1: Write failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClearablePillButton, PillButton } from "./pill-button";

describe("PillButton", () => {
  it("renders a button with the given label", () => {
    render(<PillButton>Trạng thái</PillButton>);
    expect(screen.getByRole("button", { name: "Trạng thái" })).toBeInTheDocument();
  });

  it("ClearablePillButton calls onClear without triggering the main click", () => {
    const onClear = vi.fn();
    const onClick = vi.fn();
    render(
      <ClearablePillButton onClear={onClear} clearLabel="Xóa dự án">
        <button type="button" onClick={onClick}>Dự án A</button>
      </ClearablePillButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xóa dự án" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
pnpm --filter @uniwork/views exec vitest run common/pill-button.test.tsx
```

- [ ] **Step 3: Implement** — port Multica `pill-button.tsx` chrome (`rounded-full`, `max-w-56`, `text-caption`) using `@uniwork/ui/lib/utils` `cn`. Map Multica `text-faint-foreground` → `text-muted-foreground` if UniWork lacks `faint`.

- [ ] **Step 4: Run test — expect PASS**

---

### Task 2: i18n keys for composer

**Files:**
- Modify: `packages/core/i18n/locales/vi.json` under `tasks.create`
- Modify: `packages/core/i18n/locales/en.json` under `tasks.create`

**Interfaces:**
- Produces keys used by later panels (exact paths):

```json
"create": {
  "manual_breadcrumb": "Tạo thủ công",
  "agent_breadcrumb": "Tạo với agent",
  "title_placeholder": "Tiêu đề issue",
  "description_placeholder": "Thêm mô tả…",
  "create_another_short": "Tạo tiếp",
  "switch_to_agent": "Chuyển sang agent",
  "switch_to_manual": "Chuyển sang thủ công",
  "agent_will_start": "{{name}} sẽ bắt đầu làm ngay sau khi tạo.",
  "agent_unavailable": "Tạo bằng agent chưa khả dụng trên workspace này.",
  "expand": "Mở rộng",
  "collapse": "Thu gọn",
  "more_fields": "Thêm trường",
  "sr_manual": "Tạo việc thủ công",
  "sr_agent": "Tạo việc với agent"
}
```

(en equivalents; keep existing `create_another` for backward compat or migrate callers to `create_another_short`.)

- [ ] **Step 1:** Add keys to both locale files (no test file required; Task 3+ will fail on missing keys via i18n).
- [ ] **Step 2:** Spot-check: `rg 'create_another_short|switch_to_agent' packages/core/i18n/locales/*.json`

---

### Task 3: Dialog shell + content class

**Files:**
- Create: `packages/views/tasks/create-task-dialog-classes.ts`
- Create: `packages/views/tasks/create-task-dialog.tsx`
- Create: `packages/views/tasks/create-task-dialog.test.tsx` (shell-only stubs)
- Modify: `packages/views/tasks/new-task-dialog.tsx` → re-export

**Interfaces:**
- Produces:

```ts
export type CreateTaskMode = "manual" | "agent";
export function manualDialogContentClass(isExpanded: boolean): string;
export function CreateTaskDialog(props: {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  initialMode?: CreateTaskMode;
}): JSX.Element;
export { CreateTaskDialog as NewTaskDialog };
```

- [ ] **Step 1: Failing shell test**

```tsx
it("switches body mode without unmounting the dialog role", () => {
  render(wrap(<CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Chuyển sang agent" }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByText(/sẽ bắt đầu làm ngay sau khi tạo/)).toBeInTheDocument();
});
```

(Stub panels initially if needed: shell can render placeholder strings matching i18n until Task 4–5 land — prefer implementing thin stub panels in the same PR slice.)

- [ ] **Step 2: Implement shell** mirroring Multica `CreateIssueDialogBody`:
  - `mode` state from `initialMode ?? "manual"`
  - `isExpanded` state; `DialogContent className={manualDialogContentClass(isExpanded)}` (agent may reuse or slightly different class)
  - `carry` state for `onSwitchMode`
  - Trigger: keep `DialogTrigger` + `tasks.new` when `showTrigger`
  - Body: `mode === "manual" ? <CreateTaskManualPanel … /> : <CreateTaskAgentPanel … />`

`manualDialogContentClass` — port Multica sizing (max-w, expanded wider, max-h, overflow, padding-0 so panels own chrome).

- [ ] **Step 3: `new-task-dialog.tsx` becomes:**

```ts
export { CreateTaskDialog as NewTaskDialog, type CreateTaskMode } from "./create-task-dialog";
```

- [ ] **Step 4: Run**

```bash
pnpm --filter @uniwork/views exec vitest run tasks/create-task-dialog.test.tsx
```

---

### Task 4: ManualCreatePanel composer

**Files:**
- Create: `packages/views/tasks/create-task-manual-panel.tsx`
- Modify: `packages/views/tasks/new-task-dialog.test.tsx` (selector updates)
- Keep: `create-task-error-toast.ts` wiring

**Interfaces:**
- Consumes: draft store, `useCreateTask`, pickers, `PillButton`, `ShortcutKeycaps`, `ContentEditor`
- Produces: `CreateTaskManualPanel({ workspaceId, defaults, carry, onClose, onSwitchMode, isExpanded, setIsExpanded })`

- [ ] **Step 1: Update one failing unit assertion first** — title via placeholder:

```tsx
fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Sửa lỗi" } });
```

Replace every `getByLabelText("Tiêu đề")` in `new-task-dialog.test.tsx`. Create-another:

```tsx
fireEvent.click(screen.getByRole("switch", { name: "Tạo tiếp" }));
```

- [ ] **Step 2: Implement manual panel layout** (structure, not full Multica 1400 lines):

```
[header: workspace › manual_breadcrumb] [expand] [close]
[title input autoFocus]
[ContentEditor description]
[flex wrap pills: status priority assignee labels project] [⋯ menu]
[footer: paperclip | switch_to_agent | Tạo tiếp switch | Tạo + ShortcutKeycaps]
```

- Overflow `⋯`: menu items for parent, stage, start_date, due_date, each custom property; selecting mounts inline pill + opens picker (same reveal pattern as Multica, simplified).
- Submit logic: **copy** from current `new-task-dialog.tsx` `submit` / `uploadFile` / draft versioning / toastCreateTaskError (behavior unchanged).
- ⌘/Ctrl+Enter: wire via existing `useComposerSubmit` or form `onKeyDown` on title + editor submit shortcut if already in ContentEditor; show `ShortcutKeycaps` decorative on CTA.
- Paperclip: hidden `<input type="file">` + icon button (not native “Chọn tệp” row).

- [ ] **Step 3: Run unit tests**

```bash
pnpm --filter @uniwork/views exec vitest run tasks/new-task-dialog.test.tsx tasks/create-task-dialog.test.tsx tasks/create-task-error-toast.test.ts
```

Expected: PASS (adjust mocks if dialog structure changed).

---

### Task 5: AgentCreatePanel stub

**Files:**
- Create: `packages/views/tasks/create-task-agent-panel.tsx`
- Modify: `packages/views/tasks/create-task-dialog.test.tsx`

**Interfaces:**
- Produces: `CreateTaskAgentPanel({ workspaceId, carry, onClose, onSwitchMode, isExpanded, setIsExpanded })`

- [ ] **Step 1: Test agent CTA unavailable**

```tsx
it("shows agent unavailable toast and does not POST /tasks when creating in agent mode", async () => {
  render(wrap(<CreateTaskDialog workspaceId="ws1" open showTrigger={false} initialMode="agent" onOpenChange={() => {}} />));
  fireEvent.click(screen.getByRole("button", { name: "Tạo", exact: true }));
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  expect(requestMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/tasks$/), expect.objectContaining({ method: "POST" }));
});
```

- [ ] **Step 2: Implement panel** — Multica visual: header, agent line (`agent_will_start` with fallback name “Agent”), prompt `ContentEditor`, project pill optional from carry, footer switch_to_manual + Tạo tiếp + Tạo.
- Submit: `toast.error(t("tasks.create.agent_unavailable"))` or `toastCreateTaskError`-compatible; **no** `useCreateTask` until a real agent-create API exists.
- Switch to manual: `onSwitchMode({ project_id })`.

- [ ] **Step 3: Run** `vitest run tasks/create-task-dialog.test.tsx` — PASS

---

### Task 6: E2E parity update

**Files:**
- Modify: `e2e/create-task-parity.spec.ts`

- [ ] **Step 1: Adjust selectors**

```ts
await dialog.getByPlaceholder("Tiêu đề issue").fill(titleA);
await dialog.getByRole("switch", { name: "Tạo tiếp" }).check(); // or .click() if switch
// description: getByRole("textbox", { name: … }) or placeholder "Thêm mô tả…"
```

Keep POST URL helper `isCreateTaskPost`, exact `Tạo việc` trigger, duplicate toast assertions.

- [ ] **Step 2: Run**

```bash
pnpm --filter @uniwork/e2e exec playwright test create-task-parity.spec.ts
```

Expected: 1 passed (app + server with CORS Idempotency-Key must be running).

---

### Task 7: Spec status + UniAI note

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-create-task-composer-multica-design.md` → `> **Trạng thái:** shipped`
- Modify: `docs/superpowers/plans/2026-09-16-create-task-composer-multica.md` → add/flip `> **Trạng thái:** shipped`

- [x] **Step 1:** Flip status line when E2E green.
- [x] **Step 2:** `[agent]` comment on UNI-648 (branch key); did not invent issues; did not claim UNI-426/F-05 done.

---

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| Pill chrome | 1 |
| i18n | 2 |
| Shell / expand / mode | 3 |
| Manual composer + submit + overflow | 4 |
| Agent chrome + stub submit | 5 |
| E2E | 6 |
| Status line | 7 |
| No Settings field visibility / source-context / children | intentionally omitted |
| Draft / duplicate / quota | 4 (reuse) |

## Placeholder scan

No TBD steps; agent submit behavior explicitly stubbed in Task 5.

---

## Execution

Plan saved to `docs/superpowers/plans/2026-09-16-create-task-composer-multica.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with checkpoints  

Which approach?
