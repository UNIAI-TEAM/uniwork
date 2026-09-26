# UniWork Office — G0 nguồn, khả năng và bộ mẫu (DOC-002)

> **Trạng thái:** in-progress — bàn giao Task 2 (2026-09-16) theo plan G0.
> Đây là **manifest và bộ mẫu**, không phải bằng chứng đã chạy: mọi ô năng lực vẫn
> ở trạng thái `chưa thử` vì chưa editor nào được thực thi.

**Issue:** UNI-666 (DOC-002) · **Parent:** UNI-656 · **Kế tiếp:** UNI-667 (DOC-003), UNI-668 (DOC-004), UNI-669 (DOC-005).
**Plan:** `docs/superpowers/plans/2026-09-16-documents-office-g0.md` Task 2.
**Spec:** `docs/superpowers/specs/2026-09-16-documents-office-g0-design.md` §2.1, §7.
**Brand (task 1):** `docs/office/g0/uniwork-office-integration-brand.md`.

Cả ba tài liệu trên do task khác sở hữu: plan và spec nằm ở checkout chính, còn bản đồ
brand do UNI-665 (DOC-001) viết. Đường dẫn ở đây là đường dẫn trong repo, không phải
liên kết vì các file đó chưa nằm trên nhánh này.

Task 2 trả lời ba câu: **nguồn nào được pin và được phép tái sử dụng**, **upstream có
khả năng gì**, và **bộ mẫu nào chứng minh từng khả năng**. Không câu nào trong ba câu
đó là "đã chạy đúng".

---

## 1. Thành phần bàn giao

| Path | Nội dung | Ai dùng |
| --- | --- | --- |
| [source-manifest.json](source-manifest.json) | Commit/tree đã pin, lockfile checksum, allowlist sao chép, closure app/package, license/NOTICE, runtime, lệnh tái lập | DOC-003/004/005 |
| [capabilities.json](capabilities.json) | 95 dòng `định dạng × thao tác`, tách `upstream có` / `phải port` / `web đã chứng minh` / `desktop đã chứng minh` | DOC-003/004 |
| [capability-matrix.md](capability-matrix.md) | Bảng người đọc, sinh từ `capabilities.json` và `fixtures/manifest.json`; test canh lệch | review, DOC-006 |
| [fixtures/manifest.json](fixtures/manifest.json) | 66 fixture: id, nguồn/license, checksum, capability, kết quả chuẩn và oracle | DOC-003 |
| [fixtures/files/](fixtures/files) | Fixture nhỏ và metadata, có license, nằm trong Git | DOC-003 |
| `scripts/office-g0/verify-manifest.mjs` | Kiểm manifest, checksum, đường dẫn, coverage và allowlist; có negative self-test | chạy tay / Tester (`node --test`, môi trường đã chuẩn bị), review |
| `scripts/office-g0/generate-fixtures.mjs` | Sinh fixture tất định từ manifest | tái lập |
| `scripts/office-g0/prepare-source.mjs` | Trích bản source thử trong lab từ đúng commit/tree đã pin (đọc git object, không đọc cây làm việc), ghi checksum từng file | DOC-003/004/005 |
| `scripts/office-g0/manifest.test.mjs` | Test `node --test` cho các ca âm, ca chứa/đường dẫn, glob loại trừ và promote | chạy tay / Tester (`node --test`) |
| `scripts/office-g0/prepare-source.test.mjs` | Test `node --test` cho trích nguồn: chứa/đường dẫn, byte đã pin, glob loại trừ, promote gián đoạn | chạy tay / Tester (`node --test`) |

Hiện `.github/workflows/ci.yml` chưa chạy các test lab office-g0 (qua `scripts/check.sh` chỉ có `scripts/office-g0/run-contracts.test.mjs`); phần lớn chúng cần source GenOffice đã chuẩn bị. Nối chúng vào CI là việc tiếp theo của G2/G7.

Fixture lớn (dải Q9) **không** nằm trong Git; xem §6.

---

## 2. Tái lập trong ba lệnh

Chạy từ root của worktree này, sau khi đã vào môi trường lab:

```powershell
# 1. Kiểm source đã pin còn đúng commit/tree và worktree còn sạch
node scripts/office-g0/verify-manifest.mjs --source ..\..\..\genoffice

# 2. Sinh lại mọi fixture sinh được và ghi lại checksum vào manifest
node scripts/office-g0/generate-fixtures.mjs --deps-dir ..\..\..\.uniwork-dev\office-g0\bootstrap-source\node_modules --update-checksums

# 3. Kiểm lại manifest, checksum, coverage và allowlist
node scripts/office-g0/verify-manifest.mjs
```

Các lệnh khác:

```powershell
# chỉ kiểm, không cần checkout nguồn (dùng được trên CI)
node scripts/office-g0/verify-manifest.mjs

# 28 ca âm + 1 ca đối chứng, không đọc byte fixture
node scripts/office-g0/verify-manifest.mjs --self-test

# test repo-contract
node --test scripts/office-g0/manifest.test.mjs

# xem kế hoạch: chỉ đọc, không ghi gì, chạy được cả khi đích đang bị chiếm
node scripts/office-g0/prepare-source.mjs --print-plan

# lần trích đầu: dùng một thư mục con MỚI trong lab đã cấu hình, vì trial-source
# mặc định có thể là bản cũ chưa do chính script này quản lý
node scripts/office-g0/prepare-source.mjs --work-dir ..\..\..\.uniwork-dev\office-g0\trial-source-r1 --dry-run
node scripts/office-g0/prepare-source.mjs --work-dir ..\..\..\.uniwork-dev\office-g0\trial-source-r1

# dựng lại CHÍNH đích do script này tạo; --replace từ chối mọi đích không có
# prepare-record.json hợp lệ, kể cả trial-source cũ
node scripts/office-g0/prepare-source.mjs --work-dir ..\..\..\.uniwork-dev\office-g0\trial-source-r1 --replace

# sinh lại bảng capability-matrix.md từ capabilities.json (không sửa tay bảng)
node scripts/office-g0/verify-manifest.mjs --write-matrix

# dải lớn Q9: sinh trong lab, checksum ghi vào lab-record.json cạnh file
node scripts/office-g0/generate-fixtures.mjs --deps-dir <lab>/node_modules --large 48234496 --update-checksums
```

`verify-manifest.mjs --source` **từ chối chạy** khi HEAD khác commit đã pin, tree khác
tree đã pin, hoặc checkout bẩn. Đây là chủ ý: so fixture với một cây đang đổi sẽ tạo ra
kết luận không tái lập được.

`generate-fixtures.mjs` đọc mọi dependency từ `--deps-dir` chứ không cài gì. Manifest
là nguồn duy nhất quyết định fixture nào được sinh; script không tự thêm hay bớt id.

---

## 3. Nguồn đã pin

| Trường | Giá trị |
| --- | --- |
| Repository | `https://github.com/genspark-ai/genoffice.git` (tên nguồn; không phải tên sản phẩm) |
| Commit | `09485f884dc845cf3bf27fb7edfe489f9d457aad` (2026-09-16T19:21:03+08:00) |
| Tree | `b743f03ab1f1de8f0ba1913b7bd9c06edef8f884` |
| Lockfile | `package-lock.json`, 575180 bytes, lockfileVersion 3, sha256 `DE782E49…F9FE5` |
| License | Apache-2.0, Copyright 2026 Mainfunc, Inc. |
| Số file tracked | 3137 |
| Runtime | Node `>=22.12.0` (`.nvmrc` = 22), npm `>=10`, Electron `^43.3.0` |
| Native | Rust edition 2024, crate `xlsx-sidecar 0.1.0`, toolchain 1.98.1, CRT static qua `.cargo/config.toml` |

Không pin nhãn `latest`, không dùng commit của lần khảo sát trước
(`a4d8e1a0…`, chỉ là lịch sử). Mọi dòng trong `capabilities.json` được suy lại từ
đúng commit đã pin, không kế thừa từ lần khảo sát cũ.

### 3.1 Ranh giới allowlist

Ba nhóm quyết định cái gì vào bản thử được:

| Nhóm | Nội dung | Cách cưỡng chế |
| --- | --- | --- |
| `include` | 50 mục: bảy app, 18 package, `e2e`, `fixtures`, `scripts`, `skills`, `tools`, `docs` và các file cấu hình/license ở root | Chỉ file tracked trong `include` ở đúng commit đã pin mới được trích; `prepare-source.mjs` không tự mở rộng và không đọc cây làm việc |
| `excludedSets` | `ee/`, `**/fixtures/generated`, `.github/` | `ee/` bị `prepare-source.mjs` và `verify-manifest.mjs` từ chối; `.github/` là CI/release của upstream, không thuộc bản UniWork; cả hai bị loại theo cấu trúc đường dẫn trong kế hoạch trích |
| `neverCopy` | `node_modules`, `**/target`, `**/.env*` | Từ chối theo glob khớp cả đoạn đường dẫn lẫn tên file; bản thử cài lại từ lockfile và không bao giờ thừa hưởng secret |

`/ee` ở commit đã pin chỉ chứa `LICENSE` và `README.md`, nên loại nó **không** mất mã
doanh nghiệp nào. Loại nó vì một commit sau có thể âm thầm kéo mã enterprise vào. Điều
này được cưỡng chế bằng máy, không bằng ghi chú: `verify-manifest.mjs` fail nếu chuỗi
`ee` xuất hiện trong allowlist, và `prepare-source.mjs` fail nếu bản thử có đường dẫn
`ee/`, `node_modules`, `target/` hay file môi trường ở bất kỳ đâu, hoặc có bất kỳ link nào.

`fixtures/generated` bị loại vì đó là output build của upstream (sinh lại được từ
`apps/sheets/scripts/generate-fixtures.ts` và `packages/docx-engine/scripts/generate-fixtures.ts`).
Task 2 giữ **bản sao riêng** trong `fixtures/files/` với checksum và provenance riêng,
nên nguồn gốc từng byte vẫn truy được.

---

## 4. Phân loại bằng chứng

Bốn trạng thái, dùng đúng bốn chuỗi này trong mọi tài liệu:

| Trạng thái | Nghĩa |
| --- | --- |
| `chưa thử` | Chưa có lần chạy nào. **Mặc định của mọi ô trong task 2.** |
| `đạt có bằng chứng` | Có lần chạy với artifact, lệnh và môi trường được ghi lại. |
| `đạt có giới hạn` | Có lần chạy và có giới hạn được nêu tên, ghi lại. |
| `không hỗ trợ` | Không có đường triển khai ở commit đã pin; sản phẩm không được nhận là hỗ trợ. |

Ba tầng bằng chứng phải tách rời, và task 2 **chỉ** tạo tầng đầu:

1. **Upstream có** — có mã/route/menu ở commit đã pin. Nút UI, filter hộp thoại và route
   table **chỉ** là bằng chứng "có", không bao giờ là "đạt".
2. **Phải port** — upstream làm được và nằm trong phạm vi pilot Q1-B.
3. **Web/desktop đã chứng minh** — cần một lần chạy thật trong browser/desktop.

Theo Q1-B, một thao tác upstream có hỗ trợ nhưng bản web chưa chạy được là **thiếu/blocker**,
không được xoá khỏi tập yêu cầu bằng cách đổi nhãn thành "không hỗ trợ".

### 4.1 Cái gì là bằng chứng, cái gì không

- **Checksum** chứng minh toàn vẹn truyền/lưu trữ. Nó **không** thay phép đo fidelity:
  với OOXML, checksum cả ZIP thường đổi sau mỗi lần save dù nội dung không đổi.
  Vì vậy mỗi fixture khai `expected.result` và `expected.oracle` ở tầng part/giá trị,
  không ở tầng hash file.
- **Ảnh chụp UI** không phải bằng chứng save thành công.
- **Phần mở rộng file** không phải bằng chứng parser hiểu file. Vì vậy có các ca
  `F-UNSUPPORTED-XLSB` (tên `.xlsb`, byte không phải package) và `F-PDF-CORRUPT`.
