# UNI-1994 nit 6 visual round 4: scenario C (Edited by / Updated filters) + A sanity (tester_visual, bro, head fb57d329c, 2026-10-20)

Build under test: bro worktree `/home/ubuntu/orca/workspaces/uniwork/feature-UNI-1994-doc-nits` @fb57d329c (already fast-forwarded, no product edits by me; `git status` clean afterwards, `apps/web/next-env.d.ts` restored after `next build`). Only the web app was rebuilt (`build-web-r4.sh`: `nice pnpm --filter @uniwork/web build`, Node 22 via nvm, started as `flock -o ~/office-g5g6g7/automation/state/heavy.lock bash -lc …`, lock held for the build step only, `logs-r4/web-build.log`, 0 lines matching "error"). The server binary from earlier rounds was reused (no server code changed since round 3). Fresh DB `uniwork_visual_1994d`, migrated with `go run ./cmd/migrate up` (`logs-r4/migrate.log`), ports 18850/13770 (and 19860, 13771) confirmed free with `ss` before the start, local storage `uploads-r4/` (0 files).
Load gate: before the build 5-min load 7.15 / MemAvailable 9.4 GB. The build pushed other lanes' load up (1-min 17, 5-min 11.0); I waited with a poll until the 5-min load was 7.93 (< 8) before starting the servers, MemAvailable 10.0 GB; the matrix started at 5-min 7.72, finished at 6.58. One app at a time, no parallel runs.
Evidence (local and on bro in `~/office-g5g6g7/reports/docs-ui_local/visual-1994/`): `shots-r4/` (146 files, `r4-<step>-<loc>-<mode>-<width>.png`), `logs-r4/r4-all.out` (every check, 0 `ERROR`), `logs-r4/samples-all.out` (every sampler tick, 120 runs, 3514 ticks), `logs-r4/r4-control.out`, `api-checks-r4.json`. Drivers: `seed-r4.mjs`, `r4.mjs`, `ctrl-r4.mjs`. Earlier rounds' files untouched.

## Verdicts

| Item | Verdict | One line |
| --- | --- | --- |
| C1 Edited by = a person, 0 results | **PASS** | 12/12 for "Me" and 12/12 for "Minh Tran": no-results title + "these filters" description + Clear filters, folder card still visible, workspace-empty copy never, scoped copy never |
| C2 Updated = Today, 0 results | **PASS** | 12/12, same state |
| C3 type chip (Sheets), 0 results (control) | **PASS** | 12/12 no-results title kept, the type-specific description kept ("No files of this type…"), Clear filters, no workspace-empty, no scoped |
| C4 search "zzqxk", 0 results (control) | **PASS** | 12/12 separate "No results" panel with All / Folders / Documents tabs; no workspace-empty, scoped or home no-results title |
| C5 Clear filters | **PASS** | 48/48 clicks (C1, C1b, C2, C3 x 12 combos): the scoped state and the folder card come back, filters read Any again, no Clear button left, workspace-empty never seen, URL back to `/documents`. Search box emptied (12/12): scoped state + folder card back |
| A sanity: unfiltered root, a folder, 0 loose docs | **PASS** | scoped copy 12/12 cold + 12/12 client navigation; the 100 ms sampler never saw the workspace-empty title (0 of 3514 ticks, `wsEver=false`, `wsMut=false` in all 120 runs) |

C5 count: Clear filters was clicked after C1 (Me), C1b (Minh Tran), C2 and C3 in each of the 12 combos = 48 clicks, 48/48 returned to the scoped state (`C1-editor-clear`, `C1b-editor-other-clear`, `C2-updated-clear`, `C3-type-clear` lines, `SC=true NR=false WS=false folderCard=true clearBtnsLeft=0`).

**Blocking: none. Major: none.** F-R3-1 (round 3 major) is fixed. One minor (F-R4-1) and one nit (F-R4-2) below.

## Seed
`seed-r4.mjs` over the HTTP API, the same shape as round 3: one org; workspace A has the folder "Kế hoạch kinh doanh quý bốn" holding a page and the sub-folder "Hợp đồng khách hàng" with two pages, zero loose root documents (`api-checks-r4.json`: only that one folder has `parent_id: null`); Minh is a member of A with the two sub-folder pages shared. Workspace B (same org) is empty (`owner_wsB_documents: []`, `owner_wsB_folders: []`). Because there are no loose root documents, every filter result is 0, which is what C needs. "Edited by" lists `Any / Me / Olivia Owner / Minh Tran`; I ran "Me" (C1) and the last entry, Minh Tran (C1b). "Updated" lists `Any time / Today / 7 days / 30 days`; I ran "Today" (C2).

