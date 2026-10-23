# UNI-1977 quick recheck (tester_visual-root, root 170a7b15d, 2026-10-20)

Build: web + server from `origin/feature/UNI-923-office-g5-g6-g7` @170a7b15d (build step under heavy.lock only, servers unlocked, nice), fresh DB
`uniwork_visual_1977`, ports 18850/13770, same seed as visual-1974. Shots: `shots/04-folder-page-*` and `06-folder-detail-*`, vi/en x light/dark x 1280/768/390 (24 shots);
metrics in `logs/shots.out` (h1 box, button tops, scrollWidth).

## Verdict: PASS
- 1280 (`04-folder-page-*-1280`): one row at y=76-80 holds breadcrumb, leaf h1, rename, folder actions, "..." , Upload, New. No separate title row; search box is its own full-width row under it.
- 768 (`04-folder-page-*-768`): same, one row (y=68-72) with Browse/Upload/New, nothing wrapped.
- 390 (`04-folder-page-*-390`): wraps cleanly: row 1 breadcrumb + pencil + "...", row 2 actions (Browse/Điều hướng, New), row 3 search. No overlap.
- Ancestors shrink first ("Works...", "Kế hoạch kinh...") as expected; the leaf h1 is no longer squeezed to 1 letter (was "B..." before).
- No horizontal scroll: scrollWidth == clientWidth in all 24 runs. vi/en and light/dark all legible.

## Nits (not blocking)
1. The leaf still ellipsizes the last 2-3 characters for the 19-char seed name ("Hợp đồng khách hà…", h1 164px) at all three widths, because the row is full; ancestors could shrink a little more.
2. Folder opened by its document URL (`06-folder-detail-*`, `/documents/<folderId>`) shows a yellow "this document has no file yet" banner under a clean one-line breadcrumb header; the header itself passes. Not the folder page, pre-existing.

Cleanup: servers stopped by PID, DB dropped, worktree back on `feature/UNI-1974-folder-share-off`.

VISUAL_1977_DONE
