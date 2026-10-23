# B — shell host, Office-frame host, documents/UniNote, global app shortcuts

Stage 1 inventory, read-only. Rows: `B-shell-host-web.csv` (143 data rows, 13 columns, each parsed). Fork = `uniwork-office@d999b8801`, D = `uniwork@e7be35f41`.
Row sources: own handler / tiptap / prosemirror / electron-role. Electron role accelerators are Electron defaults that are not written in either repo (electron is not installed in the checkouts), so those rows are `confidence=medium`.
Keys marked "per MS knowledge" in notes are my recollection of Office, not read from code; check them against `C-ms-reference.md`.

## 1. Where each surface's shortcuts are defined

| Surface | Single place? | Where |
| --- | --- | --- |
| Fork desktop shell (Electron) | **No, five places.** | Home, PDF, Markdown and HTML menus are in `apps/shell/src/main/index.ts` (5885-6205). Docs, Sheets and Slides menus are in their module mains: `apps/docs/src/main/docs-main.ts` 6066-6392, `apps/sheets/src/main/sheets-main.ts` 4679-4766, `apps/slides/src/main/slides-main.ts` ~2040-2115. The shell swaps the application menu per active tab in `applyMenuFor` (`index.ts` 3534). Shared pieces come from `packages/electron-utils/src/app-menu.ts`. The interface-scale items come from `apps/shell/src/main/ui-scale-menu.ts`. |
| Office frame host (D web) | Yes, one handler | `packages/views/office/frame/office-module-frame.tsx` 265-281: the window `keydown` for Ctrl/Cmd+P. `apps/web/platform/office-frame/*` has no key code at all. |
| UniNote page editor (TipTap) | **No, three layers.** | StarterKit/TipTap defaults, `packages/views/editor/extensions/list-item.ts` plus `page-task-item.ts`, and `title-editor.tsx`. The toolbar tooltips and the help popover show a hand-written subset (`page-toolbar-model.ts` 54-96, `page-help-popover.tsx` 25-48). |
| Global app shortcuts | Mostly yes | Registry `packages/core/shortcuts/definitions.ts` 69-94, listener `packages/views/layout/global-shortcuts.tsx` 43-110. Ctrl/Cmd+B, Ctrl/Cmd+F in chat, the meeting-room keys and the email-hub keys are separate listeners outside the registry. |

## 2. Structural findings

### Fork desktop shell

1. **One `before-input-event` and no `globalShortcut`.** The only key interception in the shell is `tab-manager.ts:316` (Ctrl/Cmd+W closes the active tab). It exists because keys sent to a hidden view skip both `before-input-event` and menu accelerators (comment at 177-180). It matches `event.key==='w'` or `event.code==='KeyW'`, so it works on non-Latin layouts. This is the only handler in the fork that uses `event.code`.
2. **The shell does not forward keys to the module frames.** Modules are `WebContentsView`s. The only link from key to module is a menu accelerator that calls `sendCommand`/`menu:command` over IPC with a command name (`save`, `undo`, …) (`docs-main.ts` 6024-6026, `index.ts` 4027/4030). Nothing is sent back from a module to the shell as a key.
3. **Menu accelerators beat renderer key handlers.** `app-menu.ts:561-563` says so for macOS. Sheets turned off the page-zoom roles because ⌘R/⌘0/⌘+/⌘- are sheet commands. Docs and Slides keep the Ctrl/Cmd+=, -, 0 menu accelerators.
4. **Duplicated accelerators.** Ctrl+O, Ctrl+S, Ctrl+Shift+S, Ctrl+P, Ctrl+W and Ctrl+Shift+H are written out by hand in six menus: Home, PDF, Markdown, HTML, plus Docs/Sheets/Slides with Back-to-Home injected from `index.ts:6519`. No shared table, so a rename has to touch several places.
5. **Missing roles in the shell-owned menus.** The Home, PDF, Markdown and HTML menus have no Reload or DevTools items and no browser-zoom roles. `viewMenuTemplate()` (`index.ts` 3560) returns only the interface-scale items. `setApplicationMenu` replaces Electron's default menu, so Ctrl+R and Ctrl+Shift+I do nothing on those tabs. Docs shows DevTools in dev only (`isDev`, 6224). Sheets shows it when `!app.isPackaged` (4761). **Slides always shows Developer Tools**, including in packaged builds (`slides-main.ts:2110`), so the three modules disagree.
6. **Interface-scale accelerators use `Ctrl/Cmd+Alt+= - 0`** (`ui-scale-menu.ts` 41-52). On Windows layouts that use AltGr, Ctrl+Alt is AltGr, so these can clash with typing. They exist only for Home and Sheets (`chromeFollowsUiScale`, line 25).
7. **Redo is Ctrl+Shift+Z in all three module menus** (`docs-main.ts:6155`, `sheets-main.ts:4748`, `slides-main.ts:2090`). Word, Excel and PowerPoint use Ctrl+Y on Windows. Whether the renderers also take Ctrl+Y is assignment A's question.
8. **Edit roles are mixed.** Docs and Sheets use roles for cut/copy/paste/selectAll. Slides forwards cut/copy/paste to the renderer (menu accelerators at 2093-2095). Sheets forwards undo/redo to Univer (`sheets-main.ts` 4739-4741). That matters for any shortcut change: the menu level can swallow a key before the editor sees it.
9. **No IME or AltGr handling needs checking at menu level**, since accelerators are matched by Electron. The shell's renderer UI is IME-careful on Enter (`isComposing` in `Home.tsx`, `NotesPane.tsx:191`, …), but the window-level `keydown` listeners are not: `Home.tsx:1826-1836` (Ctrl+F / Ctrl+P), the six Escape listeners in `Home.tsx`, `SettingsModal.tsx:1936`, `Onboarding.tsx:117`, `pdf-password.ts:72/95`. `Home.tsx:1826-1836` matches only lowercase `'f'`/`'p'`, so Caps Lock breaks it.
10. **`apps/uniai-pwa`** is a plain web app with Enter-to-send and Escape (`app.js` 1664-1668, 1770). It is not a frame host and has no accelerators.
11. **UniChat desktop (D, `apps/chat-desktop`)** sets no menu and no shortcuts (grep: no `accelerator`, `globalShortcut`, `setApplicationMenu`, `before-input-event`). It keeps Electron's default menu with `autoHideMenuBar: true` (`index.ts:97`).

