# Visual evidence: Docs web frame (UNI-1013, lane GO-B2+B3)

**Verdict: NOT PASS.** 4 major findings are open (#1, #2, #4, #5), 0 blocking, 8 minor. Scored on the canonical
tester_visual criteria (re-scored after the coordinator replaced the first C1-C9 set).

Tester V1 (visual). Test and evidence only, no product code changed.

- Target: lane `feature/UNI-1013-office-docs-web` at `b71936f27` (F3b merged, pin `0.1.0-5a81008`, clean fork build).
- Stack: production `next build` of `apps/web`, Go server built from this tree, Postgres from `.env.worktree`.
  `office_engine` and `office_docs_web` enabled by an ORGANIZATION override (as the e2e does).
- Capture: Playwright (`capture.spec.ts`, copied into `e2e/` to run), Chromium headless, `vi-VN`.
  Locale via the `uniwork-locale` cookie, theme via `localStorage.theme` + `colorScheme` emulation.
- Matrix: 1440x900 and 1024x768, each in vi/en x light/dark = 8 runs, ~17 PNGs per run
  (`screenshots/<1440|1024>/<lang>-<theme>/<NN-name>.png`, plus `metrics.json` per run with DOM facts: page title,
  iframe box, horizontal overflow, frame theme attribute/lang, frame page and text colours).
- Contrast numbers below were measured from the rendered pixels (foreground vs dominant background of the control).
- Not captured: "bundle not installed" (screen 9 variant). The W7 evidence already has it
  (`reports/uni-1013-w7-evidence/screenshots/06-bundle-not-installed-g3.png`); screen 9 here is the flag-off variant.
- Honesty note on coverage: every run was captured and its DOM metrics checked automatically. I read roughly 35 of
  the 140 PNGs by eye (most of vi-light at 1440, and the key states of the other seven runs). The failures below are
  code-path-wide (same component in every run), so each is stated with the combos where it was observed; a combo
  not named was not seen failing, but I did not eyeball every image.

## Screens

| # | Screen | Files (`<vp>/<combo>/…`) |
| --- | --- | --- |
| S1 | Workspace document list with the .docx | `01-document-list.png` |
| S2 | Docx in the Docs frame: loading, html pending, editor ready | `02a-opening-loading`, `02c-frame-html-pending` (1440 only), `02b-opened-editor-ready` |
| S3 | Editing (text typed, ribbon visible) | `03-editing` |
| S4 | Dirty state + leave-page dialog | `04a-dirty`, `04b-leave-dialog` |
| S5 | Saved (Ctrl+S) | `05a-saved` (no version-history control exists in the host UI for a docx: nothing to capture) |
| S6 | Save conflict in the frame (second tab saved first) | `06-save-conflict` |
| S7 | Save as | `07a-file-menu`, `07b-save-as-in-progress`, `07c-save-as-copy-opened` |
| S8 | PDF export fallback (503 `office_not_configured`, in-frame print) | `08a-export-in-progress`, `08b-export-print-fallback` |
| S9 | Flag off, G3 editor | `09-flag-off-g3-editor` |
| S10 | Errors: token mint 503, token mint network error, frame document fetch 500 | `10a-token-mint-503`, `10b-token-mint-network-error`, `10c-frame-open-500` |

## Criteria

Canonical: 1 hierarchy/typography; 2 spacing/alignment; 3 consistency with UniWork primitives + the genoffice look;
4 tokens + light/dark legibility; 5 states (empty/loading/error/disabled); 6 responsiveness; 7 vi/en copy;
8 visible accessibility (focus, contrast, targets); 9 polish. Plus A1: the document page is never recoloured by the
theme; A2: host-frame integration (no white flash in dark, title synced, no double scrollbars, feels part of UniWork).
Severity: blocking / major / minor / nit. No screen was unstyled, raw-DOM or a placeholder (the error alert in S10 is a
styled, themed alert), so nothing is blocking. Every finding has a crop under `crops/`.

## Result matrix (screen x criterion)

P = pass in all 8 runs, F#n = fails, see issue n. Criterion 6 (responsiveness) is judged on the 1024x768 runs.

| | 1 type | 2 spacing | 3 consistency | 4 tokens/theme | 5 states | 6 responsive | 7 copy | 8 a11y | 9 polish | A1 page colour | A2 integration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 list | P | P | P | P | P | P | P | P | P | P | P |
| S2 opened | P | P | P | F#2 (dark) | F#8 | F#7 | P | F#2 (dark) | P | F#1 (dark) | P |
| S3 editing | P | P | P | F#2 (dark) | F#4 | F#7 | P | F#2 (dark) | P | F#1 (dark) | P |
| S4 dirty + leave | P | P | P | F#2, F#3 (dark) | F#4 | F#7 | P | F#2, F#3 (dark) | P | F#1 (dark) | P |
| S5 saved | P | P | P | F#2 (dark) | P | F#7 | P | F#2 (dark) | P | F#1 (dark) | P |
| S6 conflict | P | P | F#11 | P | P | P | P | F#5 | P | P | F#11 |
| S7 save as | P | P | P | F#2 (dark) | F#8 | F#7 | P | F#2 (dark) | F#12 | F#1 (dark) | P |
| S8 export fallback | P | P | P | F#2 (dark) | F#6 | F#7 | F#6 | F#2 (dark) | P | F#1 (dark) | P |
| S9 G3 fallback | P | P | P | P | P | P | P | P | P | P (note a) | P |
| S10 errors | P | F#10 | P | P | F#9 | P | P | P | F#10 | P | P |

Counts (screens failing / 10): 1: 0, 2: 1, 3: 1, 4: 6, 5: 6, 6: 6, 7: 1, 8: 7, 9: 2, A1: 6, A2: 1.
Total 37 failing cells of 110.

Per-combo spread (same code in every run, so the spread is theme and viewport, not language):

| issue | vi-light | vi-dark | en-light | en-dark | 1024 |
| --- | --- | --- | --- | --- | --- |
| #1 doc page recoloured | - | F | - | F | F (dark) |
| #2 File button contrast | - | F | - | F | F (dark) |
| #3 discard button contrast | - | F | - | F | F (dark) |
| #7 ribbon clipped at 1024 | n/a | n/a | n/a | n/a | F in all 4 |
| all other issues | F | F | F | F | F |

Passes worth stating: no horizontal page overflow and no double scrollbar in any run (`hOverflow=false`, frame
`hScroll=false`, iframe 1176x788 at 1440, 944x656 at 1024); host tab title synced (`docs-web.docx · UniWork Office`,
frame `<title>` `docs-web.docx`); frame `lang` and `data-theme` follow the host (`vi-VN`/`en-US`, `light`/`dark`);
the host paints a skeleton while the frame's own page loads, so no white flash in dark
(`02c-frame-html-pending.png`, `index.html` held 3.5 s); Vietnamese diacritics render correctly in host and frame,
including both dialogs and the ribbon; Ctrl+S saves (status bar "Đã lưu" / "Saved", save icon disables);
visible focus ring on the dialog buttons; the leave dialog offers Lưu lên UniWork / Bỏ thay đổi / Ở lại (Save to
UniWork / Discard / Stay); measured contrast is >= 4.6:1 for ribbon tabs, status bar, dialog body, loading label and
error text in both themes (except issues 2 and 3).

## Issues

### #1 Dark UI recolours the document page (A1), major, owner: fork renderer (theme tokens)
Crops: `crops/01-a1-dark-page-recoloured.png` vs `crops/01-a1-light-page-reference.png`.
In dark the frame draws the page as `rgb(30,30,30)` with `rgb(255,255,255)` body text (`metrics.json`:
`inner.proseBg`, `inner.proseColor`, all four dark runs). In light it is `rgb(255,255,255)` / `rgb(0,0,0)`. The
A1 check (theming never recolours the document, the page stays authored/white) fails.
Evidence: `screenshots/1440/vi-dark/02b-opened-editor-ready.png`, `1440/en-dark/03-editing.png`,
`1024/en-dark/02b-opened-editor-ready.png`.
Note (a): the G3 editor does the same in dark (`1440/vi-dark/09-flag-off-g3-editor.png`), so this is parity with the
existing editor, not a frame regression. If dark pages are a product decision, A1 should be relaxed and
this closed; if not, it needs a renderer change (page and text colours must come from the document, not the theme).

### #2 "File" button white on light blue in dark (4 tokens, 8 contrast), major, owner: fork renderer (dark accent token)
Crops: `crops/02-file-button-dark.png`, reference `crops/02-file-button-light-reference.png`.
White label on `rgb(74,158,255)` measures 2.75:1 (needs 4.5:1 for 13 px bold text). Light mode is 6.49:1.
Evidence: `1440/vi-dark/02b-opened-editor-ready.png`, `1024/en-dark/02b-opened-editor-ready.png`. Fix: dark label
colour on the accent, or a darker accent for filled buttons.

### #3 Discard button in the leave dialog, dark (4 tokens, 8 contrast), minor, owner: dev host (`packages/ui` destructive tokens)
Crop: `crops/03-discard-button-dark.png`.
"Bỏ thay đổi" / "Discard" is `rgb(248,113,113)` on `rgb(77,50,50)`, 4.18:1. Light mode is 5.64:1.
Evidence: `1440/vi-dark/04b-leave-dialog.png`.

### #4 No dirty indicator, stale status message (5 states), major, owner: fork renderer (status bar) with dev host (header)
Crops: `crops/04-status-bar-stale-opened.png`, `crops/04-frame-header-no-dirty-state.png`, reference `crops/04-g3-header-reference.png`.
After typing, nothing says the document is unsaved: the host header has no state or Save button in frame mode (the
G3 header shows "Chưa có thay đổi" / "Lưu", `1440/vi-light/09-flag-off-g3-editor.png`), and the frame status bar
keeps the stale "— Đã mở docs-web.docx" / "— Opened docs-web.docx". Only the save icon enabling and undo give a hint.
The leave dialog is therefore the first sign the user has unsaved work. Same stale message after Save as and export.
Evidence: `1440/vi-light/03-editing.png`, `1440/vi-light/04a-dirty.png`, `1440/en-dark/07b-save-as-in-progress.png`.

### #5 Conflict dialog focuses the destructive action (8 accessibility), major, owner: fork renderer
Crop: `crops/05-conflict-dialog-focus-overwrite.png`.
The frame's conflict dialog (Hủy / Tải lại bản mới nhất / Ghi đè; Cancel / Reload latest / Overwrite) opens with
focus on the dark filled "Ghi đè" / "Overwrite", so a stray Enter overwrites the other writer's version. Focus ring is
visible, labels are clear and translated. Default focus should be Cancel (or Reload latest).
Evidence: `1440/vi-light/06-save-conflict.png`, `1440/en-dark/06-save-conflict.png`, `1024/vi-dark/06-save-conflict.png`.

### #6 Export fallback status claims an export (5 states, 7 copy), minor, owner: fork renderer message
Crops: `crops/06-export-status-message.png` (vi), `crops/06-export-status-message-en.png`.
With 503 `office_not_configured` the frame prints in place, and the status bar says "Đã xuất PDF: docs-web.pdf
(browser print dialog)" / "PDF exported: docs-web.pdf (browser print dialog)". No PDF was produced, and in vi the
parenthesis is untranslated English. Better: "Đã mở hộp thoại in" style wording.
Evidence: `1440/vi-light/08b-export-print-fallback.png`, `1440/en-light/08b-export-print-fallback.png`.
(There is no visible in-progress state either, `08a-export-in-progress.png`.)

### #7 Ribbon Styles gallery clipped at 1024 (6 responsiveness), minor, owner: fork renderer (ribbon overflow)
Crops: `crops/07-ribbon-clipped-1024.png`, `crops/07-ribbon-clipped-1024-en-dark.png`.
At 1024x768 (iframe 944 px wide) the Styles gallery is cut off at the right edge with a sliver of the next cell and
a half-visible chevron, with no overflow affordance. Everything else in the ribbon fits, no horizontal scroll.
Evidence: `1024/vi-light/03-editing.png`, `1024/en-dark/02b-opened-editor-ready.png`.

### #8 Loading and save-as feedback (5 states), minor, owner: fork renderer
Crop: `crops/08-loading-state.png` (save-as progress: no crop, the absence is the finding, see `07b`).
While loading (`02a-opening-loading.png`) the ribbon is drawn (disabled) and the status bar says "Sẵn sàng" /
"Ready" next to the "Đang mở…" label. During Save as the frame shows no progress (`07b`); the page just changes URL.
Evidence: `1440/vi-dark/02a-opening-loading.png`, `1440/en-dark/07b-save-as-in-progress.png`.

### #9 Error states are generic (5 states), minor, owner: dev host (`DocxOpenSwitch` / frame error alert)
Crops: `crops/09-error-503.png`, `crops/09-error-network.png`, `crops/09-error-500-en-dark.png`.
Token mint 503 `office_not_configured` and a frame document fetch 500 show the same text "Không mở được trình soạn
thảo tài liệu / Trình soạn thảo tài liệu gặp lỗi" ("The document editor could not open / Something went wrong…").
Only the network error has a specific message ("Không kết nối được tới UniWork. Hãy kiểm tra kết nối mạng.").
On 503 `office_not_configured` the user cannot continue; falling back to the G3 editor (as flag-off does) or saying
the editor is unavailable on this deployment would be actionable. Retry works as a control.
Evidence: `1440/vi-light/10a-token-mint-503.png`, `10b-token-mint-network-error.png`, `1440/en-dark/10c-frame-open-500.png`.

### #10 Error alert layout (2 spacing/alignment, 9 polish), minor, owner: dev host
Crops: same as #9.
The alert sits flush at the top of the content area with a full-width Retry button, not aligned to the breadcrumb
column, and leaves the rest of the page empty. Readable and themed correctly in both modes.
Evidence: same as #9.

### #11 Conflict dialog scrim covers only the frame (3 consistency, A2 integration), minor, owner: fork renderer / host
Crops: `crops/11-scrim-frame-only.png` vs `crops/11-scrim-host-dialog-reference.png`. The two dialogs also differ in style (frame: flat dark filled primary; host: blue primary on a rounded inset panel).
The frame's dialog dims and blurs the iframe area only; sidebar and header stay bright, unlike the host's own leave
dialog which covers the whole page (`04b`). Two modal looks in one flow.
Evidence: `1440/vi-light/06-save-conflict.png` vs `1440/vi-light/04b-leave-dialog.png`.

### #12 Save as: no name step, copy looks identical (9 polish), minor, owner: dev host / bridge
Crop: `crops/12-copy-same-name.png`.
"Lưu thành…" / "Save As…" creates the copy immediately; the copy opens with the breadcrumb `docs-web.docx`, the same
name as the original, and nothing says a copy was made.
Evidence: `1440/vi-light/07c-save-as-copy-opened.png` (compare `02b`).

## Top issues for the lead (verdict NOT PASS while the four majors are open)
1. #4 no dirty indicator and a stale "Opened" message (major, fork status bar + host header).
2. #5 conflict dialog defaults focus to Overwrite (major, fork).
3. #1 dark mode recolours the document page (major, fork; same as G3, so maybe by design: needs a product call).
4. #2 File button 2.75:1 in dark (major, fork).
5. #9 error states do not distinguish "editor not available" from a crash (minor, host).

## Reproduce
`capture.spec.ts` needs the lane's e2e fixtures: copy to `e2e/zz-visual-capture.spec.ts`, change the
`../../e2e/` imports to `./`, then
`OFFICE_DOCS_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT VIS_OUT=<out> VIS_LANG=vi VIS_THEME=dark VIS_VP=1440 pnpm exec playwright test zz-visual-capture.spec.ts`
from `e2e/` (`VIS_ONLY=02c` runs one step). Each run seeds its own account and writes the flag override for its organization.
