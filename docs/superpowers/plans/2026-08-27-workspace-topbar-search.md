# Workspace TopBar + Global Search Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact workspace TopBar (collapse + search pill + create task / theme / language) and a command-palette foundation (Pages + Commands only) on every workspace screen.

**Architecture:** `DashboardLayout` mounts `WorkspaceTopBar` + `SearchCommand` inside `SidebarInset`. Palette open state lives in Zustand at `@uniwork/core/search`. TopBar owns controlled `NewTaskDialog` and theme/locale selects. `SidebarProvider hasExternalTrigger` hides duplicate `CollapsedNavTrigger` on page headers.

**Tech Stack:** React, Zustand, cmdk via `@uniwork/ui` Command/CommandDialog, next-themes, react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-workspace-topbar-search-design.md`

## Global Constraints

- No entity search API in v1 (no tasks/meetings/members results).
- Stores live in `packages/core/` — search open state is `packages/core/search/store.ts`.
- `packages/views/` must not import `next/*` or call `window.location.reload()`.
- Every JSX string in views goes through `t()`; vi/en locale parity required.
- No `multica` string in source (`scripts/no-usf-leak.test.mjs`).
- Semantic tokens only (`bg-background`, `border-border`, `text-muted-foreground`, …).
- Conventional commits; do not commit unless the user asks mid-execution (plan steps still show commit messages for when asked).

## File map

| Path | Responsibility |
|------|----------------|
| `packages/core/search/store.ts` | Zustand `open` / `setOpen` / `toggle` |
| `packages/core/search/store.test.ts` | Store unit tests |
| `packages/core/search/index.ts` | Public export |
| `packages/core/package.json` | Add `"./search"` export |
| `packages/views/search/search-command.tsx` | CommandDialog + Pages/Commands |
| `packages/views/search/search-command.test.tsx` | Palette behavior tests |
| `packages/views/search/search-trigger.tsx` | Search pill button |
| `packages/views/search/use-search-hotkey.ts` | ⌘K / Ctrl+K listener |
| `packages/views/search/index.ts` | Package exports |
| `packages/views/layout/workspace-top-bar.tsx` | Compact toolbar chrome |
| `packages/views/layout/workspace-top-bar.test.tsx` | TopBar tests |
| `packages/views/layout/dashboard-layout.tsx` | Mount TopBar + SearchCommand; `hasExternalTrigger` |
| `packages/views/tasks/new-task-dialog.tsx` | Support controlled open without built-in trigger |
| `packages/core/i18n/locales/vi.json` / `en.json` | `topbar.*` + `search.*` |
| `packages/views/package.json` | Add `"./search"` export |

---

### Task 1: Search store (`@uniwork/core/search`)

**Files:**
- Create: `packages/core/search/store.ts`
- Create: `packages/core/search/store.test.ts`
- Create: `packages/core/search/index.ts`
- Modify: `packages/core/package.json` (add `"./search": "./search/index.ts"`)

**Interfaces:**
- Produces: `useSearchStore` with `{ open: boolean; setOpen: (open: boolean) => void; toggle: () => void }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/search/store.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useSearchStore } from "./store";

describe("useSearchStore", () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false });
  });

  it("starts closed", () => {
    expect(useSearchStore.getState().open).toBe(false);
  });

  it("setOpen and toggle", () => {
    useSearchStore.getState().setOpen(true);
    expect(useSearchStore.getState().open).toBe(true);
    useSearchStore.getState().toggle();
    expect(useSearchStore.getState().open).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniwork/core test -- search/store`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement store + export**

```ts
// packages/core/search/store.ts
"use client";

import { create } from "zustand";

interface SearchStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
```

```ts
// packages/core/search/index.ts
export { useSearchStore } from "./store";
```

Add to `packages/core/package.json` exports:
`"./search": "./search/index.ts"`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniwork/core test -- search/store`

Expected: PASS

- [ ] **Step 5: Commit** (when user asks)

```bash
git add packages/core/search packages/core/package.json
git commit -m "feat(core): add search palette open store"
```

---

### Task 2: i18n keys (vi/en)

**Files:**
- Modify: `packages/core/i18n/locales/vi.json`
- Modify: `packages/core/i18n/locales/en.json`

**Interfaces:**
- Produces: nested keys under `topbar` and `search` (default namespace)

- [ ] **Step 1: Add keys to both locales (same shape)**

```json
"topbar": {
  "search": "Tìm kiếm…",
  "createTask": "Tạo việc",
  "theme": "Giao diện",
  "language": "Ngôn ngữ",
  "collapseSidebar": "Thu gọn thanh bên",
  "shortcutHint": "⌘K"
},
"search": {
  "title": "Tìm kiếm",
  "description": "Điều hướng trang và chạy lệnh",
  "placeholder": "Gõ trang hoặc lệnh…",
  "groups": {
    "pages": "Trang",
    "commands": "Lệnh"
  },
  "empty": "Không có kết quả.",
  "commands": {
    "createTask": "Tạo việc",
    "themeLight": "Giao diện sáng",
    "themeDark": "Giao diện tối",
    "themeSystem": "Giao diện theo hệ thống",
    "languageVi": "Ngôn ngữ: Tiếng Việt",
    "languageEn": "Ngôn ngữ: English"
  },
  "pages": {
    "tasks": "Công việc",
    "meetings": "Cuộc họp",
    "settings": "Cài đặt"
  }
}
```

English mirror (`Search…`, `New task`, `Pages`, `Commands`, …). For `topbar.shortcutHint` on Windows tests may still show ⌘K in UI copy or use a platform-agnostic `Ctrl+K` — implement as: display `⌘K` when `navigator.platform` includes Mac, else `Ctrl+K` in the trigger component (do not hardcode only Mac in i18n if both needed — use two keys `shortcutMac` / `shortcutOther` or compute in component without literal-string lint issues via `t("topbar.shortcutMac")` / `t("topbar.shortcutOther")`).

- [ ] **Step 2: Run parity test**

Run: `pnpm --filter @uniwork/core test -- parity`

Expected: PASS

- [ ] **Step 3: Commit** (when user asks)

```bash
git add packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(i18n): add topbar and search palette strings"
```

---

### Task 3: Controlled `NewTaskDialog`

**Files:**
- Modify: `packages/views/tasks/new-task-dialog.tsx`
- Modify: `packages/views/tasks/new-task-dialog.test.tsx` (create if missing; else extend)

**Interfaces:**
- Consumes: `useCreateTask(workspaceId)`
- Produces: `NewTaskDialog({ workspaceId, open?, onOpenChange?, showTrigger? })` — default `showTrigger=true` keeps Tasks page behavior

- [ ] **Step 1: Write failing test for controlled open without trigger**

```tsx
it("opens when controlled open=true without rendering a trigger button", () => {
  render(wrap(<NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /việc mới|new task/i })).toBeNull();
});
```

(Use `wrap` from `packages/views/test/api-mock.tsx`; seed i18n via `initI18n()`.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @uniwork/views test -- new-task-dialog`

- [ ] **Step 3: Implement**

```tsx
export function NewTaskDialog({
  workspaceId,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  workspaceId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  // ... existing form ...
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger render={<Button size="sm">{t("tasks.new")}</Button>} />
      ) : null}
      <DialogContent>...</DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit** (when user asks)

```bash
git commit -m "feat(views): allow controlled NewTaskDialog without trigger"
```

---

### Task 4: SearchCommand + hotkey + SearchTrigger

**Files:**
- Create: `packages/views/search/search-command.tsx`
- Create: `packages/views/search/search-command.test.tsx`
- Create: `packages/views/search/search-trigger.tsx`
- Create: `packages/views/search/use-search-hotkey.ts`
- Create: `packages/views/search/index.ts`
- Modify: `packages/views/package.json` (`"./search": "./search/index.ts"`)

**Interfaces:**
- Consumes: `useSearchStore`, `useWorkspace`, `useNavigation`, `useTheme`, `useLocaleAdapter`, `paths`
- Produces: `<SearchCommand onCreateTask={() => void} />`, `<SearchTrigger />`, `useSearchHotkey()`

- [ ] **Step 1: Failing test — opens from store and lists pages**

```tsx
initI18n();
useSearchStore.setState({ open: true });
render(
  wrapWithNav(
    <WorkspaceProvider workspace={fakeWs} user={fakeUser}>
      <SearchCommand onCreateTask={() => {}} />
    </WorkspaceProvider>,
  ),
);
expect(screen.getByPlaceholderText(/gõ trang|type a page/i)).toBeInTheDocument();
expect(screen.getByText(/công việc|tasks/i)).toBeInTheDocument();
```

(Provide minimal `fakeWs` / `fakeUser` matching workspace-context types; follow `members-view` / sidebar test patterns.)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `SearchCommand`**

Use `@uniwork/ui` `CommandDialog`, `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`.

```tsx
// sketch
export function SearchCommand({ onCreateTask }: { onCreateTask: () => void }) {
  const { open, setOpen } = useSearchStore();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const { setTheme } = useTheme();
  const localeAdapter = useLocaleAdapter();
  const { t, i18n } = useTranslation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("search.title")}
      description={t("search.description")}
    >
      <Command>
        <CommandInput placeholder={t("search.placeholder")} />
        <CommandList>
          <CommandEmpty>{t("search.empty")}</CommandEmpty>
          <CommandGroup heading={t("search.groups.pages")}>
            <CommandItem onSelect={() => run(() => push(ws.tasks()))}>{t("search.pages.tasks")}</CommandItem>
            <CommandItem onSelect={() => run(() => push(ws.meetings()))}>{t("search.pages.meetings")}</CommandItem>
            <CommandItem onSelect={() => run(() => push(ws.settings()))}>{t("search.pages.settings")}</CommandItem>
          </CommandGroup>
          <CommandGroup heading={t("search.groups.commands")}>
            <CommandItem onSelect={() => run(onCreateTask)}>{t("search.commands.createTask")}</CommandItem>
            {/* theme light/dark/system + language vi/en — call setTheme / persist+changeLanguage */}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
