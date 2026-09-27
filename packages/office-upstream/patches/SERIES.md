# office-upstream patch series

UniWork-side changes that ride on top of the frozen upstream source in
`../upstream/`. The vendored tree is byte-identical to upstream commit
`09485f884dc845cf3bf27fb7edfe489f9d457aad` (see `../provenance.json`); every
deviation lives here as a numbered patch that `scripts/office/build-upstream.mjs`
applies to a scratch copy in `git apply -p1` order, before the build runs.

Rules:

- Patches are unified diffs rooted at `upstream/` (`a/packages/...` → `b/packages/...`).
- Never edit `../upstream/` directly; new work enters as a new numbered patch.
- Upstream files are Apache-2.0 (Copyright 2026 Mainfunc, Inc.); patches are
  UniWork changes to that source and carry the same attribution story — keep
  the provenance table below current when the series grows.

## Series

| # | Patch | sha256 | Files | What it carries |
| - | ----- | ------ | ----- | --------------- |
| 0001 | `0001-g108-xlsx-frozen-engine.patch` | `E299A322443805E2F2EBD03B70A37CE44A44EBDE020A093A64F5C14695E0F27E` | `packages/xlsx-gateway/src/gateway/xlsx-styles.ts`, `xlsx-styles.dedupe.test.ts` (new), `apps/sheets/native/xlsx-engine/src/recalc.rs` | The frozen XLSX engine changes accepted in G0: the cellXfs dedupe fix so saving an already-styled cell does not grow `xl/styles.xml` (with its node:test regression), and the sidecar `normalize_for_ironcalc` normalization + tests that make unstyled packages recalculable. |

## Provenance of 0001

Regenerated as a clean unified diff from the accepted G0 applied tree
(`advisor-resume2/xlsx-feature/feature-ready-source/dependency-source/`). The
original lab artifacts it consolidates:

| Artifact | sha256 |
| -------- | ------ |
| `feature-ready-source/managed-engine-current.patch` | `e9ba9ce9a43714a24256d9323dc0b9b87be90af69e949bc22891f501f066b799` |
| `gateway-styles-dedupe.patch` | `3dd8d157ed8be0e583d85f65bc06dff898c98bef8bddc9069f23e9d9fe3c47c0` |
| `sidecar-recalc-normalize.patch` | `0d589a4e841df23a5919582825fc9c22e59b16976ce800eae2a11fbe72490a36` |

Applied-file checksums (the `b/` side):

| File | sha256 |
| ---- | ------ |
| `packages/xlsx-gateway/src/gateway/xlsx-styles.ts` | `fd2b0dbd9a458413ccbe13f4d2e47fad97cddb53338d7bde894ea67c92535423` |
| `packages/xlsx-gateway/src/gateway/xlsx-styles.dedupe.test.ts` | `d6ec6bc60c3f91ea34c8214e2b797cbb54f6fd56f441b115ef94d6517f55d759` |
| `apps/sheets/native/xlsx-engine/src/recalc.rs` | `85355297126ad71d81aa348980dfd465fcf7e777c479a9817c8e6822fb647865` |

The original `managed-engine-current.patch` was regenerated because its file
boundaries are spliced (a `---` header glued to the previous file's last added
line) and it is not `git apply`-clean; the regenerated patch is byte-identical
in effect — it diffs the pinned blobs against the accepted applied tree.

## Known gap (recorded, not worked around)

The **Brand r8 product patch** was lost with the G0 scratch and is a recorded
gap **owned by the G3/G4/G7 brand lanes** (Advisor decision, run
`run_5901144be3bc`, 2026-09-27). It is not reinvented in G2-01. What survives
is the XLSX-lane frozen engine change set above, plus evidence that the other
frozen changes were applied inside deleted lab trees (`bootstrap-source`,
`engine-source` are not git checkouts and carry no patch manifest). The gap is
recorded in the G2-01 acceptance packet; nothing was reinvented.
