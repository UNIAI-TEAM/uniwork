# Task human-parity lát D1 — bàn phím và tiện nghi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** shipped — lát D1 của spec ô Task human-parity (2026-09-14). `make check` không chạy trọn: nó dừng ở `pnpm test`, tại hai test views là flake đã ghi (`project-detail-page`, `markdown-paste`; chạy riêng mỗi file 3/3 xanh), nên không tới Go test. Các bước còn lại được chạy tay theo đúng lệnh trong `scripts/check.sh`: coverage từng package, node contract tests (52/53, chỉ đỏ lỗi governance nền do commit `e88a055`), migrate, và Go `-race` chia bốn lần chạy cho vừa giới hạn thời gian: shard `rest` kèm gofmt, vet, staticcheck; shard `handler`; hai nửa theo tên test của `internal/service`. Cổng chạy lúc 02:00 giờ +07, nên bốn test Go so ngày "hôm qua" theo giờ máy với ngày UTC đã đỏ; chạy riêng với `TZ=UTC` thì cả bốn xanh. Gộp profile của bốn lần chia với hai lần `TZ=UTC` được 59.0%, đúng sàn. Hai test Go còn đỏ là lỗi nền đã biết (`TestChatFollowUpHTTP`, `TestChatThreadFollowMarkReadAndList`). E2E `e2e/ask-uni.spec.ts` đỏ trước khi tới ⌘J, vì lý do có từ trước D1; ⌘J mở hộp Hỏi UNI được kiểm trên Chromium thật bằng một bản chẩn đoán của spec đó. Chi tiết nằm ở spec §7quinquies.

**Goal:** Người dùng làm việc với task bằng bàn phím mà không bao giờ bị phím tắt bắn nhầm khi đang gõ, tìm được chữ trong trang chi tiết task, quay lại task vừa xem, và không phải gấp mở lại những gì đã gấp.

**Architecture:** Một bộ điều phối phím tắt toàn cục duy nhất trong shell workspace thay cho các listener rời, đọc chord từ shortcut store có sẵn và chặn phím khi đích là ô soạn thảo hoặc lớp popup. Các tiện nghi còn lại là store Zustand bền trong `packages/core/` (qua `StorageAdapter`) cộng bề mặt nhỏ trong `packages/views/`. Không đổi server.