```

- [ ] **Step 4: Implement `SearchTrigger` + `useSearchHotkey`**

```tsx
// search-trigger.tsx — button styled as compact pill
export function SearchTrigger() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="…"
      onClick={() => useSearchStore.getState().setOpen(true)}
    >
      <Search className="size-4" />
      <span>{t("topbar.search")}</span>
      <kbd>…</kbd>
    </button>
  );
}
```

```ts
// use-search-hotkey.ts
export function useSearchHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        if (!useSearchStore.getState().open) return;
      }
      e.preventDefault();
      useSearchStore.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

Call `useSearchHotkey()` inside `SearchCommand` (or TopBar once).

- [ ] **Step 5: Tests PASS + export package**

- [ ] **Step 6: Commit** (when user asks)

```bash
git commit -m "feat(views): add command palette foundation"
```

---

### Task 5: WorkspaceTopBar

**Files:**
- Create: `packages/views/layout/workspace-top-bar.tsx`
- Create: `packages/views/layout/workspace-top-bar.test.tsx`

**Interfaces:**
- Consumes: `SearchTrigger`, `NewTaskDialog`, `useTheme`, `useLocaleAdapter`, `useWorkspace`, `SidebarTrigger`
- Produces: `<WorkspaceTopBar />`

- [ ] **Step 1: Failing test**

