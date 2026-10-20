# UNI-1994 nit 2 visual round 2 (tester_visual, bro, head 1ae93449a, 2026-10-20)

Build under test: bro worktree `/home/ubuntu/orca/workspaces/uniwork/feature-UNI-1994-doc-nits` @1ae93449a (only `packages/views/documents/folder-breadcrumb.tsx` differs from round 1; no product edits by me). Web app rebuilt with `next build` under `flock -o ~/office-g5g6g7/automation/state/heavy.lock` for the build step only (2m27s, nice, Node 22). The round 1 server binary was reused unchanged. Fresh DB `uniwork_visual_1994b`, ports 18850/13770 checked free with `ss` first, local storage, round 1 seed (`seed-r2.mjs` is `seed.mjs` writing `state-r2.json`) plus one 82-character folder under the same parent (`seed-long-r2.mjs`).
Load gate: 5-min load 7.96 and MemAvailable 8.7 GB when the build started (waited from 12 to under 8 first). Shots ran unlocked, one app at a time. Other lanes pushed the load to 10-13 while the matrix ran; shots are not timing-sensitive.
Evidence: `shots-r2/` (66 files, `r2-<step>-<leaf19|leaf80>-[touch-]<loc>-<mode>-<width>.png`), `logs-r2/r2-all.out`, `logs-r2/r2-touch-all.out` (metrics, `sum.py` condenses them), driver `r2.mjs`. Round 1 files untouched. Same files on bro in `~/office-g5g6g7/reports/docs-ui_local/visual-1994/`.

## Verdict nit 2: PASS (fine-pointer), one open nit at 390 touch

| Check | Result |
| --- | --- |
| 19-char leaf "Hợp đồng khách hàng" whole, vi/en x light/dark x 1280/768/390 (12 combos) | whole name in 12/12, no ellipsis; shortfall (natural width minus content box) = 0 in 12/12 (round 1: 0.09–0.17 px) |
| Pixels (2x crop of the crumb row) | `r2-04c-crumb-crop-leaf19-vi-light-1280.png`: "Tài liệu củ… › Kế hoạch kin… › **Hợp đồng khách hàng**"; `…-en-dark-390.png`: "Wor… › Kế… › **Hợp đồng khách hàng**". Name complete in all 12 crops viewed by sampling (1280 vi-light, 390 en-dark, 768 vi-dark full page) and confirmed by the numbers for all 12 |
| Ancestors shrink first | yes: 1280 vi ancestors 91.5 and 104.5 px, 768 46.1 and 37.9, 390 46.9 and 39.1 (text cut with an ellipsis), leaf stays 164 |
| Nothing overlaps | `overlaps=[]` in 32/32 header runs (24 fine pointer + 8 touch) |
| No horizontal scroll | page `scrollWidth == clientWidth` in all 40 runs; crumb row `nav` scrollWidth == clientWidth in all |
| Smoke: New menu at 1280 vi-light | opens, entries Thư mục / UniNote / Docs / Sheets / Slides / Markdown / HTML / PDF / Chia sẻ với workspace / Tải lên, inside viewport (`r2-02b-new-menu-folder-vi-light-1280.png`) |
| Smoke: document by URL redirect, 1280 vi-light | `/documents/<folder>` → final URL `…/documents?folder=<folder>`, one hop, `banner:false`, `bodyHasBanner=false`, folder page rendered (`r2-06-folder-by-doc-url-vi-light-1280.png`) |

## 390 coarse pointer (touch pass, vi/en x light/dark, 4 runs): leaf still ellipsized
- State: **still ellipsized**, 19-char name reads "Hợp đồng khác…" (`r2-04c-crumb-crop-leaf19-touch-vi-light-390.png`, `r2-04-folder-leaf19-touch-vi-light-390.png`). h1 box 130 px, content 122 px, natural 156 px: **34 px short** (shortfall 34 in 4/4, identical to round 1: box 130, scrollWidth 164 > clientWidth 130).
- Why there is no room: the ancestors are already at their 44 px touch minimum (44 + 44), the pencil and Folder-actions buttons are 44 px each; 16 + 44 + 44 + 130 + 44 + 44 + the chevron gaps fill the 374 px right edge. The row has no spare pixel, so the fix in 1ae93449a cannot help here; the leaf would need the folder buttons to wrap to the next row to fit. Judged separately, as asked: **nit (F-R2-1)**, not a blocker for nit 2. Touch targets stay at 44 px (`minH=44` in 4/4), no overlap, no scroll.