## C1 / C2: Edited by and Updated with 0 results: PASS
Each combo: cold root load, wait 3.5 s, open the filter listbox, pick the option, wait 2.2 s, read the Documents section, with the sampler re-armed before the pick (`wsEverDuringChange`).
- Copy, en: title **No documents match the filters**, description **No documents match these filters. Clear the filters to see everything.**, button **Clear filters** (`r4-C2-updated-en-light-1280.png`, viewed). vi: **Không có tài liệu khớp bộ lọc** / **Không có tài liệu nào khớp bộ lọc. Bỏ lọc để xem tất cả.** / **Bỏ bộ lọc** (`r4-C2-updated-vi-light-768.png`, `r4-C1-editor-vi-dark-390.png`, viewed). The `status` object in `r4-all.out` carries exactly these strings: over the 24 C1 and C2 lines, 12 en-form and 12 vi-form (counted with `sort | uniq -c`; C1b and C3 `status` read in the log lines).
- Per combo: `NR_TITLE=true DESC=true WS=false SC=false clearBtns=1 folderCard=true` in 12/12 for C1, 12/12 for C1b, 12/12 for C2. `wsEverDuringChange=false wsMut=false` in all 36: the workspace-empty title is not even seen for one tick while the filter applies. The no-results title shows from 69 to 254 ms after the pick over the 36 C1/C1b/C2 runs (`nrFirstAt`).
- The folder card ("Folders 1" + card) stays visible above "Documents 0" in every shot viewed.
- No horizontal scroll (`scrollW == clientW` in all 72 `geom=` fields of A, C1, C1b, C2, C3, C4, counted by script).
- vi and en copy read right: the title names the filters, the description says what to do (clear them), the button does it. Both languages are plain and natural, and the word for the filter is the one the toolbar uses ("Bộ lọc" / "Filters"). Small wording nit F-R4-2 below.

## C3 / C4: controls, unchanged: PASS
- C3 type chip Sheets: title "No documents match the filters" / "Không có tài liệu khớp bộ lọc" (the same title as before the fix), description **"No files of this type. Create one above or clear the filter."** en (`r4-C3-type-en-dark-768.png`, viewed), vi **"Không có file loại này. Tạo mới ở hàng thẻ phía trên hoặc bỏ lọc."** (`status` in the vi-light-1280 line), Clear filters button. It still names the file type, not "these filters", as before. 12/12.
- C4 search "zzqxk": separate results panel, en "No results / Try another name or change the filter. Clear the search to go back to the folder." (`r4-C4-search-en-dark-390.png`, viewed), vi "Không tìm thấy kết quả / Thử tên khác hoặc đổi bộ lọc. Xóa ô tìm để quay lại thư mục."; `WS=false SC=false NR=false` 12/12. This panel replaces the folder card by design, as in round 3.
- Round 3 comparison is by its report (C-type and C-search rows), not by re-running the old build.

## C5: Clear filters: PASS
After each C1/C1b/C2/C3 run the Clear filters button of the empty state was clicked (`clicked=first button of 1`, there is exactly one Clear button on the screen in every run). Result 48/48: `SC=true NR=false WS=false folderCard=true clearBtnsLeft=0`, filters back to "Any" (`r4-C1-editor-clear-en-light-390.png`, viewed: "Type: All / Edited by: Any / Updated: Any time", "Folders 1" card, "No documents outside folders" + the scoped hint), `wsEverDuringClear=false`. Search: clearing the box returns the scoped state and the folder card, 12/12 (`C4-search-cleared`).

## A sanity: unfiltered root with a folder and 0 loose docs: PASS
- Cold load, sampler armed at document start (MutationObserver on the whole document + 100 ms poll, 6 s window, the same sampler as round 3): `A <tag>` lines, 12/12 `wsEver=false wsMut=false`, scoped title seen first at 1.2–2.6 s (slow cold mount on this shared host), 50–56 ticks per run. Client navigation (folder page, then the first crumb back to the root, sampler re-armed before the click): `A-clientnav <tag>`, 12/12 `wsEver=false wsMut=false`, scoped title first seen 189–391 ms after the click, 61 ticks per run. Across all 120 runs `grep -c "WS_EMPTY=1" samples-all.out` gives 0 of 3514 ticks.
- Copy kept: en "No documents outside folders" / "Look in the folders above, pick a type in the Create row, or drop files here to upload one outside them." (`r4-C1-editor-clear-en-light-390.png`), vi "Không có tài liệu nào ngoài thư mục" / "Hãy xem trong các thư mục phía trên, chọn một loại ở hàng Tạo mới, hoặc kéo thả file vào đây để tải lên ngoài thư mục." (`r4-A-final-vi-dark-1280.png`, viewed), folder card above the Documents heading.
- Sampler control (so a silent sampler is ruled out): `ctrl-r4.mjs` runs the same sampler on the empty workspace B (en and vi, light, 1280) and sees the workspace-empty title in both: `CONTROL-B en wsEver=true at 1137 ms`, `vi wsEver=true at 1289 ms` (`logs-r4/r4-control.out`, `r4-CONTROL-B-*-light-1280.png`). Run once at the end, not per combination.

