# CONTRACT-v1 - versioned browser-cycle protocol for the G0 office lab (UNI-656 / slice core-protocol)

> **Status: APPLIED to M on 2026-09-25 (Advisor g118 integration, revision C: `e2e/office-g0/lab-bridge.mjs`,
> `lab-server.mjs`); the text below is the frozen v1 as accepted and is unchanged.** Originally owned by slice:
> `.uniwork-dev/orca-recovery-g104/core-protocol/` (S). Every file named `M/...` below is a canonical
> repository file that this slice reads but never writes. The Advisor integrates after acceptance.
> Machine-readable twin: [contract-v1.json](contract-v1.json). Executable stand-in:
> `reference-client/reference-client.mjs`, its self-test `reference-client/reference-client.test.mjs`.

This document freezes **version 1** of the protocol a browser save in the DOC-003/DOC-004 lab carries, so
that every one of the six G0 core-cycle rows can name a real, readable-back protocol string instead of
leaving `protocolVersion: null`. It is written against the code that exists today - the lab transport and
save channels in `M/e2e/office-g0/lab-server.mjs`, the engine proxy in `M/e2e/office-g0/lab-engine.mjs`, the
engine host in `M/e2e/office-g0/engine-host.mts`, and the frozen DOC-004 boundary in
`M/scripts/office-g0/engine-contract.mjs` - and it invents nothing those files do not already speak. Where a
value does not exist yet, this contract says "unavailable" rather than naming one.

## 1. What was already real, and what v1 adds

Real and unchanged (anchors this contract rests on):

| Anchor | Evidence in code | What it gives the protocol |
| --- | --- | --- |
| Lab transport | `M/e2e/office-g0/lab-server.mjs` app listener: `POST /lab/<channel>`, `Content-Type: application/json`, body `{ viewId, ... }`, reply `{ ok: true, result }`, refusal `{ ok: false, error: <code>, message, details? }` (`LabProtocolError.toEnvelope`, `statusForCode`) | the request/response envelope v1 wraps |
| Session identity | `lab:session-open` returns `{ viewId, app, path, name, hash, size, workingPath, previewToken }`; `hash`/`size` are the sha256 and byte count of the **immutable input** the view was opened from (`ViewSessions.open`) | input fixture identity |
| Save channels | `host:docs-save`/`-save-new`/`-save-as`/`-save-to`, `host:text-save`, `host:pdf-save`, `host:sheets-save-edits`, `host:slides-save`/`-save-as` | the six formats' save paths |
| Output identity | `writeForView` and `publishDeck` read the bytes back off disk and report `{ path, bytes, sha256, bytesMatch }` | output sha256 |
| Engine worker | engine host answers `POST /engine/<operation>` with `{ ok, result }` or `{ ok: false, code, error }` **always at HTTP 200**; the lab proxy binds a fixed allowlist `ENGINE_OPERATIONS` and validates status, JSON content type, envelope and payload bound | engine calls the protocol encloses |
| Frozen DOC-004 contract | `M/scripts/office-g0/engine-contract.mjs` `CONTRACT_VERSION = "uniwork-office-engine-contract/1"`, `PROTOCOL_VERSION = 1`, canonical-JSON payload fingerprint, declared-checksum refusal before storage | naming/shape conventions reused here; **not replaced and not claimed by this slice** |

The engine host's own envelope carries **no version field**. Therefore, exactly as the slice brief allows, the
protocol string v1 names the lab adapter's own versioned envelope around the real engine calls. It does not
claim that any engine host speaks it back: the engine call inside the envelope stays the unversioned
`{ ok, result }` host protocol, and the receipt records that truthfully.

## 2. The protocol string

    name    = uniwork-office-lab-bridge
    version = 1
    string  = uniwork-office-lab-bridge@1

* Shape: `^[a-z0-9][a-z0-9-]*@[1-9][0-9]*$` (name, literal `@`, positive integer major version).
* The string is the value of the row's `protocolVersion`, the receipt's `receipt.contract`, and every save
  response's `result.bridge.contract`.
