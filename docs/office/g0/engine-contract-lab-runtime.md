# DOC-004 reproducible real engine contract lab (UNI-668)

> **Trang thai:** runnable feature delivery - the command below boots the real pinned
> engine host, runs the frozen DOC-004 adapter fault contract against it, retains
> evidence and releases its own resources. This is a G0 lab command, not a product
> runtime decision, deployment or installer.

**Issue:** UNI-668 (DOC-004) - **Parent:** UNI-656.
Isolation: the launcher owns one work directory and never edits the frozen contract.

---

## 1. What this replaces

`scripts/office-g0/engine-contract-adapter.mjs` drives the real DOC-003 spike engine
host over loopback HTTP, but by design it does **not** boot that host. An operator had
to start one by hand on `127.0.0.1:5392` first, which made the real-adapter evidence
depend on an undocumented manual prerequisite.

`scripts/office-g0/run-engine-contract-lab.mjs` closes that gap with one command that:

1. refuses a run whose dependencies, pin or engine port are not already correct;
2. prepares a lab this run owns;
3. generates the fixtures (or uses declared ones) and builds the PPTX prebundle;
4. boots the **real** pinned engine host through the prepared source's own `tsx`;
5. waits for the host to identify as this exact source/lab/prebundle, then proves it
   actually serves a real route;
6. runs the frozen adapter's own cases in-process;
7. writes one structured evidence record naming runtime, pin, paths, commands and
   case results;
8. stops only the process tree it started and proves the port is free again;
9. proves the owned tree by OBSERVATION: it captures the host's live descendant pids
   while the host is serving, then verifies those exact pids are gone.

The adapter, the boundary contract, the engine host, the shared evidence register and
the runtime ADR are **not** modified. The launcher imports the frozen adapter and calls
its exported `runAllAdapterCases`, so the cases and the pass/fail policy are unchanged.

---

## 2. The command

All inputs are explicit. Nothing is discovered from a sibling lane, and there is no
hardcoded `../genoffice` and no reference to another lane's generated lab.

### Workspace-root discovery

The run derives the workspace root from the nearest ancestor whose `.uniwork-dev` owns a
**shared-lab marker** - the pinned `tools` tree or the `worktrees` registry - and only
falls back to the nearest `.uniwork-dev/office-g0` and then the nearest `.uniwork-dev`.
Tier order matters because a git checkout can carry its own checkout-local
`.uniwork-dev/office-g0` stub: nearest-first lookup returned that stub, so a valid
`--work` under the real shared `.uniwork-dev` was refused as outside the workspace and the
pinned lockfile resolved under the wrong root. Ranking the shared markers first resolves the
main-checkout layout to the shared workspace without weakening the `--work` containment
checks, which still derive their boundary from the root this function returns.


```powershell
$R = "D:\.Vietants_Project\uniwork-workspace"
$NODE = "$R\.uniwork-dev\tools\node-v22.23.2-win-x64\node.exe"
$SRC  = "$R\.uniwork-dev\office-g0\bootstrap-source"
$WORK = "$R\.uniwork-dev\<your-fresh-isolated-dir>"

& $NODE "$R\dev-uniwork\scripts\office-g0\run-engine-contract-lab.mjs" `
    --source $SRC `
    --work $WORK `
    --node $NODE `
    --engine-port 5392
```

From inside this worktree the same run is:

```powershell
& $NODE .\scripts\office-g0\run-engine-contract-lab.mjs --source $SRC --work $WORK --node $NODE
```