**Tech Stack:** TypeScript strict, React 19, Zustand `persist`, TanStack Query, primitive shadcn/Base UI, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md` (mục 3.1 lát D). Dữ kiện tiền kiểm: `.superpowers/sdd/2026-09-13-tasks-human-parity-slice-c/slice-d-research.md`.

## Phát hiện đổi hình dạng lát này

Spec viết lát D như một khối. Tiền kiểm tách nó làm hai phần không chung file:

- **D1 (plan này):** phím tắt, tìm trong trang, xem gần đây, ghi nhớ gấp mở.
- **D2 (plan riêng `2026-09-13-tasks-human-parity-slice-d2.md`):** "cuộn vô hạn cho list và board". Tiền kiểm cho thấy đó không phải tiện nghi mà là lỗi: list, board và My Tasks cắt câm ở 50 task vì không gửi `limit` và server mặc định 50 (`server/internal/service/task_query.go:12-13`). Nó mang ràng buộc cache lạc quan riêng, nên có plan riêng.

Bốn điều spec giả định, tiền kiểm đã sửa:

1. **Không phải "xây phần thi hành `allowInEditable`".** Hàm kiểm đích đã có: `isEditableShortcutTarget` ở `packages/core/shortcuts/definitions.ts:208`, export qua `index.ts:10`. Thứ thiếu là **không ai gọi nó**. `useSearchHotkey` và `useAskUniHotkey` mỗi cái tự nghe `window` keydown.
2. **Không được chồng thêm listener.** ⌘K có listener cứng phím ở `packages/views/search/use-search-hotkey.ts`; ⌘J ở `packages/views/ai/use-ask-uni-hotkey.ts`. Bộ điều phối phải **thay** hai hook này, nếu không một phím chạy hai lần.
3. **Khai báo `send` đổi hành vi thật.** Hôm nay `getShortcut("send")` trả `null` (`store.ts:153-159`) nên phím gửi của editor không bao giờ chạy (`editor/extensions/submit-shortcut.ts:18-23,70`): composer bình luận chỉ gửi được bằng nút. Khai báo `send` mặc định ⌘Enter là bật tính năng đó, và phải test composer lẫn title editor.
4. **Tìm trong trang đơn giản hơn multica nhưng có một bẫy.** Timeline của UniWork không ảo hoá, nên không cần render phẳng. Nhưng lát B gấp luồng đã giải quyết thành một dòng (`timeline.tsx:77`, `expandedResolved`), nên chữ trong luồng gấp không nằm trong DOM. Tìm phải mở luồng chứa kết quả.

## Khuôn có sẵn để port

Repo thượng nguồn nằm ở `/Users/ducquang/UNICOM/multica/`. Đọc, chép có chọn lọc, đổi `@multica/*` thành `@uniwork/*`, và đổi `issue` thành `task`. `scripts/no-usf-leak.test.mjs` và `scripts/tasks-collection-brand-scan.test.mjs` sẽ đỏ nếu tên thương hiệu cũ lọt vào.

| Thượng nguồn | Dùng cho |
| --- | --- |
| `multica/packages/views/layout/global-shortcuts.tsx` (145 dòng) | Task 2 |
| `multica/packages/core/shortcuts/definitions.ts:273-286` (`PORTAL_LAYER_SELECTOR`, `isPortalLayerShortcutTarget`) | Task 1 |
| `multica/packages/views/settings/components/keyboard-shortcuts-tab.tsx` (366 dòng) và test | Task 4 |
| `multica/packages/views/issues/hooks/use-in-page-find.ts` (329 dòng) và test | Task 5 |
| `multica/packages/core/chat/recent-context-store.ts` (114 dòng) | Task 6 |

## Global Constraints

- Không đụng `server/`. Lát D1 không có thay đổi backend.
- `packages/core/` không `localStorage`/`sessionStorage`, không `react-dom`, không `process.env`. Store bền dùng `defaultStorage` từ `packages/core/platform/storage` như `packages/core/shortcuts/store.ts:4`.
- Zustand selector trả tham chiếu ổn định (`useShallow` cho object).
- Mỗi file `.ts`/`.tsx` tối đa 500 dòng theo `max-lines`, không đếm dòng trống và comment.
- Mọi JSX text node trong `packages/views/` đi qua `t()`. Khoá i18n mới có ở **cả** `packages/core/i18n/locales/vi.json` và `en.json`, cùng đường. Khoá có đếm dùng `_one` / `_other`.
- Bốn hợp đồng khả năng tiếp cận của primitive: `aria-disabled` giữ nút trong thứ tự tab và chặn bằng JS; vùng chạm ≥ 44px trên con trỏ thô; không `outline-none` đè viền `:focus-visible`; `StepperTitle` là `span`.
- Không export, file hay dependency thừa: `pnpm knip`.
- Sàn coverage chỉ đi lên, và chỉ nâng ở package lát này kiếm được. Sàn hiện tại: views 61/53/54/63, core 58/53/47/60, ui 5/7/5/5. Core functions và lines đã dưới sàn từ trước lát A; không hạ, không nhận là của lát.
- Tiền tố commit: `feat(scope)`, `fix(scope)`, `refactor(scope)`, `test(scope)`, `docs`, `chore(scope)`. Hook tự gắn `Refs:`. Không push, không PR, không `make issue-pr`.
- **Chạy lệnh (bài học lát C):**
  - Gọi vitest trực tiếp: `cd packages/<pkg> && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run <files>`. `pnpm --filter … test -- --cờ` KHÔNG truyền cờ.
  - Coverage toàn phần views chạy một mình với `--maxWorkers=2`; song song mặc định từng OOM (exit 137).
  - Chạy ở tiền cảnh với timeout Bash rõ ràng. Tiến trình nền của subagent chết khi subagent kết thúc lượt.
- **Lỗi nền đã biết, KHÔNG phải của bạn:**
  - "Group _r_2_ not found" ở `packages/views/layout/animated-right-sidebar.tsx:83`.
  - `editor/extensions/markdown-paste.test.ts` timeout dưới coverage.
  - `projects/project-detail-page.test.tsx` đỏ dưới tải.
  - `scripts/governance.test.mjs` đỏ vì commit `e88a055`.
  - Go: `TestChatFollowUpHTTP`, `TestChatThreadFollowMarkReadAndList`, `TestAIEndpoints`, `TestAskCitesOnlyPermittedSources`, `TestSearchScoringOverdueAndMembers`, `TestTaskCRUD` (song song).

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `packages/core/shortcuts/definitions.ts` (sửa) | Danh sách action của UniWork; `isPortalLayerShortcutTarget`; `shouldIgnoreGlobalShortcutEvent` |
| `packages/views/layout/global-shortcuts.tsx` (mới) | Một listener `document` keydown cho mọi action toàn cục |
| `packages/views/layout/workspace-top-bar.tsx` (sửa) | Mount `GlobalShortcuts` trong `WorkspaceChrome` |
| `packages/views/search/use-search-hotkey.ts` (xoá) | Thay bằng action `openSearch` |
| `packages/views/ai/use-ask-uni-hotkey.ts` (xoá) | Thay bằng action `ai.askUni` |
| `packages/views/navigation/types.ts`, `apps/web/platform/navigation.tsx` (sửa) | `forward?` tuỳ chọn |
| `packages/views/settings/components/keyboard-shortcuts-tab.tsx` (mới) | Đổi phím, trùng phím, đặt lại |
| `packages/views/tasks/detail/find/use-task-find.ts` (mới) | Tìm chữ, điều hướng kết quả, tô sáng |
| `packages/views/tasks/detail/find/task-find-bar.tsx` (mới) | Thanh tìm |
| `packages/core/tasks/stores/recent-tasks-store.ts` (mới) | Task xem gần đây theo workspace |
| `packages/core/tasks/stores/task-detail-ui-store.ts` (mới) | Luồng đã giải quyết đang mở, sub-task gấp |

---

## Task 1: Danh sách action và hai hàm chặn trong core

**Files:**
- Modify: `packages/core/shortcuts/definitions.ts`
- Modify: `packages/core/shortcuts/index.ts`
- Test: `packages/core/shortcuts/definitions.test.ts` (sửa file có sẵn nếu có, tạo nếu chưa)

**Interfaces:**
- Produces:
  - `SHORTCUT_ACTIONS` gồm các id: `ai.askUni`, `openSearch`, `createTask`, `findInTask`, `openThreadNav`, `send`, `goBack`, `goForward`, `goInbox`, `goTasks`, `goMyTasks`, `goProjects`, `goMeetings`, `goChat`, `goPeople`, `goSettings`.
  - `isPortalLayerShortcutTarget(target: EventTarget | null): boolean`
  - `shouldIgnoreGlobalShortcutEvent(event: KeyboardEvent): boolean`

- [ ] **Step 1: Đọc trước khi sửa**

Đọc `packages/core/shortcuts/definitions.ts` toàn bộ, `packages/core/shortcuts/store.ts:1-60` và `:150-182`. Xác nhận `sanitizeShortcutOverrides` bỏ override của id không có trong `SHORTCUT_ACTIONS`: thêm action là điều kiện để người dùng đặt được phím cho nó.

Đọc `packages/ui/components/ui/sidebar.tsx` quanh dòng 383 (`useShortcutModifier`). Nếu primitive sidebar đã tự nghe một phím tắt để bật tắt sidebar, **không** khai báo `toggleSidebar`. Nếu không, vẫn không khai báo trong lát này và ghi lý do vào báo cáo: phím bật tắt sidebar là thay đổi primitive dùng chung.

- [ ] **Step 2: Viết test thất bại**

```ts
import { describe, expect, it } from "vitest";
import {
  SHORTCUT_ACTION_BY_ID,
  createShortcutChord,
  isPortalLayerShortcutTarget,
  isShortcutAllowedForAction,
  shouldIgnoreGlobalShortcutEvent,
} from "./definitions";

describe("UniWork shortcut actions", () => {
  it("declares send as primary+Enter, allowed in editors", () => {
    const send = SHORTCUT_ACTION_BY_ID.send;
    expect(send?.defaultShortcut).toEqual(createShortcutChord("Enter", { primary: true }));
    expect(send?.allowInEditable).toBe(true);
  });

  it("creates a task with plain C, never inside an editor", () => {
    const create = SHORTCUT_ACTION_BY_ID.createTask;
    expect(create?.defaultShortcut).toEqual(createShortcutChord("C"));
    expect(create?.allowInEditable).toBe(false);
  });

  it("opens search with primary+K from anywhere", () => {
    expect(SHORTCUT_ACTION_BY_ID.openSearch?.defaultShortcut).toEqual(
      createShortcutChord("K", { primary: true }),
    );
    expect(SHORTCUT_ACTION_BY_ID.openSearch?.allowInEditable).toBe(true);
  });

  it("declares thread navigation as bindable but unbound by default", () => {
    expect(SHORTCUT_ACTION_BY_ID.openThreadNav).toBeDefined();
    expect(SHORTCUT_ACTION_BY_ID.openThreadNav?.defaultShortcut).toBeNull();
    expect(SHORTCUT_ACTION_BY_ID.openThreadNav?.allowInEditable).toBe(false);
  });

  it("leaves navigation actions unbound by default", () => {
    for (const id of ["goInbox", "goTasks", "goMyTasks", "goProjects", "goMeetings", "goChat", "goPeople", "goSettings"]) {
      expect(SHORTCUT_ACTION_BY_ID[id]?.defaultShortcut).toBeNull();
    }
  });

  it("refuses a plain letter for an action allowed in editors", () => {
    expect(isShortcutAllowedForAction("findInTask", createShortcutChord("F"), "macos", "web")).toBe(false);
  });
});

describe("isPortalLayerShortcutTarget", () => {
  it("is true inside an open menu", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    menu.append(item);
    document.body.append(menu);
    expect(isPortalLayerShortcutTarget(item)).toBe(true);
    menu.remove();
  });

  it("is true while any Base UI inert layer is present", () => {
    const inert = document.createElement("div");
    inert.setAttribute("data-base-ui-inert", "");
    document.body.append(inert);
    expect(isPortalLayerShortcutTarget(document.body)).toBe(true);
    inert.remove();
  });

  it("is false for a plain page element", () => {
    const div = document.createElement("div");
    document.body.append(div);
    expect(isPortalLayerShortcutTarget(div)).toBe(false);
    div.remove();
  });
});

describe("shouldIgnoreGlobalShortcutEvent", () => {
  it("ignores repeats and already handled events", () => {
    expect(shouldIgnoreGlobalShortcutEvent(new KeyboardEvent("keydown", { key: "c", repeat: true }))).toBe(true);
    const handled = new KeyboardEvent("keydown", { key: "c", cancelable: true });
    handled.preventDefault();
    expect(shouldIgnoreGlobalShortcutEvent(handled)).toBe(true);
    expect(shouldIgnoreGlobalShortcutEvent(new KeyboardEvent("keydown", { key: "c" }))).toBe(false);
  });
});
```

- [ ] **Step 3: Chạy đỏ**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run shortcuts/definitions.test.ts
```

Kỳ vọng: đỏ vì `send`, `createTask`, `openSearch` chưa khai báo và hai hàm chưa tồn tại.

- [ ] **Step 4: Viết mã**

Thay `SHORTCUT_ACTIONS` bằng:

```ts
export const SHORTCUT_ACTIONS: readonly ShortcutActionDefinition[] = [
  { id: "ai.askUni", category: "general", defaultShortcut: primary("J"), allowInEditable: true },
  { id: "openSearch", category: "general", defaultShortcut: primary("K"), allowInEditable: true },
  { id: "createTask", category: "general", defaultShortcut: createShortcutChord("C"), allowInEditable: false },
  { id: "findInTask", category: "general", defaultShortcut: primary("F"), allowInEditable: true },
  // Deliberately unbound: no chord was verified free of browser/OS reservations
  // on every platform. Users bind it in Settings (Task 4).
  { id: "openThreadNav", category: "general", defaultShortcut: null, allowInEditable: false },
  { id: "send", category: "general", defaultShortcut: createShortcutChord("Enter", { primary: true }), allowInEditable: true },
  { id: "goBack", category: "navigation", defaultShortcut: primary("["), allowInEditable: false },
  { id: "goForward", category: "navigation", defaultShortcut: primary("]"), allowInEditable: false },
  { id: "goInbox", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goTasks", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goMyTasks", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goProjects", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goMeetings", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goChat", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goPeople", category: "navigation", defaultShortcut: null, allowInEditable: false },
  { id: "goSettings", category: "navigation", defaultShortcut: null, allowInEditable: false },
];
```

Thêm, ngay sau `isEditableShortcutTarget`:

```ts
const PORTAL_LAYER_SELECTOR =
  '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]';

/**
 * Whether an open popup (menu, dialog, listbox) owns the keyboard. Popups are
 * portaled to the body, so page-level listeners still see their keypresses;
 * the `data-base-ui-inert` marker catches modal layers even when focus never
 * left the page.
 */