* A version bump is a new string (`@2`), never an edit of this one. A save that declares a contract string the
  running adapter does not implement is **refused** (`bridge_contract_unsupported`), never silently served.
* v1 covers the six formats of `REQUIRED_FORMATS` (`docx`, `xlsx`, `pptx`, `pdf`, `md`, `html`) and the six
  canonical core operation ids in section 5. It does not cover DOC-005, DOC-004 fault cases, or any product
  endpoint.

## 3. Envelopes

### 3.1 Request envelope (browser -> lab)

Unchanged transport, plus one optional declared block:

```json
POST /lab/<channel>            (Content-Type: application/json)
{
  "viewId": "view-<server-minted>",
  "...": "channel-specific body, unchanged from today",
  "bridge": {
    "contract": "uniwork-office-lab-bridge@1",
    "operationId": "open-edit-text-save-reopen",
    "client": { "family": "orca", "chromiumVersion": "150.0.7871.250", "userAgent": "<navigator.userAgent>" }
  }
}
```

Rules:

1. `bridge` is optional for compatibility with the frozen renderer builds (they do not send it); a request
   **without** it is served, and the adapter stamps the contract itself.
2. If `bridge` is present, `bridge.contract` must equal the running adapter's contract string. Missing
   (`bridge_contract_required`) or different (`bridge_contract_unsupported`) -> HTTP 400, no write and no engine
   call. This is the "missing protocol string" negative case.
3. `viewId` stays server-authoritative: a body-carried `viewId` is the server-minted one, and the adapter never
   accepts a browser-chosen destination, operation id or contract name as authority.
4. `bridge.client` is a declaration, not proof: the adapter records it in the receipt as `browser.declared` and
   records the observed `User-Agent` request header separately as `browser.userAgent`. When the two disagree,
   both are kept and the receipt says `browser.declaredMatchesUserAgent: false`.

### 3.2 Response envelope (lab -> browser)

Success (HTTP 200): `{ "ok": true, "result": { ...channel result..., "bridge": <bridgeStamp> } }`
Refusal (mapped status, default 400/500): `{ "ok": false, "error": "<code>", "message": "...", "details": {...} }`

`bridgeStamp` (identical in every save response and every receipt):

```json
{
  "contract": "uniwork-office-lab-bridge@1",
  "protocol": { "name": "uniwork-office-lab-bridge", "version": 1 },
  "operationId": "open-edit-text-save-reopen",
  "requestDigest": "<sha256 of canonical-json-v1({ channel, body }) - the request body together with\n                     the channel it was posted to>",
  "outputSha256": "<lowercase sha256 of the bytes on disk>",
  "outputBytes": 3417,
  "receiptPath": "<absolute path of the receipt written for this save>",
  "receiptDigest": "<sha256 of the receipt's canonical JSON>"
}
```

Non-save channels do not carry `bridge`. A save whose receipt cannot be written is **not** answered `ok: true`:
the adapter throws `bridge_receipt_unwritable`.

## 4. Fixture binding (byte-equal manifest identity)

The register binds each core row to a fixture in `M/docs/office/g0/fixtures/manifest.json` (for example
`F-DOCX-KITCHEN` -> `docs/docx-kitchen-sink.docx`, 3415 bytes,
`F86C8D90B44A265945B4918DC1F857EBD835F28E3BDF3199F24E66F7FC8AB00B`). v1 makes that binding a loading rule,
not a label:

