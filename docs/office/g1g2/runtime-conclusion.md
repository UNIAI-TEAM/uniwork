> **Bản sao vào git (2026-09-26, UNI-657).** Nguồn: `.uniwork-dev/orca-recovery-g119/doc004-runtime/RUNTIME-CONCLUSION.md` trong checkout `dev-uniwork`, sha256 `d644a5f1bd258933b043fda665a484ccb53d7ab0143d57c94275957b3728fa2d`. Nội dung bên dưới giữ nguyên văn; đường dẫn tương đối (`r2/...`, `receipts/...`, `work/...`) và các ký hiệu `B`/`M`/`S`/`E` trỏ tới thư mục chạy G0 ngoài git. Bản đồ tên file và phần đã lỗi thời: [README](README.md).

# Runtime conclusion for DOC-001 1b (ADR-ready wording)

Slice `doc004-runtime`, g119, UNI-668 / DOC-004. Candidate for M; canonical files stay read-only.
Consumer: DOC-001 1b, i.e. the draft `docs/adr/drafts/documents-office-runtime.md` which will supersede ADR 0018.
Everything below cites an accepted register row or an existing artifact; nothing here is a product-integration claim.

## 1. The conclusion, in ADR wording

> **Decision.** UniWork Office keeps the editor in the host page for all six formats, with every host capability behind
> an injected adapter; the engine modules that need to run out-of-page run as a private service process, not in the
> browser bundle. XLSX recalculation keeps its native sidecar process inside that service and is never presented as a
> browser/WASM capability. The engine receives a scoped, expiring grant, owns no account, ACL or version store, and
> never writes a business table; Go owns authorization, quota, idempotency, the version/audit/outbox commit and the
> orphan-object ledger.
>
> **Scope of the proof.** The open-edit-serialize-reopen cycle of DOCX, XLSX, PPTX, PDF, Markdown and HTML is proven in
> the Orca embedded browser (Windows, Chromium 150.0.7871.250, Orca 1.4.209) by the six accepted `E-*-CYCLE` rows on
> the frozen lab bridge `uniwork-office-lab-bridge@1`. Those rows are the evidence a compatible entry point must cite.
> Every other operation covered by this map is **not** enabled: it is either an explicit `unsupported_operation` (501)
> refusal or it waits for the row named in its blocker.

## 2. Runtime per capability (the decision table)

| format | operation | runtime | state and evidence |
| --- | --- | --- | --- |
| docx | open + edit text + renderer serialize + reopen | browser page (real docs renderer) + injected adapter | **proven** `E-DOCX-CYCLE` |
| docx | parse bytes through the engine | worker (candidate) | blocked; bounded engine evidence inside `E-DOCX-CYCLE`; test named in the map |
| docx | edit table and image | browser page (candidate) | blocked on the required Orca browser; scoped rows `E-DOCX-TABLE-SCOPED-CHROME/EDGE` are bounded evidence only |
| docx | convert / export | internal service (candidate) | blocked; G0 behaviour is `unsupported_operation` (501) |
| xlsx | open + edit cells + recalculate + save + reopen | browser page + native sidecar in the internal service | **proven** `E-XLSX-CYCLE` (assertion `formula-recalculated-numeric` passed; engine ops ran on the real sidecar host) |
| xlsx | convert external/CSV, export PDF | internal service (candidate) | blocked; explicit 501 today |
| pptx | open + edit text/image/shape + save + reopen | browser page + private engine service | **proven** `E-PPTX-CYCLE` (shape gesture needs the declared channel `host:slides-edit-transform`) |
| pptx | render preview (self-contained) | browser page (candidate) | blocked: web font shaping is unmeasured |
| pptx | export PDF | internal service (candidate) | blocked; explicit 501 today |
| pdf | replace text and an existing image + save + reopen | browser page + injected adapter channels | **proven** `E-PDF-TEXT-CYCLE` (text run replaced, page-2 image changed, 8/8 assertions) |
| pdf | text apply/verify in the service | internal service | **candidate with supporting evidence** (NOT proven): the pre-register in-memory probe (`main-pdf-text-probe.json`); **no register row exists** - gap named, owner UNI-667; Advisor g119 condition 1 keeps this row a candidate; the probe is `E/office-g0/main-pdf-text-probe.json` with E = D:/.Vietants_Project/uniwork-workspace/.uniwork-dev (workspace root, UTF-16, issue UNI-667, outcome passed, and its own limitation says "No persisted output, browser, image-edit or render-fidelity proof") |
| pdf | serialize in the service | internal service (candidate) | blocked: no product save path wired |
| pdf | convert, OCR | internal service | blocked; OCR is out of M1 scope by Q2-A |
| md | open + edit + save + reopen | browser page + host adapter, no engine | **proven** `E-MD-CYCLE` |
| md | export docx / pdf | internal service | blocked; explicit 501 today |
| html | open + edit + save + reopen + isolated preview | browser page + host adapter, sandboxed preview origin | **proven** `E-HTML-CYCLE` (isolation assertions passed) |
| html | convert to docx, export PDF | internal service | blocked; explicit 501 today |

