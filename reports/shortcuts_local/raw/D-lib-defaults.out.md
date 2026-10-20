# D — library and Electron defaults (UNI-2011 stage 1)

Output: `D-lib-defaults.csv`, 292 rows, 13 columns, repo=lib. A script checked that every row has 13 columns, a numeric line, valid enum values, and that the cited file exists with at least that many lines (0 misses). I also spot-checked 18 random rows by hand against the cited lines.

## Conventions in the CSV

- `file` is `<pkg>@<version>:<path inside the package>`.
  - Univer lines (`univer@v0.25.1:`) and TipTap lines (`tiptap@v3.31.0:`) refer to the GitHub tag source (`packages/*/src`).
  - ProseMirror, CodeMirror and pdf.js lines refer to `dist/*.js` of the npm tarball, because the tarball has no src.
  - Electron lines (`electron@v43.7.6:`) refer to the raw file at the tag.
- `module`:
  - `sheets` — Univer.
  - `docs+markdown` — TipTap core and ProseMirror keys that both editors get.
  - `markdown` — StarterKit and extension keys that only the markdown editor enables.
  - `html+markdown` — CodeMirror keys shared by the two source views.
  - `html` — the html-only app keymap.
  - `pdf`
  - `all (Electron menus)`
- Mac modifier order is `Ctrl+Option+Shift+Cmd+Key`. Windows order is `Ctrl+Alt+Shift+Key`.
- Where the library binds `Mod`, Win/Linux = Ctrl and Mac = Cmd.
- For Univer, `CTRL_COMMAND` = Ctrl on Windows and Cmd on Mac. `MAC_CTRL` is the literal Ctrl key on Mac. `ALT` is Option on Mac.
- `source` names who supplies the key: univer, tiptap, prosemirror, codemirror, electron-role. A few rows are `univer+browser-native`, for example the Univer paste entry, which is display-only.

## Versions pinned (fork @ d999b8801, from package.json and package-lock.json)

| Package | Version |
|---|---|
| all `@univerjs/*` (incl. presets) | 0.25.1 |
| `@tiptap/*` (core, extensions, pm, react, starter-kit, markdown, extension-*) | 3.31.0 |
| prosemirror-keymap | 1.2.3 |
| prosemirror-view | 1.42.6 |
| prosemirror-tables | 1.8.5 |
| prosemirror-gapcursor | 1.4.1 |
| prosemirror-history | 1.5.0 |
| @codemirror/commands | 6.11.0 |
| @codemirror/search | 6.7.2 |
| @codemirror/autocomplete | 6.20.3 |
| @codemirror/language | 6.12.4 |
| @codemirror/view | 6.43.11 |
| @codemirror/state | 6.7.4 |
| pdfjs-dist | 6.2.108 |
| electron | 43.7.6 |

## What is enabled

### Univer (apps/sheets)

- `apps/sheets/src/renderer/App.tsx:1922-1971` calls the local `createUniver` (`create-univer.ts`) with these presets:
  - `UniverSheetsCorePreset`, with header on, toolbar off, context menu, formula bar and a footer with sheet bar, statistic bar and menus.
  - Drawing, ConditionalFormatting, Filter, DataValidation, Note, FindReplace, Sort, Table.
  - `UniverSheetsTableUIPlugin` with `hideAnchor`.
- The core preset loads: Docs, DocsUI, FormulaEngine, RenderEngine, Network, RPC, Sheets, SheetsFormula, SheetsFormulaUI, SheetsNumfmt, SheetsNumfmtUI, SheetsUI, UI.
- All 103 Univer rows come only from items that a controller actually registers (parsed from `_initShortcuts` lists, not from every `IShortcutItem` in the package).
- Dynamic registrations are included as hand-coded rows:
  - Cell-editor arrows.
  - Formula-editor arrows (`use-left-and-right-arrow.ts`, priority 900).
  - Function-search popup (`SearchFunction.tsx`, priority 1000).
  - Sheet tab bar (React `onKeyDown`, `SheetBarTabs.tsx:390`).

### TipTap (3.31.0)