export function isPortalLayerShortcutTarget(target: EventTarget | null): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector("[data-base-ui-inert]") !== null) return true;
  return target instanceof Element && target.closest(PORTAL_LAYER_SELECTOR) !== null;
}

/** A focused control already handled it, the key is auto-repeating, or an IME is composing. */
export function shouldIgnoreGlobalShortcutEvent(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.repeat || event.isComposing;
}
```

Export cả hai qua `packages/core/shortcuts/index.ts`. Nếu `packages/core/utils` có `isImeComposing` (dùng ở `editor/extensions/submit-shortcut.ts:9`) và core được import nó mà không vòng, dùng nó thay `event.isComposing` và nói trong báo cáo.

Kiểm `PRIMARY_RESERVED_KEYS` ở `definitions.ts`: `[` và `]` không nằm trong đó. `F` với primary cũng không. Nếu `isShortcutAllowedForAction` từ chối chord mặc định nào ở trên trên macOS hoặc web, đó là mâu thuẫn: báo, đừng nới luật.

- [ ] **Step 5: Chạy xanh, và chạy test store có sẵn**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run shortcuts/
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/shortcuts
git commit -m "feat(shortcuts): khai báo action phím tắt của UniWork và hai hàm chặn toàn cục"
```

---

## Task 2: Một bộ điều phối toàn cục thay hai listener rời

