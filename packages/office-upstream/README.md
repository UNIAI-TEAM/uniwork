# @uniwork/office-upstream

Pinned, license-attributed subset of the upstream GenOffice engine source,
vendored so UniWork Office builds from a clean checkout — no `../genoffice`, no
symlinks, no private registry (UNI-684 / G2-01).

## Layout

| Path | What it is |
| ---- | ---------- |
| `upstream/` | Byte-identical copy of the pinned upstream files (commit `09485f884dc845cf3bf27fb7edfe489f9d457aad`). Never edited. |
| `provenance.json` | Per-file byte count + sha256 + blob id for every vendored file, plus the pin and licence record. |
| `patches/` | UniWork diffs applied to a scratch copy at build time (`SERIES.md` documents each patch and its provenance). |
| `LICENSE`, `NOTICE` | Apache-2.0 attribution, duplicated beside the tree because the boundary checker requires it at the package root. |

## Commands (from the repository root)

```sh
node scripts/office/vendor-upstream.mjs --check   # verify vendored bytes == provenance
node scripts/office/build-upstream.mjs            # provenance → copy → patch → install → bundle
node scripts/office/replay-fixtures.mjs           # pass/fail/blocked per G0 format
```

Build order (`build-upstream.mjs`):

1. Verify `upstream/` against `provenance.json` (missing / modified / extra files fail).
2. Copy `upstream/` to `.go-tmp/office-upstream-build/upstream` (gitignored scratch).
3. Apply `patches/*.patch` in name order (`git apply -p1`).
4. Generate a scratch `package.json` whose dependencies are pinned to the exact
   versions in the vendored `package-lock.json` (single-version transitives
   pinned via `overrides`), then `npm install` against the public registry.
5. Bundle each vendored `packages/*` with the repository's catalog-pinned
   esbuild, in dependency order, into `dist/<pkg>.mjs`.
6. Write `build-record.json` with every step's status and each artifact's
   sha256. The Rust xlsx sidecar needs `--with-native` and cargo; without them
   it is reported `not-attempted`, never as built.

The vendored upstream `package.json`/`package-lock.json`/`tsconfig.base.json`
are copied inside `upstream/` for exactly this flow; they are provenance, not
workspace members — this package has no scripts and is not part of the product
build graph.
