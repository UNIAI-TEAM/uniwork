# office-upstream patch series

UniWork-side changes that ride on top of the frozen upstream source in
`../upstream/`. The vendored tree is byte-identical to upstream commit
`09485f884dc845cf3bf27fb7edfe489f9d457aad` (see `../provenance.json`); every
deviation lives here as a numbered patch that `scripts/office/build-upstream.mjs`
applies to a scratch copy in `git apply -p1` order, before the build runs.

Rules:

- Patches are unified diffs rooted at `upstream/` (`a/packages/...` â†’ `b/packages/...`).
- Never edit `../upstream/` directly; new work enters as a new numbered patch.
- Upstream files are Apache-2.0 (Copyright 2026 Mainfunc, Inc.); patches are
  UniWork changes to that source and carry the same attribution story â€” keep
  the provenance table below current when the series grows.

## Series

| # | Patch | sha256 | Files | What it carries |
| - | ----- | ------ | ----- | --------------- |
| 0001 | `0001-g108-xlsx-frozen-engine.patch` | `E299A322443805E2F2EBD03B70A37CE44A44EBDE020A093A64F5C14695E0F27E` | `packages/xlsx-gateway/src/gateway/xlsx-styles.ts`, `xlsx-styles.dedupe.test.ts` (new), `apps/sheets/native/xlsx-engine/src/recalc.rs` | The frozen XLSX engine changes accepted in G0: the cellXfs dedupe fix so saving an already-styled cell does not grow `xl/styles.xml` (with its node:test regression), and the sidecar `normalize_for_ironcalc` normalization + tests that make unstyled packages recalculable. |
| 0002 | `0002-xlsx-cross-sheet-formula-cache.patch` | `1CB36ED934F9492E7352963E63D2924514086D8C07E52781CEE65D2CEE0545E4` | `packages/xlsx-gateway/src/gateway/xlsx-gateway.ts` | G2-04 (UNI-687): the formulaValues pass previously skipped any sheet the cell edits never touched (`worksheetXmls` is seeded from edit/state sheet names only), so a cross-sheet formula dependent kept its stale cached `<v>` forever. The loop now lazy-loads an untouched formula sheet via `resolveWorksheetPath` and still skips one whose path cannot be resolved, preserving the old fail-soft behaviour. A lazily loaded sheet records its source XML in `lazilyLoadedXmls`; the write-back loop publishes it only when a pass actually changed the XML, so an unchanged dependent stays byte-identical and never enters `touchedEntries` â€” `assertOnlyTouchedEntriesChanged` covers it, and preservation surface stays maximal. |
| 0003 | `0003-docx-display-formula-edit-option.patch` | `740AFAF428F73F7DF5BCDE74A4C1C76F4812477131D79643F3662D40EF65A6D2` | `apps/docs/src/renderer/editor/extensions.ts` | g3-04c T-03 (UNI-823): the display-formula hover control (`.doc-formula-edit`, click â†’ `ai-docs-edit-inline-math`) becomes opt-out through `DocProtected`'s new `formulaLatexEdit` option. `addOptions()` defaults it to `true`, so the app wiring for the genoffice host is unchanged; a host without an event consumer mounts `DocProtected.configure({ formulaLatexEdit: false })` and `wireFormulaLatexEdit` never runs. The UniWork DOCX schema mounts it off. `scripts/office/build-docx-browser.mjs` applies the series to a scratch copy before bundling, so the DOCX browser artifact carries the same patch series as the rest of the vendored graph. |
| 0004 | `0004-docx-hf-probe-scope.patch` | `116DE4188A2AD725A508B4D9BED56B8BFD7F21D9607F65C4F602038EC0A92681` | `apps/docs/src/renderer/editor/hf-dom.ts` | g3-04c T-02 (UNI-823): `hfProbeHost()` mounts `#hf-strip-probe` under the `.docx-surface` scope root when the host provides one. The repackaged renderer sheet is scoped with `@scope (.docx-surface)`, so a probe under `document.body` measured with UA defaults (16px, `line-height:normal`, no `--hf-*` vars) and silently reserved the wrong body space for every header/footer document. |
| 0005 | `0005-docx-read-only-note-areas.patch` | `10d61cbeee0289246384f99cff5246d3dc0f0d4ebfd3f0b2e5fa3f54a17a29c8` | `apps/docs/src/renderer/components/PageNoteAreas.tsx` | g3-04d (UNI-823): adds opt-in `readOnly` while preserving the pinned component's default behavior. UniWork displays original note text/numbering with edit/delete controls hidden; no note save path changes. The source blob is included through SELECTION and the existing source-manifest `apps/docs` allowlist. |
| 0006 | `0006-docx-page-footnote-dom.patch` | `f06faea1dfa92d586f91cd5abfc33ee6c5ea31915d4b9ff69278a311938278a4` | `apps/docs/src/renderer/editor/note-dom.ts` (new) | UNI-823 F1: extracts pinned App.tsx block-note scanning, note drawing, DOM height probe and page-gap note DOM through a fail-loud numbered patch; exports the helpers, scopes the probe to the host surface, and makes the edit tooltip/handler optional. The host omits it for display-only notes and uses data-note-id to skip only mounted gap notes in the final list. No serializer/save changes. |
| 0007 | `0007-xlsx-filter-funnel-suppression.patch` | `430812BBAAEF74FAD998FC8791429D87F745C40E0217DF0C2BE0E0D0F8098FCF` | `apps/sheets/src/renderer/filter-range-outline.ts` | UNI-926 B4 r4: the pinned `SheetsFilterRenderController` paints a filter funnel button in every header cell of a filtered range. UniWork replaces the pinned (en-US-only) filter panel with its own Advanced Filter dialog, so `sheet.operation.open-filter-panel` (and the related close/apply/change operations) stay policy-denied and each funnel is a visible affordance whose click is silently cancelled. The same render-module interception that stubs `_renderRange` now also stubs `_renderButtons`, so the funnel shape never renders; the range-outline suppression is unchanged. |
| 0008 | `0008-xlsx-table-additions.patch` | `50E41DA34EC43243083CF4C6187DE1560295B90DB16FF1D96E8B365FCBA6D720` | `packages/xlsx-gateway/src/gateway/xlsx-gateway.ts` | UNI-926 B9: `applyCellEditsToXlsx` gains the `tableAdditions` parameter (positionally before `formulaValues`) and forwards it to `planCellEditsToXlsx`, so the streaming save path can persist tables created in the editor (the `tableAdditions` slot `planCellEditsToXlsx` already accepted). Absent/empty reproduces the pre-patch call exactly. |
| 0009 | `0009-pptx-apply-theme-keeps-explicit-colors.patch` | `7796b38d9c7711930f6b9f1035938a91cdc0573eade5c14e216478998ce92a8f` | `packages/pptx-ops/src/ops/slide-ops.ts` | UNI-927 X3 (R2-5): the vendored `applyTheme` op always ran `remapDeckColors`, rewriting every explicit `srgbClr` fill, outline and text run to the nearest theme colour (an explicit FF0000 fill became 5DC837). PowerPoint leaves explicit RGB alone and only scheme colours follow the theme, so the remap is now opt-in through `remapExplicit: true` on the op; no UniWork edit sets it. Theme parts, fonts and the background materialization are unchanged. Real-engine proof: `packages/views/office/pptx/design/theme-explicit-colors.real.test.ts`. |