## 3. Deviations from INT-01 the ADR must state (not hide)

1. **XLSX recalculation is a native process in the internal service**, not a browser engine: INT-01 rule 4 forbids the
   WASM inference, and the accepted cycle recalculated through the native sidecar host.
2. **PDF existing-image editing is Electron-bound in the upstream module** (`image-edit.ts` imports `electron` at
   module scope). The accepted cycle proves the operation through additive lab channels; the product needs either a
   Node-safe decode adapter (G2) or a desktop host (G4). It is not proven in the engine host as it stands.
3. **PPTX ran its engine on the private service host** (engine `runtime: engine-host-http`), not in a browser worker,
   and the accepted shape gesture needed one declared extra channel that the frozen bridge does not implement. The
   product must implement that channel or refuse the gesture explicitly.
4. **HTML preview isolation is real work, not a rename**: the accepted cycle proved isolation on a non-app origin
   (sandboxed frame without `allow-same-origin`); the desktop scheme re-homing stays G4 work.
5. **Markdown and HTML have no engine at all**: the editors hold the source and the adapter only performs file I/O.
   The draft ADR should say so plainly instead of implying a shared engine.

## 4. Open questions in the draft ADR, as of this slice

| # | Question | State after DOC-004 |
| --- | --- | --- |
| O-01 | Final runtime per format/operation | **answered for the six editor cycles** (section 2); every other operation has a named runtime candidate **and** a blocker plus the test that would prove it |
| O-02 | How to run the native Rust engine server-side | **answered in direction**: its own native process/container beside the service, reached only by Go; the product deployment is G2 work |
| O-03 | Which PDF engine edits the text layer, with which limits | **answered for the accepted scope**: the pinned PDF engine over the injected adapter; the limits of the cycle are in its row |
| O-04 | Desktop login and version/conflict units | not this task (DOC-005 owns it) |
| O-05 | ADR number; concrete app id / scheme / update feed / keychain values | **still open**: every identity value is a proposal in `module-runtime-map.json` -> `packaging_and_namespace`, owned by G4 UNI-636 and G7 UNI-661; none exists at the pinned commit |

## 5. What DOC-001 1b must not claim

- Not that Office storage, ACL or the commit transaction exist: the register states they are modeled; G1 owns them.
- Not that the whole Q1-B capability matrix is proven: the accepted rows cover the editor cycles; the remaining
  capability rows are blocked in the map with the test that would prove each one.
- Not that an identity value (app id, scheme, user-data namespace, update feed) exists or has been checked.
- Not that a clean-checkout product build exists: see `PACKAGING-AND-HANDOFF.md` section 6 for exactly what the
  clean-copy run does and does not prove.

## 6. Evidence to cite in the ADR

Rows: `E-DOCX-CYCLE`, `E-XLSX-CYCLE`, `E-PPTX-CYCLE`, `E-PDF-TEXT-CYCLE`, `E-MD-CYCLE`, `E-HTML-CYCLE`, the scoped
`E-DOCX-TABLE-SCOPED-*`, `E-PDF-TEXT-SCOPED-CHROMIUM`, `E-PPTX-IMAGE-SCOPED-*`, `E-CHECKSUM-ZERO-PUT-SCOPED`,
`E-XLSX-INPUT-SCOPED-ORCA`, and the six `E-DOC004-*` fault rows - all in
`docs/office/g0/evidence-register.json` (register decision GO, verifier GO 8/8, 2026-09-25).
Files: `docs/office/g0/module-runtime-map.json` (updated by this slice's candidate), `docs/office/g0/engine-contract.md`
sections 9-11, `docs/office/g0/RT02-adapter-evidence.json`, the six `docs/office/g0/RT02-fault-*.json`.