# CONTRACT-v1.1 - addendum to CONTRACT-v1: the E-XLSX-CYCLE fixture rebind

> **Status: APPLIED to M on 2026-09-25 (Advisor g118 integration; register/verifier r3 carry the rebinds and
> `supportingFixtures`); the text below is unchanged. Statements such as "E-XLSX-CYCLE stays PENDING" describe the
> state when v1.1 was frozen; the row is now PASS in the integrated register.** Originally owned by slice: `.uniwork-dev/orca-recovery-g104/core-protocol` (S).
> Machine-readable twin: [contract-v1.1.json](contract-v1.1.json). This file SUPERSEDES
> [CONTRACT-v1.md](CONTRACT-v1.md) where the two differ; everything not restated here is unchanged.

## 1. What changed, and what did not

| | v1 | v1.1 |
| --- | --- | --- |
| protocol string on the wire | `uniwork-office-lab-bridge@1` | `uniwork-office-lab-bridge@1` (unchanged: nothing on the wire changed) |
| contract document version | 1 | **1.1** |
| core-row fixture rule | the row's own manifest fixture | unchanged, **plus** the E-XLSX-CYCLE rebind and the optional `supportingFixture` row field |

The protocol version and the contract-document version are deliberately different numbers. A row still records
`protocolVersion: "uniwork-office-lab-bridge@1"`, because the envelopes, channels, operation ids and receipt
fields did not change; only which manifest fixture the XLSX core row must use as its primary identity changed.

## 2. The E-XLSX-CYCLE fixture rebind (Advisor decision g117, 2026-09-25)

    row     E-XLSX-CYCLE      (required core gate G0-CORE-XLSX, format xlsx)
    primary F-XLSX-KITCHEN    sheets/xlsx-kitchen-sink.xlsx      5046 B  BF69B9DBC4F6B8FC485BAF6255494ED490EE6C53A3051CB4CE6F967F34FE4BC6
    supporting F-XLSX-EDIT    sheets/xlsx-compatibility-edit.xlsx 3340 B  2C2D3A09543A0AB83E4449F7224C0B81810C1071DBB87BBC59F398B12DCEF687

Why: the row's required assertion `formula-recalculated-numeric` (with `formula-expected-value`) cannot be met on
`F-XLSX-EDIT`. The manifest's own text for that entry describes it as holding a cached formula, but the Advisor
verified that the fixture has no cell formula at all, so no recalculation can be observed on it. The rebind is
the same mechanism the MD and HTML rows use: the row names one primary fixture that can satisfy every required
assertion, and the older fixture stays as context.