- **Docs** (`apps/docs/src/renderer/editor/extensions.ts`, list at about 6770-6846) uses no TipTap extension package and no StarterKit.
  - It builds its nodes and marks with `Node.create` / `Mark.create`.
  - From `@tiptap/extensions` it takes only `Gapcursor` and `UndoRedo`.
  - Library keys in docs are therefore: core Keymap (always on, no `enableCoreExtensions` override), UndoRedo, prosemirror-gapcursor arrows, and prosemirror-tables `handleKeyDown`. Apart from these, only app-own handlers (inventory A) add keys.
- **Markdown** (`apps/markdown/src/renderer/editor/extensions.ts:58-80`) uses `StarterKit.configure`.
  - Disabled in StarterKit and re-added as `Styled*` / `Loose*` / `CodeBlock.extend`: bold, italic, code, heading, lists, hardBreak, horizontalRule, codeBlock, paragraph, link, underline.
  - The re-added ones override only render, NodeView or parse. Their keymaps are inherited (verified for the extended classes read), so the keys are the stock ones.
  - Strike is enabled (`Mod-Shift-s`).
  - Underline is disabled, so TipTap binds no `Mod-u`.
  - CodeBlock Tab/Shift-Tab are inert: `enableTabIndentation` defaults to false (`code-block.ts:94`).
  - TaskItem uses `nested: true`. Table, TaskList and Math are enabled. The Suggestion (slash) extension hands its keys to the app.
- **3.31.0 vs 3.30.6:** `git diff v3.30.6 v3.31.0` over `packages/**/src/**` touches only `packages/react` (node-view selection tracking). No `addKeyboardShortcuts` or keymap changed in any package, so the A inventory (3.30.6) is valid for 3.31.0.

### CodeMirror

- **apps/html** `source/cm-setup.ts:119-125`: `closeBracketsKeymap`, `defaultKeymap`, `historyKeymap`, `foldKeymap`, `indentWithTab`. It also adds an app-level `shiftRedoKey` (Prec.highest, Ctrl/Cmd+Shift+Z → redo, IME-guarded, `:85-97`).
- **apps/markdown** `source/PlainTextEditor.tsx:113`: `closeBracketsKeymap`, `defaultKeymap`, `historyKeymap`, `indentWithTab`.
  - It has no `foldKeymap` and no shift-redo, so Ctrl+Shift+Z on Windows is unbound in the markdown source view. Redo there is Ctrl+Y.
- **Not installed anywhere:** `searchKeymap`, `completionKeymap`, `lintKeymap`. Find is the apps' own find bar. Ctrl+D is not "select next occurrence" and F3/Ctrl+G do nothing.

### pdf.js (pdfjs-dist 6.2.108)

- `apps/pdf/src/renderer/PdfPage.tsx` imports only `getDocument`, `GlobalWorkerOptions`, `AnnotationMode` and `TextLayer` from `pdfjs-dist/legacy/build/pdf.mjs`.
- There is no `pdf_viewer`, `PDFViewer`, `EventBus`, `PDFFindController` or `AnnotationEditorUIManager`. `DrawLayer` is the app's own component.
- Every keydown listener in `pdf.mjs` belongs to a class the app never instantiates. `TextLayer` (`pdf.mjs` ~21138) has none.
- So pdf.js supplies no keys (1 row records that finding). All PDF shortcuts come from the app (inventory A).

### Electron (43.7.6)

Role defaults come from `lib/browser/api/menu-item-roles.ts`. The roles the fork actually uses are below.