## Provenance of 0007

The change is confined to `apps/sheets/src/renderer/filter-range-outline.ts`, the UniWork-authored suppression module already vendored in this series' pin. It adds one line (`prototype._renderButtons = () => {}`) beside the existing `_renderRange` stub and rewrites the file header comment. The pinned upstream bytes remain untouched; `build-xlsx-browser.mjs` applies the patch to a scratch copy before bundling, so the browser artifact carries the suppressed funnel. `vendor-upstream --check` stays green and the patch apply/reverse checks fail loudly if it stops landing.

## Patch-apply fix (2026-10-02, g3-04c T-02)

Both `scripts/office/build-docx-browser.mjs` and `scripts/office/build-upstream.mjs`
applied the series with `spawnSync('git', ['apply', ...], { cwd: scratch/upstream })`
while the scratch lives **inside the lane worktree**: `git apply` walks up to the
repository root and silently **skips** patch paths that resolve outside the current
directory (exit 0, no change), so the series was a no-op in that invocation. Both
scripts now set `GIT_CEILING_DIRECTORIES` to the scratch root, which stops the
walk-up at the scratch: the apply is cwd-relative again, and a real failure exits
non-zero. Evidence: the rebuilt `dist/docs-renderer.mjs` carries `formulaLatexEdit`
and the `.docx-surface` probe mount; `git apply --verbose` reports
`Applied patch ... cleanly`.