```tsx
it("renders search, create task, theme and language controls", () => {
  render(wrapWithNav(/* providers */ <WorkspaceTopBar />));
  expect(screen.getByRole("button", { name: /tìm kiếm|search/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /tạo việc|new task/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/giao diện|theme/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ngôn ngữ|language/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /thu gọn|collapse|toggle sidebar/i })).toBeInTheDocument();
});
```

Wrap with `SidebarProvider` (required for `SidebarTrigger`).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement compact toolbar**

```tsx
export function WorkspaceTopBar() {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const localeAdapter = useLocaleAdapter();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b border-border", PAGE_GUTTER)}>
      <SidebarTrigger aria-label={t("topbar.collapseSidebar")} />
      <SearchTrigger />
      <div className="flex-1" />
      <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
        {t("topbar.createTask")}
      </Button>
      {/* Select theme + Select language — mirror preferences-tab patterns with icons */}
      <NewTaskDialog
        workspaceId={workspace.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
        showTrigger={false}
      />
    </header>
  );
}
```

Theme/language handlers: same as Preferences (persist + `changeLanguage`, no reload).

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** (when user asks)

```bash
git commit -m "feat(views): add workspace top bar chrome"
```

---

### Task 6: Mount in DashboardLayout + external sidebar trigger

**Files:**
- Modify: `packages/views/layout/dashboard-layout.tsx`
- Modify: `packages/views/layout/page-header.test.tsx` if behavior of `CollapsedNavTrigger` changes under `hasExternalTrigger`