**Files:**
- Create: `packages/views/layout/global-shortcuts.tsx`
- Create: `packages/views/layout/global-shortcuts.test.tsx`
- Modify: `packages/views/layout/workspace-top-bar.tsx` (mount trong `WorkspaceChrome`, dòng 47-56)
- Modify: `packages/views/search/search-command.tsx:22,31` (bỏ `useSearchHotkey`)
- Modify: `packages/views/ai/ask-uni-panel.tsx:33,90` (bỏ `useAskUniHotkey`)
- Delete: `packages/views/search/use-search-hotkey.ts`, `packages/views/ai/use-ask-uni-hotkey.ts`, và test của chúng nếu có
- Modify: `packages/views/navigation/types.ts`, `apps/web/platform/navigation.tsx`

**Interfaces:**
- Consumes: Task 1 (`SHORTCUT_ACTION_BY_ID`, `isEditableShortcutTarget`, `isPortalLayerShortcutTarget`, `shouldIgnoreGlobalShortcutEvent`, `getShortcut`, `shortcutMatchesEvent`, `useShortcutStore`).
- Produces: `export function GlobalShortcuts(props: { onCreateTask: () => void }): null`; `NavigationAdapter.forward?: () => void`.

- [ ] **Step 1: Đọc**

- `multica/packages/views/layout/global-shortcuts.tsx` toàn bộ.
- `packages/views/layout/workspace-top-bar.tsx:47-60`: `WorkspaceChrome` giữ `createOpen` và đã mount `SearchCommand`, `AskUniPanel`.
- `packages/core/search/store.ts` và `packages/core/ai/store.ts`: cả hai có `toggle`.
- `packages/core/paths/paths.ts` quanh dòng 41-53: builder cho inbox, tasks, myTasks, projects, meetings, chat, people, settings.
- `packages/views/navigation/types.ts` và `apps/web/platform/navigation.tsx`.

`useAskUniHotkey(enabled)` nhận cờ `enabled`. Đọc `ask-uni-panel.tsx` để biết cờ đó là gì (quyền, feature flag). Bộ điều phối phải giữ đúng điều kiện đó cho `ai.askUni`, nếu không ⌘J mở panel cho người không được dùng Ask UNI.

- [ ] **Step 2: Viết test thất bại**

`global-shortcuts.test.tsx` render `GlobalShortcuts` trong `wrapWithNav` (`packages/views/test/api-mock.tsx`) và phát `keydown` lên `document` hoặc lên phần tử đích. Tối thiểu các ca sau, mỗi ca một `it`:

1. Phím C trên `document.body` gọi `onCreateTask` một lần.
2. Phím C khi đích là `<textarea>`, là `<input>`, và là phần tử `contenteditable="true"` không gọi `onCreateTask`.
3. Phím C khi đích nằm trong phần tử `role="menu"` không gọi `onCreateTask`.
4. ⌘K (macOS: `metaKey`; đặt nền tảng bằng cách mock `getShortcutPlatform` hoặc đọc cách `packages/core/shortcuts/platform.ts` phát hiện) trong `<input>` gọi `useSearchStore.getState().toggle` đúng một lần, và **chỉ một lần** khi `SearchCommand` cũng đang mount. Đây là ca bắt listener chồng.
5. Sự kiện đã `preventDefault()` trước khi tới `document` không kích hoạt gì.
6. `useShortcutStore.getState().setShortcut("createTask", createShortcutChord("N"))` rồi phím N gọi `onCreateTask`, phím C thì không. Chứng minh override có hiệu lực không cần reload.
7. ⌘[ gọi `navigation.back`; ⌘] gọi `navigation.forward` khi adapter có, và không ném lỗi khi adapter không có `forward`.
8. Một action `go*` được gán phím qua store thì `navigation.push` với đúng đường từ `paths.workspace(org, ws)`.

