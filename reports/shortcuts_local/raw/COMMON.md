# UNI-2011 SHORTCUT-PARITY stage 1 — research worker brief (common part)

Goal of the lane: align keyboard shortcuts in UniWork documents + desktop app with Microsoft 365 (Word/Excel/PowerPoint, Edge PDF viewer; Windows Ctrl and macOS Cmd) so users do not relearn. Stage 1 = INVENTORY ONLY. **Read-only on all product code. Make no commits, no edits outside this raw/ folder.**

Checkouts (read-only):
- Fork repo UNIAI-TEAM/uniwork-office @ origin/main d999b8801: `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/uniwork-office/shortcuts-ro-UNI-2011`
- D repo UNIAI-TEAM/uniwork @ e7be35f41: `D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/worktrees/dev-uniwork/feature-UNI-2011-shortcut-parity`
- Output folder: `<D repo>/reports/shortcuts_local/raw/`

Rules:
- Every row must come from code you actually read. **An invented key or wrong file:line is a fail.** If you are unsure, mark `confidence=low` and say why in notes. Do not guess from memory of what an editor "usually" does: find the handler/keymap/accelerator.
- Include library defaults that are really active (TipTap/ProseMirror keymaps, Lexical, CodeMirror, Univer/handsontable/etc. defaults, Electron menu roles/accelerators, browser-native behaviour the app relies on) and say which library supplies them. Include keys the app intercepts, blocks (preventDefault) or forwards (postMessage) too.
- Note IME safety per handler: does it check `isComposing` / `keyCode===229` / `event.isComposing`? Note use of `event.key` vs `event.code` and whether it handles AltGr (ctrlKey+altKey).
- Record the modifier as mod (Ctrl on Win/Linux, Cmd on macOS) when the code uses Mod/CmdOrCtrl/metaKey||ctrlKey; otherwise the literal keys per platform.
- Output: a CSV per assignment (UTF-8, header row, RFC4180 quoting) with columns:
  `repo,surface,module,action,key_win,key_mac,file,line,source,ime_safe,altgr_ok,confidence,notes`
  where surface is one of web-frame, desktop-shell, web-host, uninote, documents-page, global-app; source = who supplies it (own handler / tiptap / prosemirror / lexical / univer / electron-role / browser-native / ...); ime_safe is one of yes, no, n/a, unknown.
  Plus a short Markdown `<name>.md` with: the single place (if any) where each module's shortcuts are defined, structural findings (scattered handlers, duplicate registrations, conflicts between layers, keys forwarded from frame to host), and the list of files you read.
- Heartbeat every 5 minutes with `orca orchestration send --type heartbeat ...` as in your preamble; finish with worker_done (3-sentence body, list the output files).