## Long name (82 characters, same parent): truncates inside the row, no overflow
Seed title "Hợp đồng khách hàng chiến lược dài hạn với các đối tác thương mại khu vực phía nam" (82 chars), natural width 609 px.
- 12/12 fine-pointer + 4/4 touch: leaf truncated with an ellipsis inside its box (`r2-04c-crumb-crop-leaf80-vi-light-1280.png`: "…**Hợp đồng khách hàng chiến lược dài hạn v…**"; box 326/214/216 px at 1280/768/390), h1 `scrollWidth 617 > clientWidth` as expected, page `scrollWidth == clientWidth`, the row's `nav` has no overflow, `maxRight` 1256/752/374 ≤ viewport.
- Buttons next to it: pencil, Folder actions, "⋯", Tải lên / Tạo mới stay on screen, `overlaps=[]` in 16/16 (`r2-04-folder-leaf80-vi-light-1280.png`, `r2-04-folder-leaf80-en-dark-390.png`, `r2-04-folder-leaf80-touch-vi-light-390.png`). Touch: 44 px targets kept.

## Findings
| ID | Sev | Screen | Finding | Shot |
| --- | --- | --- | --- | --- |
| F-R2-1 | nit | folder page, 390 touch | 19-char leaf still ellipsized ("Hợp đồng khác…", 34 px short) because the row has no room at the 44 px minimums; unchanged from round 1, expected from the diff | `r2-04c-crumb-crop-leaf19-touch-vi-light-390.png` |
| F-R2-2 | minor | folder page, long leaf | with a long leaf the ancestors shrink to 24 px and 10 px (all widths, also 390 non-touch): the first crumb reads "T…"/"W..", the second is a clipped single glyph "k" with no ellipsis. Not a defect of the 19-char case (there the ancestors keep 38–115 px), but the clipped letter looks like a rendering glitch and the middle folder is unreadable. Needs a minimum width for an ancestor, or hiding it behind "…" | `r2-04c-crumb-crop-leaf80-vi-light-1280.png`, `r2-04-folder-leaf80-en-dark-390.png` |

UI quality: every viewed screen rendered styled (folder page, New menu, redirect result, 768 dark, 390 light/dark touch and fine pointer, 1280 light), dark mode legible, no placeholder or raw DOM, vi/en copy normal. Not checked: hover states, screen reader, remaining crops by eye (numbers cover them), New menu at 390.

## Method notes (stated, not hidden)
- The round 1 harness was copied to `*-r2` names so round 1 evidence stays intact; I wrote a smaller driver (`r2.mjs`) that merges the `probe2.mjs` metrics (clone-measured natural width vs content box) with the header overlap check and 2x crumb crops in one pass, logging in once per combination.
- The long-name folder shares the parent with the 19-char folder, so the sidebar shows both; no other seed change.
- Shots are 2x device scale (round 1 page shots were 1x), so file sizes are larger.
- Smoke covers only the New menu and the document-URL redirect at 1280 vi-light as asked.

## Cleanup
- Servers stopped by PID with `kill -TERM`, no pkill, nothing by image name: backend `check-server` 1566737, `pnpm exec next start` 1566738, `next-server` 1566781 (`killed-pids-r2.txt`). `ss` shows 18850 and 13770 free afterwards.
- DB `uniwork_visual_1994b` dropped (`DROP DATABASE … WITH (FORCE)`, listing shows 0). Local storage: `uploads-r2/` has 0 files. Redis db 5 keys are session data of the throwaway users, left to expire.
- Bro worktree: `apps/web/next-env.d.ts` (rewritten by `next build`) restored, `git status` clean at 1ae93449a. `.next` build stays in the worktree.
- Shots and logs kept as evidence in both places; nothing committed or pushed, no `--no-verify`, no `--interrupt`.

VISUAL_1994_R2_DONE
