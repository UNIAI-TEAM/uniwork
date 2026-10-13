# UniWork Office trên nền genoffice - app desktop và web dùng chung giao diện

> **Trạng thái:** shipped - plan v1.1, cập nhật 2026-10-12; giai đoạn A, B, C đã merge vào develop qua PR #219 và PR của UNI-1305; GO-C1 bị thay thế (xem mục 7); còn lại là backlog ở mục 9.

**Issue:** UNI-1001, parent UNI-437 (C-01). Mỗi task có checkbox dưới đây là một sub-issue của UNI-1001.
**Thay thế dần:** G3 web editors (UNI-659) và G4 desktop (UNI-636) theo
[plan G3-G4](2026-09-27-office-g3-g4.md). Plan đó giữ phần đã merge; phần editor
và `apps/office-desktop` không phát triển thêm.

## 1. Vì sao đổi hướng

Người dùng phản hồi editor Office hiện tại (G3 web, `apps/office-desktop`) khó dùng
và không quen thuộc. G3/G4 dựng lại giao diện trên `packages/ui`, nên sau nhiều vòng
port vẫn còn xa genoffice. Quyết định ngày 2026-10-08: lấy nguyên giao diện và engine
genoffice (Apache-2.0), chỉ đổi brand, giữ cấu hình AI như genoffice.

Đã có tiền lệ: fork `github.com/truongnt7/uniwork-office` (rebrand baseline `11945d6d`,
240 file) đang chạy trên máy dev dưới tên "UniWork Office" 0.10.1, gồm cả màn hình
cài đặt AI. Logo app đã chốt ngày 2026-10-08: phương án v1 (chữ W UniWork trên trang giấy có góc gấp).

## 2. Các quyết định đã chốt

| # | Quyết định | Nguồn |
| --- | --- | --- |
| Q1 | **Hai repo riêng.** `dev-uniwork` giữ server, web, FileService, tài khoản, luồng tải. App desktop là repo fork genoffice. Hai bên nối bằng API. | User 2026-10-08 |
| Q2 | **Gốc là fork `truongnt7/uniwork-office`**, đưa lên genoffice mới nhất. | User 2026-10-08 |
| Q3 | **Web dùng chính renderer genoffice**, build từ repo fork, kèm cầu nối web thay `window.desktop`. | User 2026-10-08 |
| Q4 | **AI giữ như genoffice** (BYO key, Codex CLI, ...). Phần "đám mây UniWork" (tìm kiếm, tạo ảnh, tín dụng) đi qua server UniWork và `ai.Gateway`, bật theo entitlement của tổ chức. | User 2026-10-08 |
| Q5 | **Wave 4 G3-G4 vẫn chạy suite và mở PR.** *(2026-10-12: suite đã xanh trên root w4 nhưng không mở PR; hướng genoffice thay thế, xem GO-C1.)* Luồng tải/đăng nhập desktop (UNI-966) và web host dùng lại; `apps/office-desktop` đóng băng. | User 2026-10-08 |

## 3. Hiện trạng kỹ thuật (đo ngày 2026-10-08)

- genoffice: TypeScript, React 19, Electron 43, electron-vite / Vite 7, npm workspaces.
  Module: Docs (~102k dòng renderer), Sheets (~102k, Univer), Slides (~74k), PDF (~30k,
  pdf.js), Markdown (~13k), HTML (~17k), Shell (home, cài đặt, AI).
- **Engine chạy trong renderer:** `docx-engine` dùng trong 65 file renderer của Docs;
  `xlsx-gateway` (Sheets) và `pptx-engine` / `pptx-render` (Slides) cũng nằm chủ yếu
  trong renderer. Ngoại lệ: Sheets có `xlsx-sidecar.exe` native cho một số thao tác.
- **Chỗ dính Electron là cầu nối preload:** `window.desktop` và `window.projectApi`.
  Docs gọi 64 hàm, Slides 6, PDF 0. Docs đã có `vite.renderer.config.ts` (renderer
  chạy bằng Vite thường, không cần Electron).
- Upstream `genspark-ai/genoffice` đã đi thêm **699 commit** từ gốc của fork
  (`616a7acf` -> `b08e2ebf`, snapshot 2026-10-08). Upstream đã có tiếng Việt
  (`apps/docs/src/renderer/i18n/app/vi.ts`, `ribbon/vi.ts`).