1. The lab is started with `--fixture-manifest <M/docs/office/g0/fixtures/manifest.json>` (env
   `LAB_FIXTURE_MANIFEST`) and an optional `--fixture-root <dir>`. The default root is
   `<the manifest's own directory>/files`, because a manifest entry's `path` is REPOSITORY-relative
   (`docs/docx-kitchen-sink.docx`) while its bytes live under `docs/office/g0/fixtures/files/`. That is the
   rule M/scripts/office-g0/paths.mjs already owns as `resolveFixtureRoot()`, not a new convention:
   `F-DOCX-KITCHEN` therefore resolves to `M/docs/office/g0/fixtures/files/docs/docx-kitchen-sink.docx`
   (3415 bytes, `F86C8D90B44A265945B4918DC1F857EBD835F28E3BDF3199F24E66F7FC8AB00B`) and `F-XLSX-KITCHEN` to
   `M/docs/office/g0/fixtures/files/sheets/xlsx-kitchen-sink.xlsx` (5046 bytes,
   `BF69B9DBC4F6B8FC485BAF6255494ED490EE6C53A3051CB4CE6F967F34FE4BC6`). Both hashes were re-read from M on
   2026-09-25 and match the manifest entries.
2. A page opens a manifest fixture by asking for its **id**: `?fixture=F-DOCX-KITCHEN` (equivalently
   `?fixture=manifest:F-DOCX-KITCHEN`, or `{"app":"docs","fixtureId":"F-DOCX-KITCHEN"}`). The id never names a
   path; the adapter resolves `fixtures[].path` from the manifest itself.
3. Before any working copy is made, the adapter reads the manifest, resolves the entry, reads the file and
   compares **both** byte length and sha256 (case-insensitive; the manifest stores uppercase hex) with the
   manifest entry. Only then does it copy the bytes into the view's working directory.
4. An entry must carry the `bytes` and `sha256` properties; an explicit `null` is the legitimate pending or
   large-band case (it loads and is refused by name when requested), while a missing property is a malformed
   entry. A refusal is never a save:

| Code | When | Status |
| --- | --- | --- |
| `fixture_manifest_missing` | the manifest file is absent or unreadable | 500 |
| `fixture_not_in_manifest` | the requested id is not an entry (`fixtures[].id`) | 400 |
| `fixture_identity_unavailable` | the entry exists but carries `bytes: null`/`sha256: null` (a large-band/pending entry such as `F-DOCX-TOC`, `F-LARGE-DOCX`, `F-LARGE-XLSX` whose bytes do not ship in Git) | 400 |
| `fixture_bytes_missing` | the manifest entry's file is absent or unreadable | 500 |
| `fixture_identity_mismatch` | on-disk length or sha256 differs from the manifest entry (the "wrong fixture bytes" negative case) | 409 |
| `fixture_manifest_invalid` | the manifest is not parseable, has no `fixtures` array, or an entry lacks `id`/`path`/`bytes`/`sha256` | 500 |

5. The session result gains `fixture: { id, manifestPath, manifestSha256, path, bytes, sha256, byteEqualToManifest: true }`
   and the receipt carries the same block. `byteEqualToManifest` is computed by the adapter, never asserted by a
   caller.
6. A raw path (`?fixture=<absolute path>`) keeps working for lab fixtures outside the manifest, but such a
   session records `input.fixtureId: null` and **cannot** produce a row that satisfies a core gate: the verifier
   requires `fixture` on the row and the artifacts' `ref` bound to it.
7. A lab copy with different bytes is a false identity. The `fixture_identity_mismatch` refusal exists so that a
   stale lane copy can never be opened under the name `F-DOCX-KITCHEN`: the accepted scoped DOCX table cycle ran
   `lab/fixtures/g0-kitchen-sink.docx` (sha256 `8b6de008b979174065aa43c58e17db5a3eb654b42eb61232c42945ecfa64dff9`),
   the same size and the same `word/document.xml` as the manifest fixture but different package bytes.

## 5. Operation id and engine operations

`operationId` is the row's canonical id from the verifier (`REQUIRED_OPERATION_IDS` in
`M/scripts/office-g0/verify-evidence.mjs`). A save whose session format has a canonical id records it; the
adapter refuses a declared `bridge.operationId` that is not the canonical id for the session's format
(`bridge_operation_mismatch`).