- [ ] **Step 3: Chạy đỏ**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run layout/global-shortcuts.test.tsx
```

- [ ] **Step 4: Viết mã**

Cấu trúc bắt buộc, theo khuôn multica:

```tsx
"use client";

import { useEffect } from "react";
import {
  SHORTCUT_ACTION_BY_ID,
  getShortcut,
  isEditableShortcutTarget,
  isPortalLayerShortcutTarget,
  shortcutMatchesEvent,
  shouldIgnoreGlobalShortcutEvent,
  useShortcutStore,
  type ShortcutActionId,
} from "@uniwork/core/shortcuts";
import { useSearchStore } from "@uniwork/core/search";
import { useAiPanelStore } from "@uniwork/core/ai";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";

const GLOBAL_ACTIONS: readonly ShortcutActionId[] = [
  "openSearch", "ai.askUni", "createTask", "goBack", "goForward",
  "goInbox", "goTasks", "goMyTasks", "goProjects", "goMeetings", "goChat", "goPeople", "goSettings",
];

export function GlobalShortcuts({ onCreateTask }: { onCreateTask: () => void }) {
  const navigation = useNavigation();
  const { workspace } = useWorkspace();
  // Subscribe so a rebinding in Settings refreshes the listener closure.
  const overrides = useShortcutStore((state) => state.overrides);

  useEffect(() => {
    const ws = paths.workspace(workspace.organization_slug, workspace.slug);
    const destinations: Partial<Record<ShortcutActionId, string>> = {
      goInbox: ws.inbox(), goTasks: ws.tasks(), goMyTasks: ws.myTasks(),
      goProjects: ws.projects(), goMeetings: ws.meetings(), goChat: ws.chat(),
      goPeople: ws.people(), goSettings: ws.settings(),
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcutEvent(event)) return;
      const actionId = GLOBAL_ACTIONS.find((id) => {
        const action = SHORTCUT_ACTION_BY_ID[id];
        if (!action) return false;
        if (!action.allowInEditable && isEditableShortcutTarget(event.target)) return false;
        if (!action.allowInEditable && isPortalLayerShortcutTarget(event.target)) return false;
        return shortcutMatchesEvent(getShortcut(id), event);
      });
      if (!actionId) return;
      event.preventDefault();
      // dispatch per actionId: search toggle, ai toggle, onCreateTask, back, forward?.(), push(destinations[id])
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigation, onCreateTask, overrides, workspace.organization_slug, workspace.slug]);

  return null;
}
```

Viết đầy đủ nhánh điều phối thay cho dòng comment ở trên. Giữ điều kiện `enabled` của Ask UNI (Step 1). Nếu `useWorkspace()` throw trong test view có sẵn, dùng `useOptionalWorkspace()` và bỏ các action `go*` khi không có workspace.

Mount trong `WorkspaceChrome`: `<GlobalShortcuts onCreateTask={() => setCreateOpen(true)} />` cạnh `SearchCommand`. Xoá hai hook cũ và dòng gọi chúng. Hành vi ⌘K khi palette đang mở (hook cũ cho phép đóng từ ô nhập) phải giữ: `openSearch` có `allowInEditable: true` nên tự nhiên giữ. Viết test cho nó.

Thêm `forward?: () => void` vào `NavigationAdapter` với JSDoc cùng giọng `canGoBack`, và nối ở `apps/web/platform/navigation.tsx` bằng `router.forward()` nếu router Next có, hoặc `window.history.forward()`.

- [ ] **Step 5: Chạy xanh, rồi chạy test layout, search, ai**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run layout search ai
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(shortcuts): một bộ điều phối phím tắt toàn cục thay listener rời của ⌘K và ⌘J"
```

---

## Task 3: Phím gửi trong composer và title editor

**Files:**
- Test: `packages/views/tasks/detail/components/comment-composer.test.tsx` (sửa hoặc tạo)
- Test: `packages/views/editor/title-editor.test.tsx` (sửa hoặc tạo)
- Modify: chỉ khi test đỏ vì lỗi thật

**Interfaces:**
- Consumes: Task 1 (`send` mặc định ⌘Enter).

- [ ] **Step 1: Đọc**

`editor/extensions/submit-shortcut.ts` toàn bộ, `editor/title-editor.tsx:77-95,160-180`, `editor/extensions/index.ts:290-300`, `tasks/detail/components/comment-composer.tsx:140-200`. Composer bật lười (`lazy.active`); test phải kích hoạt nó trước.

- [ ] **Step 2: Viết test**

