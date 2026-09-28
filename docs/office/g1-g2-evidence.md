# Office G1-G2 evidence - G2-07 real-store integration, H4 (UNI-690)

> **Trang thai:** bang chung cua lane g2-07a (nhanh `feature-UNI-690-office-integration`, da merge vao root) va
> g2-07b (nhanh `feature-UNI-690-office-xlsx-h4`: XLSX, Q7, upgrade replay/rollback, H4, handoff G3/G4 - muc 7-11).
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
| xlsx | F-XLSX-KITCHEN | open + edit + serialize (server, Rust recalc sidecar) | bound | 07b, muc 7: open probe -> edit `set_cell` -> commit -> doc lai -> reopen; tinh lai native doc tu chinh XML cua output; hai lan save | `TestDocumentOfficeXlsxIntegration` | pass (lane 07b run 2026-09-28) |

Create-blank: `create_blank` la hanh dong do Go sinh ra cho dinh dang nguon (`md`, `html`): seed khong rong duoc
engine serialize (co poll cho den khi job settled) roi di dung duong create G1 (`CreateFileDocument`); version dau
tien khong rong va dinh dang cua tai lieu moi resolve dung. Dinh dang khac tra `unsupported_operation` reason
`blank_not_bound` **truoc khi** dang ky output hay tao tai lieu, nen khong bao gio co file Office rong.
Bang chung: `TestDocumentOfficeIntegration/blank...` (that: pass, lane run 2026-09-28) +
`TestDocumentOfficeBlankCreateWaitsForTheEngine` (deterministic, scripted engine).
Blank khong co dong `office_jobs` (chua co tai lieu de gan job): engine chay dong bo trong request, output la
provider-output intent cua FileService (khong claim thi FileService thu gom), va version dau (reason `upload`)
stamp engine/contract/protocol pin cua `officeEngineInfo()`. Mot key da co ket qua duoc tra lai **truoc khi**
engine chay lai; cung key voi title/parent/dinh dang khac, hoac key cua mot upload thuong (version khong mang
engine pin), la payload mismatch (review BE-01/BE-07, fix r2/r3). He qua: blank khong resume hay reconcile duoc
sau khi mat request: khong tai lieu nao duoc tao, output do dang FileService thu gom, retry cung key chay lai
engine. Quyet dinh Advisor 2026-09-28 (option A): ngoai le blank dong bo cho 07a; job blank ben vung (dong
`office_jobs` truoc dispatch) la follow-up G3.

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
- `export` chua co engine bind: route tra `unsupported_operation` (`export_not_bound`) truoc moi mutation.
  `convert` da dong Q7 o 07b cho dung hai cap `xls -> xlsx`, `odt -> docx` (muc 8); moi cap khac van tra
  `unsupported_operation`.
- Ban sao standalone dung lai dung `file_id` cua nguon (FileService T1-Q9): mot lan tinh dung luong, khong copy
  byte; khi co engine convert, duong copy se mang byte moi cung `source_*`.
- Ca checksum-mismatch chay tren engine that (mot PUT that cua output) nhung truong checksum khai bao bi dieu
  khien - dung mo hinh "controlled host-response checksum field" cua oracle G0; vi vay ca nay la ban mot-put,
  khac ban zero-put lich su trong register. Viec phat hien object bi sua **sau khi** FileService ghi nam trong bo
  test cua G1-03 (`TestDocumentOfficeCommit`) va khong duoc lane nay tuyen bo lai.
- MinIO la backend bat buoc cho cac hang container o tren (engine PUT vao presigned URL); hang Local can API
  chay de nhan write target, nen khong duoc tinh la da chay.

## 7. XLSX (G2-07b)

| Hang | Bang chung | Ket qua |
| --- | --- | --- |
| Main flow XLSX: upload -> open (probe JSON, khac bytes nguon) -> edit `set_cell` Data!B2=100 -> serialize (engine + Rust sidecar) -> stage -> FileService verify -> commit (G1-03) -> doc lai -> reopen | `document_office_xlsx_integration_test.go` `TestDocumentOfficeXlsxIntegration/xlsx:_open_probes...` | pass (lane 07b run 2026-09-28) |
| Tinh lai native: oracle doc lap = tong cac literal `<v>` Data!B2:B4 cua chinh output, so voi `<v>` cua PhuLuc!B2 (`=SUM(Data!B2:B4)`, cong thuc cross-sheet sach) | cung test | pass (lane 07b run 2026-09-28) |
| Hai lan save lien tiep rebase tren bytes da commit va tinh lai lan nua | `.../xlsx:_two_saves...` | pass (lane 07b run 2026-09-28) |
| Create-blank XLSX: seed SpreadsheetML toi thieu (Sheet1 rong, deterministic) -> engine `serialize:xlsx` -> create path G1; version dau stamp pin engine; reopen bang job open | `document_office_q7_integration_test.go` `.../create-blank_xlsx...` + `TestBlankSeedIsNeverEmpty` | pass (lane 07b run 2026-09-28) |
| Convert/export tren tai lieu xlsx: khong co converter tu xlsx -> `unsupported_operation`, 0 job row | `.../xlsx:_convert/export_rows...` | pass (lane 07b run 2026-09-28) |
| Upload xlsx hong (PK khong co part chinh) bi validator Documents tu choi, 0 tai lieu | `.../xlsx:_a_corrupt_upload...` | pass (lane 07b run 2026-09-28) |