| format | app | save channels | canonical operationId | engine operations the save call itself invokes |
| --- | --- | --- | --- | --- |
| docx | `docs` | `host:docs-save`, `host:docs-save-new`, `host:docs-save-as`, `host:docs-save-to` | `open-edit-text-save-reopen` | none (the renderer serializes the package; `[]`) |
| xlsx | `sheets` | `host:sheets-save-edits` | `open-edit-cell-recalculate-save-reopen` | `xlsx-save` |
| pptx | `slides` | `host:slides-save`, `host:slides-save-as` | `edit-text-image-shape-save-reopen` | `pptx-txn` (pre-save), `pptx-save` |
| pdf | `pdf` | `host:pdf-save` | `replace-text-and-image-save-reopen` | `pdf-save` |
| md | `markdown` | `host:text-save` | `edit-source-save-reopen` | none (`[]`) |
| html | `html` | `host:text-save` | `edit-source-save-reopen-isolated-preview` | none (`[]`) |

`engine.operations` lists **only** operations the save call actually invoked, in call order, from the lab's
own allowlist `ENGINE_OPERATIONS` (`M/e2e/office-g0/lab-engine.mjs`). `engine.sessionOperations` lists every
engine operation the view ran from session open to this save. An empty array is a truthful statement that the
save path performed no engine-host round trip - it is not an error, and no row may upgrade it into an
engine-round-trip claim.

## 6. Engine identity and browser identity

```json
"engine": {
  "name": "@genoffice/docs",
  "version": "0.1.0",
  "runtime": "browser-renderer",
  "host": null,
  "operations": [],
  "sessionOperations": [],
  "sourcePin": "09485f884dc845cf3bf27fb7edfe489f9d457aad",
  "source": "<prepared-source root, absolute>"
}
```

* `name`/`version` come from the prepared source's own `package.json` identity (`name`, `version`), read by the
  adapter at boot for the packages it serves; they are never typed by hand into a row. For DOCX the package is
  `@genoffice/docs` and for PDF `@genoffice/pdf`, etc. A row copies these two values verbatim.
* `runtime` is `browser-renderer` when the bytes were produced inside the renderer bundle and `engine-host-http`
  when the save traversed the engine host through the lab proxy. `host` is the engine-host base URL only when
  THIS save really called the host: an in-process (injected) handler and a save that performed no engine call at
  all both record `host: null`, never a configured-but-unused URL.
* `sourcePin` is the upstream commit of the prepared source when the lab was started with `--source-pin`
  (the v11 lab runner knows it); otherwise `null`, and the receipt says so.
* `browser.family` is `orca` only when the transport carries that claim: a declared `bridge.client.family` of
  `orca`, or a Chrome-shaped user agent from a run whose runner also observed `orca --version`. A scripted HTTP
  client that borrows a browser user agent without that observation is recorded as `unspecified`, with
  `familySource` naming the rule that produced the value (the G0 rows themselves are Orca-embedded only, per the
  decision of 2026-09-25). `browser.userAgent` is the observed request header; `browser.chromiumVersion` is
  parsed from it when present, else `null`. `browser.orcaVersion` is the value the lab runner observed from
  `orca --version` and passed as `--orca-version <value>` (with `orcaVersionSource` naming that command);
  without it the receipt records `orcaVersion: null, orcaVersionSource: "unavailable"` and no row may fill the gap.

## 7. How the lab records it, and how a Tester reads it back

The adapter writes one durable receipt per save, inside the lab tree it owns:

    <labRoot>/receipts/<viewId>/save-<NNNN>-<channel>.json      e.g. save-0001-host-docs-save.json
    <labRoot>/receipts/<viewId>/refused-<NNNN>-<channel>.json   a named refusal (same shape, ok:false)
    <labRoot>/receipts/<viewId>/index.json                      append-only index of every receipt of the view

Channel is sanitized (`host:docs-save` -> `host-docs-save`); `NNNN` is a per-view zero-padded sequence. The
same entries are appended to the in-memory operation log that `lab:events-record` returns, with `bridge` added,
so a Tester can cross-check the durable receipt against the live log without trusting either alone.

