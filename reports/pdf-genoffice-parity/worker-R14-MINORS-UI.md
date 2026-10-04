# R14-MINORS-UI (UNI-925) - worker-R14-MINORS-UI

Status: DONE (implemented + verified)
Branch: feature/UNI-925-pdf-genoffice-parity (NOT pushed)
Scope touched:
- packages/views/office/pdf/pdf-editor.tsx
- packages/views/office/pdf/pdf-editor.test.tsx
- apps/office-desktop/renderer/office/open-document.tsx
- apps/office-desktop/renderer/office/open-document.test.tsx

## What changed
1. R14-5 (packages/views/office/pdf/pdf-editor.tsx:339). The Ctrl/Cmd+F chord in
   `keyboardHandler` now also requires `!event.shiftKey`, so Ctrl+Shift+F no longer
   toggles the Find bar and no longer calls `preventDefault()` on that chord (the
   browser's own find stays available). Plain Ctrl+F and Cmd+F still open Find.
2. R14-6 (apps/office-desktop/renderer/office/open-document.tsx:95). In local mode
   the `LockedAiEntry` was a bare `<div>` child of `DropdownMenuContent`
   (role=menu). It is now wrapped in `DropdownMenuGroup` (Base UI `Menu.Group`,
   which renders `role="group"`) carrying `aria-label={tAi("entry")}`, so the AI
   entry has proper menu semantics and an accessible name. Behaviour is unchanged:
   the entry still renders locked, still opens the same popover, and signed out
   still only offers the sign-in flow.

## Tests added
- pdf-editor.test.tsx: "does not toggle Find on Ctrl+Shift+F - the shifted chord
  is out of scope" - fires Ctrl+Shift+F and asserts no `role="search"` appears,
  then fires plain Ctrl+F and asserts it opens.
- open-document.test.tsx: "exposes the local-mode AI entry as a labelled group and
  keeps it locked" - mounts local mode, opens the document menu, asserts a
  `role="group"` named after the AI entry contains the `data-ai-entry="locked"`
  trigger, and that opening it shows the locked prompt with the sign-in button.

## Verification (Node 22.23.2 first on PATH)
- `packages/views`: `npx vitest run office/pdf/pdf-editor.test.tsx`
  -> Test Files 1 passed (1); Tests 28 passed (28).
- `apps/office-desktop`: `npx vitest run renderer/office/open-document.test.tsx`
  -> Test Files 1 passed (1); Tests 9 passed (9).
- `apps/office-desktop`: `npx vitest run renderer/local-mode.test.tsx`
  -> Test Files 1 passed (1); Tests 17 passed (17) (re-verifies the AI entry stays
  locked and never calls a cloud channel).
- `packages/views` `npx tsc --noEmit` -> exit 0.
- `apps/office-desktop` `npx tsc --noEmit` -> exit 0.
- `npx eslint` on all four paths (`--max-warnings 0`) -> exit 0 (both packages).

## Notes / limits
- Only the four scoped paths were edited; other workers' files
  (pdf-adapter.tsx, browser/pdfium.ts, find/search-model.ts, find/types.ts) were
  left untouched.
- Committed with `git add <the four paths>` only (no -A); hook run normally
  (no --no-verify).
