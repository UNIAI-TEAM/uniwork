# UNI-2011 stage 1 — synthesis worker brief (common part)

Lane goal: align UniWork keyboard shortcuts (documents/modules + desktop app) with Microsoft 365 so users do not relearn. Stage 1 = contract only; no product code, no commits. All work is read-only on repos; you write only into `reports/shortcuts_local/raw/synth/` of the D checkout.

Root: `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/dev-uniwork/feature-UNI-2011-shortcut-parity/reports/shortcuts_local/raw/` (call it RAW). Code checkouts (read-only, to verify): fork `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/uniwork-office/shortcuts-ro-UNI-2011` (d999b8801), D = `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/dev-uniwork/feature-UNI-2011-shortcut-parity` (e7be35f41).

## Inputs (already produced, read them)
- "Ours today": `RAW/A-fork-modules.csv` (+ `A-fork-modules.out.md`, `A-part-*.md`), `RAW/B-shell-host-web.csv` (+ `.out.md`), `RAW/D-lib-defaults.csv` (+ `.out.md`; library/Electron defaults).
- Microsoft reference: `RAW/C2-ms-lookup.csv` (raw-HTML pass, preferred) and `RAW/C2-ms-raw.csv` (every row parsed from the official pages); `RAW/C-ms-reference.csv` is the older, weaker WebFetch pass — use only when C2 lacks the row. Cite `source_url` per MS key. A key not in these files is not an MS key for this contract: never fill from memory. If a needed MS key is missing, say `not documented` and flag it.
- Raw CSV schema for A/B/D: `repo,surface,module,action,key_win,key_mac,file,line,source,ime_safe,altgr_ok,confidence,notes`.

## Output: one CSV `RAW/synth/<name>.csv`, one row per ACTION per MODULE-GROUP, UTF-8, RFC4180, columns exactly:
`id,group,action,ms_win,ms_mac,ms_source,web_today,desktop_today,evidence,status,proposal_web,proposal_desktop,slice,ime_altgr,confidence,notes`
- `id`: `<group>-<nn>` (stable, e.g. `docs-012`).
- `group` ∈ common, docs, sheets, slides, pdf, html, markdown, uninote, shell, global.
- `ms_win` / `ms_mac`: copied verbatim from the MS files (the module's own Microsoft counterpart: docs→Word, sheets→Excel, slides→PowerPoint, pdf→Edge PDF viewer, html/markdown/uninote→Word where the action exists). Use `n/a` when MS has no such action, `not documented` when MS's page does not list it.
- `web_today` / `desktop_today`: the key (or `none`) that triggers the action TODAY on that surface; if the two differ because desktop has a menu accelerator and the web frame has none, say so. Use `Mod+` notation only when the code uses Mod/CmdOrCtrl; otherwise write Windows form, and mac form after ` / `.
- `evidence`: `repo:path:line` for the controlling handler(s) (semicolon separated, max 3). **Every evidence entry must exist: open the file at that line and confirm before writing it.** Library defaults cite the `D-lib-defaults` row's package path:line.
- `status` ∈ same / different / missing / conflict. same = both surfaces already equal MS (win and mac); different = we have a key but not MS's; missing = no key at all where MS has one; conflict = our key means something else than MS's key or collides with a global/browser/OS shortcut. If web and desktop have different statuses, write `web:<s>;desktop:<s>`.
- `proposal_web` / `proposal_desktop`: the target key. Desktop = MS exactly (Windows column on Windows, the MS Mac column on macOS). Web = MS, except browser-reserved keys (Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab and similar) where the web keeps the browser key and an alternative is shown in menus/tooltips: give the alternative and mark it `ALT-PROPOSED` (not yet validated in a browser). Where a change is risky, say `KEEP` plus the reason; where the MS key collides with a UniWork global shortcut, say who wins and why (default: the editor wins while focus is inside a frame/editor).
- `slice`: the implementation slice that would carry it, one of S-docs, S-sheets, S-slides, S-pdf, S-html-md (fork), S-shell (fork apps/shell), S-uninote (D), S-host (D web host), S-global (D core/views), S-table (the shared table per repo).
- `ime_altgr`: `ok` or the risk found (handler lacks isComposing check; fires on AltGr; uses e.key vs e.code) with the evidence in the raw row.
- `confidence` ∈ high/medium/low; high only if both the MS cell and our evidence come from a read source line.
- `notes`: keep short. Anything unresolved goes to a final section of your `.md`.

Also write `RAW/synth/<name>.md`: (1) count of rows by status; (2) the 10 most user-visible gaps for your groups, in plain Vietnamese; (3) open questions / things you could not verify; (4) list of source rows you did NOT turn into an action row and why (e.g. dialog-internal Enter/Esc keys: keep a single row per dialog class `<group>-dialog-keys` instead of one per dialog).
Rules: coverage first — every action that exists in the MS reference list for your groups AND every shortcut we have today (A/B/D rows, aggregated by action) must appear in some row; ours-only actions get ms_win/ms_mac `n/a`. No invented keys; no placeholders. Heartbeat every 5 minutes; finish with worker_done listing the files.