| Role | Windows | macOS |
|---|---|---|
| undo | Ctrl+Z | Cmd+Z |
| redo | Ctrl+Y (Win only) | Shift+Cmd+Z (also Linux) |
| cut / copy / paste | Ctrl+X/C/V, `registerAccelerator:false` (label only, the page keeps the key) | Cmd+X/C/V (native NSMenu) |
| pasteAndMatchStyle | Shift+Ctrl+V, `registerAccelerator:false` | Option+Shift+Cmd+V |
| selectAll | Ctrl+A (registered) | Cmd+A |
| close | Ctrl+W | Cmd+W |
| quit | none | Cmd+Q (Linux Ctrl+Q) |
| minimize | Ctrl+M | Cmd+M |
| togglefullscreen | F11 | Ctrl+Cmd+F |
| reload | Ctrl+R | Cmd+R |
| forceReload | Shift+Ctrl+R | Shift+Cmd+R |
| toggleDevTools (role default) | Ctrl+Shift+I | Alt+Cmd+I |
| zoomIn | Ctrl+Plus | Cmd+Plus |
| zoomOut | Ctrl+- | Cmd+- |
| resetZoom | Ctrl+0 | Cmd+0 |
| hide / hideOthers | none | Cmd+H / Alt+Cmd+H |

- On macOS most roles are native NSMenu selectors (`electron_menu_controller.mm`, kRolesMap).
- reload, forceReload, toggleDevTools, zoomIn, zoomOut, resetZoom and togglespellchecker are `nonNativeMacOSRole`: Electron's JS runs them.
- Where the fork uses them (file:line):
  - `packages/electron-utils/src/app-menu.ts`: undo 511, redo 512, cut/copy/paste 514-516, delete 517, selectAll 519, reload 572, forceReload 573, resetZoom 579, zoomIn 580, zoomOut 581, togglefullscreen 584. On darwin it uses `editMenu` (:507) and `windowMenu` (:490) roles.
  - toggleDevTools is **not** used as a role. `toggleDevToolsItem` (`app-menu.ts:529-532`) has the same accelerators and a custom detached-DevTools click. It is used at `docs-main.ts:6224` (dev only) and `slides-main.ts:2110`.
  - `docs-main.ts`: close 6128, cut/copy/paste/pasteAndMatchStyle 6159-6162, selectAll 6175, quit 6099, hide/hideOthers 6095-6096, togglefullscreen 6223.
  - `sheets-main.ts`: close 4732, quit 4733, cut/copy/paste/selectAll 4752-4756, appMenu 4685.
  - `slides-main.ts`: close 2081, quit 2082, selectAll 2096, appMenu 2045.
  - Shell `index.ts`: close 5913, appMenu 5888.
- The Electron rows are role defaults. Which menus actually show each role on each OS depends on the main files above (that part is app code, inventory A).

## Where each module's shortcuts are defined (single place)

| Module | Defined in |
|---|---|
| Univer sheets | Not one place. Item lists live in `packages/sheets-ui/src/controllers/shortcuts/*.shortcut.ts` (and `ui`, `docs-ui` (26 rows, inert in sheets), `sheets-formula-ui`, `find-replace`, `sheets-filter-ui`, `sheets-drawing-ui`); each controller's `_initShortcuts` lists which items register. Dispatch is `packages/ui/src/services/shortcut/shortcut.service.ts`. Plus the dynamic registrations listed above. The app itself defines none. |
| TipTap | `addKeyboardShortcuts()` per extension in `packages/core/src/extensions/keymap.ts` and each `packages/extension-*/src`. Docs: core Keymap + UndoRedo only. Markdown: StarterKit's set. |
| ProseMirror | `prosemirror-gapcursor` (arrows), `prosemirror-tables` (`handleKeyDown`), `prosemirror-view` `captureKeyDown` (Backspace/Delete/Enter/Esc/arrows and Mod-b/i/y/z default-prevention), `prosemirror-keymap` (Mod normalization). |
| CodeMirror | `cm-setup.ts:119-125` (html) and `PlainTextEditor.tsx:113` (markdown) choose the keymaps. The key tables are in `@codemirror/commands` (`defaultKeymap`, `historyKeymap`), `@codemirror/language` (`foldKeymap`, `indentWithTab`) and `@codemirror/autocomplete` (`closeBracketsKeymap`). |
| pdf.js | None. |
| Electron | Defaults in `lib/browser/api/menu-item-roles.ts`; usage in `packages/electron-utils/src/app-menu.ts` and each `*-main.ts`. |

## Structural findings

