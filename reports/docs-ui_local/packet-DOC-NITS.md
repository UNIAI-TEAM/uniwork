# Packet DOC-NITS (UNI-1994)

Branch `feature-UNI-1994-doc-nits`, base root `feature/UNI-923-office-g5-g6-g7` @8cb13a296, head `fb57d329c` (local commits only, not pushed; bundle shipped to bro for the visual rounds).
Lane: lead-docs-ui_local, run run_31392fc82ddf. Sources: `visual-1974-REPORT.md`, `visual-1977-REPORT.md`, user nit 6 (brief `briefs/uni1994-nit6.md`).

## Nits and commits
| # | Nit | Commit | Result |
| --- | --- | --- | --- |
| 1 | Comment-level share read "View only" | 444fafa09 | PASS r1 (view and comment / Xem và nhận xét; view stays View only; edit none), red test first |
| 2 | Folder leaf ellipsized by a 0.1px flex shortfall | b4cc68823, 64bd41676, 1ae93449a | PASS r2: whole name 12/12, shortfall 0, no overlap. Open nit: coarse-pointer 390 (ancestors at the 44px touch minimum) leaf still 34px short, no room on one row |
| 3 | Folder opened by its document URL showed the no-file banner | ad8d634e1, 64bd41676 | PASS r1, r2, r3 smoke: replaced with the folder page, no banner, back is not a loop, no redirect while the detail query errored |
| 4 | "Not in a folder" header alone for recipients | ad8d634e1 | PASS r1: hidden when it is the only group, kept next to folder groups |
| 5 | "Share with workspace" next to Folder | b4cc68823 | PASS r1 (judged): the switch closes the document kinds, Folder sits at the top behind two rules; at 390 the mobile Upload entry sits below it. Desktop order was already separated before the change. Minor left: the off state has no switch affordance (no new design) |
| 6 | "No documents in this workspace yet" at a root with folders (user) | 6331b8944, ca6a7c1e4, fb57d329c | PASS r3 A, B, D and r4 C1-C5, A: scoped copy en "No documents outside folders" / vi "Không có tài liệu nào ngoài thư mục"; hold until the folder tree answers (reviewer finding, sampler saw the old title 0 of 3514 ticks); Edited by / Updated filters now count as filtered (round 3 finding) |

New i18n keys (vi and en): the nit 1 badge, notice and file-hint keys, and `documents.home.empty.outside_folders_title` / `_description`. No new design, tokens only, no next/*.

## Evidence
- Review: reviewer_fe on nits 1-5 PASS-with-nits (two nits fixed in 64bd41676); reviewer_fe on nit 6 FIX-NEEDED (tree-loading flash), fixed in ca6a7c1e4.
- Local, Node 22, exact files: vitest on 11 touched and related files, 191 tests pass; core i18n parity 55 pass; `tsc --noEmit` views clean; eslint `--max-warnings 0` on touched views files clean.
- Visual on bro (headless, vi/en x light/dark x 1280/768/390, seed from visual-1974): `visual-1994/REPORT.md` (r1), `REPORT-round2.md`, `REPORT-round3.md`, `REPORT-round4.md`; shots on bro `~/office-g5g6g7/reports/docs-ui_local/visual-1994/` (shots, shots-r2, shots-r3, shots-r4) and local untracked. scrollWidth equals clientWidth in every run. Each round cleaned up: servers stopped by PID, DB dropped.
- Not run: whole suites. `cloud-spec-1994.txt` is written for the Advisor to run on the cloud runner (views documents, layout, core i18n/paths, tsc, eslint, scripts tests, knip) once the branch is pushed. The knip run needs the untracked `visual-1994/*.mjs` harness scripts out of the tree, they are not committed.

## Known nits left (none blocking)
- Touch 390: folder leaf 34px short, ancestors already at their touch minimum (F-R2-1); an 82-char name clips a glyph at the ancestor edge (F-R2-2, minor).
- 390: the scoped empty hint and the no-results Clear button can sit at the fold (inner scroll only, F-R3-2, F-R4-1); no-results title and description near-duplicate (F-R4-2).
- New menu off-state toggle shows no switch or check indicator (minor).
