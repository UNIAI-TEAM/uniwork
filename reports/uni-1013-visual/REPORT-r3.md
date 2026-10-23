# Visual recheck r3: Docs web frame after the fork main merge (UNI-1013, lane GO-B2+B3)

**Verdict: PASS.** 0 blocking, 0 major open. 3 new minor findings, and 2 minor + 2 nits carried over from r2.
Tester V1 round 3 (Sonnet 5.5). Test and evidence only. r2 is `REPORT-r2.md` (4a947ac92).

- Target: dev lane `8ac1108b6` merged here, pin `0.1.0-8687750` (46 files verified by `office-frame-sync`),
  `office_docs_web` default ON. S9 uses an explicit org override to false, as asked.
- Capture: the r2 script (+ a ribbon step: Home / References / View tabs, overflow probe, click the Styles card),
  production `next build`, 6 runs, all passed: vi/en x light/dark at 1440x900 plus vi-light and en-dark at 1024x768.
  Screens in `screenshots-r3/`, per-run `metrics.json`, 23 crops in `crops-r3/`.
- Scope: S2-S9 only (S1 list and S10 error states were not changed by this merge and were not re-judged).
  I read about 30 of the ~140 PNGs by eye plus every ribbon/overflow metric; unseen images share code with seen ones.
- Not verifiable here: a real PDF export (no engine locally; the print fallback runs), transient Saving text.

## Matrix (screen x criterion), canonical 9 + A1 + A2

P = pass in all runs, F#n = finding n below.

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | A1 | A2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S2 opened | F#1 | P | P | P | P | P | P | P | P | P | P |
| S3 editing + ribbon (Home/References/View) | F#1, F#2 | P | P | P | P | F#3 | P | P | P | P | P |
| S4 dirty + leave | P | P | P | P | P | P | P | P | P | P | P |
| S5 saved | F#1 | P | P | P | P | P | P | P | P | P | P |
| S6 conflict | P | P | P | P | P | P | P | P | F#N3 | P | P |
| S7 save as | P | P | P | P | P | P | P | P | F#N4 | P | P |
| S8 export fallback | P | P | P | P | P | P | P | P | F#N4 | P | F#N1 |
| S9 flag off -> G3 | P | P | P | P | P | P | P | P | P | P | P |

Failing cells: 1: 3, 6: 1, 9: 3, A2: 1 = 8 of 88. All minor or nit.

## r2 findings

| r2 | Status | Evidence |
| --- | --- | --- |
| N1 chrome flips light while exporting in dark (minor) | **Still open**: `data-theme` is light for the whole export pass while the page stays dark | `crops-r3/r3-N1-export-chrome-flips-light.png` |
| N2 Try again on denied (nit) | **Not rechecked** (S10 unchanged by this merge, out of scope) | - |
| N3 failed-save toast covers the ribbon (nit) | **Still open**: the toast sits over the right half of the ribbon (`06b`) | `r3-S6-conflict-en-dark.png`, `screenshots-r3/1440/en-dark/06b-conflict-after-escape.png` |
| N4 leftover "Opened <name>" next to "All changes saved" (nit) | **Still open** (after open, copy; replaced by the print message after export, as before) | `r3-N4-status-opened-leftover.png` |
| A1 redefined | **Holds**: print media page is `rgb(255,255,255)` / `rgb(0,0,0)` in dark (all dark runs); saved docx has no theme colours; own page colour FFF2CC kept in dark | `r3-A1-print-media-dark.png`, `r3-A1-own-page-colour-dark.png` |
| r2 fixes re-verified after the merge | Dirty/saved header and status bar (vi + en), conflict dialog focus on Cancel/Hủy in all 6 runs with host inert (10 nodes), Esc closes, leave dialog and danger button contrast (visual), vi "Lưu dưới dạng…" in the File menu, copy named "(bản sao)/(copy)" + toast, print message "Không xuất được PDF trực tiếp; đã dùng hộp thoại in…" | `r3-S4-*`, `r3-S5-*`, `r3-S6-*`, `r3-S7-*`, `r3-S8-*` |

No r2 fix regressed.

## New findings

### #1 Font name box is empty in the frame, minor (1 typography, 5 states), owner: fork renderer
In the Home tab the font-name combobox shows nothing at open, while typing, after save and after Save as, in all runs.
r2 showed "Calibri (Nội dung) / Calibri (Body)" for the same file and the G3 editor shows "Calibri" now. The size box
works (10 / 16). The empty box gives no sign of the current font; not a dead control (the dropdown arrow remains).
Crops: `r3-F1-font-box-blank-frame.png` vs `r3-F1-font-box-g3-reference.png`.

### #2 Styles gallery at 1440 hides the Normal card, nit (3 consistency), owner: fork renderer
At 1440 the Styles group shows "Heading 1, Heading 2" + expander + "Styles Pane" button; the Normal card is not visible
(gallery scrolled to the selection, the expander has the rest). It is a window onto the list, not clipped. At 1024 the
group is one whole card ("Heading 1" / "Tiêu đề 1") + expander + "Ngăn kiểu / Styles Pane", the card is clickable
(clicking it applied the style: the paragraph became 16 pt bold, `03b-styles-heading1-applied.png`). F12 works as described.
Crops: `r3-F2-styles-1440-no-normal-card.png`, `r3-S3-styles-1024-en-dark.png`, `r3-S3-styles-1024-card-clickable-vi.png`.

### #3 Ribbon scrolls horizontally with no visible affordance, minor (6 responsiveness), owner: fork renderer
The ribbon body is `overflow-x: scroll` with no visible scrollbar or fade. It overflows:
- View tab at 1440 in vi (1262 px of content in 1176): last item "Ngăn điều hướng" is cut at the edge; en is nearly
  fitting (1190 in 1176).
- View tab at 1024: "Thước kẻ / Ruler" is half cut (1156-1228 in 944).
- Home tab at 1024: 1051 / 1058 in 944, the Find / Replace / Select All group is off-screen, and "Styles Pane" touches
  the edge. Nothing breaks the host page (`hOverflow=false`; no double scrollbar), and References fits everywhere.
Users can scroll (wheel / trackpad / drag), but nothing says so. Crops: `r3-F3-view-tab-clipped-1440.png`,
`r3-F3-view-tab-clipped-1024.png`, `r3-S3-references-tab.png`.

## Passes confirmed
No horizontal overflow of the host page or double scrollbars in any run; tab title `docs-web.docx · UniWork Office`;
frame `lang` and `data-theme` follow the host; no white flash (host skeleton); Ctrl+S saves; vi diacritics correct in
the new ribbon strings (Tham khảo, Bố trí, Ngăn kiểu, Thước kẻ, Đường lưới, Chế độ tối); References tab fits at 1440 and
1024; G3 fallback via org override renders the full G3 editor with its own header (`r3-S9-g3-en-light.png`).
Flag default ON: a fresh org opened the frame with no override. Note: the G3 editor still draws a dark page in dark
like before (by-design decision).

## Reproduce
Copy `capture.spec.ts` to `e2e/zz-visual-capture.spec.ts`, change `../../e2e/` imports to `./`, then from `e2e/`:
`OFFICE_DOCS_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT VIS_OUT=<out> VIS_LANG=vi VIS_THEME=dark VIS_VP=1440 pnpm exec playwright test zz-visual-capture.spec.ts`.
