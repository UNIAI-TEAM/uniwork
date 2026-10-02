# G3-04d — DOCX fidelity: root cause, fix approach, pinning tests (first checkpoint)

> Status: checkpoint 1, implementation starting. Root causes below are read from the code at
> branch `feature/UNI-823-office-docx-fidelity` @ `940ee3ac` and the genoffice pin `09485f88`.

Issue UNI-823 (parent UNI-659). Evidence: G3-D3 measurement `reports/g3-d3-docx/measure.md`
(at `09b72628`) and the user's G3-D3 decision 2026-10-02 (tolerance accepted; R1/R2/R3/T fixed
here; dark mode = contrast review). The lane owns `reports/g3-d3-docx-r2/` for the re-measure.

## 0. Why these four findings exist

`packages/office-upstream` vendors the genoffice **engine** (measure → slice → gap, sections,
styles) at the pin, and `packages/views/office/docx/docx-pagination.ts` is the UniWork **driver**
— a re-implementation of the App-side loop that genoffice's own `App.tsx` owns. Every finding
below is a place where the driver is missing a step the upstream App performs; the engine
modules are already vendored and correct. So all four fixes land in host code plus (for
typography) one newly vendored engine module — no serializer or save-path change.

| # | Finding | UniWork driver | genoffice counterpart (pin `09485f88`) |
| - | ------- | -------------- | -------------------------------------- |
| R1 | section columns render as one column | `docx-pagination.ts:372` page-geometry vars only; `:379` measure without the single-flow state; `:390` slice with unmodified `sectionGeoms` | `App.tsx:5606-5613` col CSS + measuring width; `:3001-3012` `measureSingleFlow`; `:3015-3022` `colGeomsFor`; `:3962-4016` mixed mode |
| R2 | table row split across the page break; rows/cells counts differ | `docx-pagination.ts:390` passes `undefined` for `blockMetaOf`; `:254-345` in-table cuts fall back to an inline anchor; no repeat-header clones | `App.tsx:2836-2879` `blockMetaOf`; `:3704-3763` in-table gap + `tblHeader` clones; `:3894-3912` row fills |
| R3 | page after an explicit break / last page are not full sheets | `docx-pagination.ts:305-315` gap metrics carry the plain bottom margin only | `App.tsx:3502-3525` underflow `pad` (+ mixed-column `pullUp`); applied at `:3632-3635`, `:3751-3754` |
| T | typography is the renderer-sheet default, not the document styles | `use-docx-tiptap-handle.ts:open()` installs the sheet only; `docConfig`/theme CSS never generated | `file-actions.ts:372` `setDocCss(docStyleCss(parsed))`; `App.tsx:5583-5605` doc CSS, `--doc-line-factor`, grid/charSpace, `--doc-margin-*` |

## R1 — section columns

- Observed (G3-D3): `docx-two-columns` renders 1 column with ~2004 px frames, 4 pages;
  oracle renders the declared 2 columns, 8 column-cut frames. Structural mismatches:
  `page_count`, `blocks_total`, `div_blocks`.
- Root cause: the driver never switches the canvas to the declared column layout. Upstream
  renders a uniform multi-column document with whole-page CSS multicol on `.doc-page`
  (`column-count: var(--page-cols, auto)` — `styles.css:2257-2261`) plus a driver-injected
  rule that sets the document's real count/gap and a `.measuring-columns` state whose width
  equals one column, so measurement/slicing produce 1-D column-flow coordinates. The driver
  also must keep `SectionGeom.cols` (`sectionGeoms` sets it for `columns > 1`,
  `pagination-sections.ts:745-750`) unless the column layout is inactive (`colGeomsFor`).
  When sections disagree (count/width/`w:bidi`), upstream paints the engine's regions with
  per-block placements (`columnLayoutSpecs` + `setColumnLayout` — both already vendored).
- Fix (host driver + shim exports): compute `colMode`/`colFlow` from `spec.sections` using the
  vendored `sectionColumns`/`sectionColGeom`/`sectionBidi`; inject the col CSS element
  (`column-count`, `column-gap`, `column-fill: balance`, plus the `.measuring-columns`
  width swap); wrap `measureBlocks`/`sliceWithLineSplit` in the measuring state; pass geoms
  through `colGeomsFor`; for mixed mode call the vendored `columnLayoutSpecs`/`setColumnLayout`
  (export both from `shims/docs-renderer-entry.ts`).
- Pinning tests: `packages/views/office/docx/docx-pagination-columns.test.ts` (jsdom) —
  2-column section: slices keep `cols`, the `.doc-page` element carries the col CSS, the
  measuring class is on only during measure; page frames are column-cut frames, block/page
  counts match the oracle counts recorded in the G3-D3 report.

## R2 — table row keep-together + repeated header rows

- Observed (G3-D3): `docx-long-table` UniWork 61 rows / 183 cells vs oracle 65 / 191, and
  page 2 shows one row split across the gap with cells on both sides. The parse has one table
  with `tblHeader` on its header rows (61 `<w:tr>`).
