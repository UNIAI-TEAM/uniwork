# UNI-1994 DOC-NITS visual round (tester_visual, bro, head 64bd41676, 2026-10-20)

Build under test: bro worktree `/home/ubuntu/orca/workspaces/uniwork/feature-UNI-1994-doc-nits`, branch `feature-UNI-1994-doc-nits` @64bd41676 (clean, no product edits).
Stack: production `next build` + `go build` server (build step only under `heavy.lock`, 6m03s; install 27s), fresh DB `uniwork_visual_1994`, ports 18850 (API) / 13770 (web) checked free with `ss` first, local storage, Node 22, servers and shots under `nice`, unlocked.
Seed (`seed.mjs`): owner Olivia, member Minh (no folders of their own). Folders "Kế hoạch kinh doanh quý bốn" > "Hợp đồng khách hàng" (the 19-char seed name). In the inner folder, three pages shared to Minh at `comment` ("Biên bản nghiệm thu dự án"), `view` ("Báo cáo tham khảo quý ba") and `edit` ("Kế hoạch chung của nhóm" level, a fresh copy per combination, see Method). One unfiled page "Ghi chú họp tuần" shared view. API proof of levels: `api-checks.json` (`my_level` comment / view / edit, `parent_id` null for Minh, `recipient_folders` empty).
Matrix: vi/en x light/dark x 1280 / 768 / 390 = 12 combinations, `shots/` (217 files; names `<step>-<loc>-<mode>-<width>.png`). Metrics and text dumps: `logs/shots.out` (576 lines, 0 `ERROR`), `logs/shots-touch.out` (coarse-pointer 390 pass), `logs/probe.out`, `logs/probe2.out`. Scripts: `seed.mjs shots.mjs probe.mjs probe2.mjs env build.sh run.sh`.

## Verdict per nit

| Nit | Verdict | One line |
| --- | --- | --- |
| 1 Comment badge | **PASS** | comment reads View and comment / Xem và nhận xét; view still View only / Chỉ xem; edit shows none; 12/12 |
| 2 Folder leaf | **FAIL** (major) | the leaf h1 is still visibly ellipsized ("Hợp đồng khách hà…") at 1280, 768 and 390 in all 8 locale/theme combos; the requested metric `scrollWidth == clientWidth` passes anyway, which hides it |
| 3 Folder by document URL | **PASS** | ends on `/documents?folder=<id>`, no banner at any moment, back is not a trap; 12/12 |
| 4 Grouping | **PASS** | recipient: no "Not in a folder" header 12/12; owner: folder groups and the unfiled header both present |
| 5 New menu | **PASS** (minor finding) | switch is separated from Folder and Upload stays reachable below it at 390; the switch no longer reads as applying to Folder; one minor affordance finding |

Blocking: none. Major: 1 (nit 2). A pass needs no open major finding, so **this build does not pass**; nit 2 needs a fix and a recheck.

## Nit 1 — comment-level badge: PASS
Recipient Minh opens each page by `/documents/<id>`; visible read-only text (text nodes and `title` attributes that are rendered) in `logs/shots.out` lines `recipient-comment|view|edit <tag>: ... readonly-texts=`.
- **comment** page, <640 (390, header chip): en `View and comment`, vi `Xem và nhận xét` (with diacritics), chip `title` = "You can read the committed copy and comment on it, but not edit it…" / "Bạn xem và nhận xét được trên bản đã lưu trên server nhưng không chỉnh sửa được…". Shots `11-recipient-comment-{vi,en}-{light,dark}-390.png`. At 1280/768 the notice strip carries the comment wording ("…and comment on it…" / "…xem và nhận xét được…"), shot `11-recipient-comment-vi-dark-1280.png`. "View only" / "Chỉ xem" never appears on a comment page in any of the 12.
- **view** page (control): 390 chip `View only` / `Chỉ xem`; 1280/768 strip "You can read and download the committed copy, but not edit it…" / "Bạn xem được bản đã lưu…". Still view wording in 12/12.
- **edit** page: `readonly-texts=[]` in 12/12, editor with toolbar (`11-recipient-edit-en-dark-768.png`). Each combination uses a freshly created page so an editor lock from an earlier run cannot colour it (the first trial showed "You're editing this document in another window" on a reused page; that was a lock, not the level, and was removed from the evidence).
- Not a defect, worth knowing: at ≥640 the header chip is hidden by design (`sm:hidden` in `document-readonly-chip.tsx`); the level is carried only by the notice strip sentence there, which names the level in words but has no short badge label.
- Not covered: the file-view hint (`readonly_comment_hint`) needs a file document; none was seeded.

