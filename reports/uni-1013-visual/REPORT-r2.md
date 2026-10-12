# Visual re-test r2: Docs web frame (UNI-1013, lane GO-B2+B3)

**Verdict: PASS.** 0 blocking, 0 major open. 1 minor and 4 nits remain (listed below); all four round-1 majors are
fixed, and #1 is closed by the user decision (dark on-screen page is by design).

Tester V1 round 2. Test and evidence only; no product code changed. Round 1 is `REPORT.md` (c9f2214e5).

- Target: dev lane `d9687d38b` (F5 host fixes) merged into this branch, pin `0.1.0-4cd31f8`
  (fork `dist-web/docs/0.1.0-4cd31f8`, verified by `office-frame-sync`, 40 files).
- Stack: production `next build` of `apps/web`, Go server built from this tree, Postgres from `.env.worktree`.
  `office_engine` and `office_docs_web` on by ORGANIZATION override.
- Capture: same script (`capture.spec.ts`, extended), 1440x900 and 1024x768 in vi/en x light/dark = 8 runs,
  all passed with no failed step. Screens in `screenshots-r2/<1440|1024>/<lang>-<theme>/`, per-run `metrics.json`,
  crops in `crops-r2/`. Error mocks now use the server `ErrorSDO` shape `{error:{code,message}}`.
- New checks this round: conflict dialog focus + Esc + host inert (`06`, `06b`), the four typed failure states plus a
  frame-side 500 (`10a-10e`), a document with its own page colour in dark (`13`), print media and the saved file
  (`14`), copy name + toast (`07c`).
- Coverage note: every run was captured and metrics-checked automatically. I looked at about 30 of the 8 x ~23 PNGs by
  eye, plus pixel-measured contrast on every control that was a round-1 finding. Unseen images share code with seen ones.
- Not verifiable here: a real PDF export (no office engine locally; the fallback path is what runs) and the transient
  "Saving" / "Saving as" progress text (gone before the first capture frame; "Opening..." was captured).

## Round-1 issues

| # | Round-1 finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Dark UI recolours the document page (A1) | **Closed by user decision** (by design). Redefined A1 verified, see below | `crops-r2/r2-A1-own-page-colour-dark.png`, `r2-A1-print-media-dark.png` |
| 2 | File button 2.75:1 in dark | **Fixed**: 4.90:1 dark, 6.49:1 light | `crops-r2/r2-02-file-button-dark.png` |
| 3 | Discard button contrast, dark | **Fixed**: 5.58:1 dark, 6.25:1 light | `crops-r2/r2-03-discard-dark.png` |
| 4 | No dirty indicator, stale status | **Fixed**: host header "Chưa lưu / Đã lưu / Unsaved / Saved"; frame status bar "Có thay đổi chưa lưu / Đã lưu mọi thay đổi" with a coloured dot | `r2-04-header-unsaved.png`, `r2-04-status-unsaved.png`, `r2-04-header-saved-en.png` |
| 5 | Conflict dialog focuses Overwrite | **Fixed**: focus on Hủy / Cancel (`activeElement` BUTTON "Hủy"/"Cancel" in all 8 runs), Overwrite is a red danger button, Esc closes it (`06b`) | `r2-05-conflict-en-dark.png`, `r2-05-conflict-vi-light-full-scrim.png` |
| 6 | Export fallback claims an export | **Fixed**: "PDF export is unavailable here; the browser print dialog was used instead" / "Không xuất được PDF trực tiếp; đã dùng hộp thoại in của trình duyệt thay thế", fully translated | `r2-06-export-status-en.png`, `r2-06-export-status-vi.png` |
| 7 | Styles gallery clipped at 1024 | **Fixed**: the group collapses to one cell plus a chevron, nothing cut off | `r2-07-ribbon-1024.png` |
| 8 | Loading / save-as feedback | **Fixed** for opening (spinner + "Opening..." in canvas and status bar, status no longer says Ready). Saving / Saving-as progress not captured (transient) | `r2-08-opening.png` |
| 9 | Error states generic | **Fixed**: unavailable (info, "Mở bằng trình soạn thảo tiêu chuẩn"), network, denied, failed, each with its own icon, title and text | `r2-09-unavailable.png`, `r2-09-failed-dark.png`, `r2-09-denied-retry-nit.png` |
| 10 | Error alert layout | **Fixed**: centred Notice, themed in both modes, holds at 1024 | `r2-10-network-1024.png` |
| 11 | Scrim covers only the frame | **Fixed**: the whole page dims and the host chrome is inert (10 `[inert]` nodes while the dialog is open); frame dialog matches the host dialog look | `r2-05-conflict-vi-light-full-scrim.png` |
| 12 | Save as: same name, no feedback | **Fixed**: copy opens as "docs-web (bản sao).docx" / "docs-web (copy).docx" with a toast "Đã tạo bản sao ..." / "Created the copy ..." | `r2-12-copy-name.png`, `r2-12-copy-toast.png` |

Regressed: none of the twelve. One new finding (N1) is a side effect of the export path, see below.

## Redefined A1: print / export / saved file never recoloured

- Print media (`emulateMedia print`) in the dark UI: the frame page is `rgb(255,255,255)` with `rgb(0,0,0)` text in all
  4 dark runs (`metrics.json` `14-print-prose`; `r2-A1-print-media-dark.png`). Pass.
