# Cloud test rounds (UNI-1013, lane GO-B2+B3)

Non-visual checks ran on the Cursor cloud runner (team rule "Cloud test runner").

- dev-uniwork: `r1.md` (b71936f27), `r2.md` (7fc96a74b), `r3.md` (8e017c68c); spec files in `specs/`.
- fork uniwork-office (CI replica, `--repo uniwork-office`): `fork-r1.md` .. `fork-r6.md`; `fork-r6.md` (a4304d6, fresh
  VMs, test/cursor-cloud-env 0a10070c6) is the reference: test + e2e jobs PASS.

Raw per-round logs (about 39 MB) are kept out of the repository to respect the `reports/` size convention; they are
archived on the lane VPS at `/home/ubuntu/projects/uniwork-office/.uniwork-lane/evidence/cloud-logs/`, and the runner
also stored them under `refs/test-results/...` at the time of each round.