### Office frame host (D web)

1. The host intercepts exactly one key: **Ctrl/Cmd+P** on `window` (`office-module-frame.tsx:272-278`). It requires ctrl or meta, `!altKey`, and `key.toLowerCase()==='p'`. It calls `preventDefault()` then `host.print({mode:'dialog'})`. It skips `event.repeat`. It is registered only when the session is ready, not modal, and `canPrint`. It ignores Shift, so Ctrl+Shift+P also prints, and it has no composition check.
2. **Focus inside the iframe is invisible to the host.** The frame is a separate document, so the page's `window` and `document` listeners never see its keys. This applies to Ctrl/Cmd+P here and to every global app shortcut in §Global below, so Ctrl+J, Ctrl+K, Ctrl+B and the others do not fire when the frame has focus. The comment at 265-270 states it: "only the frame can hear Ctrl+P there", and since UNI-1920 Docs and HTML bind Ctrl+P in the frame itself.
3. **The message protocol has no key message.** Host→frame requests are `init open save saveAs print doc.closeCheck comments.reveal doc.download` (`docs-frame-protocol.ts` 1510-1517). Frame→host events are `ready dirty title modal resize saved error cancel aiRun size_warning save_blocked lag_detected open_refused close_requested` (1557-1570). So the host cannot learn that a key was pressed, and keys that are unhandled in the frame are not passed up. `print` is the one place a key-like action crosses over: the page header's Print item and Ctrl+P share one `print()` (`use-docs-frame-session.ts` 544-560).
4. **Save has no host key.** The page header has a Save button (`office-module-frame.tsx` ~243-248, 360-366) and no accelerator. Ctrl+S lives inside each frame (comment `use-docs-frame-session.ts:225`). After a page dialog closes, `frame-focus.ts` (28-41) puts keyboard focus back into the iframe so Ctrl+S works without a click.
5. `<iframe allow="clipboard-read; clipboard-write">` (`office-module-frame.tsx:451`) has no `fullscreen` entry. I did not find a `sandbox` attribute in the lines at 444-451; the rest of the element was not read.
6. `apps/web/platform/office-frame/` (module-frame-host.tsx, document-host.tsx, desktop-handoff.ts, desktop-open-props.ts, tab-title.ts) has no keyboard code. `desktop-handoff.ts` listens to `blur`, `pagehide` and `visibilitychange` only.

### Documents pages and UniNote (TipTap)