- Saved docx written from the dark UI: `word/document.xml` carries no colour or fill attributes and no `1E1E1E`
  (`14 saved-docx colour attrs ... []` in all 8 runs, dark runs included). The theme never leaks into the file. Pass.
- A document with its own page colour (`w:background FFF2CC`) in the dark UI keeps it: cream page, black text, dark
  chrome around it (`r2-A1-own-page-colour-dark.png`, vi-dark; the other dark runs captured `13-own-page-colour.png` too but I only viewed
  vi-dark and vi-light). Pass. Export to a real PDF was not testable (no engine locally).

## Result matrix (screen x criterion)

Canonical criteria: 1 hierarchy/typography; 2 spacing/alignment; 3 consistency with UniWork primitives + genoffice
look; 4 tokens + light/dark legibility; 5 states; 6 responsiveness; 7 vi/en copy; 8 visible accessibility;
9 polish; A1 (redefined above); A2 host-frame integration. P = pass in all 8 runs; F#n = finding n below.

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | A1 | A2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 list | P | P | P | P | P | P | P | P | P | P | P |
| S2 opened / loading | P | P | P | P | P | P | P | P | P | P | P |
| S3 editing | P | P | P | P | P | P | P | P | P | P | P |
| S4 dirty + leave | P | P | P | P | P | P | P | P | P | P | P |
| S5 saved | P | P | P | P | P | P | P | P | P | P | P |
| S6 conflict | P | P | P | P | P | P | P | P | F#N3 | P | P |
| S7 save as | P | P | P | P | P | P | P | P | F#N4 | P | P |
| S8 export fallback | P | P | P | P | P | P | P | P | F#N4 | P | F#N1 |
| S9 G3 fallback | P | P | P | P | P | P | P | P | P | P | P |
| S10 errors | P | P | P | P | P | P | P | P | F#N2 | P | P |
| New: own page colour (dark) | P | P | P | P | P | P | P | P | P | P | P |

Counts (screens failing / 11): 9: 4, A2: 1, all others 0. Total 5 of 121 cells; 0 blocking, 0 major, 1 minor, 4 nits.

Passes confirmed again: no horizontal overflow or double scrollbar in any of the 8 runs (`hOverflow=false`, frame
`hScroll=false`); tab title `docs-web.docx · UniWork Office`; frame `lang` and `data-theme` follow the host; no white
flash (host skeleton while the frame page loads, `02c`); Ctrl+S saves; vi diacritics correct everywhere; measured
contrast >= 4.5:1 on every previously failing control and on the new Notice and status text (min 4.53:1, the light
"Ghi đè" danger button, borderline but passing). The two round-1 contrast failures are now 4.90 and 5.58 or better.

## New findings

### N1 Frame chrome flips to light while exporting in the dark UI, minor (A2 integration), owner: fork renderer
While "Đang xuất PDF... / Exporting PDF..." is shown, the frame sets `data-theme="light"` (ribbon, status bar and
canvas turn white) but the document page stays dark and the host stays dark, so the screen briefly shows a white
ribbon over a dark page. It lasts as long as `window.print` is open (4 s with my stub; with the real print dialog the
browser's preview covers most of it). It reverts to dark afterwards (`08b` is dark again).
Crop: `crops-r2/r2-N1-export-chrome-flips-light.png` (vi-dark; `metrics.json` shows `dataTheme: light` during export in en-dark, vi-dark and the 1024 vi-dark run).

### N2 "Try again" on the denied state, nit (9 polish), owner: dev host
"Bạn không có quyền / You do not have access" offers a retry that cannot succeed. The unavailable state correctly
offers "Mở bằng trình soạn thảo tiêu chuẩn" instead; denied could offer the same or no button.
Crop: `crops-r2/r2-09-denied-retry-nit.png`.

### N3 Error toast covers ribbon commands after a failed save, nit (9 polish), owner: fork renderer
After dismissing the conflict dialog with Esc, the red toast "Save failed: the document was changed elsewhere" sits
over the ribbon's right half. It is informative (header and status bar also say Unsaved, which is good) but hides
controls until it times out.
Crop: `crops-r2/r2-N3-error-toast-over-ribbon.png`.

### N4 Leftover "Opened <name>" text in the status bar, nit (9 polish), owner: fork renderer
Next to the new "Đã lưu mọi thay đổi" the bar still shows "— Đã mở docs-web (bản sao).docx" / "— Opened ..." from the
last action, which no longer adds information (and after export it is replaced by the print message, fine).
Crop: `crops-r2/r2-N4-status-opened-leftover.png`.

## Not covered
Real PDF output (no engine locally), transient Saving / Saving-as text, the "bundle not installed" fallback
(round-1 W7 evidence has it), version history UI (the host shows none for a docx).

## Reproduce
Copy `capture.spec.ts` to `e2e/zz-visual-capture.spec.ts`, change the `../../e2e/` imports to `./`, then from `e2e/`:
`OFFICE_DOCS_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT VIS_OUT=<out> VIS_LANG=vi VIS_THEME=dark VIS_VP=1440 pnpm exec playwright test zz-visual-capture.spec.ts`
(`VIS_ONLY=13` runs one step).
