# G3-05c — XLSX renderer port design (contract-first checkpoint)

> Status: design, pending Advisor go. No port code exists yet. This is the
> contract-first deliverable the brief (`g3-05c-xlsx-renderer.md`) requires
> before any code moves. Every number in section 1 was re-measured at the pin
> on 2026-10-02; the method is in section 9.

Issue UNI-824 (parent UNI-659). Source oracle: genoffice pin
`09485f884dc845cf3bf27fb7edfe489f9d457aad` (read-only,
`D:/.Vietants_Project/uniwork-workspace/genoffice`), Apache-2.0.

## 0. What this slice replaces

The shared XLSX editor (`packages/views/office/xlsx`, G3-05a UI + G3-05b real
loop) renders a plain HTML table over `XlsxWorkbookSnapshot` (cells:
`value`/`formula` only). The G3-D3 XLSX measurement
(`reports/g3-d3-xlsx/measure.md`, 7/7 rows over the proposed tolerance) names
exactly what the table cannot do, and all of it is read-model data:

| D3 finding | Cause in the current view |
| --- | --- |
| merges missing, custom column widths/row heights off, frozen panes missing | the snapshot carries no sheet layout |
| 2,247 number formats not applied in `styled2000` | `cellText()` prints the raw value; no format codes |
| formulas shown as `=…` text | `readBasicWorkbook` stores `{value: null, formula}` — and drops the cached `<v>` |
| 15 styled cells missing on `features` (2,260 structural mismatches on `styled2000`), CF not painted, numbers left-aligned | no styles/DXF in the model, no renderer |

Working parts that stay: the G3-05a editor shell and toolbar, the G3-05b save
loop (`XlsxSessionRuntime` → `XlsxFormatAdapter` → shared coordinator →
`edit:xlsx` gateway assemble + native recalc → upload/commit), the capability
gating, the draft/recovery hooks, and the i18n halves already in
`packages/core/i18n/locales`. The port replaces the render surface and widens
the open model; it does not fork the seam (web documents page and the desktop
host adapter mount the same `XlsxEditor`).

## 1. Inventory at the pin (measured)

### 1.1 Modules

`apps/sheets/src/renderer/` at `09485f88` (line counts include blank lines):

| Area | Files | Lines | Note |
| --- | ---: | ---: | --- |
| root `*.ts`/`*.tsx` | 145 | 58,976 | plus `styles.css` 5,598 and `index.html` inside 147 root entries / 64,590 lines |
| `ai/` | 33 | 6,129 | all out of scope (G6 + brief) |
| `i18n/` | 65 | 37,491 | genoffice's own runtime; excluded as in g3-04c |
| `assets/` | 14 | (PNG binaries) | icons; excluded |
| **total** | **259** | **108,447** | |

Coupling of the 145 root `ts/tsx` files (import scan):

| Bucket | Files | Lines |
| --- | ---: | ---: |
| imports `@univerjs/*` | 75 | 42,498 |
| no edge to Electron/i18n/UI/AI/main (Univer imports allowed) | 83 | 14,145 |
| of which Univer-only (no other external edge) | 52 | 9,411 |
| purely coupling-free (no Univer either) | 31 | 4,734 |
| imports `window.desktopApi` | 13 | — |
| imports genoffice i18n (`@genoffice/i18n`, `./i18n/locale`) | 47 | — |
| imports `@genoffice/ui` (plus `electron-utils` once) | 16 (+1) | — |
| imports `../main`/`../shared` paths | 29 | — |
| imports `@fluentui/react-icons` | 2 | — |
| imports `node:*`/`electron` (root `env.d.ts` consumes Electron types) | 3 | — |

Closures over local imports (same counter):

- **Univer closure (upper bound): 142 of 145 files, ≈58.9k lines** — seeding
  from every `@univerjs` importer drags in `App.tsx`, `ExcelShell.tsx`, every
  dialog/panel and the ribbon (they are all reachable through `univer-sync`).
- **Grid/edit/save core (17 seeds incl. `univer-sync`, `edit-journal`,
  `op-executor`, `workbook-ops`, `save-actions`, `univer-state`): 56 files,
  ≈31.6k lines** — still pulls visuals/pivot/chart UI (`WorkbookVisuals`
  4,975, `plan-operations`, `pivot-actions`, `PivotDialog`…).