1. **UniNote = the page editor**: `packages/views/documents/document-editor.tsx` with `createPageDocumentExtensions` (`packages/views/editor/extensions/index.ts` 378-409). The Markdown flavor (`createEditorExtensions`) is for tasks and chat and is a different set. It disables underline, keeps highlight and the Escape-to-blur extension, and uses heading levels 1-6.
2. **Library keymaps active in the page editor** come from `@tiptap/starter-kit` (installed 3.30.6 in `node_modules/.pnpm`; `pnpm-workspace.yaml` catalog says 3.27.1, which I did not reconcile): bold, italic, underline, strike, code, bullet/ordered/task list, blockquote, headings 1-3, paragraph, hard break, undo/redo, the core keymap (Enter/Backspace/Delete/Mod-a), the list keymap, and table navigation. The repo's own keymaps are `PatchedListItem`/`PatchedTaskItem` (Enter split-or-lift, Tab sink, Shift+Tab lift) and `titleKeymap`.
3. **The help sheet** (`page-help-popover.tsx`) and the toolbar tooltips share the chord objects from `@uniwork/core/shortcuts` (`createShortcutChord`), formatted per platform by `ShortcutKeycaps`. The test `page-shortcuts.test.ts` proves every chord shown plus the typed patterns and that Mod-k creates no link. Pattern to reuse: a chord table, a test that fires each chord with `editor.commands.keyboardShortcut`, and a rule that a chord is listed only if the test proves it. The help popover lists only Ctrl+B, Ctrl+I, Ctrl+Shift+S, Ctrl+E, Ctrl+Z and Ctrl+Shift+Z. Underline, Ctrl+Y, lists, headings and code block exist in the toolbar or in the test but not in the help rows.
4. **Not bound in the page editor**: link (deliberate, Ctrl+K is app search), highlight, Escape-to-blur (only the Markdown flavor has it), Ctrl+S (pages autosave, no handler anywhere in `packages/views/documents`).
5. **IME and AltGr in TipTap**: ProseMirror ignores keydown during composition (`prosemirror-view/src/input.ts` 106-110, `inOrNearComposition` 495) and `prosemirror-keymap` skips its keyCode fallback for Ctrl+Alt on Windows (`keymap.ts` 91-93). So all StarterKit and `addKeyboardShortcuts` rows are `ime_safe=yes`. The repo's own plugin handlers and pickers check `isImeComposing` (`submit-shortcut.ts`, `mention-suggestion.tsx:104`, `slash-command-suggestion.tsx:88`, `page-block-list.tsx:43`).
6. **Picker navigation aliases** `Ctrl+N/J/P/K` while a mention or slash picker is open (`picker-keys.ts` 55-80), plus Enter or Tab to accept. These are `Ctrl` only, not `Cmd`.

### Global app shortcuts

