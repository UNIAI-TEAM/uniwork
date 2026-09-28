# Office G1-G2 evidence - G2-07a real-store integration (UNI-690)

> **Trang thai:** bang chung cua lane g2-07a tren nhanh `feature-UNI-690-office-integration`.
> Engine pin: `genoffice@09485f88+uniwork-office.0`; contract `uniwork-office-engine-contract/1`, protocol `1`.
> Cot **ket qua** chi ghi `pass` khi lenh trong cot **bang chung** da chay tren dung commit cuoi cua lane;
> cac hang chua chay ghi `not_run` kem ly do, khong bao gio ghi pass thay. Lan chay cuoi trong lane:
> 2026-09-28 (UTC+7), engine container `uniwork-office-engine:dev` build tu chinh worktree nay; Tester stage
> chay lai tung lenh tren commit dong bang va ghi ket qua rieng trong acceptance packet.

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
| Go service + handler | `go test ./internal/service/ -run 'TestDocumentOffice'` va `./internal/handler/ -run 'TestOffice\|TestDocumentOffice'` | capability, gate, blank, copy, lifecycle |
| Go integration (real FileService + engine container) | `server/internal/service/document_office_integration_test.go`: `go test ./internal/service/ -run TestDocumentOfficeIntegration -v` voi `OFFICE_ENGINE_TEST_URL`, `OFFICE_ENGINE_TEST_CONTAINER`, `MINIO_*` (xem ghi chu MinIO) | 5 dinh dang + blank + 7 ca fault DOC-004 |
| Engine boundary (Node 22) | `node --test scripts/office/integration.test.mjs` voi `OFFICE_REQUIRE_ENGINE=1` + `OFFICE_ENGINE_TEST_URL` | pin 3 noi, fixture manifest, capability that |
| Core TS | `pnpm --filter @uniwork/core typecheck\|lint\|test` | office.ts + office-hooks.ts + malformed tests |
| Engine (Node 22) | `pnpm --filter @uniwork/office-engine typecheck\|lint\|test` | pdf asset fallback khong lam lech dev/test |

Ghi chu MinIO: engine container PUT vao presigned URL, nen tren Docker Desktop phai dat
`MINIO_ENDPOINT=http://127.0.0.1:9000` cho tien trinh Go va `MINIO_PUBLIC_ENDPOINT=http://host.docker.internal:9000`
cho phan ky URL (backend MinIO cua suite nhan them bien nay trong
`officeMinioBackend`, khong doi harness cua G1-03), container chay voi
`--add-host host.docker.internal:host-gateway` va `OFFICE_ENGINE_OUTPUT_ORIGINS` gom ca
`http://host.docker.internal:9000` lan origin write-target cua test.

Ghi chu write target (hai che do, hai lan chay): `officeBridge` giu mot origin cho ca tien trinh test
(`sync.Once`), nen
- hang **container that** (`TestDocumentOfficeJob`): dat `OFFICE_ENGINE_TEST_TARGET_ADDR=0.0.0.0:18297` va
  `OFFICE_ENGINE_TEST_TARGET_ORIGIN=http://host.docker.internal:18297` (container voi tới duoc host);
- **scripted engine** (`TestDocumentOfficeLifecycle`): KHONG dat hai bien tren, de bridge tu bind
  `127.0.0.1:<port>` - PUT trong tien trinh Go khong với tới `host.docker.internal` tren host nay.
Vi mot tien trinh test chi co mot origin, chay `TestDocumentOfficeJob` tach khoi nhom scripted bang hai lenh
`go test -run` (xem acceptance packet).

## 3. Tung dinh dang (07a)