Receipt shape (exact field names; `receipt.digest` is sha256 over the receipt's canonical JSON with
`digest.value` set to `null`, keys sorted, no insignificant whitespace - the `M/scripts/office-g0/engine-contract.mjs`
canonicalisation):

```json
{
  "receipt": {
    "kind": "uniwork-office-lab-save-receipt",
    "schemaVersion": 1,
    "ok": true,
    "contract": "uniwork-office-lab-bridge@1",
    "protocol": { "name": "uniwork-office-lab-bridge", "version": 1 },
    "at": "2026-09-25T00:00:00.000Z",
    "sequence": 1,
    "viewId": "view-...",
    "app": "docs",
    "format": "docx",
    "channel": "host:docs-save",
    "op": "docs-save",
    "operationId": "open-edit-text-save-reopen",
    "labRoot": "<absolute>",
    "requestDigest": "<sha256 of canonical-json-v1({ channel, body }) - the request body together with the channel it was posted to>"
  },
  "input": {
    "fixtureId": "F-DOCX-KITCHEN",
    "manifestPath": "<absolute path of fixtures/manifest.json>",
    "manifestSha256": "<sha256 of that manifest file>",
    "path": "<absolute immutable input path>",
    "name": "docx-kitchen-sink.docx",
    "bytes": 3415,
    "sha256": "f86c8d90b44a265945b4918dc1f857ebd835f28e3bdf3199f24e66f7fc8ab00b",
    "byteEqualToManifest": true
  },
  "output": {
    "path": "<absolute>",
    "name": "docx-kitchen-sink.docx",
    "bytes": 3417,
    "sha256": "<lowercase sha256 recomputed by the adapter from the bytes on disk>",
    "declaredSha256": "<what the renderer/engine reported, or null when nothing was declared>",
    "declaredIndependently": true,
    "independentDeclaration": "matched | not-declared",
    "verified": true,
    "verifiedAgainst": "bytes read back from disk; output.sha256 is the adapter recomputation"
  },
  "engine": { "...": "as in section 6" },
  "browser": {
    "family": "orca",
    "orcaVersion": "1.4.209",
    "orcaVersionSource": "run-lab.mjs --orca-version (orca --version)",
    "userAgent": "Mozilla/5.0 ... Chrome/150.0.7871.250 ...",
    "chromiumVersion": "150.0.7871.250",
    "declared": { "family": "orca", "chromiumVersion": "150.0.7871.250", "userAgent": "..." },
    "declaredMatchesUserAgent": true
  },
  "digest": {
    "algorithm": "sha256",
    "canonicalization": "canonical-json-v1 (sorted keys, no whitespace, digest.value=null)",
    "value": "<64 lowercase hex>"
  }
}
```

A refusal receipt carries the same `receipt` block with `ok: false` plus
`receipt.refusal: { code, message, details }`, and no `output`. `output.sha256` is ALWAYS the adapter's own
recomputation of the bytes on disk, and `output.verified: true` means exactly that: the bytes were read back and
re-hashed. `output.declaredSha256` stays `null` when the writer or engine declared nothing (then
`declaredIndependently: false` and `independentDeclaration: "not-declared"`); when a digest WAS declared, a
disagreement is refused with `output_hash_mismatch` and only a `refused-...json` receipt is written. A receipt is
never overwritten: the next sequence continues the view's existing receipts, and an existing file at the target
name is `bridge_receipt_unwritable`.

How a Tester reads it back (commands only; the Tester runs them in its own session and keeps raw output):

```powershell
# 1. the receipts of the view the browser just saved into
Get-ChildItem -LiteralPath "$lab\receipts\$viewId" | Select-Object Name, Length
# 2. the receipt itself
$r = Get-Content -LiteralPath "$lab\receipts\$viewId\index.json" -Raw | ConvertFrom-Json
$receipt = Get-ChildItem -LiteralPath "$lab\receipts\$viewId" -Filter 'save-*.json' | Sort-Object Name | Select-Object -Last 1
$doc = Get-Content -LiteralPath $receipt.FullName -Raw | ConvertFrom-Json
$doc.receipt.contract; $doc.receipt.operationId; $doc.input.sha256; $doc.output.sha256; $doc.engine.name
# 3. the bytes named by the receipt, independently
Get-FileHash -Algorithm SHA256 -LiteralPath $doc.output.path
(Get-Item -LiteralPath $doc.output.path).Length
# 4. the live log cross-check (through the Orca embedded browser, or a direct POST)
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/lab/lab:events-record" -ContentType 'application/json' -Body '{}'
```