1. **Registry**: `SHORTCUT_ACTIONS` (`definitions.ts` 69-94): `ai.askUni` Ctrl/Cmd+J, `openSearch` Ctrl/Cmd+K, `createTask` C, `findInTask` Ctrl/Cmd+F, `openThreadNav` Ctrl/Cmd+Shift+O, `send` Ctrl/Cmd+Enter, `goBack` Ctrl/Cmd+[, `goForward` Ctrl/Cmd+], and eight unassigned `go*` actions. All are rebindable in Settings. The registry blocks Ctrl+W/R/Q/A/C/V/X/Y/Z/B and the zoom keys (265-279) and the browser keys P/L/T/N/D/U, which are only allowed bare on desktop (288-291).
2. **One document-level listener** (`global-shortcuts.tsx` 43-110, bubble phase). It skips events that `defaultPrevented`, repeat, or are IME-composing; plain-key actions skip editable and popup targets; `ai.askUni` and `openSearch` are `allowInEditable` so they fire inside editors. It reads `event.key` (not `event.code`) and drops events where `getModifierState('AltGraph')` is true (`definitions.ts:139`).
3. **Listeners outside the registry** that do not honour `defaultPrevented` or composition: `packages/ui/components/ui/sidebar.tsx:200-217` (Ctrl/Cmd+B, window), `chat-page-content.tsx:168-174` (Ctrl/Cmd+F), `meeting-room-shortcuts.ts:25-50` (Ctrl/Cmd+D mic, Ctrl/Cmd+E camera), `use-email-hub-shortcuts.ts:60-104` (plain j/k/c/e/r/a/f/s/u/U/#/?//), `people-toolbar.tsx:106-113` (`/`). The sidebar listener skips contenteditable and form controls, and the registry source says it is deliberately not claimed by any action (`global-shortcuts.tsx` 20-22).
4. **Frame awareness**: none of these listeners knows about the Office iframe. They are silent while a frame has focus only because key events do not cross the document boundary.
5. `apps/web/**` has keydown code only in the landing pages (`features/landing/*`); the app shell has none.

## 3. Potential collisions with Word/Excel/PowerPoint keys

Listed from the code side. The Office column is my recollection and needs checking against `C-ms-reference.md`.

| UniWork key | Where it applies | Office meaning | Risk |
| --- | --- | --- | --- |
| Ctrl/Cmd+K → search | whole app (not in a frame); fork Docs menu has Ctrl+K → insert link | Insert hyperlink | High in the web page editor, none in the fork |
| Ctrl/Cmd+J → Ask UNI | whole app, also inside TipTap | Justify | Medium |
| Ctrl/Cmd+E → inline code | UniNote | Center | High |
| Ctrl/Cmd+Shift+S → strike | UniNote | Apply Styles (Word) | Medium |
| Ctrl/Cmd+Shift+8 → bullet list | UniNote | Show/hide ¶ (Word) | Medium |
| Ctrl/Cmd+Shift+B → blockquote | UniNote | Bold (alt) | Low |
| Ctrl/Cmd+Alt+C → code block | UniNote | © symbol | Low |
| Ctrl/Cmd+[ and ] → back/forward | app, outside editable targets | Shrink/grow font | Low |
| Ctrl/Cmd+Enter → send | task/chat composers | Page break (Word) | Low, not in the page editor |
| Ctrl/Cmd+B → toggle sidebar | outside editors only | Bold | None (skips editors) |
| Ctrl+D / Ctrl+E in a meeting room | meeting room only | Font dialog / Center | None in editors (skips typing targets) |
| Ctrl/Cmd+= zoom in (fork Docs menu) | fork Docs | Subscript (Word) | Medium |
| Ctrl/Cmd+Alt+M paragraph dialog (fork Docs) | fork Docs | Insert comment (Word) | Medium |
| Ctrl+Shift+Z redo (all fork menus, UniNote has both) | fork menus | Ctrl+Y | Low |

## 4. Files read

Fork: `apps/shell/src/main/index.ts` (lines 3500-3566, 3615-3632, 4015-4035, 5873-6205, 6505-6535), `close-tab-chord.ts`, `ui-scale-menu.ts`, `tab-manager.ts` (170-185, 290-350), `detached-windows.ts` (grep), `apps/shell/src/renderer/src/Home.tsx` (key listener ranges), `SettingsModal.tsx`, `Onboarding.tsx`, `pdf-password.ts`, `NotesPane.tsx`, `apps/uniai-pwa/app.js` (grep and key lines), `packages/electron-utils/src/app-menu.ts` (all), `apps/docs/src/main/docs-main.ts` (6015-6392), `apps/sheets/src/main/sheets-main.ts` (4676-4766), `apps/slides/src/main/slides-main.ts` (2040-2115).
D: `apps/web/platform/office-frame/module-frame-host.tsx`, `document-host.tsx`, `desktop-handoff.ts` (grep), `packages/views/office/frame/office-module-frame.tsx` (240-345, 365-395), `frame-focus.ts` (grep), `use-docs-frame-session.ts` (536-560), `packages/core/office/docs-frame-protocol.ts` (1494-1572, 575-590), `packages/core/shortcuts/definitions.ts` (60-420), `packages/views/layout/global-shortcuts.tsx` (20-115), `packages/ui/components/ui/sidebar.tsx` (200-218), `packages/core/utils.ts` (55-70), `packages/views/documents/document-editor.tsx` (1-60, 205-240), `page-toolbar/page-help-popover.tsx`, `page-shortcuts.test.ts`, `page-toolbar-model.ts` (grep), `menu-keys.ts`, `document-tree.tsx` (176-240), `packages/views/editor/extensions/index.ts` (225-300, 340-470), `list-item.ts`, `blur-shortcut.ts`, `submit-shortcut.ts`, `picker-keys.ts`, `slash-command-suggestion.tsx` (84-125), `title-editor.tsx` (95-118), `hooks/use-zoom-canvas.ts` (340-372), `chat-sidebar-header.tsx` (270-290), `chat-page-content.tsx` (162-176), `use-task-detail-shortcuts.ts`, `meeting-room-shortcuts.ts`, `use-email-hub-shortcuts.ts`, `inbox-view.tsx`, `home-my-work.tsx`, `people-toolbar.tsx` (key blocks), plus grep results for `packages/views/documents` and `apps/chat-desktop`. TipTap 3.30.6 sources under `node_modules/.pnpm/@tiptap+*` (bold, italic, underline, strike, code, code-block, blockquote, lists, task-item, heading, paragraph, hard-break, undo-redo, highlight, table, core keymap), `prosemirror-view` input.ts and `prosemirror-keymap` keymap.ts.

## 5. Not covered / caveats

- `packages/office-upstream/upstream/` in the D repo is a vendored copy of the fork's apps. I left it to assignment A.
- Electron role default accelerators are from memory of the Electron role table, not from repo code (rows `medium`).
- Not read in full: `apps/shell` renderer key handlers other than the window-level ones listed, `uniwork-folders/*` and `NewMenu.tsx` arrow/Escape menus, `calendar-*` panels, `chat-info-panel.tsx` Escape, `keyboard-shortcuts-tab.tsx` recorder (it does check `isImeComposing`, line 129), CodeBlockExtension's possible key overrides.
