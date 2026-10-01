# G3-04c — DOCX renderer port design (first checkpoint)

> Status: design, pending Advisor go. No port code exists yet. This doc is the
> contract-first deliverable the brief (`g3-04c-docx-renderer.md`) requires before any
> code moves.

Issue UNI-823 (parent UNI-659). Source oracle: genoffice pin
`09485f884dc845cf3bf27fb7edfe489f9d457aad` (read-only,
`D:/.Vietants_Project/uniwork-workspace/genoffice`), Apache-2.0.

## 1. What is already in place (reuse, do not re-vendor)

`packages/office-upstream` already vendored `packages/docx-engine` and
`packages/font-metrics` from the same pin (see `provenance.json`
`selection`). `packages/office-engine/src/docx/` (403+282+160+133+113+105+8
= 1204 lines) is the **G2 public DOCX engine**, already built on that vendored
code:

- `docx/model.ts` — the editable session model. An `open()` produces a
  `DocxParsed` (an ordered list of `DocxBlock`s, each either `original`
  with a `docxIndex` or a generated/replacement block) plus two derived
  sets: `visibleIndexes` (every legal original block a save plan may draw
  from) and `editableIndexes` (the text-editable paragraph subset).
  Edits are a typed op log (`DocxEdit`): `set_paragraph_text`,
  `insert_generated`, `replace_block_xml`, `insert_xml`, `insert_image`,
  `insert_chart`, `remove_block`, `set_header_footer`, `set_title_pg`,
  `set_even_odd_headers`.
- `docx/engine.ts` — `DocxParsed`/`DocxGeneratedBlock`/`DocxSaveBlock`/
  `DocxSaveOptions` types and the parse/save primitives (`DocxEngineError`).
- `docx/adapter.ts` — wires the model onto `OfficeHostAdapter`
  (`packages/office-contracts/src/host-adapter.ts`): read/write/asset ports,
  the typed refusal set (`unsupported`/`unbound`/`policy`/`failed`), never a
  silent fallback.
- `docx/assets.ts`, `docx/password.ts`, `docx/vendor.ts` — asset
  resolution, the encrypted-open path (today a typed refusal, matches
  `CAP-docx-encrypted-open: pending-04b` in `docx-capability-map.md`), and
  the thin call into the vendored docx-engine.

**This answers the brief's central design question**: the renderer edits an
**in-browser model** (`DocxParsed` + `DocxEdit` plan) and serializes through
the G2 engine's own save plan (paragraph-patch: unedited blocks are kept
byte-identical, only touched blocks are regenerated) — there is **no server
sidecar** for DOCX editing, unlike XLSX (G3-05b) which needed the Rust
sidecar for recalculation. `saveDocx` runs in the browser via
`packages/office-engine/src/browser/index.ts`.

`packages/views/office/docx/` (04a) already has the host-facing shell:
`docx-editor.tsx`, `docx-toolbar.tsx`, `docx-error-state.tsx`, `types.ts`.
It already:
- consumes `EditorHandle<TSnapshot>` from `@uniwork/core/office` (open/undo/
  redo/dispose/getDirtyGeneration) and a `DocxSaveCoordinator`
  (`getState`/`subscribe`/`save`/`cancel`/`markDirty`/`checkpoint`) — the G3-01
  save coordinator contract;
- gates editing on a `capability` row (`operation === "serialize"` and
  `status === "available"`); never renders a Save control otherwise;
  blocks tracked in `docx-capability-map.md` (`pending-04b`) refuse honestly;
- renders only `office.docx.surface.ready` — **the placeholder this lane
  replaces**. No paragraphs, runs, headings, lists, tables, images,
  headers/footers or pagination render today; the toolbar's undo/redo/save
  wiring is real but there is no document surface for it to act on.
- `i18n`: `office.docx.*` keys already exist in both locales
  (`packages/core/i18n/locales/{en,vi}.json:~6863/~6857`) for the shell
  states; new editor-surface keys (toolbar labels, heading/list commands)
  are additive under the same namespace, vi first per `docs/conventions.md` §2.

So G3-04c is **not** a vendoring task (AC-1's "vendored renderer subset" is
mostly already satisfied by G2) — it is porting the **editing surface**: the
TipTap/ProseMirror schema and the commands/components that bind a
`DocxParsed` session to an editable DOM and emit `DocxEdit`s, replacing the
placeholder `<p>{t("office.docx.surface.ready")}</p>` in `docx-editor.tsx`.

## 2. Inventory: genoffice renderer modules considered for porting

Counted at the pinned commit, `apps/docs/src/renderer/` (Apache-2.0,
`NOTICE` already in `packages/office-upstream/`):

