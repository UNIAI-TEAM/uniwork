# UniWork Office desktop - dùng không đăng nhập (chế độ trên máy, offline)

> **Trạng thái:** superseded - chế độ dùng không đăng nhập là việc của `apps/office-desktop`, đã đóng băng theo [plan genoffice](../plans/2026-10-08-uniwork-office-genoffice.md) (UNI-1001; vào develop cùng UNI-1001). App fork genoffice vốn dùng được với file cục bộ (GO-A6 giữ nguyên hành vi đó).

> **Còn hiệu lực:** đăng nhập UniWork vẫn dùng luồng UNI-966 (GO-A5, UNI-1006).

## 1. Lý do

Người dùng 2026-10-02: "sử dụng offline không đăng nhập cũng rất cần thiết. nên đưa luồng này vào làm luôn trong g3g4".

Hiện trạng trên root: `apps/office-desktop/renderer/app.tsx` chỉ vào shell khi phiên `signed-in`; chưa đăng nhập chỉ có
`login-screen.tsx`. Thư viện, mở tệp trên máy và editor đều nằm sau đăng nhập. Spec G4 có luồng file local nhưng không
mô tả trạng thái chưa đăng nhập, trong khi plan §8.1 (quyết định người dùng 2026-09-30) đã giả định "chưa đăng nhập hoặc
đang mở file local chưa bind cloud". genoffice gốc mở/sửa file local không cần tài khoản.

Đây là mở rộng G4-04 (UNI-833, local I/O + protected draft). Không đổi G5 (thư viện offline/đồng bộ vẫn ngoài G3-G4).

## 2. Hai chế độ của app

| | Chế độ trên máy (chưa đăng nhập) | Đã đăng nhập |
| --- | --- | --- |
| Mở/sửa/Lưu/Lưu thành tệp `.docx` trên máy | Có | Có |
| Tạo tài liệu DOCX mới (lưu ra máy) | Có, nếu engine có mẫu trắng đóng gói sẵn; không thì ẩn | Có |
| Nháp bảo vệ + khôi phục sau crash | Có, namespace `local` của thiết bị | Có, namespace tài khoản |
| Tab tài liệu (UNI-917) | Có | Có |
| Thư viện cloud, "Đưa lên UniWork", mở từ web, tính năng theo entitlement | Không: hiện khoá + nút "Đăng nhập" | Có |
| AI trong editor | Khoá + lời nhắc + nút đăng nhập (plan §8.1), không gọi `ai.Gateway`, không gửi nội dung | Theo quyền/entitlement |
| Gọi mạng | **Không gọi gì** (không refresh, không config, không update check) | Như hiện tại |

Đã đăng nhập nhưng mất mạng: tệp trên máy vẫn mở/sửa/lưu được; phần cloud báo "không có kết nối" thay vì treo.

## 3. Luồng

1. **Mở app lần đầu, chưa có phiên:** màn đăng nhập giữ nút chính "Đăng nhập bằng trình duyệt", thêm hai lựa chọn phụ
   bên dưới: "Mở tệp trên máy" (mở hộp chọn tệp, vào thẳng tab) và "Dùng không đăng nhập" (vào trang chủ trên máy).
   Ghi chú nhỏ: "Bạn có thể đăng nhập sau để dùng thư viện UniWork."
2. **Lần sau:** nếu lần trước người dùng chọn chế độ trên máy và không có phiên, app mở thẳng trang chủ trên máy; nút
   "Đăng nhập" nằm trên title bar (chỗ avatar của UNI-917). Lựa chọn lưu theo thiết bị trong main, không theo tài khoản.
3. **Trang chủ trên máy:** dùng `CollectionPageHeader` (icon, "Tệp trên máy", nút "Mở tệp" / "Tài liệu mới"), danh sách
   tệp mở gần đây (tên + thư mục rút gọn + thời gian; tệp không còn tồn tại thì mờ + "Không tìm thấy tệp", có nút xoá
   khỏi danh sách), trạng thái rỗng có minh hoạ + hai nút. Không có tab Thư viện cloud; thay bằng tab cố định "Trên máy".
4. **Mở `.docx` từ hệ điều hành** (double-click, "Open with", kéo thả vào cửa sổ) khi chưa đăng nhập: mở thẳng trong chế độ
   trên máy, không đòi đăng nhập.