Field names a row may quote, and nothing else: `receipt.contract`, `receipt.operationId`, `receipt.format`,
`receipt.channel`, `input.fixtureId`, `input.sha256`, `input.bytes`, `output.sha256`, `output.bytes`,
`engine.name`, `engine.version`, `engine.operations`, `browser.orcaVersion`, `browser.chromiumVersion`,
`digest.value`. Log path: `<labRoot>/receipts/<viewId>/`.

## 8. Row template for an Orca-embedded core row

This is the exact shape the verifier's table accepts for a `core-cycle` gate row, filled in from the receipt
(placeholders in `<>`; nothing invented). Format `docx` shown; the other five swap `format`, `gate`, `fixture`,
`operationId` and the assertion list from `REQUIRED_ASSERTIONS`.

```json
{
  "id": "E-DOCX-CYCLE",
  "kind": "core-cycle",
  "capability": "docx-editor-cycle",
  "format": "docx",
  "operation": "open the manifest fixture F-DOCX-KITCHEN, edit text in the real renderer, save, close, and reopen the persisted bytes in a fresh editor session",
  "operationId": "open-edit-text-save-reopen",
  "status": "PASS",
  "result": "pass",
  "level": "browser-real",
  "provides": ["editor-cycle", "engine-operation"],
  "operationEvidence": "byte-verified-operation",
  "adapter": "real",
  "uiKind": "real-editor",
  "platform": {
    "os": "windows",
    "browser": "orca",
    "browserVersion": "<embedded Chromium version, from browser.chromiumVersion>",
    "orcaVersion": "<browser.orcaVersion>",
    "embeddedBrowser": "orca"
  },
  "runtime": { "node": "<node version of the lab run>" },
  "engine": { "name": "<engine.name>", "version": "<engine.version>" },
  "protocolVersion": "uniwork-office-lab-bridge@1",
  "fixture": "F-DOCX-KITCHEN",
  "source": { "kind": "repo-commit", "id": "<registry.sources id>", "commit": "<40-hex>" },
  "command": "<exact command that started the lab and the browser steps>",
  "cwd": "<absolute>",
  "expected": { "result": "<expected.result of the manifest entry>", "oracle": "<the oracle actually compared>" },
  "actual": "<observed, including: receipt path, input sha256, output sha256, engine.operations, reopen observation>",
  "assertions": [
    { "id": "text-changed", "status": "passed" },
    { "id": "table-preserved", "status": "passed" },
    { "id": "image-preserved", "status": "passed" },
    { "id": "reopen-fresh-session", "status": "passed" }
  ],
  "scope": "<what this row does not cover>",
  "limitations": ["the save path performed no engine-host round trip; the package was serialized in the browser renderer (<engine.name>@<engine.version>)"],
  "artifacts": [
    { "role": "immutable-input",     "path": "<copied fixture>",        "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" },
    { "role": "persisted-output",    "path": "<saved bytes>",           "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" },
    { "role": "reopened-output",     "path": "<reopened copy>",         "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" },
    { "role": "render-evidence",     "path": "<reopen screenshot>",     "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" },
    { "role": "extraction-evidence", "path": "<structured extraction>", "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" },
    { "role": "report",              "path": "<save receipt JSON>",      "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" },
    { "role": "transcript",          "path": "<tester log/transcript>", "bytes": 0, "sha256": "<lowercase>", "ref": "F-DOCX-KITCHEN/docx/open-edit-text-save-reopen" }
  ]
}
```

Rules the verifier enforces on this template (and the row must satisfy honestly):