- 636 file nguồn upstream nhắc `genspark`/`genoffice`; phần lớn là tên package nội bộ
  `@genoffice/*`, người dùng không thấy. Chuỗi hiển thị, URL (`genspark.ai/login`,
  `auth.genspark.ai/device`) và định danh app thì phải đổi.

## 4. Gate cần người dùng quyết

| Gate | Câu hỏi | Đề xuất |
| --- | --- | --- |
| GO-D1 | **Đã quyết 2026-10-08:** repo của team là `UNIAI-TEAM/uniwork-office` (public, tạo mới vì không có quyền transfer fork `truongnt7/uniwork-office`; lịch sử đã đẩy đủ `main` và `cursor/teacher-edu-mode`). Gốc làm việc gồm cả 26 commit teacher-edu (`6ad7b4e`); đổi lại sau nếu cần. | Đã chốt |
| GO-D2 | **Đã quyết 2026-10-08:** iframe cùng origin + `postMessage` (cách 1 trong báo cáo GO-B1, UNI-1011, `4a70857`). Giao thức không dựa vào cookie, token đi qua message, để chuyển sang subdomain riêng sau này chỉ là đổi URL; có thể thêm nút "Mở toàn màn hình" dùng cùng bundle. Không gắn thẳng vào trang, không Shadow DOM. | Đã chốt |
| GO-D3 | Thao tác Sheets cần `xlsx-sidecar.exe` trên web: chạy ở office-engine trên server hay tắt trên web? | Đo ở GO-B6 rồi quyết theo danh sách thao tác cụ thể |

## 5. Giai đoạn A - App desktop (repo fork)

Làm trong repo fork, theo luật của repo đó. Lane dùng branch mang key sub-issue.

- [x] **GO-A1 (UNI-1002) Đưa fork lên upstream mới nhất bằng rebrand dạng script.** Không merge 699
  commit đè lên 240 file sửa tay. Viết `tools/rebrand/` (bảng thay chuỗi hiển thị,
  appId, productName, protocol, thư mục userData, tên bản cài, icon và logo dạng
  overlay), chạy trên upstream `b08e2ebf` rồi đưa 26 commit teacher-edu (`6ad7b4e`) lên trên, so với baseline `11945d6d` để không sót
  thứ fork đã đổi. Tên package nội bộ `@genoffice/*` giữ nguyên để merge upstream dễ.
  Kiểm chứng: test quét chuỗi hiển thị và i18n không còn "GenOffice"/"Genspark";
  app build và mở được 6 module.
  *Đã xong: fork main `e693a168` (2026-10-09), `tools/rebrand/`.*
- [x] **GO-A2 (UNI-1003) Quy trình đồng bộ upstream.** Script `sync-upstream` (merge upstream ->
  chạy rebrand -> test quét brand) và một CI job chạy định kỳ, mở PR khi upstream có
  bản mới. Ghi trong README của fork.
  *Đã xong: fork `.github/workflows/upstream-sync.yml` + `tools/rebrand/`.*
- [x] **GO-A3 (UNI-1004) Tuân thủ Apache-2.0 và nhãn hiệu.** Giữ `LICENSE`, `NOTICE`
  (thêm dòng UniWork), `THIRD-PARTY-NOTICES`; ghi rõ là bản sửa đổi; bỏ tên và logo
  GenOffice/Genspark khỏi giao diện, bộ cài, metadata.
  *Đã xong: fork main `e693a168`.*
- [x] **GO-A4 (UNI-1005) Gỡ dịch vụ Genspark.** Tắt đăng nhập Genspark (`aiGskLogin`, device flow
  `auth.genspark.ai`), telemetry và kênh cập nhật trỏ về Genspark. Thay bằng UniWork
  hoặc tắt.
  *Đã xong: fork main `e693a168`.*
- [x] **GO-A5 (UNI-1006) Đăng nhập UniWork trong app.** Dùng lại luồng của UNI-966
  (`/auth/desktop/start` -> consent -> exchange, profile triển khai theo origin).
  Shell genoffice hiện mục "Tài khoản" là tài khoản UniWork.
  *Đã xong: PR #214, gộp vào PR #219.*