| Module | Files | Lines (ts/tsx) | Decision |
| --- | ---: | ---: | --- |
| `editor/` | 57 | 24,485 | **Port, trimmed.** TipTap extensions + conversion (`convert.ts`) + layout (`pagination-*.ts`, `column-layout.ts`) + marks/format commands. This is the bulk of the work. |
| `components/` | 33 | 18,616 | **Port, trimmed.** Ribbon tabs, dialogs, panels. Many (AiAskPopover, CommentsPanel pending G6/`pending-04b`, ComparePanel, EquationModal, PaginationPreview, PasswordDialog) map to `pending-04b` capability rows or excluded scope — ported later or not at all. |
| top-level files (`App.tsx`, `doc-*.ts`, `pagination*.ts`, `numbering-actions.ts`, `review-actions.ts`, `embedded-fonts.ts`, `font-check.ts`, `font-list.ts`, `system-fonts.ts`, `word-count.ts`, `shortcuts.ts`, `headless-export.ts`, `html-export.ts`, `file-actions.ts`, `mcp-bridge.ts`, `print-*.ts`, `spellcheck-pref.ts`) | 40 | n/a (mixed) | **Split**: doc-state/doc-dirty/doc-cache/pagination/numbering/font-check/font-list/word-count/embedded-fonts are editor-model glue — port, adapted to the G2 model and `EditorHandle` instead of genoffice's own `doc-state.ts`/Electron main process. `file-actions.ts`, `mcp-bridge.ts`, `headless-export.ts`, `html-export.ts`, `print-*.ts`, `spellcheck-pref.ts` are Electron-main-process or AI-adjacent — **excluded**. |
| `i18n/` | 68 | 27,399 | **Excluded entirely.** This is genoffice's own i18n runtime (`strings*.ts`, `locale.tsx`) — incompatible with the repo's i18next + `vi.json`/`en.json` convention (`docs/conventions.md` §2). Only the English copy is a reading reference, never ported as code. |
| `ai/` | 25 | n/a | **Excluded** (brief: AI/agent features are G6 scope). |
| `zotero/` | 2 | 797 | **Excluded** (citation manager integration, out of scope). |
| `fonts/` (TTF/WOFF2 binaries + `fonts.css`) | 33 | n/a (binary) | **Excluded from the port.** These are genoffice/branded fonts (Caladea, GenOffice Poppins/Gothic subsets). UniWork's design tokens (`packages/ui/styles/tokens.css`) own typography; G3-D3 fidelity measurement may need a subset of these as *test fixtures only* (not shipped), flagged to the Advisor as a decision, not assumed. |
| `assets/` (PNG icons) | 16 | n/a (binary) | **Excluded.** Icons come from `packages/ui` registry primitives per UI Rules; genoffice's file-type PNGs are not used. |

Grep check: no direct `electron`/`node:fs`/`node:path` import in `editor/` or
`components/` (0 hits) — consistent with the brief's "browser entry must not
resolve Node/Electron/native." Files that DO cross into Electron main
(`file-actions.ts`, `mcp-bridge.ts`) stay excluded; this needs re-verifying
file-by-file during the actual vendor-upstream selection, not assumed from
a single grep.

**Dependencies the editor module needs** (from `apps/docs/package.json`,
Apache-2.0/MIT, already common in the JS ecosystem): `@tiptap/core`,
`@tiptap/pm`, `@tiptap/react`, `@tiptap/extensions` (ProseMirror-based rich
text), `opentype.js` (already covered by vendored `font-metrics`). Excluded:
`marked` (markdown export — G6/engine-gap), `officecrypto-tool` (encrypted
docx — `pending-04b`/`CAP-docx-protection`, `CAP-docx-encrypted-open`),
`jsdom`/`electron`/`electron-vite`/`electron-builder` (build/test tooling for
genoffice's own Electron shell, not applicable — UniWork's web host is
Next.js, desktop host is `apps/office-desktop`).

### Estimated vendored subset for this lane

Trimming `ai/`, `i18n/`, `zotero/`, `fonts/`, `assets/`, and the
Electron-main-process top-level files from the raw renderer inventory:

- `editor/` (57 files, ~24.5k lines) + `components/` (33 files minus the
  AI/compare/comment/password/equation pieces deferred to `pending-04b`,
  roughly 20 files, ~12k lines) + ~15 top-level glue files (~4k lines,
  estimate — not individually counted yet) ≈ **~95 files, ~40k lines** entering
  `packages/office-upstream` as the AC-1 vendored subset, on top of the
  1,204-line G2 docx engine that is already in.
- `@tiptap/*` packages add roughly 150-250KB gzipped to the web bundle
  (ProseMirror core + tiptap react bindings), based on published package
  sizes; this needs confirming with an actual `next build` bundle-analyzer
  run once the port lands, not assumed from package.json alone.

This is a rough estimate for the checkpoint, not a selection list — the
actual `scripts/office/vendor-upstream.mjs` `SELECTION` addition will be
file-exact and go through `vendor-upstream --check` (AC-1), same as the
existing docx-engine/font-metrics entries.

## 3. Host seam this lane plugs into

