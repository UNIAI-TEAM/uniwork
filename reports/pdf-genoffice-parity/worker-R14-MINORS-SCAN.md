# R14-MINORS-SCAN (UNI-925) - worker-R14-MINORS-SCAN

Status: DONE (implemented + verified)
Branch: feature/UNI-925-pdf-genoffice-parity (NOT pushed)
Scope touched (only these):
- scripts/office/check-boundaries.mjs
- scripts/office/check-boundaries.test.mjs

## What changed

### R14-2 - bare-global scan widened, blanket exclusion replaced by a per-file allowlist
- Removed `BROWSER_GLOBAL_SCOPE_ROOTS` and its `collectGraph` helper. The
  bare-global scan now runs on every file the browser walk already visits
  (`BROWSER_SCOPE_ROOTS`: office-contracts, engine index/shared/browser +
  markdown/html/assets/xlsx, packages/core/office, apps/web/platform/office),
  so a stray `Buffer.from` in apps/web/platform/office or the markdown/html/
  assets/xlsx lanes is caught instead of passing silently.
- Added `BROWSER_GLOBAL_SCOPE_EXCLUDE_FILES = new Set(["packages/office-engine/src/xlsx/vendor.ts"])`.
  That one file legitimately feature-detects `typeof Buffer === "undefined"`;
  every other browser file is held to the rule. The allowlist is per-file, so a
  sibling xlsx file with an unguarded Buffer is still flagged (test proves it).
- Extended `BROWSER_FORBIDDEN_GLOBALS` with `global`, `module`, `exports`.
- Scope note: I did NOT add `packages/office-engine/src/docx` to the scan.
  The finding enumerates only apps/web/platform/office, packages/core/office and
  engine markdown/html/assets/xlsx; src/docx/vendor.ts has the same legitimate
  `typeof Buffer` crypto-host detect (its own documented Node-only seam), and
  pulling it in would require a second allowlist entry the finding did not ask
  for. Flagging so the lead can decide if a follow-up is wanted.

### R14-3 - scanner edge cases (ternary / case / regex)
- The old blanket skip-if-followed-by-`:` rule also swallowed `cond ? process : x`
  and `case Buffer:`. The `:` skip now applies only where a key can occur - at
  the start of an object, after `{`/`,`/`(`/`;`, or after a declaration name -
  so a ternary or a switch case is still reported.
- Regex literals are now recognized (`regexOpensHere` + `skipRegex`): the body is
  blanked, so `/a\/\/` no longer reads as a line comment that blanks the rest of
  the line, and `/Buffer/` no longer false-positives. Handles char classes
  (`[^/]`) and flags; conservative (only blank a `/` that can start a regex).
- Added `collectLocalBindings`: a locally bound name (`(module) => module.X`,
  a `process` parameter, a destructured binding) is not the Node global and is
  skipped, which is what lets the widened scope stay false-positive-free on the
  real tree (apps/web/platform/office/document-office-host.tsx binds `module`
  in three `.then((module) => ...)` callbacks).
- Both `stripCommentsAndStrings` and `bareNodeGlobals` stay small scanners, not
  parsers.

## Tests added (scripts/office/check-boundaries.test.mjs, 25 -> 31)
- "fails on a bare Node global planted in a widened browser root": plants
  `Buffer.from` in apps/web/platform/office/pdf-render.ts, packages/core/office/
  pdf-render.ts and the markdown/html/assets vendor seams -> each must fail.
- "the xlsx vendor typeof-Buffer feature-detect stays allowed, per file": the
  guarded vendor.ts shape stays clean while an unguarded sibling adapter.ts is
  still flagged.
- "global/module/exports are forbidden bare globals": `module.exports` fails.
- "a ternary or a switch case still trips the global scan": `cond ? process : x`
  and `case Buffer:` both flag.
- "a regex literal is not a comment and does not false-positive": `/Buffer\.from/`
  is clean; `/a\/\/b/` does not blank the following `process` reference.
- "object keys, member access and local shadows are not bare globals":
  `{ process: 1 }`, `foo.Buffer`, a `process` param, and the
  `(module) => module.X` dynamic-import callback are all clean.

## Verification (Node v22.23.2 first on PATH)
- `node scripts/office/check-boundaries.mjs`
  -> "check-boundaries: OK - browser isolation, no /ee, licence attribution", exit 0.
- `node --test scripts/office/check-boundaries.test.mjs`
  -> tests 31, pass 31, fail 0.
- No new false positives on the real tree: the only bare global anywhere in the
  full browser scope is xlsx/vendor.ts's Buffer, which the allowlist covers.

## Notes / limits
- Only the two scoped paths were edited; other workers' in-flight files
  (pdf-adapter.tsx, browser/pdfium.ts, find/*, pdf-render.ts) were left untouched.
- Committed with `git add <my two paths + this report>` only (no -A); commit hook
  run normally (no --no-verify).