## 8. Q7 dong o phia server (G2-07b)

Lua chon (Advisor 2026-09-28, option A): converter viet trong repo, chi chay Node, khong them dependency ben thu ba,
khong vao browser bundle: `packages/office-engine/src/node/convert/` (BIFF8 `.xls -> .xlsx`: CFB + Workbook stream,
ten sheet, label/so, cong thuc thanh gia tri cache; ODF `.odt -> .docx`: `content.xml` heading + paragraph). Fidelity
luon `limited` va `fidelity.lost` liet ke **moi** hang muc bi bo (xls: `cell_formatting`,
`formulas_are_cached_values`, `charts_pivot_tables_and_macros`, `defined_names_and_sheet_view_state`; odt:
`text_styling_and_fonts`, `lists_numbering_and_page_layout`, `tables_images_and_embedded_objects`); `content` la
danh sach thay doi (sheet/cell hoac paragraph) G3 hien truoc khi nguoi dung chap nhan. Contract `/1` giu nguyen
version: format enum them `xls`, `odt` (chi cho capability + convert, capability-gated).

| Buoc closing test (q7-blocker.md) | F-LEGACY-XLS | F-UNSUPPORTED-ODT | Bang chung |
| --- | --- | --- | --- |
| (a) canh bao ghi dung cai se doi: job convert completed mang `result` (fidelity + change list) | 3 sheet `Sheet1..3`, `Sheet1!A1='replaceMe'` (oracle manifest G0) | heading + paragraph = oracle doc truc tiep tu `content.xml` cua fixture | `TestDocumentOfficeQ7Integration/F-*` |
| (b) Cancel -> khong tao gi, nguon khong doi | job cancelled; `/copies` voi `job_id` -> 409 `conversion_not_accepted`; so tai lieu khong doi; output khong bao gio duoc claim | nhu xls | cung test + `TestDocumentOfficeQ7/*/cancel_creates_nothing` |
| (c) Accept -> ban OOXML moi co provenance | `POST /documents/{id}/copies` `{consent:"copy", job_id}`: tai lieu moi, version 1 = output cua job, `source_document_id/version_id/revision`, `source_checksum_sha256` = sha256 Go do khi doc nguon, `source_format` (mime nguon), `target_format`, `source_engine` = pin, `conversion_reason=convert`; ban sao reopen la xlsx (job open completed) | ban sao docx chua van ban ODT; dinh dang resolve `docx` | cung test |
| (d) Nguon va lich su khong doi | revision, `file_version_id`, so version (1) va bytes nguon giong truoc | nhu xls | cung test |

Cong va phan quyen (khong can container, `TestDocumentOfficeQ7` tren fake + local): open/edit/serialize tren xls ->
`not_bound`; convert thieu target hoac sai cap -> `convert_pair_not_bound`; engine khong bind `convert:xls` ->
`not_bound` **truoc** moi mutation (0 job row, 0 output intent); engine lech pin -> `engine_incompatible`; target tren
thao tac khac -> 400 `office_job_invalid`. Output convert khong bao gio commit vao nguon (`office_job_convert_copy_only`).
Accept chi cho nguoi tao job (admin workspace co quyen sua nguon -> 403), job cua tai lieu khac -> 404, thanh vien
workspace B / nguoi ngoai -> 404/403 va khong ghi gi; cung key tra lai cung ban sao, key moi tren job da dung -> 409.
Handler: `TestOfficeBlankAndCopyRoutes`, `TestOfficeJobRoutes`, `TestOfficeJobResultDTO`.

## 9. Upgrade replay va rollback (G2-07b)

