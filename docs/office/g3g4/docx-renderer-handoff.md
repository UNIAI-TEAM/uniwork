# G3-04c (UNI-823) — handoff

Lane: `g3-04c-docx-renderer`. Branch `feature/UNI-823-office-docx-renderer`.
Design doc: `docs/office/g3g4/docx-renderer-port.md` (read sections 3b–3f for
the decision history before doing anything — the vendoring scope changed
three times after the Advisor's initial go).

Child Run: `run_40487dafaf11`. Worker stage: task `task_3f4adaf7302e`,
dispatch `ctx_04cbced1c145`, terminal `term_b7b8252f-cdca-41d0-bc26-f00927f1daaa`.
Parent Run (Advisor): `run_1a61037d79e9`. My own dispatch as lead:
`ctx_a2cea88e4d9c` / task `task_6586def2ce6b`.

**Current state**: worker is holding, last directive sent
(`msg_1d206c7019aa`) not yet acknowledged or reported on. Repo is clean —
nothing uncommitted. Last commits:

- `31b54e28` — doc: Advisor's final decision (full vendor rework, shims not stubs).
- `40bd4b54` — the worker's hand-authored TipTap editing surface bound to G2
  `DocxParsed`/`DocxEdit` (35 passing tests, all gates green). **Superseded as
  the schema source** per the Advisor, but its session-bridge files
  (`docx-doc-convert.ts`, `docx-reconcile.ts`, `use-docx-tiptap-handle.ts`)
  are likely still the right shape for the seam and should be reused where
  they fit, not discarded.

## Next 5 steps

1. **Check the worker's reply to `msg_1d206c7019aa`** (non-blocking:
   `orca orchestration check --terminal term_c60a8fd4-579b-4e61-8d92-2752270020e8 --peek --json`,
   or `--run run_40487dafaf11`). It was last asked to vendor the
   `extensions.ts` transitive closure (~35–40 files) file-by-file
   (licence/`/ee`/Electron-Node checks), add browser shims at the seam for
   any genuine Electron/Node-only import (listing each in design-doc
   section 3f), render equation/OMML read-only (not stub), and only escalate
   for a file that's truly impossible. If it's still working, just resume
   polling — do not re-send the same directive.

2. **When the vendor SELECTION lands**, verify independently before trusting
   the worker's report: `vendor-upstream --check` actually green, the shim
   list in section 3f matches what's in the diff, and no file imports
   `node:*`/`electron` without a shim (`scripts/office/check-boundaries.mjs`
   should catch this but re-grep the new files too — a worker report is not
   verification, per repo acceptance-check discipline).

3. **Confirm the schema integration**: the vendored `extensions.ts` is the
   TipTap schema; `40bd4b54`'s session-bridge files should now call into it
   instead of (or alongside) the hand-authored schema. Watch for dead code
   left behind from the superseded hand-authored schema — `knip` should flag
   it, but check the diff directly too.

4. **Run the Tester stage** once the worker reports green (per
   `team-rules.md`'s Worker → Tester → Reviewer loop): opencode2 primary,
   fallback claude-sonnet-5 medium per the latest roster note in
   `team-rules.md`. The acceptance bar from the brief: render scope (tables,
   images, headers/footers, page layout, equations read-only — **never** a
   plain/unstyled surface, that's a blocking finding), edit scope
   (text/format/headings/lists/undo-redo, save round trip), web mount. Then
   Reviewer (devin swe-2 max, unlimited per the 2026-10-01 11:20 roster
   note) — mixed BE+FE diff gets two independent reviewer instances.

5. **After Tester/Reviewer clear**, run the targeted gates named in the
   worker task spec (typecheck/lint/test for touched packages, knip,
   `vendor-upstream --check`, `catalog-check`, `check-boundaries`) on the
   FINAL commit, then send my own `worker_done` to the Advisor
   (`run_1a61037d79e9`, task `task_6586def2ce6b`, dispatch
   `ctx_a2cea88e4d9c`) with the acceptance packet. AC-5 (G3-D3 fidelity
   measurement) is explicitly a **separate later stage**, not part of this
   worker_done.

## Known gotchas hit this session

- My coordinator terminal (`term_c60a8fd4-579b-4e61-8d92-2752270020e8`) is
  **fenced to the child Run** (`run_40487dafaf11`) once I called
  `run-create`; `orca orchestration check --run run_1a61037d79e9` always
  errors `consumer_fenced` from here. Messages the Advisor sends addressed to
  `dispatch:ctx_a2cea88e4d9c` do not surface via `check` from this terminal —
  they arrive as a user-turn paste instead. Don't waste time retrying
  `check --run run_1a61037d79e9`.
- `orca orchestration check --wait` on the child run repeatedly hit
  `waiter_exists` errors (stale background waits from earlier in the
  session overlapping). Prefer non-blocking `--peek` + `worker-show` polling
  over stacking `--wait` calls; only use one `--wait` at a time if none is
  already outstanding.
- `--type` for `send` must be one of `status, dispatch, worker_done,
  merge_ready, escalation, handoff, decision_gate, question, heartbeat` —
  `feedback` (a team-rules.md *body* `kind`, not a CLI `--type`) is rejected.