External edges out of the Univer closure (import count): `@univerjs/*` 176 ·
`@genoffice/xlsx-gateway/*` **112 (already vendored)** · `react` 36 · relative
paths leaving the renderer (`../main`, CSS, …) 25 · `@genoffice/ui` 16 ·
`@genoffice/agent-core` 9 · genoffice i18n 6 · `@genoffice/docx-engine` 3 ·
`@fluentui/react-icons` 3 · `zod` 3 · `@genoffice/ai-provider` 3 ·
`@genoffice/pptx-render` 1 · `@genoffice/electron-utils` 1 · `rxjs` 2 ·
`react-dom` 4.

### 1.2 Proposed vendored subset (AC-1)

Following the g3-04c lesson (its sections 3b–3f): the proposal is the
**Univer integration closure, trimmed**, not the whole renderer; the exact
file list is confirmed **file-by-file** at vendor time against the three
criteria (licence at the pin, no `/ee`, no Node/Electron-only import), and
every file that cannot pass comes back as a named question — the same rule the
Advisor set for g3-04c 3f. Working estimate: **~40–56 files, ~20–32k lines**,
being the seed closure minus the UI chrome in section 2 that the closure only
reaches through `univer-sync` imports.

The vendored files keep genoffice's import paths; four seams are UniWork code
(not vendored, documented in section 4):