- **Macro** chỉ được mở để kiểm bảo toàn; **không macro nào được chạy** ở bất kỳ đâu.

---

## 5. Bộ mẫu

66 fixture trong `fixtures/manifest.json`. Phân bố theo cách sản xuất:

| Cách sản xuất | Số lượng | Nghĩa |
| --- | --- | --- |
| `copied` | 13 | Byte lấy từ upstream, giữ nguyên, có `upstreamPath`, `upstreamCommit` và provenance |
| `generated` | 42 | Sinh bởi `generate-fixtures.mjs` và các engine builder đã pin; không chứa byte upstream nào |
| `pending` | 9 | Chưa sản xuất được; mỗi mục nêu rõ vì sao và chủ |
| `lab-large` | 2 | Dải Q9, chỉ sống trong lab, không vào Git |

Mỗi fixture bắt buộc có: `expected.result` (điều gì đúng thì quan sát được),
`expected.oracle` (so với cái gì), `capabilities` (ít nhất một id có thật trong
`capabilities.json`) và `tags`.

### 5.1 Sinh fixture tất định

Fixture `generated` không chứa timestamp, không dùng randomness, và nén ở mức cố định
(DEFLATE level 9). Hai lần chạy trên hai máy phải ra cùng sha256. Script không tự đặt
id: id đến từ manifest, nên thêm một fixture là sửa manifest rồi chạy lại, không phải
sửa script.

Một số cặp fixture cố tình khác byte dù cùng định dạng, để một ca không che ca khác:
`F-XLSX-VI` (đa sheet + chart) khác `F-XLSX-KITCHEN` (thêm định dạng điều kiện và
validation thứ hai) khác `F-XLSX-STRUCT` (thêm protection); `F-MD-VI` (không có khối
toán/mermaid) khác `F-MD-FULL` (có); `F-HTML-VI` khác `F-HTML-SINGLE` (không tài
nguyên ngoài) khác `F-HTML-ASSET` (stylesheet và ảnh tương đối). `verify-manifest.mjs`
không cho hai fixture trùng id, và `manifest.test.mjs` kiểm các cặp này khác hash.

### 5.2 License đi kèm byte upstream

13 fixture `copied` chứa byte nguyên bản của upstream, nên Apache-2.0 §4 và các notice của
bên thứ ba buộc license/NOTICE phải đi cùng chúng. Các file đó nằm ở
`docs/office/g0/fixtures/upstream-license/` và là **bản sao nguyên văn** từ commit đã pin
(không sửa một ký tự):

| File | Nguồn upstream | Nội dung |
| --- | --- | --- |
| `LICENSE.txt` | `LICENSE` | Apache-2.0, Copyright 2026 Mainfunc, Inc. |
| `NOTICE.txt` | `NOTICE` | Notice của upstream |
| `LICENSE-UNICODE.txt` | `LICENSE-UNICODE.txt` | Unicode License v3 (ảnh hưởng `apps/pdf/src/shared/radicals.ts`) |
| `LICENSE-msoffcrypto-tool.txt` | `apps/docs/tests/encrypted-fixtures/LICENSE-msoffcrypto-tool.txt` | Notice cho fixture mã hoá |
| `LICENSE-python-pptx.txt` | `packages/pptx-engine/tests/fixtures/LICENSE-python-pptx.txt` | Notice cho fixture pptx-engine |

`manifest.licenseBundle` ghi đường dẫn, byte và sha256 của từng file; `verify-manifest.mjs`
fail nếu bundle thiếu `LICENSE.txt` hay `NOTICE.txt`, sai checksum, hoặc trỏ ra ngoài bộ mẫu.
Mỗi fixture `copied` cũng phải nêu license hoặc `thirdPartyNotice`.

### 5.3 Fixture `pending` — vì sao chưa có

6 fixture chưa sản xuất được, và lý do là một phần của bàn giao chứ không phải thiếu sót
bị bỏ qua. Hai nhóm:

- **Cần builder của engine hoặc đo phân trang:** F-DOCX-TOC, F-PPTX-CHART, AcroForm (pdf) khi không có nguồn được cấp phép. Tự viết XML ở script
  này sẽ là *snapshot của script*, không phải của engine — ca kiểm sẽ đo sai đối tượng.
