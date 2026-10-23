# UNI-933 self-review (one pass, user 2026-10-05 10:26)

stage_outcome: completed
review_verdict: approved (after the fixes below; no blocking finding, the one major is accepted by design and documented)

Range reviewed: `31fc70ed..429ffa88` (8 commits). Reviewers: the worker (Opus 5.5) + one fresh Sonnet 5.5 subagent
(read-only second pair of eyes over cross-format regressions incl. the four lane worktrees, a11y, tests, i18n).
Fixes landed in the commit after 429ffa88 (see git log).

## Findings
| id | file:line | trigger | impact | severity | fix owner / status |
| --- | --- | --- | --- | --- | --- |
| F1 | packages/views/documents/document-workspace.tsx:104,504; office-shell.tsx:278; editor-slot.tsx:169 | `usesOfficeEditor` is true for all six formats; the page no longer scrolls/pads them, shell and slot drop padding/card | a format editor on a lane that relied on the outer page scroll is clipped below the fold until it mounts `OfficeFrame` (on root only DOCX/XLSX mount; XLSX self-scrolls; others show the unavailable alert) | major (by design: F1 applies to all formats) | accepted; documented in ADOPTION.md "Behaviour changes" for lanes 925-928 |
| F2 | packages/views/office/ribbon/layout.ts:95 | a `custom` item with `size: "icon"` now packs into icon strips | MD lane `blockStyle` (140px) and `link` customs join strip rows on merge | minor | documented in ADOPTION.md (lane 928 re-checks its Home group) |
| F3 | ribbon-item.tsx:15-17, office-ribbon.tsx:178 | large items fill the row with 32px icon + 2-line label; body 92->96px; inset separators | visible change for MD/HTML lane large buttons on merge | minor (intended F3/F4) | documented in ADOPTION.md |
| F4 | docx/toolbar/groups/home-clipboard.tsx:59 | format painter used the `Toggle` primitive (outline-none, no coarse min size, `disabled` drops it from tab order, h-7 taller than the strip) | a11y contract (focus outline, 44px coarse target, aria-disabled) | minor | FIXED: Button with aria-pressed + aria-disabled + title, 24px |
| F5 | frame/office-status-bar.tsx:25 | row fixed h-7 while buttons get 44px on coarse pointers | touch targets clipped by the frame's overflow-hidden | minor | FIXED: `pointer-coarse:h-11` |
| F6 | office-status-bar.tsx zoom buttons; docx-shortcuts-help.tsx | icon-only buttons had aria-label but no tooltip | no visible label on hover | nit | FIXED: `title` on zoom in/out/reset and help |
| F7 | office-status-bar.tsx reset button | aria-label "Reset zoom" did not contain the visible "125%" (WCAG 2.5.3) | voice-control users cannot name it | nit | FIXED: name = "<value> Reset zoom"; test updated |
| F8 | ribbon/office-ribbon.test.tsx:239 | gallery-card text assertion had been loosened to "non-empty span" | weaker test | nit | FIXED: asserts specimen "AaBbCcDd" and the card name |
| F9 | core/i18n/locales en.json + vi.json | `office.status.help` added but unused; `office.docx.status.zoom` dead after the status-bar move | dead copy | nit | FIXED: both removed (en + vi) |
| F10 | ribbon-gallery.tsx:59 | "more" column is w-5; coarse pointers force 44px, layout budgets 22px | width estimate off on touch (overflow correction absorbs it) | nit | open (not fixed) |
| F11 | ribbon-gallery.tsx:42 | card accessible name = style name only, visible text is specimen + name | label-in-name holds (name is a visible substring) | nit | open, acceptable |
| F12 | docx/lists/home-lists.tsx:81 | `HomeListsGroup` component only referenced by its own test after the Lists -> Paragraph merge | dead-ish code (knip does not flag it: test entry) | nit | open (left for lane cleanup; no feature change in scope) |
| F13 | office-status-bar.tsx:55 | unknown zoom renders an en dash, DOCX unknown readouts use an em dash | inconsistent unknown mark | nit | open |

Checked and fine: tokens `--office-band` / `--office-canvas` declared in `:root` and `.dark`, mapped in `@theme`, in the
`cn()` colour list and tokens.test.ts; no hard-coded colours or px font sizes in chrome (only `text-*` roles; px values
are layout widths); shared ribbon/frame API has no DOCX-specific code (slots ribbon/subbar/rail/aside/bottom/statusBar);
no lane imports moved internals (`RIBBON_PORTAL_ATTR`, `MenuEntries`, `COMBO_*`), `EditorSlot`/`OfficeShell` props
unchanged, desktop `open-document.tsx` still merges its classes; Button blocks aria-disabled clicks; no `outline-none`
on ribbon/frame interactive items; every new key in en + vi; no JSX literal text; all changed non-test files < 500
lines; knip clean; DOCX = one frame, no inner card/title/Save row, one-row status bar with help, nothing floating.

## Gates rerun after the fixes (Node 22)
vitest office/ribbon, office/frame, office/docx/{toolbar,status,shortcuts,character}, docx-editor: 262 pass;
core i18n 28 pass; `tsc --noEmit` (views) clean; eslint (changed dirs, --max-warnings 0) clean; `pnpm knip` clean.
Tokens test not rerun (tokens.css unchanged in this pass).

## Not checked
- Real rendering after the fixes (no new screenshots; changes are a11y attributes, coarse-pointer height, test and
  locale edits).
- Lane test suites against the new ribbon (only their class assertions were grepped).
- Go tests and the Playwright e2e suite (no server change).
