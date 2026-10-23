> **Bản sao vào git (2026-09-26, UNI-657).** Nguồn: `.uniwork-dev/orca-recovery-g119/doc003-evidence/r2/Q7-BLOCKER.md` trong checkout `dev-uniwork`, sha256 `cf6a71717374888ad1576d3b5502b9f73ed75ebde7276e92b7bd1b4c33293b54`. Nội dung bên dưới giữ nguyên văn; đường dẫn tương đối (`r2/...`, `receipts/...`, `work/...`) và các ký hiệu `B`/`M`/`S`/`E` trỏ tới thư mục chạy G0 ngoài git. Bản đồ tên file và phần đã lỗi thời: [README](README.md).

# Q7 (plan 3.4) - exact blocker, r2

Plan 3.4: warning names exactly what will change; cancel creates no output; accept creates a copy with provenance; source
and history unchanged. "Chưa có engine chuyển đổi hợp lệ thì báo blocker, không bỏ lỗi nội dung bằng thông báo chung."

## What r2 established (correcting r1)
r1 recorded `engine_unsupported` for the legacy `.xls` open. That was the S lab wrapper binding no XLSX operation at all
(r2/ROOT-CAUSE.md D2), not an engine verdict. With the XLSX engine bound on the accepted sidecar (sha256 a498cbd7...),
the real engine answers the legacy file with a named parse error:
`[office-g0-xlsx] engine /engine/xlsx-open refused: invalid Zip archive: Could not find EOCD` (HTTP 502 engine_error,
r2/receipts/author-probe-http.json; browser text recorded by Tester r2, part A2). The ODT open still lands on a blank
Untitled.docx through the upstream failed-open fallback (PORT-ITEMS P3).

## The blocker, exactly
1. No conversion engine is bound or exists in the G0 lab: the lab allowlist `ENGINE_OPERATIONS`
   (M `e2e/office-g0/lab-engine.mjs:32-75`) has no convert/import operation, and the engine host advertises none
   (`r2/receipts/run-lab/*/*/engine-proof.json` advertisedRoutes: docx-*, pptx-*, pdf-*, xlsx-* only). `xlsx-open` reads
   OOXML zip packages only; there is no BIFF8 (`.xls`), ODF (`.odt/.ods`), RTF or XLSB reader.
2. No warning / cancel / accept surface exists: the renderers have no "convert to OOXML" dialog on these paths (sheets:
   failed select -> shell + status line; docs: failed open -> blank document, B `App.tsx:1788`).
3. Provenance and history are Workspace concepts (plan 5.4, DOC-005 contract); the lab has neither.
Nothing is faked: no conversion was simulated and no provenance field was invented.

## What is observable now (and was observed)
- Source unchanged: before/after sha256 of F-LEGACY-XLS (`2b5ec829...`) and F-UNSUPPORTED-ODT (`98329f94...`) (r1 A2);
  r2 Tester re-hashes on the r2 lab.
- No output file is created by the refused open (r1 lab-root deltas; r2 Tester lab-root delta).

## Owner and closing test
- Conversion engine (legacy/ODF -> OOXML, service side, never in the browser bundle): G2 UNI-658 (adapter + Office Engine
  Service boundary, INT-01), with the service choice recorded in DOC-004's contract.
- Warning/cancel/accept UI: G3 UNI-659.
- Provenance/history record of the converted copy: DOC-005 contract (plan 5.4) implemented in G1/G2.
- Closing test (to be written with the engine): Orca-browser row on F-LEGACY-XLS and F-UNSUPPORTED-ODT:
  (a) the warning lists what will change (manifest `expected.content`: three sheet names, `Sheet1!A1='replaceMe'`);
  (b) Cancel -> lab/workspace delta empty, source sha256 unchanged;
  (c) Accept -> a new OOXML copy whose reopen matches the manifest oracle, with a provenance field naming the source id
      and sha256; (d) source and its history unchanged.
Until then DOC-003's 3.4 checkbox stays open with this blocker (plan: "Không đạt một nhóm lõi thì báo blocker").

## Closing status (G2-07b, UNI-690, 2026-09-28)

The server half is closed; the warning UI (G3 UNI-659) is still open. Engine choice (Advisor, option A): in-repo
node-only converters `packages/office-engine/src/node/convert/` (BIFF8 `.xls -> .xlsx`, ODF text `.odt -> .docx`),
bound in the engine service as `convert:xls` / `convert:odt`, no new dependency, never in the browser bundle.
Closing test steps (a)-(d) run on the real engine container + FileService on MinIO in
`server/internal/service/document_office_q7_integration_test.go` (`TestDocumentOfficeQ7Integration`), with the
gate/authz rows in `document_office_q7_test.go`; the per-step table is `docs/office/g1-g2-evidence.md` section 8.