Excel-parity (Univer):
- Univer binds no Home/End/PageUp/PageDown/Ctrl+Home/Ctrl+Space/Shift+Space. Excel's navigation and row/column selection keys are therefore absent unless the app adds them.
- Ctrl+0 is zoom reset in Univer (priority 1). In Excel it hides columns. Univer puts hide column on Ctrl+Shift+0.
- Ctrl+= and Ctrl+- are zoom (with NilCommand fallbacks that preventDefault browser zoom). Ctrl+Shift+X is strikethrough. Ctrl+Shift+L is filter.
- Alt+= is QuickSum (Mac: Cmd+Option+=).
- Find is Ctrl+F on Windows, and is registered twice on Windows (duplicate registration). On Mac it is Cmd+F and Ctrl+F. Replace is Ctrl+H on Windows. On Mac it is Ctrl+H only; there is no Cmd+Option+F-style replace.
- On Mac both Delete and Backspace clear cells. Shift+Delete = cut. Shift+Backspace = clear.
- Undo/redo exclude the cell editor. Inside the editor, undo falls to the browser, and docs-ui ignores `historyUndo`/`historyRedo` input events (`doc-selection-render.service.ts:1208`).
- docs-ui shortcuts are registered but inert in sheets: they need `FOCUSING_DOC`, and the focused unit is the Workbook (`core/.../instance.service.ts:268-272`). The exception is SelectAll, which also passes on `EDITOR_ACTIVATED`.

TipTap / ProseMirror:
- `Mod-Enter` is bound twice: core `exitCode` and HardBreak. Which wins depends on extension priority.
- `Mod-B` (uppercase) also catches Ctrl+Shift+B, and Blockquote uses `Mod-Shift-b`. Precedence depends on plugin order (medium confidence).
- `Mod-Backspace` / `Mod-Delete` in core are only for the empty-node case. Mid-text the browser does the word deletion natively.
- Ctrl/Cmd+Shift+V is plain-text paste in prosemirror-view (`index.js:3762`).
- Markdown has no `Mod-u`: Underline is disabled and ProseMirror does not capture it. Native Ctrl+U behaviour was not verified.

CodeMirror:
- Ctrl+I is `selectParentSyntax` and Ctrl+/ is toggle comment. Both clash with Word habits (italic, and none).
- Without `searchKeymap`, Ctrl+D is not "select next occurrence" and F3 / Ctrl+G are not bound. Find belongs to the app.
- markdown source view has no Ctrl+Shift+Z on Windows (see above).

Electron:
- `registerAccelerator:false` for copy/cut/paste/pasteAndMatchStyle on Win/Linux: the menu shows the accelerator but does not register it, so the page keeps the key. `selectAll` is registered.
- zoomIn `Plus` requires Shift on most keyboards. Ctrl+= is not mapped by the role.
- `quit` has no Windows accelerator.
- The role default toggleDevTools differs from the app-defined `toggleDevToolsItem` only in the click behaviour. The accelerators match.

IME / AltGr:
- **Univer ShortcutService** (`shortcut.service.ts:172`, `:324-347`) is a capture-phase window keydown built on `keyCode` + modifiers, with no `isComposing`/229 check and no `event.code`. keyCode 229 matches no binding, so it is effectively IME-safe. It preventDefaults on a match. On Windows AltGr (ctrl+alt) matches nothing because no Windows Ctrl+Alt bindings exist. Keys are layout-dependent (EQUAL=187 and so on) and cover top-row digits only.
- Univer docs-ui input skips keydown during IME (`_isIMEInputApply`, `:1195`). The sheet tab bar uses React `onKeyDown` with `event.key` and no IME guard (`SheetBarTabs.tsx:390`).
- **prosemirror-view** skips keydown while composing (`index.js:3212`). **prosemirror-keymap** has an AltGr guard (`:111-113`).
- **CodeMirror view** `runHandlers` (`view/dist/index.js:9164-9228`) has an AltGr guard (`:9201-9203`) and no explicit isComposing check. Composition keys arrive as `key:"Process"` / keyCode 229, so it is implicitly safe.