| Format | Fixture | Engine op | Bind trong build | Bang chung | Ket qua |
| --- | --- | --- | --- | --- | --- |
| docx | F-DOCX-SIMPLE | serialize (server) | **not_bound** -> `unsupported_operation` reason `not_bound`, khong tao job/khong ghi byte; store round-trip upload -> commit -> doc lai | `TestDocumentOfficeIntegration/docx_pptx...` | pass (lane run 2026-09-28) |
| pptx | F-PPTX-STD | serialize (server) | **not_bound** nhu docx | `TestDocumentOfficeIntegration/docx_pptx...` | pass (lane run 2026-09-28) |
| pdf | F-PDF-TEXT | open + serialize | bound | open tra probe JSON (khac bytes nguon), serialize -> stage -> validate -> commit -> doc lai byte-identical, **reopen** bang mot job open nua tren version da commit | `TestDocumentOfficeIntegration/pdf...` | pass (lane run 2026-09-28) |
| md | F-MD-FULL | serialize | bound | serialize -> stage -> validate -> commit -> doc lai byte-identical; provenance engine/contract ghi tren version; **capability sau commit van tra `md`** (khong mat dinh dang vao text/plain cua provider output) | `TestDocumentOfficeIntegration/md...` | pass (lane run 2026-09-28) |
| html | F-HTML-VI | serialize | bound | nhu md; HTML duoc mo o ca FileService registry lan validator Documents (C-01 §5.5) | `TestDocumentOfficeIntegration/html...` | pass (lane run 2026-09-28) |
| (xlsx) | - | - | ngoai pham vi 07a (G2-04/07b) | - | not_run |

Create-blank: `create_blank` la hanh dong do Go sinh ra cho dinh dang nguon (`md`, `html`): seed khong rong duoc
engine serialize (co poll cho den khi job settled) roi di dung duong create G1 (`CreateFileDocument`); version dau
tien khong rong va dinh dang cua tai lieu moi resolve dung. Dinh dang khac tra `unsupported_operation` reason
`blank_not_bound` **truoc khi** dang ky output hay tao tai lieu, nen khong bao gio co file Office rong.
Bang chung: `TestDocumentOfficeIntegration/blank...` (that: pass, lane run 2026-09-28) +
`TestDocumentOfficeBlankCreateWaitsForTheEngine` (deterministic, scripted engine).

Provenance cua output: commit path G1-03 nhan job row lam goc (`officeJobForOutput`), stamp
`engine_name/genoffice`, engine/contract/protocol pin tu `office.TrustedEngineVersion`; actor la nguoi chay job.
Ban sao (copy) ghi `source_document_id/version/revision/checksum/format` va giu nguyen bytes (cung `file_id`).

## 4. Bay ca fault DOC-004 (Go + FileService that + engine container that)

| Ca | Co che | Ky vong | Ket qua |
| --- | --- | --- | --- |
| type-version-mismatch | 4 probe wire thang vao `/v1/jobs` (Go client khong bieu dien duoc protocol dang string): contract `.../999`, protocol `"1"`, protocol `2`, `client_engine_version` khong tin cay | contract/protocol -> 400 `contract_violation` (`must_equal`/`safe_integer_required`) dung nhu oracle G0; engine build -> 409 `engine_incompatible`; sau do status cung grant tra `not_found` = 0 job | pass (lane run 2026-09-28; 4/4 refusals + 0 job) |
| malformed-result | service tra JSON hong | `engine_result_invalid`, khong panic, khong job | pass (lane run 2026-09-28) |
| checksum-mismatch | job serialize that tren engine container (PUT that vao MinIO) + **truong checksum khai bao cua engine bi thay bang digest sai** (dung mo hinh "controlled host-response checksum field" cua oracle G0); FileService bam lai object that | job `failed` ma `engine_checksum_mismatch`, commit bi tu choi, 0 version | pass (lane run 2026-09-28) |
| timeout | fault `uniwork-fault:sleep 5000` + deadline 2s | job `timed_out`, 0 version, output khong duoc claim | pass (lane run 2026-09-28) |
| cancel-complete-race | fault `sleep`, cancel khi job dang chay | cancel thang: row `cancelled`, commit bi tu choi, ket qua muon khong doi row | pass (lane run 2026-09-28) |
| crash-restart | fault `uniwork-fault:crash` + `docker restart` | job cu khong commit; sau restart mot job moi hoan thanh | pass (lane run 2026-09-28) |
| metadata-access-engine-down | `docker stop` container | doc/tai byte van doc duoc; start job that bai va 0 job row | pass (lane run 2026-09-28) |