1. Composer bình luận: gõ chữ, ⌘Enter gọi submit đúng một lần.
2. Composer: Enter trơn KHÔNG gửi và vẫn xuống dòng.
3. Composer: ⌘Enter khi IME đang soạn không gửi.
4. Composer: ⌘Enter khi nội dung rỗng không gửi (nút gửi đang `aria-disabled`; phím phải tuân cùng điều kiện).
5. Title editor: Enter trơn không gọi `onSubmitShortcut` (bảo vệ #5532 ghi ở `title-editor.tsx:80-84`); ⌘Enter thì gọi.
6. Người dùng đổi `send` thành Enter trơn qua store: composer gửi bằng Enter, Shift+Enter xuống dòng (`shouldReplayNativeEnter`), title editor vẫn không gửi bằng Enter trơn.

- [ ] **Step 3: Chạy**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/detail/components/comment-composer.test.tsx editor/title-editor.test.tsx
```

Ca 4 có thể đỏ thật: `onSubmit` của composer gọi `submit()` không kiểm rỗng. Nếu đỏ, sửa ở `comment-composer.tsx` bằng cùng điều kiện với nút gửi, rồi chạy lại. Ca nào đỏ thì ghi output đỏ vào báo cáo.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(editor): khoá hành vi phím gửi sau khi send được khai báo"
```

(Dùng `fix(tasks)` nếu phải sửa composer.)

---

## Task 4: Tab Settings để đổi phím tắt

**Files:**
- Create: `packages/views/settings/components/keyboard-shortcuts-tab.tsx`
- Create: `packages/views/settings/components/keyboard-shortcuts-tab.test.tsx`
- Modify: `packages/views/settings/components/settings-page.tsx` (dòng 18-36 và phần `TabsContent` quanh 163-177)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Consumes: Task 1; `useShortcutStore` (`setShortcut`, `resetShortcut`, `resetAll`, `store.ts:77-79`); `findShortcutConflict`; `shortcutFromEvent`; `isShortcutAllowedForAction`; `formatShortcut`.

- [ ] **Step 1: Đọc**

Port `multica/packages/views/settings/components/keyboard-shortcuts-tab.tsx` và test của nó. Multica dùng `useT`, `SettingsCard`, `SettingsRow`, `SettingsSection`, `ShortcutKeycaps` từ `../../common/shortcut-keycaps`. UniWork dùng `useTranslation`, primitive `settings-layout.tsx` (`SettingsTab` ở dòng 8, và các phần khác trong file đó), và `packages/views/editor/shortcut-keycaps.tsx`. Đọc hai file UniWork đó trước khi port.

- [ ] **Step 2: Viết test thất bại**

1. Mỗi action trong `SHORTCUT_ACTIONS` hiện một hàng với nhãn dịch và phím đang hiệu lực (hoặc "—" khi `null`).
2. Bấm đổi, nhấn một chord hợp lệ: `setShortcut` được gọi với đúng chord.
3. Nhấn một chord bị giữ chỗ (ví dụ ⌘W): không lưu, hiện lỗi dịch.
4. Nhấn một chord đang thuộc action khác: hiện hộp xác nhận; huỷ thì không đổi gì; xác nhận thì action cũ bị gỡ phím và action mới nhận phím.
5. Đặt lại một hàng gọi `resetShortcut`; đặt lại tất cả gọi `resetAll` sau khi xác nhận.
6. Nhấn Escape trong lúc ghi phím huỷ ghi, không lưu.
7. Tab mở được qua `?tab=shortcuts` (theo `TAB_QUERY_KEY` ở `settings-page.tsx`).

- [ ] **Step 3: Chạy đỏ, viết, chạy xanh**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run settings/components/keyboard-shortcuts-tab.test.tsx settings/components/settings-layout.test.tsx
```

Thêm key `"shortcuts"` vào `ACCOUNT_TAB_KEYS`, icon `Keyboard` từ `lucide-react` vào `ACCOUNT_TAB_ICONS`, nhãn `settings.page.tabs.shortcuts`, và lazy import cùng khuôn các tab khác. Mỗi nhãn action là khoá i18n ở cả hai locale. Giữ file dưới 500 dòng; nếu vượt, tách hàng ghi phím ra file riêng.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(settings): tab đổi phím tắt"
```

---

## Task 5: Tìm trong trang chi tiết task

> **Đổi hình dạng khi thực thi.** Hai chỗ dưới đây đã bị thay, không làm theo.
> - Chữ ký `useTaskFind` ở mục Interfaces: hook nay nhận `{ container, contentKey }`, và state tìm nằm trong `TaskFindScope` để gõ không render lại editor (1af5af6).
> - Câu "Đóng thanh tìm không tự gấp lại các luồng đã mở" ở Step 2: theo addendum cuối của brief Task 5, tìm mở luồng khớp bằng một tập tạm trong timeline (`find/find-expanded-threads.ts`) và không ghi store của Task 7, nên đóng thanh tìm thì luồng chỉ mở vì tìm sẽ gấp lại.
>
> Lý do nằm ở ledger `.superpowers/sdd/2026-09-13-tasks-human-parity-slice-d1/progress.md` (Task 7 điểm 4, vòng sửa Task 5). Các bước bên dưới giữ nguyên để đối chiếu.

**Files:**
- Create: `packages/views/tasks/detail/find/use-task-find.ts`
- Create: `packages/views/tasks/detail/find/use-task-find.test.ts`
- Create: `packages/views/tasks/detail/find/task-find-bar.tsx`
- Create: `packages/views/tasks/detail/find/task-find-bar.test.tsx`
- Modify: `packages/views/tasks/detail/task-detail-suite-page.tsx` (quanh dòng 81-110)
- Modify: `packages/views/tasks/detail/components/timeline.tsx` (quanh dòng 77, `expandedResolved`)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Consumes: Task 1 (`findInTask`), `getShortcut`, `shortcutMatchesEvent`, `shouldIgnoreGlobalShortcutEvent`. Nếu Task 7 đã xong, dùng store của Task 7 để mở luồng; nếu chưa, dùng callback.
- Produces:
  - `export function collectTextMatches(root: HTMLElement, query: string): TextMatch[]`
  - `export function useTaskFind(opts: { containerRef: RefObject<HTMLElement | null>; enabled: boolean; onQueryChange?: (query: string) => void }): TaskFindState`

- [ ] **Step 1: Đọc**

`multica/packages/views/issues/hooks/use-in-page-find.ts` và test. Giữ: TreeWalker thuần DOM, bỏ `[data-find-ignore]`, không `scrollIntoView` gốc, dò `CSS.highlights` trước khi dùng. Bỏ: phần render phẳng timeline ảo, vì timeline UniWork không ảo.

- [ ] **Step 2: Quyết định về luồng đã giải quyết, rồi viết test**

Chữ trong luồng đã gấp không có trong DOM. Khi truy vấn đổi, mở mọi luồng đã giải quyết có ít nhất một bình luận chứa truy vấn (so không phân biệt hoa thường trên nội dung thô của bình luận), rồi mới đếm kết quả DOM. Không mở luồng không khớp. Đóng thanh tìm không tự gấp lại các luồng đã mở.

Test tối thiểu:

1. `collectTextMatches` tìm không phân biệt hoa thường, theo thứ tự tài liệu, bỏ `script`, `style` và `[data-find-ignore]`.
2. ⌘F trong trang chi tiết mở thanh tìm và focus ô nhập; ⌘F khi trang không hiển thị không làm gì.
3. Gõ truy vấn cập nhật "n / tổng"; Enter tới kết quả kế; Shift+Enter về kết quả trước; vòng quanh ở hai đầu.
4. Escape đóng thanh và trả focus về phần tử trước khi mở.
5. Truy vấn khớp chữ trong một luồng đã giải quyết đang gấp: luồng đó được mở và kết quả được đếm.
6. Không có CSS Highlight API (jsdom): thanh vẫn mở, đếm và điều hướng, không ném lỗi.
7. Thanh tìm không phản ứng ⌘F khi đích là ô soạn thảo **bên ngoài** trang chi tiết (ví dụ ô tìm của palette). Trong editor mô tả của chính task thì có mở (`allowInEditable: true`).
8. Điều hướng luồng (`openThreadNav`): gán phím qua store rồi nhấn trên trang chi tiết thì focus vào mục đầu của `ThreadNavPanel` (`detail/components/thread-nav-panel.tsx`). Khi panel tự ẩn (dưới bốn luồng, quyết định có chủ đích của lát B), phím không làm gì và không ném lỗi. Không phản ứng khi đích là ô soạn thảo hay lớp popup.

- [ ] **Step 3: Chạy đỏ, viết, chạy xanh**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/detail/find tasks/detail/components/timeline.test.tsx
```

Thanh tìm là primitive `input` với nhãn truy cập dịch, nút trước/sau có `aria-label` dịch, và vùng `aria-live="polite"` cho "n / tổng". Trang chi tiết đang lazy-load trong ngân sách 150 KB gzip (spec §6); không kéo thư viện mới.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(tasks): tìm trong trang chi tiết task, mở luồng đã giải quyết khi khớp"
```

---

## Task 6: Task xem gần đây

**Files:**
- Create: `packages/core/tasks/stores/recent-tasks-store.ts`
- Create: `packages/core/tasks/stores/recent-tasks-store.test.ts`
- Modify: `packages/core/tasks/` export tương ứng
- Modify: `packages/views/tasks/detail/task-detail-suite-page.tsx` (ghi lượt xem)
- Modify: `packages/views/search/search-command.tsx` (nhóm "Gần đây")
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Produces:
  - `export interface RecentTaskEntry { id: string; identifier: string; title: string; visitedAt: number }`
  - `export const useRecentTasksStore` với `recordVisit(workspaceId: string, entry: Omit<RecentTaskEntry, "visitedAt">): void`, `forget(workspaceId: string, taskId: string): void`, `pruneWorkspaces(activeWorkspaceIds: string[]): void`
  - `export function useRecentTasks(workspaceId: string): readonly RecentTaskEntry[]` (tham chiếu ổn định)

- [ ] **Step 1: Đọc**

`multica/packages/core/chat/recent-context-store.ts` và `packages/core/shortcuts/store.ts` (khuôn `persist` + `createJSONStorage(() => defaultStorage)` + làm sạch dữ liệu hỏng khi merge).

- [ ] **Step 2: Viết test thất bại**

1. Ghi cùng một task hai lần giữ một mục và đưa nó lên đầu.
2. Tối đa 20 mục mỗi workspace; mục cũ nhất rơi ra.
3. Tối đa 50 workspace; workspace có lượt xem cũ nhất rơi ra.
4. Dữ liệu lưu hỏng (không phải mảng, mục thiếu `id`) bị bỏ khi nạp, không ném lỗi.
5. `useRecentTasks` trả cùng tham chiếu giữa hai lần render khi không đổi.
6. `forget` gỡ một task (dùng khi task bị xoá hoặc trả 404).

- [ ] **Step 3: Chạy đỏ, viết, chạy xanh**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/stores/recent-tasks-store.test.ts
```

- [ ] **Step 4: Nối vào trang chi tiết và palette, có test**

- Trang chi tiết ghi lượt xem khi task tải thành công, không ghi khi lỗi hoặc 404, và gọi `forget` khi 404.
- Palette hiện nhóm "Gần đây" tối đa 5 mục khi ô tìm rỗng, mỗi mục điều hướng tới `paths.workspace(org, ws).task(id)` qua `useNavigation().push`. Có truy vấn thì nhóm ẩn.
- Test ở `search-command.test.tsx`.

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run search tasks/detail/task-detail-suite-page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tasks): nhớ task xem gần đây và hiện trong palette tìm"
```

---

## Task 7: Ghi nhớ gấp mở trên trang chi tiết

**Files:**
- Create: `packages/core/tasks/stores/task-detail-ui-store.ts`
- Create: `packages/core/tasks/stores/task-detail-ui-store.test.ts`
- Modify: `packages/views/tasks/detail/components/timeline.tsx:77` (`expandedResolved` sang store)
- Modify: `packages/views/tasks/detail/components/subtasks-section.tsx` (thêm gấp mở)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Produces:
  - `useTaskDetailUiStore` với `setResolvedExpanded(taskId: string, threadRootId: string, expanded: boolean)`, `isResolvedExpanded(taskId: string, threadRootId: string): boolean`, `setSubtasksCollapsed(taskId: string, collapsed: boolean)`, `isSubtasksCollapsed(taskId: string): boolean`.
  - Giới hạn: nhớ tối đa 200 task, bỏ task truy cập cũ nhất.

- [ ] **Step 1: Đọc**

`timeline.tsx:70-200`: `expandedResolved` còn được đọc bởi logic cuộn tới bình luận (dòng 164-197). Chuyển sang store không được phá luồng "nhảy tới bình luận trong luồng đã gấp thì mở luồng rồi cuộn".

- [ ] **Step 2: Viết test thất bại**

1. Store: đặt, đọc, giới hạn 200, dữ liệu lưu hỏng bị bỏ.
2. Timeline: mở một luồng đã giải quyết, unmount, mount lại cùng task: luồng vẫn mở.
3. Timeline: một task khác không thừa hưởng trạng thái mở.
4. Timeline: nhảy tới bình luận trong luồng đang gấp vẫn mở luồng và cuộn (test có sẵn phải còn xanh).
5. Sub-task: gấp, unmount, mount lại: vẫn gấp. Nút gấp có `aria-expanded` và `aria-controls`, nhãn dịch.

- [ ] **Step 3: Chạy đỏ, viết, chạy xanh**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/stores/task-detail-ui-store.test.ts
cd ../views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/detail
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(tasks): nhớ luồng đã giải quyết đang mở và sub-task đang gấp"
```

---

## Task 8: Cổng cuối và tài liệu

- [ ] **Step 1: Cổng**

`NODE_OPTIONS="--no-experimental-webstorage" make check` một lần, tiền cảnh. Nếu dừng ở một lỗi nền trong danh sách Global Constraints, chạy tay các bước sau theo đúng lệnh trong `scripts/check.sh`: node contract tests, migrate, `scripts/test-go.sh --race`. Đối chiếu mọi lỗi với danh sách; lỗi ngoài danh sách thì chạy riêng hai lần, còn đỏ thì dừng và báo.

- [ ] **Step 2: i18n**

`cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run i18n/parity.test.ts`, và kiểm bằng script rằng mọi khoá mới của D1 có ở cùng đường trong cả hai locale.

- [ ] **Step 3: Coverage**

Coverage `views` và `core`, mỗi package chạy một mình. Nâng sàn **chỉ** của package lát này kiếm được, lên phần nguyên số đo. Chứng minh bằng một lần chạy `GATE_LEVEL=standard`. Không chạm sàn `ui`.

- [ ] **Step 4: Tài liệu**

- Plan này: `in-progress` → `shipped`, ghi trung thực `make check` chạy tới đâu.
- Spec: dòng trạng thái thêm "lát D1 shipped"; §3.1 lát D trỏ sang D1 và D2; thêm `## 7quinquies. Giới hạn đã biết của lát D1`.
- §7quinquies phải ghi: `openThreadNav` không có phím mặc định vì chưa kiểm được chord nào không bị trình duyệt hoặc hệ điều hành giữ trên mọi nền tảng; người dùng gán trong Settings.
- Roadmap `docs/roadmap/FEATURE_ROADMAP.md`, hàng F-05: giữ `MỘT PHẦN`, nối một câu "Lát D1/human-parity (...) shipped <ngày>".

- [ ] **Step 5: Commit. KHÔNG mở pull request.**

```bash
git commit -m "chore(tasks): nâng sàn coverage và cập nhật trạng thái lát D1"
```

## Một chỗ plan này cố ý lệch khuôn

Task 1 có mã đầy đủ vì controller đã đọc tận dòng file đích. Task 2 có khung mã và danh sách ca test cụ thể. Task 3 đến 7 nêu **ca test phải phủ** bằng lời, cộng interface chính xác và file thượng nguồn để port, thay vì khối mã viết sẵn. Lý do giống lát C: người viết plan chưa đọc hết `settings-layout.tsx`, `comment-composer.tsx` lúc chạy lười, và nội dung test hiện có của timeline. Một khối mã đoán sẽ trông thật và dẫn người thực thi đi sai. Mỗi task bắt đầu bằng bước ĐỌC có tên file và dòng cụ thể.

## Ghi chú cho người thực thi

- Thứ tự phụ thuộc: Task 1 trước tất cả. Task 2 và 3 cần Task 1. Task 4 cần Task 1. Task 5 dùng store của Task 7 nếu Task 7 xong trước; nếu không, dùng callback rồi Task 7 chuyển sang store. Task 6 độc lập với 2 đến 5. Task 8 cuối cùng.
- Không thêm listener `keydown` toàn cục nào ngoài `GlobalShortcuts` và hook tìm trong trang. Nếu thấy mình cần một cái nữa, đó là một action thiếu trong Task 1.
- Lát D2 (phân trang list, board, My Tasks) chạm `use-task-surface-controller.ts` và cache lạc quan ở `packages/core/tasks/hooks.ts`. D1 không chạm hai file đó.