- **Cần nguồn có license chưa chốt:** font nhúng (docx/pptx) và `.xls` BIFF8. Không được
  thay bằng font hệ thống hay file giả.

Mỗi mục `pending` có `owner` mặc định `DOC-003 (task 3)`. Khi sản xuất được, mục đó
chuyển thành `copied` hoặc `generated` với checksum, và capability tương ứng không đổi.

Engine-backed advanced batch: `F-DOCX-CHART` and `F-DOCX-WATERMARK` now have pinned bytes.
Regenerate with `scripts/office-g0/generate-advanced-docx-fixtures.mjs --engine <verified-engine.cjs> --record <build.json> --out <owned-fixture-directory>`; inputs are in `advanced-docx-inputs.json`.
The build record must bind the original source pin, dependency lock and bundle hash.
Only ZIP metadata is normalized; the engine writes all feature XML and the chart workbook.
Parser/save/reopen and structural mutation evidence do not establish editor rendering or capability support.
`F-DOCX-TOC` remains pending: its real builder needs heading page numbers measured by the renderer; unpaginated cached text is not a deliverable fixture.

Engine-backed equation/protection batch: `F-DOCX-EQUATION` and `F-DOCX-PROTECTED` now have pinned fixture bytes.
Regenerate with `scripts/office-g0/generate-equation-protection-fixtures.mjs --engine <verified-engine.cjs> --record <build.json> --out <owned-fixture-directory>` and `equation-protection-inputs.json`.
The equation uses the real LaTeX/OMML constructors; the protection input retains one genuinely random salt from the real SHA-512/100000-iteration hash API.
The documented password `UniWork-Fixture-Only-2026!` is public synthetic test data. Fresh hash generation remains random; reproduction reuses the retained input and normalizes ZIP metadata only.
Independent ZIP/XML/password checks and engine parse/save/reopen verify fixture structure, without claiming visual rendering, editor enforcement/unlock, authorization, DRM, or capability support.

---

## 6. Nguồn lab so với nguồn build production

Đây là ranh giới dễ hiểu sai nhất, nên ghi rõ:

| | Bản thử trong lab (`prepare-source.mjs`) | Nguồn production |
| --- | --- | --- |
| Vị trí | `../.uniwork-dev/office-g0/trial-source` | trong monorepo, qua quyết định của DOC-004 |
| Vai trò | sandbox khảo sát và build; chạy được, hỏng được | mã sản phẩm, được review và versioned |
| Dependency | cài từ lockfile đã pin **bên trong** bản copy | build chuẩn của sản phẩm |
| Patch spike | ghi thành `.patch` có checksum trong `../.uniwork-dev/office-g0/patches/` | port đã review, có commit riêng |
| Phụ thuộc checkout người dùng | **không**; bản thử phải dựng lại được ở thư mục sạch, không cần symlink | **không** |

Quy tắc: **không máy nào được yêu cầu `../genoffice` hay symlink tới checkout của người
dùng để build sản phẩm.** Checkout `genoffice` là **input chỉ-đọc**; task 2 không sửa nó.

Cache và output (npm, Electron, Rust, browser) ở lại trong lab dưới workspace root —
không vào monorepo sản phẩm, không vào checkout người dùng.

### 6.1 Dải lớn (Q9)

Q9-A: file chủ yếu dưới 50 MiB. Hai fixture `lab-large` (`F-LARGE-DOCX`,
`F-LARGE-XLSX`) sinh trong `../.uniwork-dev/office-g0/fixtures/large/` với mặc định
48234496 byte (46 MiB, sát trần mà vẫn dưới 50 MiB).

Chúng **không** vào Git, và manifest đã commit **không** mang checksum của chúng: nếu mang
thì manifest sẽ vô dụng trên mọi máy chưa sinh file. Thay vào đó:

- manifest khai `production.labPath` và `production.defaultBytes` (kích thước dự kiến);
- checksum của file thực tế nằm trong `../.uniwork-dev/office-g0/fixtures/large/lab-record.json`,
  cạnh chính file đó, do `--large <bytes> --update-checksums` ghi ra;
