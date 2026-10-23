# Fork CI replica r3 (uniwork-office @ 86877508, feature/UNI-1013-docs-web-bridge)
Reports/logs: `fork-r3/`. Cost ~17c (test 9.0c, e2e 7.6c).
- test job: FAIL, unchanged: only `tests/font-covering.test.ts` "returns null for unassigned codepoints no real font maps" (VM has fonts-noto-cjk). Step 1 exit 128 = no origin/main in the VM clone (replica limit).
- e2e job: build:all and apps/markdown pass; Electron suite 171 passed, 7 failed (r2: 158 passed, 8 failed, 13 did not run).
  - FIXED since r2: docs-style-gallery.spec.ts:40 and docs-word-interaction-smoke.spec.ts:275 (Title style-card click).
  - STILL FAILING: docs-spell-suggestions.spec.ts:71 (+retry #1, squiggle not gone after Add to Dictionary); docs-visual.spec.ts:63 x5 (kitchen-sink, captable-inline/float/pct/page-anchor pixel diffs).
  - NEWLY VISIBLE: `e2e/docs-table-float-click.spec.ts:78` "clicking a cell of a floating table puts the caret in that cell": expected path to contain `docTableCell`, got `["docParagraph","doc"]` (docs-table-float-click.spec.ts:106). It sat in the "did not run" group in r1/r2, so it is not known whether it regressed or was just unreachable before.