1. `platform.browser` is `orca`, `platform.browserVersion` is the embedded Chromium version and
   `platform.orcaVersion` is the Orca application version; both are non-empty. Installed Chrome/Edge rows are
   not required at G0 and never substitute for an Orca row; they stay valid only as non-gate scoped rows.
2. `protocolVersion` is the contract string (section 2). A core row at `browser-real` with an empty or unknown
   protocol string is an error, not a warning.
3. `operationEvidence: "byte-verified-operation"`, `adapter: "real"`, `uiKind: "real-editor"` and every
   required assertion of the row's format are present and `passed`.
4. `engine.name`/`engine.version` equal the receipt's `engine` block; the row must not claim an engine round trip
   the receipt does not record.
5. Artifacts: an `immutable-input` and a `persisted-output` are required, a `report` or `transcript` is
   required, and independent render/extraction evidence is required; PDF additionally needs
   `pre-edit-extraction`, `post-edit-extraction`, `pre-edit-render` and `post-edit-render`. Every artifact of a
   core row carries `ref = fixture/format/operationId` and one file belongs to one accepted row.
6. `fixture` is the manifest id, and the row's input artifact is byte-equal to that manifest entry (the receipt's
   `input.byteEqualToManifest` is the adapter's own check; the Tester re-hashes it).

## 9. Reference client (format slices can start now)

`reference-client/reference-client.mjs` is a dependency-free Node 22 module that speaks v1 without the lab:

* `buildSaveRequest({ channel, viewId, format, operationId, body, client })` - request envelope (section 3.1)
* `buildReceipt({ ... })` / `validateReceipt(receipt)` - receipt construction, canonical digest, structural checks
* `createFakeLab({ manifest })` - an in-memory adapter that resolves a manifest fixture, refuses wrong bytes,
  performs a modelled save, and returns `{ ok, result }` in the v1 envelope
* `readReceiptIndex(labRoot, viewId)` - the read-back a Tester performs, as a function

It is a **reference**, not evidence: its saves are modelled (`adapter: "model"`, level `harness` at best) and it
must never be cited as a real adapter run, a browser cycle or an engine round trip. Its self-test covers the
three required negative cases - wrong fixture bytes, missing/unsupported protocol string, mismatched output
hash - plus digest stability.

```powershell
& $NODE reference-client/reference-client.test.mjs        # node --test, no dependencies
& $NODE reference-client/reference-client.mjs --demo      # prints one example receipt
```

## 10. Negative cases (v1 acceptance)

| Case | Expected answer | Where it is asserted |
| --- | --- | --- |
| Wrong fixture bytes for a manifest id | `fixture_identity_mismatch` (409), no working copy, no receipt | adapter tests + reference client self-test |
| Missing protocol string in a declared `bridge` block | `bridge_contract_required` (400), no write, no engine call | adapter tests |
| Unsupported protocol string (`...@2`, invented name) | `bridge_contract_unsupported` (400), no write, no engine call | adapter tests + reference client self-test |
| Declared output hash differs from the bytes on disk | `output_hash_mismatch` (500), `refused-*.json` receipt with both digests, no `save-*.json` | adapter tests + reference client self-test |
| Core row without `protocolVersion` / without `orcaVersion` | verifier error, gate stays unsatisfied | verifier candidate tests |

## 11. What v1 does not claim

* not a product protocol: no Go service, auth, quota, version commit, audit or outbox is modelled here;
* not a replacement for the frozen DOC-004 boundary (`uniwork-office-engine-contract/1`) or for its fault gate;
* for docx/md/html the save path performs no engine-host call - the receipt says `engine.operations: []` and no
  row may claim an engine round trip for those formats;
* `orcaVersion` is only as good as the `orca --version` the runner observed; without it the receipt is explicit
  that the value is unavailable;
* the six core cycles themselves belong to the format slices (`core-docx-pptx`, `core-xlsx-pdf`,
  `core-md-html`); this contract only makes their rows readable and checkable.