- Root cause: `sliceWithLineSplit`'s 5th argument is the parse-metadata lookup
  (`BlockMeta`: `keepNext`/`keepLines`/`pageBreakBefore`/`widowControl` and
  `tableRowFlags` → `{isHeader, cantSplit, minHPx}` from `tableRowFlags()`,
  `pagination-measure.ts:463`, consumed at `pagination-lines.ts:418`). The driver passes
  `undefined`, so the slicer knows no row is unsplittable and no table repeats its header
  rows (`PageSlice.repeatHeader`, `pagination-types.ts:219`). The in-table cut then falls
  through to the generic inline-gap path, which splits the row visually. Upstream also builds
  the gap as an **in-table** widget (`kind: 'table'`, a `tr` with a spanning cell sized to the
  table's real grid) and clones the `tblHeader` rows below it (`App.tsx:3704-3763`).
- Fix (host driver): build `blockMetaOf(docxIndex)` from `parsed.blocks`/`parsed.styles`
  (`format`/`styleId`/`display` + `originalXml` flag scan `tblHeader|cantSplit|<w:trHeight`) and
  pass it to `sliceWithLineSplit`; when a cut lands inside a table, emit the in-table gap
  spec (grid cols computed from the rows' `colSpan` sum) and attach the cloned
  `repeatHeaderEls` when `slice.repeatHeader` is present. `setRowFills` already receives
  `out.rowSplits`.
- Pinning tests: `docx-pagination-table.test.ts` — (a) `blockMetaOf` returns `tableRowFlags`
  for a `tblHeader` table and `cantSplit` rows stay whole at a cut; (b) a cut inside the long
  table produces an in-table gap spec + repeat-header clones; DOM assertion: no `tr` row is
  split, `tr.page-gap-table` present, `page-repeat-header` clones on pages 2+.

## R3 — full sheets after a break / on the last page

- Observed (G3-D3): `docx-pagination-hf` frames `[894, 237, 915, …, 296]` px vs oracle
  ~934 px on every page; the footer after the explicit break does not sit at the paper bottom.
- Root cause: a page that ends early (explicit break / section break / `keepNext`) leaves
  unused content height. Upstream inflates the **gap widget's `marginBottom`** by exactly the
  shortfall so the frame renders the full paper height and the next page's header/footer
  strips land on the sheet:
  `prevContentH = pageHeight − effectiveTop − marginBottom`,
  `remaining = max(0, prevContentH − (slice.end − slice.start + repeatHeader.height))`,
  `pad = max(0, round(remaining − footnoteHeight))` (`App.tsx:3502-3525`). The driver's gap
  metrics (`docx-pagination.ts:305-315`) carry only the plain bottom margin, so frames shrink
  to their content. (Uniform multi-column pages skip the pad — the browser compresses the
  flow; mixed-column pages use `slice.physHeight` and pull the gap up instead — both ported
  with the same expressions.)
- Fix (host driver): port the `pad`/`pullUp` computation into `buildPaginationFrame` and add
  it to every gap kind's `marginBottom` (block, inline, and the new in-table gap).
- Pinning tests: `docx-pagination.test.ts` — a short page before a forced break yields a gap
  whose `marginBottom` includes the shortfall and a frame height equal to the page box; the
  last page's frame is a full sheet.

## T — document typography parity

- Observed (G3-D3, 8/8 fixtures): computed `h1/h2/p` are the renderer-sheet defaults
  (`Calibri, DengXian, …` stack, weight 400, 18.67 px `marginTop`) while the oracle resolves
  the document styles (`Calibri Light` headings, weight 600, style sizes/colors/margins,
  `line-height` from the theme body font).
- Root cause: the document's own CSS is never generated. genoffice builds it from the parse —
  `docStyleCss(parsed)` (`doc-style-css.ts:280`; sets every `[data-style]` rule, theme-resolved
  fonts, `--doc-line-factor*`, autospace, page-wrap line factor) and `docThemeCss(themeFonts,
  themeColors, !!docBodyFont(parsed))` (`doc-style-css.ts:101`), plus `.doc-page` vars for
  margins/grid pitch/charSpace and the editor `lang` from `docDefaults` (`App.tsx:5583-5605`).
  The doc-style module is **not vendored** (`vendor-upstream.mjs` SELECTION stops at the
  pagination modules + `styles.css`), and the UniWork host installs only the sheet.
- Fix: vendor `apps/docs/src/renderer/doc-style-css.ts` through
  `scripts/office/vendor-upstream.mjs` (SELECTION + provenance; its imports — `pagination`,
  `line-metrics`, `editor/*`, docx-engine — are all already vendored), export
  `docStyleCss`/`docThemeCss`/`docLineFactor`/`docHasCjk`/`docBodyFont` from the shim, and
  install a doc-style element + `.doc-page` var rule per open in the host, mirroring App.
- Pinning tests: `docx-doc-styles.test.ts` — with the vendored sheet and generated doc CSS in
  jsdom, computed styles of the first `h1`/`h2`/`p`/`li`/`td` match the source-oracle values
  (font family/stack, size, weight, colour, line-height, margins) for the fixture documents;
  the theme major face wins headings while the body keeps the declared body font.

## Constraints honoured / not touched

- No serializer or save-path change; the 57-test DOCX suite and the save round trip stay
  untouched. Every engine deviation enters through the vendor SELECTION or (if genuinely
  required) a numbered fail-loud patch under `packages/office-upstream/patches/`.
- `vendor-upstream --check`, `check-boundaries`, `knip`, typecheck/lint/test for the touched
  packages, and the scripts suites run before the Tester stage.