- `verify-manifest.mjs` fail nếu `lab-large` lại mang `sha256` trong manifest, thiếu `labPath`
  hay `defaultBytes`, hoặc nếu `lab-record.json` lệch manifest hay lệch byte trên đĩa.

`lab-record.json` là tùy chọn theo máy: máy chưa sinh dải lớn thì không có file này và
`verify-manifest.mjs` báo rõ "none on this machine" thay vì fail.

Theo Q9-A, dải này **không** tự đặt lại trần upload/quota của sản phẩm. DOC-003 đo tài
nguyên, DOC-006 chốt ngưỡng theo định dạng và môi trường.

### 6.2 Trích nguồn thử: byte nào, ở đâu, và bản cũ ra sao

`prepare-source.mjs` không sao chép cây làm việc. Nó đọc đúng commit/tree đã pin từ
git object store (kiểm tra `HEAD` khớp `upstreamCommit` và tree khớp `pinnedTree` trước),
nên file bẩn, file bị ignore hay file sinh ra trong lúc làm việc **không** lọt vào bản thử.
Mỗi file được ghi lại kèm mode, byte và sha256; bản ghi khớp từng byte với object đã pin.

- Chỉ file tracked nằm trong `include` mới được trích. Mọi file khác của cây đã pin bị
  kiểm qua `exclude`, `excludedSets` và `neverCopy`; mục `include` không khớp gì thì
  bị báo là lỗi thay vì bỏ qua im lặng. `excludedSets[].path` được áp dụng cả khi là
  đường dẫn thật lẫn glob (`**/fixtures/generated`), cho cả kế hoạch lẫn bước tự kiểm bản
  đã tạo, và có thể dùng thêm `excludedSets[].glob`; không cần thêm một mục trùng trong `exclude`.
- Từ chối mode không phải file thường: symlink (`120000`) và gitlink (`160000`) trong cây đã pin
  đều bị từ chối, và bản thử không bao giờ chứa link. Đây là chính sách **nghiêm ngặt, không có
  Git link** ở mốc pin này (pin hiện tại không có link nào); chính sách không được nới cho pin sau.
- `LICENSE`, `NOTICE` và lockfile phải đúng byte đã pin trước khi có gì được ghi.
- Đích phải nằm trong lab đã cấu hình (`<workspace>/.uniwork-dev/office-g0`), không được là
  chính lab hay thư mục cha của nó, và không được chồng lên repo hay checkout nguồn. Junction ở
  thư mục cha được resolve trước khi so; lab thật còn phải nằm trong workspace thật, nên một
  junction ở `.uniwork-dev` hay `office-g0` trỏ ra ngoài workspace bị từ chối thay vì mở rộng
  quyền ghi.
- Bản thử được ghi vào thư mục staging riêng, tự kiểm tra (đủ file, đúng byte, đúng lockfile, không
  link, không `ee/`/`node_modules`/`target/`/`.env*`) rồi mới được promote.
- Nếu đích đã tồn tại: chỉ thay khi có `--replace` **và** đích mang `prepare-record.json` hợp lệ do
  chính script này ghi. Dấu phải là file thường: marker là link hay thư mục không tính là hợp lệ
  (kiểm bằng `lstat` trước khi đọc). Thư mục không có dấu (ví dụ bản source thử cũ) không bao giờ
  bị xoá.
- `--print-plan` chỉ đọc kế hoạch và không nhìn tới đích, nên dùng được khi đích đã bị chiếm.
  `--dry-run` vẫn kiểm tra đích và thoát mã 1 nếu đích không dùng được, để không báo thành công
  cho một lần trích thật sẽ hỏng.
- Khi promote, bản cũ được đổi tên sang chỗ tạm trước; nếu bước sau lỗi, bản cũ được trả lại, nên
  không có bản thử nửa vời. Chỉ staging do chính lần chạy đó tạo mới bị xoá.

---

## 7. Kiểm và cưỡng chế