## UI quality
Viewed by eye, all styled with no placeholder, raw-DOM or unstyled screen: C2 en light 1280 (full shell), C2 vi light 768, C3 en dark 768, C1 vi dark 390, C4 en dark 390, C5 en light 390, A vi dark 1280. Dark mode is legible, the icon (search for no-results, open folder for scoped), title, hint and button are centred and consistent between the three states. The other 139 shots are covered by the text and geometry logs, not by eye (counted: 7 viewed of 146). Not checked: hover states, screen reader.

| ID | Sev | Screen | Finding | Evidence |
| --- | --- | --- | --- | --- |
| F-R4-1 | minor | Documents root at 390, no-results state (C1/C1b/C2/C3), dark and light | The home page does not scroll as a document but its inner section does: the description's second line is cut by the fold and the Clear filters button sits below it, reachable only by an inner scroll without a cue. Same family as F-R3-2, and the type-chip no-results shares it (it is not new to nit 6). The click on Clear filters worked at 390 in all 16 mobile runs (Playwright scrolls it into view), so it is reachable, not blocked | `r4-C1-editor-vi-dark-390.png` (viewed: "Không có tài liệu nào khớp / bộ lọc. Bỏ lọc để xem tất cả." half cut, no button visible); `r4-all.out` `status` bottom 964 vs viewport 844 in all 16 390 runs |
| F-R4-2 | nit | Documents root, home no-results copy | Title and description nearly repeat each other: "No documents match the filters" then "No documents match these filters." (vi the same, "…khớp bộ lọc" then "…nào khớp bộ lọc"). Reads fine, a little redundant | `r4-C2-updated-en-light-1280.png`, `r4-C2-updated-vi-light-768.png` |

## Method notes (stated, not hidden)
- Filters are listbox buttons (`main button` with the label, then `getByRole("option")`), as in round 3. The pick for Edited by is by index (1 = Me, last = Minh Tran), for Updated index 1 (Today), type index 3 (Sheets).
- Playwright, one login per combination (rotating refresh cookie), theme via browser colour scheme, locale via the `uniwork-locale` cookie. The sampler is re-armed per navigation, filter change and Clear click.
- C1b (Minh Tran) is an addition to the asked "a person". The first single-combination trial run (`ONLY=vi-light-1280`) was used to check the script, its files were deleted before the full run (`logs-r4/r4-vi-light-1280.out` and `samples-vi-light-1280.out` remain, from that trial; the type-description regex was fixed afterwards, nothing else).
- The no-results text on the page was matched by regex against the English and Vietnamese titles and descriptions, and the full text is in the `main=` and `status=` fields of `r4-all.out`; I judged "reads right" from those and the viewed shots, as a reader, not a native-language review.
- Shot lag: shots are taken 2.2 s after the action, so they show the settled state, not transitions; transitions are covered by the sampler logs.

## Cleanup
- Servers stopped by PID, descendants first, `kill -TERM`, no `pkill`, nothing by image name: `check-server` **1708028**, `pnpm exec next start` **1708029**, `next-server` **1708141** (`killed-pids-r4.txt`). `ss` shows 18850, 13770 and 19860 free afterwards; no `r4.mjs`/`ctrl-r4.mjs` process left.
- DB `uniwork_visual_1994d` dropped (`DROP DATABASE … WITH (FORCE)` via `docker exec uniwork-postgres-1`; the listing shows 0 `uniwork_visual_1994*`). Org, workspaces and users lived only in that DB. `uploads-r4/` holds 0 files; Redis db 5 holds only the throwaway users' session keys, left to expire.
- Bro worktree clean at fb57d329c (`git status` empty); `.next` stays in the worktree. Shots and logs kept locally and on bro. Nothing committed or pushed, no `--no-verify`, no `--interrupt`. `env-r4` here has its secrets replaced by `***`.

VISUAL_1994_R4_DONE