Version negotiation: `office.Negotiate` chay **truoc** moi mutation (khong `office_jobs`, khong provider output):
engine/contract/protocol lech pin -> 409 `engine_incompatible`/`contract_mismatch`/`protocol_mismatch`; thao tac
khong duoc bind -> 501 `unsupported_operation` reason `not_bound`; capability tra loi hong ->
`engine_result_invalid`. Cac ca nay co test o `document_office_capability_test.go` va
`document_office_test.go` (client drift).

## 5. Cac manh ghep con thieu truoc 07a da duoc va trong lane nay

- Provider output khong co ten (FS-C1 §4): version cua office output giu **mime cua tai lieu** (md la
  `text/markdown` du sniff ra `text/plain`), commit path chi cho phep drift trong cung mot format
  (`officeOutputKeepsFormat`), va resolver doc mime cua version khi file khong co duoi
  (`officeFormatForFile`/`officeFormatFromMime`) - nho vay reopen sau commit khong mat dinh dang.
- `create_blank` cho (`md`, `html`) cho den khi job serialize settled, va grant mang `base_version_id` khong rong
  (`blank:<jobID>`) theo contract grant cua engine.
- HTML duoc them vao allowlist `document_file` cua FileService (`server/internal/files/registry.go`) dung C-01
  §5.5, va validator `server/internal/document/file_validation.go` mo HTML nhu text (sandbox preview G2-06 la
  lop an toan render, khong phai allowlist nay).
- PDF asset trong image: job worker chay voi env whitelist (khong ke thua `UNIWORK_PDF_ASSETS`), nen
  `packages/office-engine/src/pdf/pdfium.ts` tim them `./pdf-assets` canh bundle truoc khi fallback ve
  `require.resolve`; khong sua `apps/office-engine/supervisor.ts` (G2-04 so huu).
- Handler tier khong import `internal/office` (ADR 0021 leaf guard cua G2-02): cac allowlist, identity pin va
  error view di qua service (`server/internal/service/document_office_view.go`), engine client dung
  `service.NewOfficeEngineClient`; test handler dung engine stub HTTP qua chinh factory do.
- Copy: endpoint `/copies` tra `owner_requires_copy` cho **moi** tai lieu owned (C-14 chua co); dieu kien
  "level < edit" cu lam nhanh nay khong bao gio chay trong khi caller da qua duoc cong edit - khong tao ban sao
  standalone cua tai lieu owned.

## 6. Gioi han con mo (khong duoc viet thanh da xong)

- `docx`/`pptx` khong co handler server-side trong build nay: UI phai dua vao capability tra ve
  (`supported:false`, reason `not_bound`) va trinh soan thao phia client; mo lai bang adapter nam trong
  bang chung replay cua G2-03, khong phai bang chung cua lane nay.
- `convert`/`export` giu nguyen blocker Q7 (`docs/office/g1g2/q7-blocker.md`): route tra
  `unsupported_operation` truoc moi mutation; ban sao doi dinh dang that chua co engine.
- Ban sao standalone dung lai dung `file_id` cua nguon (FileService T1-Q9): mot lan tinh dung luong, khong copy
  byte; khi co engine convert, duong copy se mang byte moi cung `source_*`.
- Ca checksum-mismatch chay tren engine that (mot PUT that cua output) nhung truong checksum khai bao bi dieu
  khien - dung mo hinh "controlled host-response checksum field" cua oracle G0; vi vay ca nay la ban mot-put,
  khac ban zero-put lich su trong register. Viec phat hien object bi sua **sau khi** FileService ghi nam trong bo
  test cua G1-03 (`TestDocumentOfficeCommit`) va khong duoc lane nay tuyen bo lai.
- MinIO la backend bat buoc cho cac hang container o tren (engine PUT vao presigned URL); hang Local can API
  chay de nhan write target, nen khong duoc tinh la da chay.