## Provenance of 0001

Regenerated as a clean unified diff from the accepted G0 applied tree
(`advisor-resume2/xlsx-feature/feature-ready-source/dependency-source/`). The
original lab artifacts it consolidates:

| Artifact | sha256 |
| -------- | ------ |
| `feature-ready-source/managed-engine-current.patch` | `e9ba9ce9a43714a24256d9323dc0b9b87be90af69e949bc22891f501f066b799` |
| `gateway-styles-dedupe.patch` | `3dd8d157ed8be0e583d85f65bc06dff898c98bef8bddc9069f23e9d9fe3c47c0` |
| `sidecar-recalc-normalize.patch` | `0d589a4e841df23a5919582825fc9c22e59b16976ce800eae2a11fbe72490a36` |

Applied-file checksums (the `b/` side):

| File | sha256 |
| ---- | ------ |
| `packages/xlsx-gateway/src/gateway/xlsx-styles.ts` | `fd2b0dbd9a458413ccbe13f4d2e47fad97cddb53338d7bde894ea67c92535423` |
| `packages/xlsx-gateway/src/gateway/xlsx-styles.dedupe.test.ts` | `d6ec6bc60c3f91ea34c8214e2b797cbb54f6fd56f441b115ef94d6517f55d759` |
| `apps/sheets/native/xlsx-engine/src/recalc.rs` | `85355297126ad71d81aa348980dfd465fcf7e777c479a9817c8e6822fb647865` |

The original `managed-engine-current.patch` was regenerated because its file
boundaries are spliced (a `---` header glued to the previous file's last added
line) and it is not `git apply`-clean; the regenerated patch is byte-identical
in effect â€” it diffs the pinned blobs against the accepted applied tree.

## Provenance of 0003

Regenerated as a clean unified diff from the vendored `extensions.ts` blob at
`09485f884dc845cf3bf27fb7edfe489f9d457aad` (the scratch patch repo used the
same bytes; `git apply --check -p1` passes against `upstream/` today). The
patch carries no upstream reformatting, only the three hunks above; the applied
`b/` file is the only changed blob.

## Known gap (recorded, not worked around)

The **Brand r8 product patch** was lost with the G0 scratch and is a recorded
gap **owned by the G3/G4/G7 brand lanes** (Advisor decision, run
`run_5901144be3bc`, 2026-09-27). It is not reinvented in G2-01. What survives
is the XLSX-lane frozen engine change set above, plus evidence that the other
frozen changes were applied inside deleted lab trees (`bootstrap-source`,
`engine-source` are not git checkouts and carry no patch manifest). The gap is
recorded in the G2-01 acceptance packet; nothing was reinvented.

Root scope: `scripts/office/build-upstream.mjs` already exists on the integration root (UNI-819) with the same silent-skip apply, and it builds every vendored-engine `dist/*.mjs` bundle the office-upstream package exports (docx/xlsx/pptx/pdf), so the root and every lane that rebuilds through it need this fix too. `scripts/office/build-docx-browser.mjs` is lane-local (g3-04c) and has no root copy.


## Provenance of 0006

The helper bodies are extracted from pinned `apps/docs/src/renderer/App.tsx:435-565` at `09485f884dc845cf3bf27fb7edfe489f9d457aad`, using the `blockNoteScanRuns` and `DEFAULT_SETTINGS` anchors. Original upstream bytes remain untouched. Explicit deviations are the named exports, scoped hidden probe mount, optional edit handler/tooltip and per-row `data-note-id`; the extraction receipt is in the UNI-823 lane report `f1-draft/note-helper-provenance.json`. Patch apply/reverse checks and required source/artifact symbols fail loudly.

## Provenance of 0008

The change is confined to `packages/xlsx-gateway/src/gateway/xlsx-gateway.ts`: `applyCellEditsToXlsx` accepts the `tableAdditions` list and passes it into `planCellEditsToXlsx` (whose 15th parameter it already was). This closes the only gap between the streaming save path and the table writer the vendored gateway already carries (`applyTableAdditions`). Pinned upstream bytes stay untouched; the build applies the patch to a scratch copy and the patch apply/reverse checks fail loudly if it stops landing. `vendor-upstream --check` stays green.