## Unresolved

- Cell-editor arrow behaviour is decided in the sheets-ui editing render controller, which I did not read. The CSV has no `low` rows; the cell-editor rows are `medium` where they depend on that controller.
- Whether the sheets app overrides or shadows any Univer default (`create-univer.ts`, App.tsx handlers) is covered only by the A-part-sheets inventory.
- Native Ctrl+U in the markdown editor (see above) is unverified.
- `Mod-B` vs `Mod-Shift-b` and `Mod-Enter` precedence depend on runtime extension order. I did not run the editors.
- Electron: whether a given app menu really contains a role on a given OS is app code. Only the role defaults and the fork's role usage are recorded here.
- I did not run any app, so nothing here is observed at runtime. Everything is from source read.

## Downloads and housekeeping (all under `raw/`)

- `lib-src/` (~157 MB, untrusted, never executed, no scripts run):
  - `tarballs/` with the extracted `univerjs-preset-sheets-*-0.25.1`, `univerjs-sheets-ui-0.25.1`, `prosemirror-*`, `codemirror-*`, `electron-43.7.6` (npm wrapper only) and `pdfjs-dist-6.2.108`.
  - `univer-src/` — sparse clone of `dream-num/univer` at tag v0.25.1 (d70f347), `packages/*/src`.
  - `tiptap-src/` — sparse clone of `ueberdosis/tiptap` at v3.31.0 (v3.30.6 tag available for diffing), `packages/*/src/**`.
  - `electron-src/` — raw files at v43.7.6: `lib/browser/api/menu-item-roles.ts`, `menu-item.ts`, `docs/api/menu-item.md`, `shell/browser/ui/cocoa/electron_menu_controller.mm`.
- `univer-src/` and `tiptap-src/` contain nested `.git` directories. Do not `git add` `raw/lib-src/`; it is not meant to be committed. Delete it after review if disk is needed.
- `_univer.rows.csv` and `_others.rows.csv` are intermediates for the merge; `D-lib-defaults.csv` is the deliverable.
- Generator scripts (not product code, not in the repo) are in the session scratchpad: `gen-univer.mjs`, `gen-others.mjs`, `merge.mjs`.

## Files read

Fork (read-only):
- `package.json` files and `package-lock.json`.
- `apps/sheets/src/renderer/App.tsx`, `create-univer.ts`.
- `apps/docs/src/renderer/editor/extensions.ts`, `apps/docs/src/renderer/App.tsx` (`useEditor`, ~1249).
- `apps/markdown/src/renderer/editor/{extensions.ts,markdownStyleRenderers.ts,localImage.ts,blockKeymap.ts}`.
- `apps/html/src/renderer/source/cm-setup.ts`, `apps/markdown/src/renderer/source/PlainTextEditor.tsx`.
- `apps/pdf/src/renderer/PdfPage.tsx`.
- `packages/electron-utils/src/app-menu.ts`.
- `docs-main.ts`, `sheets-main.ts`, `slides-main.ts` and the shell `index.ts` (menu sections only).

D repo: `raw/COMMON.md`, `raw/D-lib-defaults.md`, `raw/A-fork-modules.out.md` ("Limits").

Library sources (under `raw/lib-src/`):
- Univer v0.25.1 `packages/{ui,sheets-ui,docs-ui,sheets-formula-ui,find-replace,sheets-filter-ui,sheets-drawing-ui}/src` (rows cite these) plus `core` (`instance.service.ts`) and the preset packages for the plugin list. The sort, table, note, data-validation and conditional-formatting plugins contributed no registered shortcut rows.
- TipTap v3.31.0 and v3.30.6 (diff) `packages/**/src`.
- `prosemirror-{gapcursor,tables,keymap,view,history}` dist.
- `@codemirror/{commands,search,autocomplete,language,view}` dist.
- `pdfjs-dist` `legacy/build/pdf.mjs`.
- Electron v43.7.6 `menu-item-roles.ts`, `menu-item.ts`, `menu-item.md`, `electron_menu_controller.mm`.
