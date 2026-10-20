# Visual round UNI-1974 FOLDER-SHARE-OFF (tester_visual-root, head 1adfd03ec, 2026-10-20)

Stack: production Next build + server binary from this head, fresh DB `uniwork_visual_1974` (shared Postgres 5432), ports 18850/13770 (8081 untouched),
local storage. heavy.lock held only for the builds (Advisor order 01:50), servers + shots ran unlocked under `nice`.
Seed: owner Olivia, member Minh; folder "Kế hoạch kinh doanh quý bốn" > "Hợp đồng khách hàng" with two pages created inside
(one shared to Minh at comment level, one private). Matrix: vi/en x light/dark x 1280x800 / 390x844, 8 combos, in `shots/`
(`01-home` `04-folder-page` `05-folder-actions-menu` `05b-tree-folder-menu` `06-folder-detail` `07-doc-in-folder` `08a-doc-more-menu` `08-doc-share-dialog`
`09-shared-by-me` `10-recipient-shared-with-me` `11-recipient-doc` `12-recipient-home` `02-new-menu` `03-new-folder-dialog`, each `-<loc>-<mode>-<width>.png`;
`13-new-menu-toggle-on-*` is one extra). Logs: `logs/shots.out`, `logs/dialog.out`; API evidence `api-checks.json`, `api-checks2.json`.
Scripts: seed.mjs, api2.mjs, shots.mjs, dialog.mjs, toggle.mjs, serve.sh.

## Results
1. Folder Share UI - PASS. Folder page "Folder actions" menu: Star, New subfolder, Rename, Move to, Archive, Delete (no Share/Access/link). Sidebar folder menu:
   Open, Star, New subfolder, Rename, Move to, Access report (read-only report, kept by decision), Delete. Folder detail route shows no Share button.
   New-folder dialog (`03-new-folder-dialog-*`, all 8): name field + Create/Cancel only, 0 switches. With "Share with workspace" switched on in the New menu,
   the folder POST body is `{"kind":"folder","title":...,"parent_id":...}` with no `visibility` (`toggle.mjs`). The switch stays in the New menu for documents (intended).
2. Document inside a folder - PASS. Header More actions > Share opens the normal dialog ("Share “Bản nháp nội bộ”", add access, public links) in all 8 (`08-*`).
   Pages created in the folder came back `visibility: restricted` (api-checks.json) and show "Private" in the list (`04-folder-page-*`); no "inherited from folder" hint anywhere.
3. Recipient view - PASS. Minh's Shared with me lists only the page; API row has no `parent_id`, detail has no `parent_id`/breadcrumbs; sidebar shows
   "No folders yet", detail breadcrumb has no folder crumb; page opens (`10-*`, `11-*`). Default Group-by-Folder puts it under "Not in a folder" (see nit 1).
4. Shared by me - PASS. Only the page (`09-*`; API `shared_by_me_kinds` = page only); `shared_by_me=true&kind=folder` answers 400 `invalid_filter`.
5. Errors - PASS. curl as owner on the folder: create with visibility workspace, PATCH visibility workspace, POST shares, POST shares/batch and PUT access all answer
   422 `folder_not_shareable` (message vi); public link still 422 `folder_not_supported`. The UI cannot reach these paths (no entry), so there is no UI error
   state to see; the vi/en copy key `documents.errors.folder_not_shareable` exists in both locale files (not rendered, not triggerable).
6. General UI quality - PASS with nits. Everything styled, no placeholder/raw-DOM screens; scrollWidth == clientWidth in every combo at 390 and 1280 (logs/shots.out);
   dark mode legible in all shots viewed (menus, share dialog, folder dialog, lists). Criteria: hierarchy, spacing, primitives, tokens, states, responsive, vi/en copy, a11y labels, polish all fine.

## Blocking defects
None.

## Nits (not caused by this change, none blocking)
1. Recipient "Shared with me" default grouping shows a "Not in a folder" group header (`10-*`): correct (no owner folder), but the header is mildly odd when the user has no folders.
2. Recipient opened a comment-level share and the header badge reads "View only" (`11-recipient-doc-en-light-390.png`); check the level label vs `my_level: comment`.
3. Folder page leaf breadcrumb is still truncated early ("Hợp đồng kh...") with a wide search box and the actions on a second row, same as the UNI-1977 finding of round 5975 (`04-folder-page-*`).
4. The "Share with workspace" item sits at the bottom of the New menu right below the Folder entry; it does not apply to Folder (verified), but a reader may assume it does.
Not checked: legacy workspace-shared folders (needs the admin clean-up command; contract's data path), hover states, screen reader.
Cleanup: servers stopped by PID (backend 10731, next 10872), DB dropped, `apps/web/next-env.d.ts` restored; uploads/ and shots left as evidence.

VISUAL_1974_DONE