`verify-manifest.mjs` từ chối 28 tình huống, mỗi tình huống là một ca âm chạy được:

| Từ chối | Vì sao |
| --- | --- |
| Source/commit/tree khác đã pin, hoặc checkout bẩn | Fixture so với cây đang đổi thì kết luận không tái lập |
| `sha256` sai định dạng/giá trị, byte trên đĩa khác manifest | Manifest phải mô tả đúng byte thật |
| Đường dẫn tuyệt đối, `..`, `ee/`, `node_modules`, dấu `\` | Fixture không được thoát khỏi bộ mẫu |
| Hai fixture trùng id, hoặc trùng đường dẫn | Không có hai ca khác nghĩa cùng một file |
| Fixture thiếu `expected.result` hoặc `expected.oracle` | Không có kỳ vọng thì không phải ca kiểm |
| Fixture không gắn capability, hoặc gắn id không tồn tại | Liên kết hai chiều |
| Capability được nhận hỗ trợ nhưng không có ca | Điều kiện đạt của DOC-002 |
| Capability trỏ fixture manifest không khai | Liên kết hai chiều, chiều còn lại |
| Fixture không được bất kỳ dòng capability nào trỏ tới | Một fixture không nói lên nó kiểm gì thì không phải ca kiểm |
| Dòng capability mang trạng thái ngoài bốn chuỗi | Vocabulary đóng |
| Manifest nhận đã đạt trong khi chưa chạy | Trạng thái chỉ đổi khi có evidence register |
| `lab-large` mang `sha256` trong manifest, thiếu `labPath`/`defaultBytes`, hoặc lab record lệch manifest/đĩa | Dải lớn không thuộc Git; checksum của nó phải ở cạnh file |
| Allowlist chứa `ee` hoặc bỏ `**/.env*` khỏi `neverCopy` | Ranh giới license/an toàn |
| Bundle license thiếu file, sai checksum, hoặc thoát khỏi bộ mẫu | Byte upstream phải đi kèm license/NOTICE (Apache-2.0 §4) |
| Fixture copy không nêu license lẫn third-party notice | Không có byte upstream nào vô danh |
| Capability `đạt` đã có ca nhưng thiếu `evidenceRegister` | Trạng thái chỉ đổi khi có entry đã ghi của một lần chạy |
| App khai thiếu/thừa runtime dependency so với `package.json` đã pin, sai `kind`, hoặc thiếu cả `runtimeDependencies` | Closure phải so được với pin, không phải văn xuôi |
| Package khai thiếu/thừa workspace runtime dependency, hoặc thiếu cả `runtimeWorkspaceDependencies` | Cạnh `@genoffice/*` khi tách module phải so được với pin |
| Evidence trỏ đường dẫn hoặc glob không tồn tại ở commit đã pin | Bằng chứng phải đọc được ở đúng pin, không chỉ ở `HEAD` đang trôi |
| Lockfile ở checkout khác byte đã pin khi chạy `--source` | Trial cài lại từ lockfile này |

`verify-manifest.mjs --self-test` chạy lại **cùng validator** trên 29 bản sao: 28 bản bị
cố ý làm hỏng phải bị từ chối, 1 bản đối chứng phải qua. Nếu một mutant được chấp
nhận, hoặc bản đối chứng bị từ chối, lệnh trả về non-zero. Điều này để script không chỉ
là bản snapshot chính output do nó sinh ra.

`manifest.test.mjs` chạy cùng bộ ca đó qua `node --test`, cộng thêm các ca kiểm byte
trên đĩa, liên kết hai chiều capability ↔ fixture, và lab record. Test này **không** nằm
trong danh sách cố định ở bước `[3/6]` của `scripts/check.sh`, nên phải gọi tường minh:

```powershell
node --test scripts/office-g0/manifest.test.mjs
```

---

## 8. Cái gì chưa được chứng minh

Danh sách này là một phần của bàn giao:

1. **Không editor nào được chạy.** Không có lần mở/ sửa/ lưu/ export nào cho task này;
   mọi ô `webProven`/`desktopProven` vẫn `chưa thử`. DOC-003 sở hữu các lần chạy đó.
2. **Không `npm install`, build, Electron, Rust hay browser run** nào được thực hiện
   cho task 2. Baseline build/dependency install được đo ngoài worktree này và
   không commit ở đây; đó là điều kiện tiên quyết, **không** phải bằng chứng editor.
3. **9 fixture `pending`** chưa có byte; xem §5.3.
4. **Hai fixture dải lớn** không thuộc Git: bản commit không mang checksum nào của chúng. Máy đã sinh ra chúng giữ một cặp đúng băng Q9 (`requestBytes`) với checksum ở `lab-record.json` cạnh file; một bản clone chưa sinh thì không có file này, và `verify-manifest.mjs` báo "none on this machine" thay vì đạt. Xem §6.1.
5. **Chồng lấn với hệ catalog UniWork** (React 19.2.3, TipTap 3.30.6) chưa chứng minh.
6. **MacOS và Safari** (QA-01) hoãn sang UNI-671, chưa phải kết quả đạt.
7. **`packages/ai-search`** phụ thuộc `@genspark/cli` đóng; license và provenance
   chưa giải quyết, chuyển tiếp cho task 4.
8. **Chưa có patch spike**, nên đường replay patch chỉ được luyện bởi prepare/verify,
   chưa bởi một bộ patch thật.

---

## 9. Bàn giao cho task sau

- **DOC-003** dùng `fixtures/manifest.json` + `fixtures/files/` và chạy chu trình
  mở–sửa–lưu–mở lại; mọi kết quả ghi vào evidence register với lệnh và môi trường, và
  ô trạng thái chỉ đổi khi có bằng chứng.
- **DOC-004** dùng `sourceClosure.int01EntryPoints` để tách module; các mục
  `browserSafeEntry`, `hostCoupling`, `placement` là ứng viên, chưa chốt.
- **DOC-005** dùng cùng allowlist/lab này cho contract login/sync/draft.
- **DOC-006** tổng hợp sau cùng, dùng §8 làm danh sách giới hạn ban đầu.

## 10. Bàn giao DOC-006 (g119)

Ba tài liệu dưới đây là đầu ra của plan Task 6 (DOC-006, UNI-670) trong nhánh g119; chúng chỉ mô tả
ngưỡng, ước lượng và bàn giao, **không** thay đổi phán quyết G0 = GO trong `evidence-register.json`.

- [`acceptance-thresholds.md`](acceptance-thresholds.md) - ngưỡng nghiệm thu đo được của 6.2: quy tắc nội dung/cấu trúc
  không mất, các mốc thời gian/bộ nhớ/kích thước/độ phức tạp theo định dạng và theo máy (kèm số mẫu), danh sách
  giá trị còn `chưa đo`, và quyết định người `DEC-RENDER-TOLERANCE` đang **mở** (chưa có phép đo sai khác bố cục).
- [`m1-m2-estimate.md`](m1-m2-estimate.md) - ước lượng M1/M2 của 6.3: các con số đo được chỉ là số đếm (56 hàng
  capability bị chặn, 16 thao tác bị chặn, 95 hàng kiểm kê với 72 hàng must-port); mọi đơn giá công là giả định
  có ghi rõ và phải được hiệu chỉnh sau sprint G1/G2 đầu tiên. Hai mốc cũ 8-12 ngày và 12-18 tuần không còn dùng.
- [`handoff-map.md`](handoff-map.md) - bàn giao 6.5/6.6: mỗi nhóm G1-G7 (cùng UNI-662, UNI-671, ADV-002) nhận
  artifact nào, tiêu chí nghiệm thu nào, quyết định nào còn mở; kèm tiêu chí brand và hai việc cần coordinator
  xác nhận (dòng mapping G1-G7 chưa có trong UniAI; bốn hàng ADV-002 chưa có issue).

Giới hạn cần đọc trước khi trích dẫn: chưa có phép đo nào về nỗ lực/công sức, chưa có pixel-diff cho bất kỳ định
dạng nào, và các mốc thời gian chỉ hợp lệ cho đúng build đã phục vụ với định danh trong `acceptance-thresholds.md`.