**Interfaces:**
- Consumes: `WorkspaceTopBar`, `SearchCommand`

- [ ] **Step 1: Wire layout**

```tsx
<SidebarProvider className="h-svh bg-app-shell" hasExternalTrigger>
  …
  <SidebarInset …>
    <NavigationProgress />
    <WorkspaceTopBar />
    {children}
    <SearchCommand onCreateTask={() => {/* lift createOpen via small store or callback */}} />
    {extra}
  </SidebarInset>
</SidebarProvider>
```

**Create-task from palette:** either
- lift `createOpen` state to a tiny `useCreateTaskDialogStore` in `packages/core` / local module next to TopBar, shared by TopBar + SearchCommand, **or**
- put both TopBar and SearchCommand inside a small `WorkspaceChrome` client component that owns `createOpen`.

Prefer **`WorkspaceChrome`** wrapper in `packages/views/layout/workspace-chrome.tsx` to avoid another store:

```tsx
export function WorkspaceChrome({ children }: { children: ReactNode }) {
  const [createOpen, setCreateOpen] = useState(false);
  useSearchHotkey();
  return (
    <>
      <WorkspaceTopBar createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
      <SearchCommand onCreateTask={() => setCreateOpen(true)} />
      {children}
    </>
  );
}
```

Adjust TopBar props accordingly. Mount `<WorkspaceChrome>{children}</WorkspaceChrome>` in `DashboardLayout`.

- [ ] **Step 2: Confirm `CollapsedNavTrigger` returns null when `hasExternalTrigger`**

Existing: `if (!sidebar || sidebar.hasExternalTrigger) return null;` — with `hasExternalTrigger` on provider, page headers no longer show a second trigger. Add/adjust a test if none covers this path.

- [ ] **Step 3: Run views tests + typecheck**

```bash
pnpm --filter @uniwork/views test
pnpm --filter @uniwork/core test -- search
pnpm --filter @uniwork/views typecheck
pnpm --filter @uniwork/web typecheck
pnpm lint
```

Expected: PASS

- [ ] **Step 4: Manual smoke** — open workspace, collapse sidebar, ⌘K, create task, theme, language

- [ ] **Step 5: Update spec status** to `Đã duyệt` in the design doc header if still “Chờ duyệt”

- [ ] **Step 6: Commit** (when user asks)

```bash
git commit -m "feat(views): mount workspace chrome with top bar and palette"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| WorkspaceTopBar layout C | Task 5 |
| Collapse SidebarTrigger | Task 5–6 |
| Search pill + ⌘K | Task 4–6 |
| Pages + Commands only | Task 4 |
| Create task / theme / language | Task 3–5 |
| Store in core | Task 1 |
| No entity API search | (none added — YAGNI) |
| hasExternalTrigger / no dual trigger | Task 6 |
| i18n vi/en | Task 2 |

No TBD placeholders. `NewTaskDialog` controlled API defined before TopBar consumes it.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-27-workspace-topbar-search.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with checkpoints  

Which approach?