Both files live under `M/docs/office/g0/fixtures/files/<entry path>` exactly as every other manifest fixture, and
both hashes above were re-read from M on 2026-09-25:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "M\docs\office\g0\fixtures\files\sheets\xlsx-kitchen-sink.xlsx"
Get-FileHash -Algorithm SHA256 -LiteralPath "M\docs\office\g0\fixtures\files\sheets\xlsx-compatibility-edit.xlsx"
```

Bounds of this change:

1. **The fixture manifest is not edited.** `M/docs/office/g0/fixtures/manifest.json` keeps its text for
   `F-XLSX-EDIT`, bytes and sha256 included. The disagreement between that text and the fixture bytes is a
   recorded finding owned by the **core-xlsx-pdf** slice; it is not papered over here.
2. **No row status changes.** `E-XLSX-CYCLE` stays `PENDING`; the rebind only fixes what its primary identity will
   be when the Orca-embedded cycle is run and the row is filled in. G0 stays NO-GO.
3. **Artifact refs stay bound to the primary fixture**: `ref = F-XLSX-KITCHEN/xlsx/open-edit-cell-recalculate-save-reopen`.
   A `supportingFixture` never appears in a ref and is never an identity a gate can count.
4. The register candidate records the rebind in a new `fixtureRebinds` block and sets the pending row's
   `fixture: "F-XLSX-KITCHEN"` with `supportingFixture: "F-XLSX-EDIT"`; the verifier (r2) validates that block.

## 3. The `supportingFixture` row field

```json
{
  "id": "E-XLSX-CYCLE",
  "fixture": "F-XLSX-KITCHEN",
  "supportingFixture": "F-XLSX-EDIT"
}
```

* optional; when present it must be a non-empty manifest-id-shaped string and must differ from `fixture`;
* it is reported in the verifier output and in the row, so a reader can see which older fixture was kept;
* every artifact of the row still carries `ref = <fixture>/<format>/<operationId>`;
* a row whose primary `fixture` is the retired side of a rebind for its own format is reported by the verifier
  (`core-row-uses-retired-fixture`, a warning that keeps the register valid and the gate unsatisfied) - it is the
  mechanical rule that would have caught the F-XLSX-EDIT problem before a cycle was run on it.

## 4. Unchanged from CONTRACT-v1

The protocol string and its shape, both envelopes, the refusal codes and their ordering (declared envelope
checked before any write or engine call), the manifest fixture binding (including `fixture/files/` as the fixture
root, byte+sha256 equality, and `fixture_identity_unavailable` for entries without an identity), the canonical
operation ids, the save channels, the receipt path/field names and digest, the engine identity and call
attribution rules, the browser identity rule, the Orca-embedded row template, and the reference client. Read
CONTRACT-v1.md for all of it; this file only adds sections 2 and 3 above.

## 5. Errata (r3 / Advisor g117 section 4, 2026-09-25)

### 5.1 Fixture root: the lab reads a LAB-CONTAINED copy, not M directly

Sections 1-3 above (and CONTRACT-v1.md section 4) describe `--fixture-root` as pointing at
`M/docs/office/g0/fixtures/files`. That is the right *identity* root, but a lab session cannot read it unless
the lab was also given it as a read root: `LabRoots.requireRead` refuses a path outside the lab's own roots, so
a bare `--fixture-root M/docs/office/g0/fixtures/files` answers `path_outside_lab`
(core-docx-pptx/evidence/protocol/FINDING-fixture-root-outside-lab.md). The corrected recipe:

1. copy the manifest fixture's bytes into the lab (a lab-contained copy - e.g. `<lab>/fixtures/<name>`), or pass
   the fixture directory as the lab's `--fixtures <dir>` read root, which is what this slice's smoke does;
2. verify the copy against `M/docs/office/g0/fixtures/manifest.json` by size AND sha256 BEFORE the lab starts;
3. open the session on the lab-contained copy and let the receipt record `input.byteEqualToManifest: true`
   together with the manifest id, path and sha256;
4. never treat the M path as a document root. The manifest stays an identity source, not a lab read root.

Nothing else in the fixture binding changes: the identity is still the manifest entry, and a byte difference is
still `fixture_identity_mismatch`.

### 5.2 A row's fixture id must exist in the manifest (verifier r3)

The verifier now reads the fixture manifest (`--fixture-manifest <file>`, otherwise
`<root>/docs/office/g0/fixtures/manifest.json`) and reports **`unknown-fixture-id` as an error** for a required
core-cycle row whose `fixture` or `supportingFixture` is not a manifest id - and for both sides of a
`fixtureRebinds` entry. A non-core row that keeps a historical lane-fixture name stays a warning, and a run that
cannot read the manifest reports one `fixture-manifest-unreadable` warning rather than skipping silently.
This caught two register bugs of the same class: `E-PPTX-CYCLE.fixture` was `F-PPTX-STANDARD` (the manifest id is
`F-PPTX-STD`) and `E-MD-CYCLE.fixture` was `F-MD-KITCHEN` (the manifest's Markdown kitchen-sink id is
`F-MD-FULL`, text/markdown-kitchen-sink.md, 1122 B, 7CC9530F...). Both are corrected in the register candidate;
core-md-html owns confirming its primary fixture.

### 5.3 Slice-owned lab extensions are not part of this contract

`pdfApi.pageImagePng` (core-xlsx-pdf) and `host:slides-edit-transform` plus the `pptx-edit-transform` entry in
the lab's engine allowlist (core-docx-pptx) extend `e2e/office-g0/lab-server.mjs` / `lab-engine.mjs` on top of
this slice's revision-B postimage. They do not change the protocol string, the envelopes, the receipt fields or
the row template; a revision C folding them into one lab-server patch will be produced only if the Advisor asks.