- `EditorHandle<TSnapshot>` (`@uniwork/core/office`) — open/dispose/undo/
  redo/`getDirtyGeneration`. The TipTap `EditorView` instance's undo/redo
  stack (`@tiptap/extensions` history, or ProseMirror's own) backs
  `editor.undo`/`editor.redo`; `getDirtyGeneration` reads off the PM
  transaction count or a dedicated counter bumped on every applied
  `DocxEdit`.
- `OfficeSaveTransport` / `DocxSaveCoordinator` — G3-01's save coordinator is
  reused as-is (`docx-editor.tsx` already wires it); this lane's only
  obligation is to call `coordinator.markDirty()` on every edit and produce
  a `StableSnapshot` the coordinator can hand to G2 `saveDocx`.
- `DocxSelectionPort` (`types.ts`) — maps a PM selection (`from`/`to`,
  nearest block id) to `DocxSelection`; already typed, needs a real adapter
  instead of today's unset `editor.selection`.
- i18n / theme tokens — no new infrastructure; additive keys under
  `office.docx.*`, semantic Tailwind classes already used in
  `docx-editor.tsx`/`docx-toolbar.tsx` (`bg-background`, `text-muted-foreground`,
  `border-border`), both themes via existing tokens.
- Desktop host (g4-06a): coordinate on the `EditorHandle` seam per the
  brief ("do not fork") — the editor surface built here is host-agnostic;
  g4-06a wires the adapter, not a second editor.

## 3b. Correction (post-go, phase-1 file-by-file re-verification)

The Advisor's go approved vendoring the ~95-file/~40k-line subset above. The
worker's required file-by-file re-verification (the design doc's own
section 2 instruction, since the single grep check was explicitly flagged as
not to be trusted) found this estimate wrong in a load-bearing way:

- 27 of `editor/`'s 57 files — including `extensions.ts` (5,925 lines, the
  file that actually assembles the TipTap schema/commands) — import
  genoffice's **own** i18n runtime (`../i18n/locale`) and/or
  `@genoffice/docx-engine` (genoffice's own parse/save engine and Block
  model — a different, incompatible model from the G2 `DocxParsed`/`DocxEdit`
  this lane binds to). Vendoring them as-is means either vendoring
  genoffice's i18n runtime as code (forbidden, section 1) or carrying a
  second parse/save engine alongside G2 (forbidden, G2 already exists).
  Several files outside `editor/` the design doc never selected
  (`line-metrics.ts`, `font-list.ts`, `font-check.ts`, `note-format.ts`) are
  also pulled in as siblings.
- Only 30 of 57 `editor/` files are coupling-free, and `extensions.ts` (the
  integration point) is not one of them — vendoring the clean 30 alone gives
  no usable binding surface.

**Correction**: `apps/docs/src/renderer/editor/` and `components/` are
**design reference only** (read, never ported as code — the same treatment
already given to genoffice's i18n, section 2), not a `vendor-upstream.mjs`
selection. Vendor only the genuinely standalone pure-logic files the new
binding code will import — roughly 15–20 files, low thousands of lines, not
~40k (`headings.ts`, `column-layout.ts`, `page-break.ts`, `indent.ts`,
`table-sizing.ts`, `para-border-merge.ts`, `move-block.ts`, `paste-text.ts`,
`paste-web-html.ts`, `paste-options.ts`, `dark-page.ts`, `text-color.ts`,
`shading-ink.ts`, `case-transform.ts`, `direction.ts`,
`trailing-table-exit.ts` — exact list confirmed file-by-file at
vendor-upstream time, not assumed from this list). The actual TipTap
schema/commands binding `DocxParsed`/`DocxEdit` is **new UniWork code** in
`packages/views/office/docx/`, following the pattern
`packages/office-engine/src/docx/adapter.ts` already uses for the vendored
`docx-engine`. `components/` (Ribbon, dialogs) is skipped entirely — coupled
to genoffice's own CSS/i18n, and UI Rules require `packages/ui` primitives +
Tailwind tokens instead, so it is rebuilt, not ported.

This shrinks AC-1's vendored surface substantially versus section 2's
estimate. Sent to the Advisor as a `decision_required` alongside this
checkpoint; the worker proceeds on this trimmed basis in the meantime since
the alternative (vendoring a second i18n runtime or a second docx engine) is
already ruled out by standing rules, not a judgment call.

## 4. Open questions for the Advisor (go/no-go gate)

1. Confirm the ~95-file/~40k-line vendored subset and the `@tiptap/*`
   dependency addition are acceptable before the actual `vendor-upstream.mjs`
   `SELECTION` edit (AC-1 gate: provenance + licence + boundaries + knip).
2. Confirm scope for this slice: AC-2 mandates text + bold/italic/underline,
   headings, lists, undo/redo, i18n, themes — tables/images
   (`CAP-docx-edit-table-image`), create-blank, and the preservation-only
   rows stay `pending-04b` per `docx-capability-map.md`. This design treats
   04c as AC-2/AC-3/AC-4 (render + edit + save round trip + web mount); the
   deeper content rows stay pending unless the Advisor says otherwise.
3. Genoffice's branded fonts (Caladea etc.) — ship as test fixtures only for
   G3-D3 (AC-5), or skip entirely for 04c and let G3-D3 flag font-substitution
   diffs as a known tolerance class? Needs an explicit answer before the
   fidelity report work starts.

Sending this as a checkpoint to the Advisor now; porting code waits for its
go per the brief.