- [x] **GO-A6 (UNI-1007) Mở/lưu tài liệu UniWork trong app.** "Mở từ UniWork" và lưu ngược về
  qua FileService + Documents (quyền, phiên bản theo C-01 / FS-C1). File cục bộ vẫn
  dùng như genoffice.
  *Đã xong: PR #219.*
- [x] **GO-A7 (UNI-1008) AI "đám mây UniWork".** Giữ nguyên cấu hình AI của genoffice; các công cụ
  đám mây (tìm web, tạo ảnh, phân tích media, tín dụng) gọi API UniWork, server đi qua
  `ai.Gateway` và entitlement của tổ chức. Phía `dev-uniwork`: endpoint + ADR (xem
  GO-C2).
  *Đã xong: PR #219 (ADR 0029, `ai.Gateway`).*
- [x] **GO-A8 (UNI-1009) Đóng gói và phát hành.** CI của fork build bộ cài Windows (NSIS) và macOS
  (dmg); đăng bản lên URL mà server phát (`OFFICE_INSTALLER_*_URL`, UNI-966). Ký số
  vẫn nằm trong backlog chứng chỉ.
  *Đã xong: PR #215, gộp vào PR #219; bộ cài fork từ 0.11.0-dev.4.*
- [x] **GO-A9 (UNI-1010) Nghiệm thu app.** tester_visual trên app thật (tiếng Việt, sáng/tối,
  9 tiêu chí chất lượng UI), luồng: tải từ web -> cài -> đăng nhập -> mở tài liệu
  UniWork -> sửa -> lưu -> thấy phiên bản mới trên web.
  *Đã xong: nghiệm thu app 2026-10-11 (`reports/go-a9`).*

## 6. Giai đoạn B - Web dùng renderer genoffice

Build trong repo fork, nạp trong `dev-uniwork`.

- [x] **GO-B1 (UNI-1011) Spike Docs trên web.** Build renderer Docs bằng Vite cho web; liệt kê
  64 hàm `window.desktop` và xếp loại: làm qua API UniWork / dùng tính năng trình duyệt
  / ẩn trên web (Zotero, mật khẩu file, bản khôi phục cục bộ). Đo kích thước bundle và
  thời gian mở. Kết quả: báo cáo + danh sách hàm, quyết GO-D2.
  *Đã xong: báo cáo spike `4a70857`, quyết GO-D2.*
- [x] **GO-B2 (UNI-1012) Hợp đồng nạp bundle.** Fork xuất bundle web có version (artifact CI hoặc
  package); `dev-uniwork` phục vụ từ origin web; CSP; cầu nối chỉ chạm file qua token
  FileService của đúng workspace (cách ly tenant, theo `TestIsolationMatrix`).
  *Đã xong: PR #219 (pins + `source.json` trong `apps/web/platform/office-frame/`).*
- [x] **GO-B3 (UNI-1013) Docs trên web.** Cầu nối web cho Docs; trang mở tài liệu docx trong
  UniWork web dùng renderer genoffice thay editor G3.
  *Đã xong: PR #219.*
- [x] **GO-B4 (UNI-1014) PDF, Markdown, HTML trên web** (ít hoặc không gọi cầu nối).
  *Đã xong: PR #219.*
- [x] **GO-B5 (UNI-1015) Slides trên web.**
  *Đã xong: PR #219.*
- [x] **GO-B6 (UNI-1016) Sheets trên web.** Đo các thao tác cần `xlsx-sidecar`, quyết GO-D3.
  *Đã xong: PR #219; file vượt giới hạn WASM mở bằng app (quy tắc 2026-10-07).*
- [x] **GO-B7 (UNI-1017) Gỡ editor cũ.** Với mỗi module đã chạy trên web: xoá editor tương ứng
  trong `packages/views/office` và phần vendor trong `packages/office-upstream`;
  `pnpm knip` xanh.
  *Đã xong: GO-C4 (UNI-1240) trong PR #219: xoá editor G3, `packages/office-upstream` phần chỉ G3 dùng và `apps/office-desktop`.*