## Nit 2 — folder leaf with the 19-char name: FAIL (major)
Requested metric: h1 `scrollWidth == clientWidth` at 1280 and 768, measured by `shots.mjs` (`folder-page h1`): 164 == 164 in all 12 combinations (1280, 768, 390), `ellipsized:false`. The metric is green, **the pixels are not**:
- `shots/04c-leaf-crop-*` (2x crop of the crumb row): 1280 vi-light "Tài liệu củ… › Kế hoạch kin… › **Hợp đồng khách hà…**", 390 en-dark "Wor… › Kế… › **Hợp đồng khách hà…**". Same in `04-folder-page-*-1280/768/390` (e.g. `04-folder-page-vi-light-1280.png`, `04-folder-page-vi-light-768.png`, `04-folder-page-en-dark-390.png`). At 1920 the same row shows the whole name (`04p-probe-folder-page-vi-light-1920.png`), so it is the squeeze, not the text.
- Why the metric misses it (`logs/probe2.out`): natural text width 156 px, content box 155.83–155.91 px (box 164 minus 2 x 4 px padding), shortfall 0.09–0.17 px at 1280/768/390 in vi and en, light and dark. The flex shrink gives the leaf under a pixel, Chromium ellipsizes, and `scrollWidth` rounds back to 164. Only at 1920 (shortfall 0–0.02) is it whole.
- Coarse pointer (390 touch pass, `logs/shots-touch.out`, `shots/04-folder-page-touch-*-390.png`): the leaf box is 130 px, `scrollWidth 164 > clientWidth 130` → ellipsized by 34 px, reads "Hợp đồng khác…" (`04-folder-page-touch-vi-light-390.png`). The ancestors are already at their 44 px minimum there.
- "Ancestors shrink first" holds (they are cut to "Tài liệu củ…", "Kế hoạch kin…") but the leaf loses 2–5 characters as well, in every width below 1920. This is the residual of the earlier rounds' nit (1977 nit 1, 1974 nit 3), not fixed.
- Suggested fix direction (not applied, I do not edit product code): the leaf needs a minimum equal to its natural width (or 1–2 px slack) while the ancestors still have room to give, and a rule for what the leaf does once they are at min.
- Rest of nit 2 that passes: 390 wraps cleanly in three rows (crumbs + pencil + folder actions / "More actions" + Browse + New / search), `overlaps=[]` in all 16 runs (`folder-page header` lines), every control in the header is 44 px tall on the coarse-pointer pass (`minH=44`; the fine-pointer 28/20 px is the desktop size by design), `scrollWidth == clientWidth` on the page in every run.