Exit `0` means: every adapter case passed, there were **no unavailable rows**, the owned
host tree stopped, and the engine port is free again. Any other outcome exits `1`.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--source <dir>` | required | Prepared source module root (engines load from it; never a document root) |
| `--work <dir>` | required | Fresh isolated dir under `<workspace>/.uniwork-dev`; must not overlap the source, this checkout, `office-g0`/`tools` or any sibling lane |
| `--engine-port <n>` | `5392` | Engine host port; configurable and collision-checked |
| `--fixtures <dir>` | generated under `--work` | Use declared fixtures instead of generating them |
| `--prebundle <file>` | built under `--work` | Use a declared prebundle instead of building one |
| `--evidence-dir <dir>` | `<work>/evidence` | Where the run record is written |
| `--host-entry <file>` | `e2e/office-g0/engine-host.mts` | Engine host entry module |
| `--tsx <file>` | `<source>/node_modules/tsx/dist/cli.mjs` | TypeScript runner from the prepared source |
| `--node <file>` | the running node | Pinned node executable to boot the host with |
| `--manifest <file>` | `docs/office/g0/source-manifest.json` | Pin/lockfile source of truth |
| `--expected-pin <sha>` | the manifest pin | Refuse unless the manifest pin matches this |
| `--upstream-checkout <dir>` | absent | Verify this git checkout is AT the pinned commit and tree (clean) before the run; absent, pin identity rests on the manifest artifacts alone and is recorded as such |
| `--readiness-timeout-ms <n>` | `60000` | Bound on the identity+readiness wait |
| `--remove-lab-on-success` | off | Remove the lab tree after a fully clean pass |
| `--allow-unknown-cleanup` | off | Accept an unproven descendant tree on cleanup; still recorded, never claimed as proven |

Environment equivalents exist for machine callers, e.g. `OFFICE_G0_LAB_SOURCE`,
`OFFICE_G0_LAB_WORK`, `OFFICE_G0_LAB_ENGINE_PORT`, `OFFICE_G0_LAB_NODE`,
`OFFICE_G0_LAB_UPSTREAM_CHECKOUT`.

---

## 3. Failure behaviour (all bounded, all nonzero, all truthful)

| Case | Observed behaviour |
| --- | --- |
| Occupied engine port | Refuses **before** spawning anything, names `EADDRINUSE`, and never signals the foreign owner |
| Missing dependency | Refuses before spawning and names the exact missing role and path |
| Wrong pin | Refuses when `--expected-pin`, the manifest pin, the pinned lockfile and the adapter's declared pin disagree |
| Readiness timeout | Bounded wait; stops the host it started; still writes an evidence record; port released |
| Child crash | Detected by exit code or signal; stops only its own tree; nonzero |
| Cleanup unproven | Nonzero **even when every case passed** - neither a missing port release nor an unproven descendant tree is a pass (--allow-unknown-cleanup opts in, still recorded). A parent that exited on its own is **proven** when every descendant observed under it while it was alive is now gone; it is unproven only when a descendant is still alive or the enumeration cannot run |
| `--work` overlap | Refused before anything is created when `--work` is the workspace root, this checkout, the prepared source, `office-g0`/`tools` or a sibling lane |
| `--work` not fresh | Refused when `--work` already holds a lab tree, so a run cannot adopt an earlier run tree; the check resolves the nearest EXISTING ancestor, so an absent child of a junction that leaves the workspace is refused too |
| Source mutated | Nonzero if the pinned source tree digest changes during the run |
| Wrong pinned runtime | Nonzero before the host, fixtures or prebundle are started when the pinned node's observed version does not satisfy the manifest's declared `runtime.node.requiredRange`, or when the executable path/version is not the one the manifest records. (Reading that version does spawn `node --version`; nothing else runs first.) The manifest is never edited to fit the host |
| Source identity tampered | Nonzero when the prepared source's recorded BYTES (license/notice rows, lockfile, root package identity) do not match the source manifest |
| Interrupt (Ctrl+C / SIGTERM / SIGHUP) | Cooperative only: the run stops at the next stage boundary, reports nonzero, stops the host it owns and releases the port; the interrupt is named in the retained record. An interrupt is a refusal at ANY stage, including after a green adapter contract, and is never recorded as a pass |

---

## 4. Evidence record

`<work>/evidence/engine-contract-lab-run.json` names:

* runtime: the PINNED node executable and its observed version, the launcher's own node, platform, arch, cwd, tsx path;
* pin: manifest pin, adapter pin, expected pin, lockfile path and observed hash;
* inputs: source, work, lab, fixtures, prebundle, evidence, host entry, port, timeout;
* dependency checks: every role, path and whether it was satisfied;
* the exact commands run (generate fixtures, build prebundle, boot host, run adapter);
* fixture preparation: mode, per-file bytes/sha256, and which fixtures are volatile;
* host: pid, command line, cwd, logs, identity result, readiness result;
* adapter: contract version, transport, oracle digest, upstream pin, per-case results;
* cleanup: owned host stop result - including whether the descendant tree was proven and WHICH proof establishes it (`treeProof`: `taskkill-tree-close` or `observed-descendants-gone`) - the port-release result, and retention flags;
* `ownedTree`: the descendant pids observed under the live host, or the reason none could be observed;
* `sourceTree`: a before/after digest of the pinned source tree with an `unchanged` flag;
* `provenance`: what was PROVEN about the prepared source against the manifest's own recorded artifacts, and what was not;
* `upstreamCheckout`: the observed commit/tree/dirty state when `--upstream-checkout` was supplied;
* `termination`: the cooperative signal that stopped the run, when one arrived.

On failure the same file is written with `ok:false`, the failing stage and message, so
evidence survives a failure and never has to be reconstructed from console output.

### What pinned source is proven to mean

Three claims are kept apart, and none stands in for another:

1. **Within-run immutability** - before equals after. This says the run did not change the source. Alone it says nothing about whether the source was ever the intended pin.
2. **Manifest artifact identity** - every in-trial license or notice file recorded in the source manifest, the pinned lockfile, and the root package name/version/engines.node are hashed and compared with the manifest. A tampered tree is refused **before** any host boots.
3. **Upstream pin identity** - only an explicit upstream-checkout flag can prove the prepared copy descends from the pinned commit: the checkout must be AT the pinned commit, AT the pinned tree and clean.

Only claim 3 closes the gap. With no upstream checkout the record says pin identity rests
on the manifest artifacts alone and is left partially unproven rather than claimed; the
launcher never discovers a checkout from a hardcoded sibling path.

The pinned runtime is checked the same way: the node executable the host will actually
boot with is probed for its version, and that version is enforced against the manifest
declared node range before anything is spawned.

The manifest names the runtime it was checked with (`runtime.node.usedForChecks` and
`usedForChecksPath`). The launcher compares the ACTUAL executable path and the observed
version against those records and refuses a mismatch, then records the observed binary
bytes and sha256. The manifest does **not** record a binary hash, so this proves the
declared name, version and path plus the observed bytes - it is reported as exactly that,
not as a byte pin of the toolchain.

### Termination, and its honest limit

### How the owned tree is proven

The launcher owns the pid of the prepared source's `tsx` wrapper, but `tsx` runs the real
host in a **grandchild**. "The wrapper exited" therefore says nothing about the process that
holds the engine port, and an already-dead parent also makes `taskkill /T` answer
"not found" (exit 128). Reading either of those as a leaked tree refused truthful green runs:
the cleanup-proof was racy for a host that exits on its own.

The proof is now observational. While the host is serving (after readiness, and again before
cleanup if the run failed earlier), the launcher enumerates the host's live descendants and
records them in `ownedTree`. At cleanup it re-enumerates and requires **every observed pid
to be gone**. That makes `cleanup.host.treeProof` one of:

* `taskkill-tree-close` - the owned tree was closed through `taskkill /T` and the kill reported success;
* `observed-descendants-gone` - the parent had already exited, and every process observed under it is gone;
* `unproven` (or `unproven-accepted-by-flag`) - a descendant is still alive, or the enumeration
  could not run; this is nonzero unless `--allow-unknown-cleanup` accepted it explicitly.

An unobservable tree is never recorded as clean: with nothing observed, the verdict stays
unproven rather than assuming an empty tree. This proof is Windows-specific, like the rest of
the process-tree handling here; it is not a Unix process-tree proof.

A cooperative interrupt (SIGINT, SIGTERM, SIGHUP) is honored: the run stops at the next
stage boundary, stops the host it owns, releases the port, reports nonzero and names the
signal in the retained record. An external **forced** kill of the launcher PID runs no
JavaScript at all, so descendants can still be orphaned; a Windows Job Object with
KILL_ON_JOB_CLOSE would close that hole and is **not** implemented. That stays a named G0
limitation, not a claimed guarantee, and this cleanup proof is Windows-specific: these
tests are not evidence about a Unix process tree.

The interrupt is checked at every stage boundary and on each identity ping, and it gates
the final verdict: a signal that arrives late still fails the run as `stage: interrupt`.
A signal landing strictly inside the frozen adapter's own in-process case loop is observed
at the next boundary after it returns, so the cases may have run to completion before the
refusal is reported - the record still never calls that a pass.

### Fixture determinism (qualified, not claimed)

Fixtures are generated from the pinned source with the prepared source's own `tsx`.
`g0-kitchen-sink.docx` is byte-stable across runs. `g0-slides.pptx`, `g0-text.pdf` and
both `g0-compatibility-*.xlsx` files embed volatile package ids/timestamps, so their
**bytes** differ per run while the adapter's oracles stay behavioural and still pass.
The record marks each generated fixture `volatileAcrossRuns` with the reason instead of
pretending byte reproducibility.

### Source-mutation proof, and what it does not cover

`sourceTree.unchanged` folds every file except `node_modules` and `.git`, so it proves the
tracked source did not change while the run was live. A tool cache written into the shared
`node_modules` would not move that digest. Fixture and prebundle children therefore also
run with `TEMP`/`TMP`/`TMPDIR` inside the owned work directory, which is the mechanism that
keeps such a cache out of the shared tree in the first place.

---

## 5. Tests

```powershell
& $NODE --test scripts/office-g0/run-engine-contract-lab.test.mjs
```

67 tests: hermetic unit coverage of arguments, workspace-root discovery (shared-lab root
versus a checkout-local stub, plus fallbacks), strict path ownership and physical
containment, pin and provenance verification, pinned-node attribution and the declared
runtime range, port probes, identity/readiness, cooperative termination, cleanup
truthfulness, the observed owned-tree proof and the record shape; plus real bounded
integrations for occupied port, missing dependency, wrong pin, a tampered source identity,
readiness timeout, child crash, a delivered interrupt, a run with a verified upstream
checkout, and the **real end-to-end run** (11/11, no unavailable rows, port released,
evidence retained, repeatable across two sequential runs on one port).

Every case that needs the prepared source, the pinned node or an upstream checkout skips
**explicitly, naming the missing input** - none of them returns early in a way that could
read as a pass. With all inputs present the suite runs 67/67 with zero skips.

---

## 6. Scope limits

This is a G0 lab delivery. It does **not** provide production Go auth/ACL, deployment,
an installer, the final engine-runtime decision, or all-format native support.

The dependency cache under `.uniwork-dev/office-g0/bootstrap-source` may be reused, but
this command makes **no** self-contained offline-distribution claim: it needs a prepared
source tree, its `node_modules`, and `esbuild`/`tsx` inside it.

Related documents: [engine-contract.md](engine-contract.md) (frozen contract),
[README.md](README.md) (source/manifest provenance),
[source-manifest.json](source-manifest.json) (pin and dependency closure).

---

## 7. Later accepted evidence this command does not absorb

Generation 48 accepted six canonical real-adapter fault cases for the modeled
reference boundary. Their runner is `scripts/office-g0/run-engine-contract-faults.mjs`.
This lab command still runs the frozen 11-case adapter. It does not run those
six cases, and a green lab exit is not evidence that the six fault cases ran.

The parent business job map used when the fault runner restarts the engine is
not durable. It lives in the parent process. This lab command does not change
that limit and does not claim a durable service restart.

Prepared bootstrap-source, its `node_modules`, `tsx` and `esbuild` remain
external inputs. This document does not claim a clean standalone production
build. On 2026-09-22 a direct read showed `apps/pdf/src/main/image-edit.ts`
line 1 imports `nativeImage` from `electron` in both the genoffice checkout
and bootstrap-source (19325 bytes each). A non-recursive scan of
`packages/docx-engine/src/*.ts` found no `electron` import. Those checks
reconfirm the existing placement blockers. They do not choose a runtime.

This lab command is not the scoped editor cycles recorded in
`module-runtime-map.json` `scoped_editor_cycles`. A green 11-case exit does not
deny those cycles, and those cycles do not make this command a browser-worker
or product-service proof.


## 8. RT-02 and G1/G2 handoff status

RT-02 has bounded evidence present: the separate real-engine artifact records
11/11 loopback cases at contract `uniwork-office-engine-contract/1`, oracle
`bae36e364475441967d8bf092e1c34b43d11a14c5239745be6bc08b8de0f5cad`; see the candidate map `rt02_reconciliation`
and engine contract section 14 for artifact SHA, exact case ids, and the distinct
six-fault run. These results do not change this command into a product service
or establish a selected runtime. DOC-003 whole browser acceptance, Go ACL/store,
durable job state, and the G2 clean-checkout production build remain pending.

Section 15 of the engine contract gives G1/G2 a proposed source layout, public
entry, dependency direction, catalog constraints, private job/resource/cleanup
contract, upgrade/rollback gates, and owners. This is G0 handoff output only;
the current command still depends on prepared source and toolchain inputs and
does not prove a standalone product build. G2 must produce and build the ported
source in a clean monorepo checkout; G3 owns browser/editor integration.