- `@genoffice/xlsx-gateway/*` → the **already-vendored**
  `packages/office-upstream/upstream/packages/xlsx-gateway` (built artifact +
  build-upstream alias, exactly like the docx lane's `@genoffice/docx-engine`).
- `./i18n/locale` → locale shim delegating to i18next under
  `office.xlsx.editor.*` (the g3-04c 3d pattern; vi/en keys additive).
- `../shared/desktop-api` → `apps/sheets/src/shared` **is already vendored**;
  the renderer imports its types/schemas for the workbook payload shapes. The
  host bridge (section 4) produces those shapes from UniWork data, so the
  ported code needs no reshaping.
- `window.desktopApi` → host bridge (open/range/recalc/save replaced by the
  G3-05b loop; the sidecar never appears in the browser).

New UniWork build pieces, mirroring g3-04c: `scripts/office/build-xlsx-browser.mjs`
(esbuild artifact `packages/office-upstream/dist/xlsx-renderer.mjs` +
build record), a stylesheet repackaging step scoped to the grid mount, the
locale shim, the fail-loud patch checks (patch apply + reverse check + patched
symbols in the artifact) and the artifact symbol assertions.

### 1.3 Package dependencies (to add to the workspace catalog)

The renderer imports 31 distinct `@univerjs/*` specifiers across the **15
`@univerjs/*` packages `apps/sheets/package.json` declares** (`^0.25.1`;
`sheets`, `sheets-ui`, `sheets-formula`, `docs*`, `engine-formula`, `ui` and
`design` arrive transitively). The install closure
in the lab bootstrap is **48 `@univerjs/*` packages**: 46 Apache-2.0,
`@univerjs/icons` MIT, and `@univerjs/telemetry`, whose `package.json` license
field is empty but whose `LICENSE` and per-file headers are Apache-2.0 (3 KB;
it is a DI identifier only, no sender — recorded here because the brief
excludes telemetry). No `@univerjs-pro/*` or `@univerjs-infra/*` is present;
the presets meta-package that drags 27 proprietary packages stays out (the
pin's `create-univer.ts` already depends on the individual presets for that
reason, and the port keeps that property).

Measured weights in the same install (ESM `lib/es` only, gzip level 9):
**48 packages, 24,611,276 B raw / 4,406,561 B gzip concatenated**; heaviest:
`sheets-formula` 7.57 MB (1.11 MB gz), `engine-render` 6.82 MB (1.29 MB gz),
`sheets-ui` 1.99 MB (0.50 MB gz); Univer CSS 24 files / 284,970 B raw.
Third-party transitives also enter: `rxjs` 1.31 MB (204 KB gz), `lodash-es`
632 KB (123 KB gz), `nanoid`, `ot-json1`, `rbush`, `kdbush`, `fast-diff`,
`async-lock`, `numfmt`, `@wendellhu/redi` (all permissive; each verified in
the lockfile review). `rxjs` and friends are **new catalog entries** — this is
one of the go/no-go questions (section 8).

### 1.4 Phase-1 close-out (AC-1, after the Advisor go)

Confirmed at vendor time, file-by-file (the build reaches every file, so the
list is the real runtime closure, not the estimate):

- **Vendored renderer subset: 34 files** under
  `apps/sheets/src/renderer/` — `univer-sync.ts`, `univer-state.ts`,
  `create-univer.ts`, `edit-journal.ts`, `view-transform.ts`, `numfmt-fix.ts`,
  `cell-font-fallback.ts`, `app-constants.ts`, `calc-options.ts`,
  `selection-format.ts`, `undo-carry.ts`, `protected-ranges.ts`,
  `filter-range-outline.ts`, `formula-*.ts` (5), `autofit-*.ts` (2),
  `rtl-grid-mirror.ts`, `rtl-text-fix.ts`, `rich-text-bidi-fix.ts`,
  `merge-border-fix.ts`, `thick-border-fix.ts`, `cell-clip-anchor-fix.ts`,
  `center-continuous.ts`, `long-text-render.ts`, `number-as-text-alert.ts`,
  `load-perf-patches.ts`, `chart-sync-pending.ts`, `cf-formula-fold.ts`,
  `cf-thresholds.ts`, `shared-formula-journal.ts`, `formula-stream-hold.ts` —
  plus the two Carlito faces (`packages/ui/src/fonts/Carlito-{Regular,Bold}.ttf`,
  SIL OFL) and the OFL text (`apps/docs/src/renderer/fonts/LICENSE-OFL.txt`).
  `vendor-upstream --check --source <pin>` green, pinned-tree blob check green.
- **Artifact**: `packages/office-upstream/dist/xlsx-renderer.mjs` —
  **14,115,703 B raw / 3,761,066 B gzip**, react/react-dom/i18next external,
  Univer bundled, 9 Univer stylesheets repackaged under `@scope
  (.xlsx-surface)` (global resets cannot leak), Carlito Regular+Bold inlined
  as data URLs. Build: `scripts/office/build-xlsx-browser.mjs` with fail-loud
  patch checks (0001 `xfIdentity`, 0002 `lazilyLoadedXmls`) and artifact
  symbol assertions; a new `build-xlsx-browser.test.mjs` + 
  `xlsx-renderer-styles.test.mjs` cover it (office scripts 42/42).
- **Shims (UniWork code)**: `shims/xlsx-renderer/controller.ts` (the mount
  controller and `window.desktopApi` host bridge),
  `shims/xlsx-renderer/locale.ts` (the `./i18n/locale` seam; 17
  `office.xlsx.editor.*` keys added to en/vi), and two scope-boundary shims:
  `workbook-visuals.ts` (visuals/charts/shapes install as no-ops — the
  approved render scope) and `advanced-filter-dialog.ts` (typed refusal).
- **Dependencies**: 21 individual `@univerjs/*` 0.25.1 packages + `rxjs` +
  `numfmt` pinned once in the catalog; `packages/office-upstream` declares
  them. `pnpm audit --audit-level high` **clean** after a
  `nanoid@>=4.0.0 <5.1.16 → 5.1.16` override (GHSA-28wg-ghj8-5hjv) in the
  root `package.json` `pnpm.overrides`; knip clean; `check-boundaries` green.
- **Deviations from the estimate above**: the visuals/charts subgraph is
  shimmed rather than vendored (it was in the closure only through
  `univer-sync`'s install calls), which is why the subset is 34 files rather
  than the 40–56 estimated; the Carlito faces come from
  `packages/ui/src/fonts` (the pin's sheets font path), not the docs font
  directory.

## 2. Excluded, and why

| Excluded | Reason |
| --- | --- |
| `ai/` (33 files, 6,129 lines), `mcp-bridge.ts` | AI/agent scope is G6; the brief excludes it. |
| `i18n/` (65 files, 37,491 lines) | genoffice's own i18n runtime is incompatible with i18next + `vi.json`/`en.json` (as g3-04c section 2). A locale shim replaces the import path. |
| `assets/` PNGs, `icon-catalog.ts`, `ribbon-icons.tsx` | Icons come from `packages/ui` + lucide per UI Rules. |
| `App.tsx`, `ExcelShell.tsx`, `ribbon-actions.ts`, every `*Dialog.tsx`/`*Panel.tsx`, `ChartPanels.tsx`, `WorkbookVisuals.tsx`, `cross-highlight.tsx`, `ColorDropdown.tsx`, `toast*`, `ScreenshotDialog`, `RecoveryDialog` | UI chrome coupled to genoffice CSS/i18n/`window.desktopApi`; **design reference only**, rebuilt on `packages/ui` primitives + the existing `XlsxToolbar` (the docx `components/` precedent). |
| `print-*.ts`, `csv-export.ts`, `page-break-preview.tsx`, page-layout/header-footer dialogs | Print/CSV are out of this slice; export stays the capability map's `engine-gap` row, and a command that cannot run is not rendered enabled. |
| `main.tsx`, `env.d.ts`, `../main/*`, `../shared/ipc-channels.ts` | Electron bootstrap and main-process IPC; the XlsxEditor mount and host bridge replace them. The sidecar client stays server-side in `packages/office-engine`. |
| `mcp-bridge`, `ScreenshotDialog`, AI transport | G6 / not Office. |
| genoffice fonts, branding, `styles.css` (5,598 lines) | Brand/typography are UniWork's; Univer's own CSS is scoped under the mount root. |
| charts, pivots, slicers, timelines, sparklines, shapes, OLE visuals, protection, data-validation editing, conditional-formatting editing | capability map keeps them `engine-gap`; render-only where the model carries them, never an enabled dead button. |

## 3. Workbook model mapping onto the G2 xlsx-gateway

### 3.1 genoffice's model

The Rust sidecar owns a resident session per workbook. Main asks it for the
open payload (`WorkbookFile`: sheets metadata, `styles[]`, `dxfStyles`,
visuals, theme palette/fonts, protections, defined names) and then streams
viewport windows (`read_range` → cells with value/formula/styleIndex/rich runs,
row heights/hidden/outline, merges, hyperlinks, CF rules, DV, autoFilter, page
setup). The renderer installs each window into Univer (`univer-sync.ts`,
7,506 lines) with `LazyWorkbookState` bookkeeping, eviction and two formula
modes: small workbooks hand formulas to Univer's engine for live recalc; large
ones stream cached values and fall back to the sidecar (IronCalc) for recalc
overlays. Edits are journaled (`edit-journal.ts`, 2,221 lines) and a save
sends the journal to main, which lets the sidecar rewrite the package with
untouched parts preserved.

### 3.2 The G2 model today

One-shot service jobs (`apps/office-engine`): `open:xlsx` parses bytes with the
browser-safe vendored gateway (`readBasicWorkbook` — cells only; formula cells
get `{value: null, formula}`, the cached `<v>` is dropped today) and returns
`{document_model, snapshot}` JSON; `edit:xlsx` re-opens the bytes, applies the
bounded op list, recalculates through the **server-side** Rust sidecar
(`recalc_cells` only), assembles through `applyCellEditsToXlsx`, asserts
`assertOnlyTouchedEntriesChanged`, and returns the new bytes. The browser keeps
a mirror snapshot and applies the same ops locally (`xlsx-runtime.applyEdits`);
Save is serialize → upload → commit through the shared coordinator. No state
crosses jobs (the sidecar is killed in `finally`).

### 3.3 The port mapping — in-browser model + gateway patch ops

**Decision (the brief's central question): the browser holds the workbook
model, and edits never round-trip to a gateway. Only Save does.** Concretely:

- **Open/read.** The G2 engine produces one **render model** per open: values
  **and cached formula results** (the D3 “formulas shown as text” fix needs the
  cached `<v>` the basic read drops), styles (fonts/fills/borders/alignment/
  wrap/numFmt + theme palette), merges, column widths, row heights/hidden,
  frozen panes, hyperlinks, and — when the closure needs them — CF rules, DV
  and autoFilter. The model is delivered through the existing `open:xlsx` job
  payload (today ≤16 MB, `xlsx_open_model_too_large` otherwise) as an additive
  field next to `snapshot`, so G3-05b’s value snapshot and probing stay the
  session baseline. Virtualisation windows are then served **from the
  in-browser model** (section 5), not by service calls.
- **Edit.** Univer mutates the in-browser model. The ported edit journal
  yields `WorkbookCellEdit`-shaped rows; the host bridge maps them to the G2
  wire ops and calls `editor.edit(ops)` — the existing browser mirror path
  (`xlsx-runtime.applyEdits` + `markDirty()`), which already exists for the
  formula bar. Nothing is sent to the service per edit.
- **Recalculate.** Unchanged and server-only: G3-05b's recalc port (IronCalc
  sidecar) runs inside the save job; the browser never evaluates a formula for
  the file. Univer's own engine may recalc small workbooks **for display**
  (genoffice's formula mode), exactly as genoffice does; display results never
  become the saved `<v>`.
- **Serialize.** Unchanged G3-05b path: coordinator → `edit:xlsx` (open bytes
  → apply ops → recalc → assemble → `assertPreserved`, patch 0001 + 0002) →
  upload → commit. Patches stay in the build series; the browser never sees
  the sidecar.
- **After save.** The job returns the new bytes and the adapter rebases; the
  browser refreshes its mirror from the returned snapshot (or re-reads the
  saved bytes with the same G2 reader) so recalculated dependents — including
  cross-sheet (patch 0002) — display without a reopen.

**Op vocabulary** (the bound set is `set_cell` / `clear_cell` / `set_cells` in
`packages/office-engine/src/xlsx/ops.ts`):

| Univer journal event | G2 op |
| --- | --- |
| set value | `{op:"set_cell", target:{sheet,cell}, attributes:{value}}` |
| set formula | `{op:"set_cell", target:{sheet,cell}, attributes:{formula:"=…"}}` |
| clear | `{op:"clear_cell", target:{sheet,cell}}` |
| clear/format range | `set_cells` with range + attributes |
| format change (numFmt/font/fill/border/alignment) | `set_cell` with `style` (opaque `WorkbookStyleEdit`); `styleReset` for clears |

Merges, row/column insert/delete, sheet rename and chart/pivot edits are **not
in the bound vocabulary**: this slice renders them read-only and leaves their
commands capability-gated (no dead buttons), matching the capability map.
Structural editing is a later slice that must extend the op vocabulary first.

### 3.4 Read-model source — the one open engineering choice

Three placements produce the rich model; the checkpoint recommends **A**, with
**B** as the named fallback for oversized models:

- **A (recommended): extend the G2 gateway lane's read** — a new reader module
  in `packages/office-engine/src/xlsx` built on the already-vendored gateway's
  exported primitives (`readBasicWorkbook`, `createBufferEntrySource` via
  `readEntryText`, `parseStylesheetFormats`, `parseSheetElements`,
  `parseRelationships`, CF/DV helpers), delivered through the existing
  `open:xlsx` payload. Browser-safe by construction, one model contract for
  service and browser (the adapter's own rule), no new job ops, no resident
  state, no second OOXML parser. Cost: the reader’s style/layout fidelity must
  be verified against the source oracle (AC-5 already does this structurally).
- **B (fallback for large workbooks): the same reader in a web worker** —
  the browser already downloads the bytes (`documents.read()` in
  `xlsx-adapter.tsx`); the worker parses and the service keeps the value
  snapshot/probe job for session authority. No 16 MB transfer, same contract.
  Cost: browser CPU and a worker lifecycle to own.
- **C (named, not recommended): sidecar-backed read jobs** — the sidecar is
  the exact D3 oracle (`open`/`read_range` already exist in the Rust binary,
  only `recalc_cells` is bound in `packages/office-engine/src/node`). Maximum
  parity, but it means resident sidecar sessions across one-shot jobs (the
  service's isolation rule) or re-opening per window, plus a second read
  model in G2. Only if A/B both fail the D3 structural comparison.

### 3.5 Capability rows this slice touches

`xlsx-open`, `xlsx-edit-cells`, `xlsx-save`, `xlsx-recalculate`,
`xlsx-cross-sheet-formulas`, `xlsx-native-sidecar-build` stay `supported` and
gain render evidence; `xlsx-charts`, `xlsx-conditional-formatting`,
`xlsx-data-validation`, `xlsx-pivot`, `xlsx-protection`, `xlsx-export-pdf`,
`xlsx-macro-preserve-not-execute` stay `engine-gap` — rendered read-only where
the model carries them, never an enabled command.

## 4. Host seam (`EditorHandle` / `OfficeSaveTransport` / i18n / theme; reuse G3-05b)

- **`XlsxEditor` props stay**: `documentKey`/`editor`/`open`/`coordinator`/
  `capability`/`permissions`/`onSelectionChange`. The HTML table is replaced by
  the mounted renderer; `types.ts` gains the render-model channel and keeps
  `XlsxSelection` (sheet + A1 + endAddress) as the host-visible selection.
- **`EditorHandle`**: `open`/`dispose` drive Univer create/destroy per
  `documentKey`; `undo`/`redo` map to Univer's undo service with the ported
  `undo-carry` semantics and load-time journal suppression (so opening a
  workbook never "has undo"); `getDirtyGeneration` reads the journal revision.
  `captureSnapshot`/`getWorkbookSnapshot`/`subscribeSnapshot` keep the
  **value/formula** shape so `editor-host-core` drafts, checkpoints and
  recovery stay untouched.
- **`OfficeSaveTransport`**: unchanged. The bridge only has to keep
  `editor.edit(ops)`/`markDirty()` flowing; the toolbar Save button and
  Ctrl/Cmd+S keep calling the coordinator (`serialize` → upload → commit).
- **Selection/clipboard/recalc ports**: selection ↔ Univer's selection service
  (active sheet + A1 range), clipboard ↔ Univer clipboard with the existing
  permission gates, `XlsxRecalcController` unchanged (progress/cancel map to
  the job cancel).
- **i18n**: locale shim + additive `office.xlsx.editor.*` keys (vi first per
  `docs/conventions.md` §2); the vi/en parity check stays in the gates.
- **Theme**: a token bridge maps UniWork semantic tokens (light/dark) onto the
  Univer theme; the surface uses `bg-background`/`text-foreground`/borders and
  must flip with the app theme (D3/AC-2 screenshot evidence). Univer CSS is
  scoped under the mount root so it cannot leak into the shell.
- **Desktop**: the same component and adapter seam; the desktop shell loads
  the web surface (G4-06a pattern) — no second editor, no forked port.
- **Drafts**: unchanged, because the snapshot mirror is. A dirty generation
  from the journal keeps the 2 s local checkpoint and the no-autosave rule.

## 5. Virtualisation strategy

genoffice streams: `read_range` windows per viewport with
`loadedRanges`/eviction, a preload pass, a formula-closure mode for small
sheets and cached-value streaming for large ones. The port keeps the
**windowed install/evict design** (the `LazyWorkbookState` machinery ports,
section 1.2) but the window source is the in-browser model, so a scroll costs
no network round trip:

- viewport row bands install into Univer as the user scrolls; rows outside the
  window are evicted (per-sheet loaded-range bookkeeping), so a 20k×10 sheet
  never materialises 200k live cells;
- the D3/G3-05b large fixtures must open in a session and scroll without the
  DOM-table failure modes (05b: 30k rows → 660k DOM nodes / 300k buttons /
  273 MB heap / 65 s open / Save 200 in 91.6 s, then the runner stalled; D3
  `large`: 33 s open, the first Save was not confirmed and a second attempt
  crashed the tab). Target: match genoffice’s session behaviour; the number is
  measured in AC-5, not claimed here;
- formula mode: small workbooks may install formulas for live display recalc;
  large workbooks stream cached values and rely on the save-time service
  recalc. Which side of the split a workbook lands on is recorded per open.

## 6. Bundle-size estimate

Measured today (section 1.3): the Univer ESM closure alone is **24.6 MB raw /
4.4 MB gzip** across 48 packages, plus 285 KB CSS; the renderer subset
(~40–56 files, 20–32k lines) adds roughly 0.6–1.0 MB raw / 150–250 KB gzip of
UniWork code; third-party riders ≈ 350 KB gzip (rxjs + lodash-es + small ones).
Expect a **lazy chunk in the 3–5 MB gzip / 12–18 MB raw** order; Univer's
plugins are side-effectful, so minification and tree-shaking will not cut this
to a fraction.
This is an estimate; AC-4 measures it exactly like g3-04c
(`scripts/bundle-budget.mjs`, per-route first-load sets, documents +
documents/[documentId] routes, DOCX-style membership proof that the chunk is
*not* in first load). Mitigations: individual preset packages (never the
meta-package), feature-flag mount, route-lazy chunk, no first-load entry.

## 7. Acceptance mapping

- **AC-1** vendoring: SELECTION + `source-manifest.json` allowlist, provenance
  (`vendor-upstream --check` plus `--source` pinned-tree check), ATTRIBUTION
  files already in place, `check-boundaries` (no `/ee`, browser isolation),
  knip, fail-loud patch checks and artifact symbol assertions — the g3-04c
  machinery reused, with the Univer dependency audit added.
- **AC-2** render: the real fixtures (section 9.3) with styles, merges, frozen
  panes, widths/heights, number formats and multiple sheets; cell/formula
  edits + undo/redo; real toolbar/formula-bar commands; vi/en; light/dark.
- **AC-3** save round trip: edit → Save (button and shortcut) → reopen shows
  the edit and recalculated dependents incl. cross-sheet (patch 0002);
  untouched parts keep the G3-05b digests.
- **AC-4** web host: lazy chunk out of documents/library first load; visual
  Tester open → edit → Save → reopen with light/dark screenshots + Jev.
- **AC-5** re-measurement into `reports/g3-d3-xlsx-r2/` against the pin with
  the same method; no fidelity pass is claimed; the user signs.
- **AC-6** gates: typecheck/lint/test for touched packages + coverage floors,
  web build, node --test scripts, `pnpm audit --audit-level high`, 500-line
  rule, desktop checks if the editor API changes.

## 8. Open questions (go/no-go gate)

1. **Read-model source.** Confirm **A** (G2 gateway-lane rich read through the
   existing open payload) with **B** (browser worker, same reader) as the
   fallback for oversized models — or direct otherwise (C is named above with
   its cost). This is the only design fork that changes the port's shape.
2. **Scope.** Confirm AC-2 edit scope = cell value/formula + style edits inside
   the existing bound op vocabulary; structural edits (merges, row/column
   changes, sheet rename), charts/pivots/visuals/protection/print/export stay
   render-only or `engine-gap` in 05c (no dead buttons).
3. **Dependencies + bundle.** Approve the `@univerjs/*` 0.25.1 catalog addition
   (+ rxjs/lodash-es and the rest of the Univer runtime closure) under
   `pnpm audit --audit-level high`, and a lazy-chunk budget: is ~3–5 MB gzip
   acceptable if documents first-load is unchanged?
4. **Fonts/metrics.** The grid's column widths and row auto-fit depend on the
   normal-font metrics (Calibri/Carlito aliases; `cell-font-fallback.ts`,
   `autofit-line-pitch.ts`). Confirm UniWork ships the OFL Carlito faces for
   the grid, or accepts host-font substitution as a measured fidelity class
   (the docx lane excluded branded fonts). The D3 `upstream-limit` finding
   (genoffice column widths = chars×8 vs Excel chars×7+5) also needs a
   confirmation that parity-with-genoffice, not Excel-correct widths, is the
   AC-5 basis.
5. **Fixture ownership.** Confirm the D3 fixture set (`features.xlsx`,
   `styled2000.xlsx`, `large.xlsx`) plus the G0 sheets fixtures and the 05b
   `composite-seed.xlsx` are the AC-2/AC-3 corpus, and whether `large` must
   open in the ported editor for AC-2 or only in AC-5.

## 9. Method, fixtures and current evidence

1. Counts: PowerShell/Node walks over the pin checkout (`Get-ChildItem` +
   per-file line counts; import graphs via a Node closure script over
   `from '…'`). Weights: Node 22.23.2 `zlib.gzipSync` over the bootstrap
   install `.uniwork-dev/office-g0/bootstrap-source/node_modules/@univerjs`
   (pinned lockfile install), ESM `lib/es` only.
2. G3-D3 / G3-05b numbers quoted from `reports/g3-d3-xlsx/measure.md` and
   `reports/g3-05b-xlsx-real-loop/acceptance.md` (unchanged by this doc).
3. Fixtures for AC-2/AC-3: G0 sheets corpus
   (`docs/office/g0/fixtures/files/sheets/`: kitchen-sink 5,046 B,
   satellite-sheets 3,933 B, vietnamese 4,953 B, chart 4,440 B, pivot 6,880 B,
   protected 3,489 B, macro 3,912 B, compatibility ×3, legacy-xls 13,824 B);
   G3-05b `composite-seed.xlsx` 7,503 B (3 sheets, cross-sheet formulas, CF,
   pivot); G3-D3 `features.xlsx` 4,031 B, `styled2000.xlsx` 97,790 B,
   `large.xlsx` 1,059,920 B (20k×10).

No port code is written until the Advisor answers section 8.