## Nit 3 — folder opened by its document URL: PASS
`06a-folder-detail-early-*` (shot right after `domcontentloaded`: the app boot splash only), `06-folder-detail-final-*`, `06b-after-back-*`. A `MutationObserver` + 40 ms poll watched the visible text for "has no file yet" / "chưa có tệp" from the first frame.
- Final URL in 12/12: `/{org}/{ws}/documents?folder=01M5BJ6H7T2CWEQXZ6BFCV2GDN`; URL history seen: `/documents/<id>` then `/documents?folder=<id>` (replace, one hop). `seen.banner:false`, `bodyHasBanner=false` in 12/12 (`logs/shots.out`, `folder-detail <tag>`). The first version of my observer read `textContent` (includes Next's inline script data) and reported a false hit at 28 ms; fixed to visible text and the whole matrix rerun.
- Back: `goBack` once → `/documents` (the page before), not the detail URL again; a second `goBack` → the earlier folder page entry from my own navigation, no loop (`back1`/`back2` lines).
- Control: a normal page by the same route stays at `/documents/<id>` with its editor, no redirect (`07-page-control-*`, 12/12, `seen.urls` has one entry, banner false).

## Nit 4 — grouping: PASS
- Recipient Minh, Shared with me, default Group by Folder, no folders: 12/12 with no unfiled header and a flat list of the four shares with level labels View only / Edit / Comment (`10-recipient-shared-with-me-*`, e.g. `-en-dark-1280.png`; text check for `Not in a folder|Chưa xếp thư mục` = 0 of 12). Sidebar says "No folders yet.".
- Owner with folders: Shared by me (`09-shared-by-me-*`) shows "Not in a folder 1" and the folder group "Kế hoạch kinh doanh quý bốn / Hợp đồng khách hàng 3"; Recent (`09b-recent-*`, e.g. `09b-recent-vi-light-390.png`) shows "Folders 1", "Not in a folder 1" / "Chưa xếp thư mục 1" and the folder group. Header present only where there are other groups.

## Nit 5 — New menu: PASS, one minor finding
`02-new-menu-home-*`, `02b-new-menu-folder-*`, crops `02c-…-crop-*` and `02d-…-crop-*`, geometry in `logs/shots.out` (`new-menu folder|home <tag>`).
- Folder page order: Folder · rule · UniNote · rule · Docs / Sheets / Slides / Markdown / HTML / PDF · rule · **Share with workspace** (at the end, 427–463 px at 1280; Folder at 112–148 px) · at <640 rule + **Upload** below it. Home: UniNote · … · PDF · rule · switch, no Folder entry. All 24 menus inside the viewport.
- 390: Upload entry visible and below the switch in 4/4 (`upload item visible=true`, y 504–540 of 844, `02b-new-menu-folder-vi-dark-390.png`). ≥640 the Upload button is in the header, the menu entry is hidden (`visible=false`, by design).
- My judgment: it no longer reads as if it applied to Folder. Folder sits eight rows up behind two rules; the switch hugs the document kinds it closes. Minor (F3): when off, the row is plain text with no switch/check indicator, so it looks like an action, not a toggle; the Quick create strip on Home shows a real switch pill (`01-home-vi-dark-768.png`), the menu does not. The "on" hint line was not captured.

## UI quality (per screen, light/dark, vi/en, 1280/768/390)
Everything rendered styled, no unstyled/placeholder/raw-DOM screen; dark mode legible in all viewed shots; scrollWidth == clientWidth in all 120 recorded runs plus 4 touch runs (no mismatch). Viewed: folder page, home, shared-by-me, recent, recipient list, three recipient pages, 06 early/final, New menu (home/folder, 3 widths), page control.

| ID | Sev | Screen | Finding | Shot |
| --- | --- | --- | --- | --- |
| F1 | major | folder page | leaf name ellipsized below 1920 (details in nit 2) | `04c-leaf-crop-vi-light-1280.png`, `04-folder-page-touch-vi-light-390.png` |
| F2 | minor | recipient page 390 | the title is cut ("Biên bản ng…", "Báo cáo tham k…") next to the read-only chip; correct, but the chip takes the room | `11-recipient-comment-vi-dark-390.png`, `11-recipient-view-en-light-390.png` |
| F3 | minor | New menu | switch row has no off-state toggle affordance, looks like an action | `02d-new-menu-folder-crop-en-light-390.png` |
| F4 | nit | folder header | two "⋯" buttons side by side (Folder actions and More actions), told apart only by aria-label/tooltip | `04c-leaf-crop-vi-light-1280.png`, `04-folder-page-en-dark-390.png` |
| F5 | nit | recipient sidebar | "No folders yet." sits flush left, not aligned with the items above | `10-recipient-shared-with-me-en-dark-1280.png` |

Hierarchy, spacing, primitives, tokens, states (empty page bodies are seed content, not a defect), a11y labels (menuitemcheckbox with aria-label, buttons named) and vi/en copy: no other issue seen. Not checked: hover states, screen reader.

## Method notes and gaps (stated, not hidden)
- A first matrix run reused one login across combinations; the rotating refresh cookie went stale so later combinations landed on the login page. Discarded, script changed to log in per run, whole matrix rerun (the shots here are all from the rerun).
- New menu at 390 was measured with a fine pointer; the coarse-pointer pass covers the folder page header only (44 px targets there). Menu items would be 44 px high on touch (`pointer-coarse:min-h-11` in the source), not measured.
- Bro load gate: the matrix started at 5-min load 7.91 (1-min 8.9, others' work); the two trial runs and the first width probe (`probe.mjs`, one browser, ~1 minute) ran while the 5-min load was 8.6–9.1, i.e. above the 8 gate. `probe2.mjs` ran at 7.89 after waiting.
- `scrollWidth` is not a reliable ellipsis test for sub-pixel squeeze (see nit 2); use the natural-vs-content width in `probe2.mjs` or the pixels.

## Cleanup
- Servers stopped by PID, `kill -TERM` on the tree: 1359840 (next-server), 1359776 (pnpm exec next start), 1359775 (check-server); no process left, ports 18850/13770 free (`killed-pids.txt`). No `pkill`, no kill by image name, nothing under another lane touched.
- DB `uniwork_visual_1994` dropped (`DROP DATABASE … WITH (FORCE)`, listing shows 0). Storage was local (`uploads/` has 0 files); no MinIO prefix was used, so nothing to empty. Redis db 5 keys are session data of the throwaway users, left to expire.
- Bro worktree: `apps/web/next-env.d.ts` (rewritten by `next build`) restored, `git status` clean at 64bd41676; `node_modules` and the builds stay in the worktree. Shots and logs kept as evidence in `~/office-g5g6g7/reports/docs-ui_local/visual-1994` and copied here.
- Local: this directory is untracked in the worktree; nothing committed or pushed.

VISUAL_1994_DONE
