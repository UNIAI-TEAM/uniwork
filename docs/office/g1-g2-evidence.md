# Office G1-G2 evidence - G2-07a real-store integration (UNI-690)

> **Trang thai:** bang chung cua lane g2-07a tren nhanh `feature-UNI-690-office-integration`.
> Engine pin: `genoffice@09485f88+uniwork-office.0`; contract `uniwork-office-engine-contract/1`, protocol `1`.
> Cot **ket qua** chi ghi `pass` khi lenh trong cot **bang chung** da chay tren dung commit cuoi cua lane;
> cac hang chua chay ghi `not_run` kem ly do, khong bao gio ghi pass thay.

## 1. Pham vi

- Go: `server/internal/service/document_office*.go` (capability, version negotiation, operation gate, blank
  create), `server/internal/service/document_copy.go` (consent + provenance + ACL snapshot), route
  `/documents/{documentDocumentID}/office/*`, `/workspaces/{workspaceID}/documents/files/blank`,
  `/documents/{documentID}/copies`, SDI/SDO + OpenAPI.
- Core: `packages/core/api/endpoints/office.ts`, `packages/core/documents/office-hooks.ts`.
- Engine: chi dung build dang chay; lane nay KHONG bind them handler nao trong
  `apps/office-engine/src/worker/handlers.ts` (G2-04 so huu file do). Vi vay `docx`/`pptx` khong co
  thao tac server-side trong build nay - hang tuong ung ghi `not_bound`, khong gia lap.

## 2. Nguon bang chung

| Bang chung | Lenh | Pham vi |
| --- | --- | --- |
| Go service + handler | `go test ./internal/service/ -run 'TestDocumentOffice\|TestBlankSeedIsNeverEmpty\|TestDocumentCopy'` | capability, gate, blank, copy |
| Go integration (real FileService + engine container) | `server/internal/service/document_office_integration_test.go`: `go test ./internal/service/ -run TestDocumentOfficeIntegration` voi `OFFICE_ENGINE_TEST_URL`, `MINIO_*` | 5 dinh dang + 7 ca fault DOC-004 |
| Go handler | `go test ./internal/handler/ -run TestOffice` | flag gate, document authority, SDI/SDO, khong lo dia chi engine |
| Engine boundary (Node 22) | `node --test scripts/office/integration.test.mjs` (+ `OFFICE_REQUIRE_ENGINE=1` khi co container) | pin 3 noi, fixture manifest, capability that |
| Core TS | `pnpm --filter @uniwork/core typecheck\|lint\|test` | office.ts + office-hooks.ts + malformed tests |

## 3. Tung dinh dang (07a)

| Format | Fixture | Engine op | Bind trong build | Bang chung | Ket qua |
| --- | --- | --- | --- | --- | --- |
| docx | F-DOCX-SIMPLE | serialize (server) | **not_bound** -> `unsupported_operation` khong tao job/khong ghi byte; store round-trip upload -> commit -> doc lai | `TestDocumentOfficeIntegration/docx_pptx...` | not_run (Tester stage) |
| pptx | F-PPTX-STD | serialize (server) | **not_bound** nhu docx | `TestDocumentOfficeIntegration/docx_pptx...` | not_run (Tester stage) |
| pdf | F-PDF-TEXT | open + serialize | bound | open tra probe JSON (khac bytes nguon), serialize di dung mot commit path G1-03, doc lai bang checksum | `TestDocumentOfficeIntegration/pdf...` | not_run (Tester stage) |
| md | F-MD-FULL | serialize | bound | serialize -> stage -> validate -> commit -> doc lai byte-identical; provenance engine/contract ghi tren version | `TestDocumentOfficeIntegration/md...` | not_run (Tester stage) |
| html | F-HTML-VI | serialize | bound | nhu md | `TestDocumentOfficeIntegration/html...` | not_run (Tester stage) |
| (xlsx) | - | - | ngoai pham vi 07a (G2-04/07b) | - | not_run |

Create-blank: `create_blank` la hanh dong do Go sinh ra cho dinh dang nguon (`md`, `html`): seed khong rong duoc
engine serialize roi di dung duong create G1 (`CreateFileDocument`). Dinh dang khac tra `unsupported_operation`
reason `blank_not_bound` **truoc khi** dang ky output hay tao tai lieu, nen khong bao gio co file Office rong.

## 4. Bay ca fault DOC-004 (Go + FileService that + engine container that)

| Ca | Co che | Ky vong | Ket qua |
| --- | --- | --- | --- |
| type-version-mismatch | envelope contract `.../9` voi grant hop le | `contract_mismatch` 409, khong co job | not_run (Tester stage) |
| malformed-result | service tra JSON hong | `engine_result_invalid`, khong panic, khong job | not_run (Tester stage) |
| checksum-mismatch | fault `uniwork-fault:code engine_checksum_mismatch` | job `failed` ma `engine_checksum_mismatch`, commit bi tu choi, 0 version | not_run (Tester stage) |
| timeout | fault `uniwork-fault:sleep 5000` + deadline 2s | job `timed_out`, 0 version, output khong duoc claim | not_run (Tester stage) |
| cancel-complete-race | fault `sleep`, cancel khi job dang chay | cancel thang: row `cancelled`, commit bi tu choi, ket qua muon khong doi row | not_run (Tester stage) |
| crash-restart | fault `uniwork-fault:crash` + `docker restart` | job cu khong commit; sau restart mot job moi hoan thanh | not_run (Tester stage) |
| metadata-access-engine-down | `docker stop` container | doc/tai byte van doc duoc; start job that bai va 0 job row | not_run (Tester stage) |

Version negotiation: `office.Negotiate` chay **truoc** moi mutation (khong `office_jobs`, khong provider output):
engine/contract/protocol lech pin -> 409 `engine_incompatible`/`contract_mismatch`/`protocol_mismatch`; thao tac
khong duoc bind -> 501 `unsupported_operation` reason `not_bound`; capability tra loi hong ->
`engine_result_invalid`. Cac ca nay co test o `document_office_capability_test.go` va
`document_office_test.go` (client drift).

## 5. Gioi han con mo (khong duoc viet thanh da xong)

- `docx`/`pptx` khong co handler server-side trong build nay: UI phai dua vao capability tra ve
  (`supported:false`, reason `not_bound`) va trinh soan thao phia client; mo lai bang adapter nam trong
  bang chung replay cua G2-03, khong phai bang chung cua lane nay.
- `convert`/`export` giu nguyen blocker Q7 (`docs/office/g1g2/q7-blocker.md`): route tra
  `unsupported_operation` truoc moi mutation; ban sao doi dinh dang that chua co engine.
- Ban sao standalone dung lai dung `file_id` cua nguon (FileService T1-Q9): mot lan tinh dung luong, khong copy
  byte; khi co engine convert, duong copy se mang byte moi cung `source_*`.
- Ca checksum-mismatch mo phong o phia engine (fault code); viec FileService phat hien object bi sua sau khi
  ghi nam trong bo test cua G1-03 (`TestDocumentOfficeCommit`) va khong duoc lane nay tuyen bo lai.
- MinIO la backend bat buoc cho cac hang container o tren (engine PUT vao presigned URL); hang Local can API
  chay de nhan write target, nen khong duoc tinh la da chay.