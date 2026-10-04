# W-FIX-G - web editor viewport fit (UNI-924 docx_genoffice_parity)

Base: `cc8dd312` (worktree HEAD at dispatch was `b867af2a`). Source: `visual-r4.md` M-1 / W-A M-5b
(the desktop fix works; the web host did not). Owned files: `apps/web/platform/office/**`.

## Root cause

The web route chain is bounded all the way down to the page scroller:

- `DashboardLayout` -> `SidebarProvider` (`h-svh`) -> `SidebarInset` (`flex flex-1 flex-col`)
  -> `WorkspaceChrome` motion div (`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`)
- `DocumentDetailView` root (`flex min-h-0 min-w-0 flex-1 overflow-hidden`)
- `DocumentWorkspace` root (`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`)
- the `kind=file` branch scroller (`min-h-0 flex-1 overflow-y-auto`) -> `DocumentFileView`
  -> `OfficeEditorHost`

The break was **inside the web host wrapper** in
`apps/web/platform/office/editor-host.tsx`:

```tsx
<div className={className} data-office-editor-host ...>   // block div, height:auto
  <OfficeShell ... className="min-h-[20rem]" />
```

A plain block `<div>` has no definite height and is not a flex container, so `OfficeShell`'s
`flex-1` had no bounded flex parent to resolve against and `docx-editor`'s `h-full` resolved to
`auto`. The card therefore grew with its content (~1465 px at 1440x900): the ribbon scrolled away
(tab row y=132 -> y=-468 after one wheel step) and the 28 px status bar sat at y=1569, below the
fold. Desktop is correct because the Electron renderer mounts `OfficeShell` directly under a
bounded `h-svh` frame with no intermediate block wrapper.

## Fix (minimal, format-neutral)

Give the host wrapper a definite height and make it the flex column that carries the bound, so the
shared `OfficeShell` -> `main` -> `docx-editor` -> `data-testid="docx-canvas"` chain resolves and
only the canvas scrolls:

- `apps/web/platform/office/editor-host.tsx`
  - wrapper is now `cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)`
    (was `className` only); added the `cn` import from `@uniwork/ui/lib/utils`.
  - `h-full` (not a `100dvh` calc) because the file route's scroller already fixes the host's
    height; the wrapper simply has to propagate it. `min-h-0` lets the flex child shrink;
    `overflow-hidden` keeps the page scroller from also scrolling. This is format-neutral: it
    applies to every format that renders through `OfficeEditorHost` (docx and xlsx).
- `apps/web/platform/office/xlsx-office-host.tsx`
  - the negotiation-pending branch had the same unbounded wrapper
    (`<div className={props.className} data-office-editor-host>`); given the same
    `cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", props.className)` so xlsx keeps
    working (and no longer jumps height when negotiation settles). Added the `cn` import.
- No change to `packages/views/office/office-shell.tsx` (other lane) or
  `packages/views/office/ribbon/**`. `editor-slot.tsx` / `docx-editor.tsx` already carry the
  W-A `min-h-0` and needed no edit.

## Test

`apps/web/platform/office/editor-host.component.test.tsx` - new `OfficeEditorHost viewport bound`
block:

- asserts the `[data-office-editor-host]` wrapper carries `flex h-full min-h-0 flex-col
  overflow-hidden` and that `[data-office-shell]` is `flex-1 flex-col` (class-level, as allowed);
- asserts a caller `className` is merged, not dropped.

## Verification

- `cd apps/web; npx vitest run platform/office/editor-host.component.test.tsx --coverage.enabled=false`
  -> 15/15 passed.
- `cd apps/web; npx vitest run platform/office --coverage.enabled=false` -> 218/219; the one
  failure is `preview.test.ts` (`window.localStorage.setItem is not a function`, a Node 25/jsdom
  quirk) and reproduces on the unmodified tree - pre-existing and unrelated.
- `cd apps/web; npx tsc --noEmit` -> clean.
- `cd packages/views; npx tsc --noEmit` -> clean (two other lanes' in-flight test files were
  stashed to isolate; my files are not involved).
- `cd apps/web; npx eslint platform/office/editor-host.tsx platform/office/xlsx-office-host.tsx
  platform/office/editor-host.component.test.tsx --max-warnings 0` -> clean.
- No whole-suite local run (cloud rule).

## For the lead's focused visual delta

Files/classes to check at 1440x900 (and 768 / 390):

- `apps/web/platform/office/editor-host.tsx` -> `[data-office-editor-host]` =
  `flex h-full min-h-0 min-w-0 flex-col overflow-hidden`
- `apps/web/platform/office/xlsx-office-host.tsx` -> pending `[data-office-editor-host]` = same
- Expected: ribbon/tab row and the 28 px status bar visible without scrolling; only
  `[data-testid="docx-canvas"]` scrolls; the page scroller does not grow with the document.