5. **Deep link từ web khi chưa đăng nhập:** hỏi đăng nhập như hiện tại (không hiện metadata tài liệu); "Huỷ" quay lại
   chế độ trên máy, tab trên máy giữ nguyên.
6. **Đăng nhập từ chế độ trên máy:** luồng trình duyệt hiện có. Tab tệp trên máy giữ nguyên (cùng handle), thêm tab
   Thư viện. Nháp `local` **không** tự chuyển sang tài khoản; muốn đưa lên thì "Đưa lên UniWork" như hiện tại.
7. **Đăng xuất:** xử lý tab cloud bẩn (Lưu / Không lưu / Huỷ, luồng G4-04b), đóng tab cloud, giữ tab tệp trên máy, về
   chế độ trên máy. Không đóng app.

## 4. Bảo mật và lưu trữ (bất biến)

- Đường dẫn tệp và handle chỉ ở main; renderer nhận id mờ + tên hiển thị (như G4-04). Danh sách gần đây lưu trong main,
  mã hoá như nháp; xoá được.
- Nháp `local` dùng kho key hệ điều hành như G4-04 (DPAPI / Keychain / Secret Service), namespace riêng
  `local:<device>`. Phiên tài khoản A không list/đọc/giải mã nháp `local` và ngược lại; IPC không cho caller chọn
  namespace tuỳ ý. Không plaintext fallback; không có kho key thì báo lỗi có lý do (như UNI-920 trên Linux).
- Chế độ trên máy không mở kết nối mạng nào: có test chặn mạng (transport giả ném lỗi nếu bị gọi) và kiểm thật với app
  đóng gói khi tắt mạng.
- Không có "tài khoản khách" trên server, không tạo phiên thiết bị khi chưa đăng nhập.

## 5. Phạm vi file (lane)

`apps/office-desktop/renderer/**` (app.tsx, login-screen, trang chủ trên máy, title bar nút Đăng nhập),
`apps/office-desktop/main/**` + `electron-main.ts` (trạng thái chế độ, namespace nháp `local`, danh sách gần đây, mở tệp
từ hệ điều hành khi chưa đăng nhập, chặn mạng), `apps/office-desktop/preload/**`, `apps/office-desktop/shared/ipc.ts`,
i18n `officeDesktop.local.*` vi + en. Editor dùng lại như đang có (DOCX). Không sửa server, `packages/views/office`
(trừ khi hỏi Advisor), `scripts/`, `identity.json`, `build/` (UNI-920).

## 6. Nghiệm thu

- Unit/jsdom: chọn chế độ, nhớ lựa chọn, trang chủ trên máy (rỗng / có tệp / tệp mất), mở tệp từ hệ điều hành khi chưa
  đăng nhập, deep link khi chưa đăng nhập, đăng nhập giữ tab trên máy, đăng xuất giữ tab trên máy, AI/cloud khoá,
  namespace nháp tách biệt (A không đọc `local`, `local` không đọc A), không plaintext, transport bị gọi trong chế độ
  trên máy thì test fail.
- Kiểm thật trên app đóng gói Windows, **tắt mạng** (adapter tắt hoặc chặn tiến trình): mở `.docx` từ Explorer, sửa,
  Lưu, Lưu thành, crash (kill tiến trình) rồi khôi phục nháp, mở lại; sau đó bật mạng, đăng nhập, tab trên máy còn
  nguyên, nháp `local` không xuất hiện trong tài khoản.
- Tester visual (claude-sonnet-5-5 medium + Jev, 9 tiêu chí UI): màn đăng nhập mới, trang chủ trên máy (rỗng / có tệp /
  tệp mất), title bar khi chưa đăng nhập, AI khoá; sáng + tối; 1360×900 và 720×550. Người dùng duyệt giao diện cuối.
- check-boundaries, knip, desktop typecheck/lint/test, 500 dòng, coverage chỉ tăng.

## 7. Phụ thuộc

Chạy sau khi UNI-917 (tab + title bar) merge vào root, vì cùng sửa renderer shell, title bar và `electron-main.ts`.
Phối hợp UNI-920 (macOS/Linux) qua root: lane nào merge sau thì rebase lên root.
