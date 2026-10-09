# Fork CI replica r2 (uniwork-office @ 8f34ddf0, feature/UNI-1013-docs-web-bridge)
Reports/logs: `fork-r2/`. Cost ~21c (test 13.1c, e2e 8.3c; warm VMs).
- test job: FAIL, same as r1: only `tests/font-covering.test.ts` "returns null for unassigned codepoints no real font maps" (VM has fonts-noto-cjk); all other steps pass (step 1 exit 128 is the missing origin/main in the VM clone, replica limitation).
- e2e job: build:all, apps/markdown playwright pass; Electron suite 158 passed, 8 failed, 13 did not run (r1: 157/9/13).
  - FIXED since r1: `e2e/markdown-tab.spec.ts:101` (argv .md edit + save).
  - STILL FAILING (unchanged): `docs-spell-suggestions.spec.ts:71` (squiggle not gone after Add to Dictionary, + retry #1); `docs-style-gallery.spec.ts:40` and `docs-word-interaction-smoke.spec.ts:275` (Title style-card click timeout, ribbon group intercepts pointer events); `docs-visual.spec.ts:63` x5 (kitchen-sink, captable-inline/float/pct/page-anchor pixel diffs).