## 7. Giai đoạn C - Đóng G3-G4 và giấy tờ ở dev-uniwork

- [~] **GO-C1 (UNI-1018) Đóng wave 4 G3-G4.** Chạy toàn bộ suite trên root
  `feature/UNI-819-office-g3g4-w4` qua cloud runner, mở PR vào `develop` khi người dùng
  ra lệnh. Đánh dấu `apps/office-desktop` đóng băng trong spec G4.
  *Bị thay thế 2026-10-12: suite trên root `feature/UNI-819-office-g3g4-w4` @ `8588ca23f` đã xanh (`reports/go-c1/suite-report.md`) nhưng không mở PR. Luồng tải và đăng nhập desktop của wave 4 (UNI-966) được làm lại trên app genoffice (GO-A5, GO-A8, UNI-1309); `apps/office-desktop` đã xoá ở GO-C4.*
- [x] **GO-C2 (UNI-1019) ADR AI phía client của Office.** ADR 0010 chỉ nói agent runtime phía
  server. ADR mới: app desktop được gọi nhà cung cấp AI trực tiếp bằng key của người
  dùng; mọi tính năng tính tín dụng UniWork đi qua `ai.Gateway`.
  *Đã xong: ADR 0028 + ADR 0029.*
- [x] **GO-C3 (UNI-1020) Cập nhật spec.** Spec G3/G4 sang `superseded` cho phần editor, trỏ về plan
  này; ghi hợp đồng API app <-> UniWork (đăng nhập, FileService, AI cloud, bản cài).
  *Đã xong: PR #219.*

## 7b. Làm thêm sau khi plan duyệt

- [x] **GO-A10 (UNI-1233) Kiểm bộ cài Linux và macOS trên VM.** Không có lỗi chặn; dmg chưa ký vẫn báo "damaged" cho tới khi có chứng chỉ (backlog).
- [x] **GO-B8 (UNI-1232) Hoàn thiện web:** ảnh qua route ký, Sheets, chỉ xem, chip AI, xuất Markdown/HTML, khôi phục nháp, bố cục 390 px. PR #219.
- [x] **GO-C4 (UNI-1240) Việc theo sau:** file lớn mở bằng app, `uniwork-office-cli` trên Linux, My AI theo tài khoản, model AI lưu trên server, xoá editor cũ. PR #219.
- [x] **UNI-1305 Trang Tài liệu mới trên web:** tạo mới 7 loại (Trang, Docs, Sheets, Slides, Markdown, HTML, PDF), thư mục lồng nhau, file từ Chat/Task/Cuộc họp/Email theo quyền người xem kèm "Lưu vào thư mục", lọc và nhóm, nút "Mở bằng app" trên từng dòng và "Mở UniWork Office" ở đầu trang.
- [x] **UNI-1307 Trang Office trên site công khai:** menu Office, bố cục theo genoffice.ai với nội dung của UniWork, ảnh chụp bằng Playwright.
- [x] **UNI-1309 Bỏ gói zip khi tải bộ cài:** trình duyệt tải thẳng bộ cài từ nơi phát hành; địa chỉ server đi theo link mở app (cùng mã triển khai thì app tự đổi địa chỉ, người dùng chọn chấp nhận rủi ro link giả); màn "Kết nối UniWork" trong app. App 0.11.0-dev.7, bộ web `0.1.0-0d03b18`.

## 8. Thứ tự và song song

1. GO-A1 trước (mọi thứ khác dựa trên fork đã lên upstream). GO-C1 chạy song song.
2. Sau GO-A1: GO-A2, GO-A3, GO-A4 song song; GO-B1 spike song song.
3. GO-A5 -> GO-A6 -> GO-A9; GO-A7 cần GO-C2; GO-A8 cần GO-A4.
4. Web theo kết quả GO-B1: GO-B2 -> GO-B3 -> GO-B4/B5/B6 -> GO-B7.

Giới hạn lane theo quy tắc hiện hành (tối đa 3 lane chạy cùng lúc); test cục bộ chỉ
chạy đúng file bị ảnh hưởng, suite chạy trên cloud runner.

## 9. Ngoài phạm vi

- Ký số, notarization, kênh stable và feed cập nhật: chờ chứng chỉ (backlog).
- App mobile.
