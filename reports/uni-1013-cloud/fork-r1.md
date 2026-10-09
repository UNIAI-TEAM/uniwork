# Fork CI replica r1 (uniwork-office, lane branch feature/UNI-1013-docs-web-bridge @ bd875973)

Runner: `--repo uniwork-office`, specs `office-ci-test.txt` + `office-ci-e2e.txt` from test/cursor-cloud-env e9343922 (the
VPS runner checkout is older and lacks them, so I ran a copy extracted to the scratchpad). Reports/logs: `fork-r1/`.
Cost: test 7.5c + e2e 14.4c = ~22c (VMs provisioned fresh, clone mode: Cursor cannot open the fork repo directly).

## Shard 1: `test` job -> FAIL (19 of 20 steps pass)
Pass: licenses, format:check, check:theme-colors, check:brand, test:rebrand, tools/release tests, legal:check + test:legal,
check:egress, merge-conflict marker scan, check:skill-version, public-hygiene, check:english-comments, lint, typecheck,
fixtures + `git diff --exit-code fixtures/generated`, sheets fixtures + compat.
Fail:
- `npm test`: ONE test, `tests/font-covering.test.ts > findFontCovering > returns null for unassigned codepoints no real font maps` (AssertionError: expected Buffer [OTTO ...] to be null). The VM has fonts-noto-cjk installed (the e2e spec installs it, and the VM profile is shared), so a CJK font "covers" the codepoint: font-environment dependent, not a lane regression (unverified on GitHub runner).
- Step 1 `git fetch --unshallow; git fetch origin main; git rev-parse --short HEAD origin/main` exit 128 "Needed a single revision": `origin/main` does not exist in the VM clone (clone mode); the later FORMAT_BASE_REF steps still passed, so format/skill-version checks ran against whatever merge-base fell back to. Replica limitation.
- Not replicated: cargo-deny licences.

## Shard 2: `e2e` job -> FAIL: 157 passed, 9 failed, 13 did not run (10.6 min Playwright)
Pass: build:all (145 s), sheets fixtures, apparmor/fonts/chromium setup, `apps/markdown` Playwright config (pass, 37 s).
`xvfb-run npm run test:e2e` (the Electron/desktop suite, 635 s) failures:
1. `e2e/docs-spell-suggestions.spec.ts:71` (also retry #1): "squiggle gone after Add to Dictionary" expected 0 got 39 (:178).
2. `e2e/docs-style-gallery.spec.ts:40` Styles pane: `locator.click` timeout 30 s on `.style-card[data-style-id="Title"]`; `.ribbon-group-items.rb-font-group` subtree intercepts pointer events.
3. `e2e/docs-word-interaction-smoke.spec.ts:275` same click timeout / same intercepting ribbon group (2 and 3 look like one layout/overlap bug, possibly the known Docs open regression F11 is fixing; unconfirmed).
4. `e2e/docs-visual.spec.ts:63` x5 (kitchen-sink, captable-inline, captable-float, captable-pct, captable-page-anchor): `toHaveScreenshot` pixel diffs (e.g. 2310 and 5689 px, ratio 0.01) on `.doc-page`; golden screenshots vs VM font rendering, likely environmental (same fonts story as the unit test).
5. `e2e/markdown-tab.spec.ts:101` argv .md edit+save: saved text is `# Appended line.Hello` where `# Hello` expected (markdown-tab.spec.ts:145): the appended line landed inside the heading line, a real behavioural diff or a timing/selection race.
"13 did not run" are tests after the failures in the same serial groups.