- Fixture replay: `docs/office/g1g2/upgrade-replay.json` liet ke hinh dang version da commit ma build dang pin phai
  doc lai, cho **tat ca** sau dinh dang + hai nguon Q7 (download truoc, roi open/serialize/convert tuy dinh dang).
  Truoc **moi** lan doi pin engine: tro `OFFICE_ENGINE_TEST_URL` vao build ung vien, chay
  `go test ./internal/service/ -run TestDocumentOfficeUpgradeReplay -v`, roi moi them build do vao
  `office.ReadableEngineVersions` va doi pin trong manifest. `TestOfficeUpgradeReplayManifest` (khong can container)
  va `scripts/office/integration.test.mjs` fail khi pin manifest, pin Go/TS va tap readable lech nhau.
- Rollback: version do build ngoai `office.ReadableEngineVersions` ghi (vd. build moi hon truoc khi rollback) ->
  moi thao tac engine (open/edit/serialize/convert) tra 409 `engine_incompatible` reason `version_engine:<build>`,
  0 job row; capability giu `engine_bound` nhung `supported=false` cho moi hang engine; download va lich su van doc
  duoc; restore mot version cu do build hien tai ghi mo lai duoc. Bang chung: `TestDocumentOfficeEngineRollback`
  (fake + local).

| Dinh dang | Fixture replay | Thao tac replay | Bang chung |
| --- | --- | --- | --- |
| docx | F-DOCX-SIMPLE | download (khong co handler server) | `TestDocumentOfficeUpgradeReplay/F-DOCX-SIMPLE` |
| pptx | F-PPTX-STD | download | `.../F-PPTX-STD` |
| xlsx | F-XLSX-KITCHEN | download, open | `.../F-XLSX-KITCHEN` |
| pdf | F-PDF-TEXT | download, open, serialize (+ serialize lai version da commit) | `.../F-PDF-TEXT` |
| md | F-MD-FULL | download, serialize (+ lai) | `.../F-MD-FULL` |
| html | F-HTML-VI | download, serialize (+ lai) | `.../F-HTML-VI` |
| xls | F-LEGACY-XLS | download, convert | `.../F-LEGACY-XLS` |
| odt | F-UNSUPPORTED-ODT | download, convert | `.../F-UNSUPPORTED-ODT` |

## 10. Ma tran H4 (sau dinh dang)

Lane 07b chay cac hang duoi day tren engine container build tu chinh worktree (`uniwork-office-engine:g207b`,
MinIO that); ket qua pass / fail / not_run tung lenh tren commit cuoi nam trong acceptance packet
(`reports/g2-07b-office-xlsx-h4/`), do Tester stage chay lai. Lan chay toan bo suite dong H4 la cua Advisor khi mo
PR, khong phai cua lane nay.

| Dinh dang | Mo (open) | Sua (edit) | Luu (serialize -> commit -> doc lai) | Blank | Convert / export | Replay | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| docx | not_bound (editor phia client) | not_bound | store round-trip (07a) | khong (goi rong khong phai tai lieu) | dich Q7 cua odt; tu docx: not_bound | download | engine_incompatible khi version ngoai tap readable |
| xlsx | bound (muc 7) | bound, tinh lai native | bound (muc 7) | co (muc 7) | dich Q7 cua xls; tu xlsx: not_bound | download, open | nhu tren |
| pptx | not_bound | not_bound | store round-trip (07a) | khong | not_bound | download | nhu tren |
| pdf | bound (probe) | engine bind, chua co bang chung san pham | bound, byte-identical (07a) | khong | not_bound | download, open, serialize | nhu tren |
| md | - | - | bound, byte-identical (07a) | co (07a) | not_bound | download, serialize | nhu tren |
| html | - | - | bound, byte-identical (07a) | co (07a) | not_bound | download, serialize | nhu tren |

## 11. Gioi han con mo sau 07b

- UI canh bao / cancel / accept la G3 (UNI-659): server tra `result` tren job SDO va nhan `job_id` o `/copies`.
- Ket qua convert mat khi job bi reconcile tu output (engine restart sau khi ghi): job do `failed`
  `convert_result_missing`, nguoi dung convert lai - khong bao gio chap nhan mot ban sao khong co danh sach thay doi.
- Converter BIFF8 chi doc label/so/cong thuc-as-gia-tri; `.xls` co mat khau hoac khong phai BIFF8 tra loi co kieu,
  khong bao gio tao workbook rong. ODT chi mang van ban heading/paragraph.
- `ods`, `xlsb`, `rtf`, `doc`, `ppt` van chua co converter (tra `not_bound` / `convert_source_not_bound`).
- Mac/Safari va desktop host: xem `docs/office/g1g2/packaging-and-handoff.md` muc 7.
