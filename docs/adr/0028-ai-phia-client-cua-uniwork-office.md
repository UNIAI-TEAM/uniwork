# 0028 — AI phía client của UniWork Office: khóa của người dùng gọi thẳng nhà cung cấp, mọi thứ tốn credit đi qua UniWork API

**Trạng thái:** accepted (2026-10-09, UNI-1019; quyết định người dùng 2026-10-08, câu hỏi Q4 của kế hoạch: "AI giữ như genoffice")
**Issue:** UNI-1019 · **Parent:** UNI-1001 · **Liên quan:** [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) (AI phía server), [0021](0021-runtime-engine-office-da-dinh-dang.md), [0026](0026-office-desktop-host.md).
**Nguồn:** `docs/superpowers/plans/2026-10-08-uniwork-office-genoffice.md` (kế hoạch genoffice; chưa có trên `develop`, land cùng UNI-1001).

---

## Bối cảnh

ADR 0010 và `ai.Gateway` điều chỉnh **runtime agent phía server**: mọi lệnh gọi LLM
của server đi qua `server/internal/ai/`, agent không ghi bảng nghiệp vụ, mọi ghi
đi theo đề xuất → người xác nhận → thực thi. ADR đó không nói gì về ứng dụng
desktop UniWork Office.

UniWork Office là bản fork của genoffice (Apache-2.0, repo riêng
`UNIAI-TEAM/uniwork-office`); UI G3/G4 dựng lại đang được thay bằng genoffice theo
kế hoạch nêu trên. Genoffice vốn có AI chạy ở phía client: người dùng tự điền khóa
nhà cung cấp (BYO key) hoặc dùng CLI cục bộ như Codex CLI. Ngày 2026-10-08 người
dùng chốt "AI giữ như genoffice". UniWork Office không có tài khoản riêng: tài
khoản là tài khoản UniWork, quyền dùng tính năng đến từ plan của tổ chức do server
cấp. Cần một ranh giới rõ: lệnh gọi nào phía client được tự gọi, lệnh nào bắt buộc
qua server.

## Quyết định

1. **ADR 0010 chỉ điều chỉnh runtime agent phía server.** Nó không điều chỉnh ứng
   dụng UniWork Office.
2. **AI bằng khóa của người dùng gọi thẳng nhà cung cấp.** Ứng dụng desktop được
   gọi nhà cung cấp AI trực tiếp bằng khóa của chính người dùng (BYO key) hoặc CLI
   cục bộ (Codex CLI…), cấu hình trong ứng dụng đúng như genoffice. Các lệnh gọi này
   không chạm máy chủ UniWork và không tiêu credit UniWork.
3. **Mọi thứ tốn credit UniWork hoặc dùng công cụ cloud của UniWork đi qua UniWork
   API.** Gồm tìm kiếm web, sinh ảnh, phân tích media, credit: client gọi UniWork API
   bằng phiên UniWork của người dùng, server định tuyến qua `ai.Gateway` với quyền
   lợi (entitlement) theo plan của tổ chức, do server cấp. Endpoint server cho các
   công cụ cloud này là việc của GO-A7 (UNI-1008), ADR này không dựng chúng.
4. **Ứng dụng không bao giờ giữ khóa nhà cung cấp của UniWork** hay bất kỳ
   credential provider phía server nào.
5. **Frame web.** Renderer genoffice nhúng trong UniWork web (các route office-frame
   của GO-B2/GO-B3) hiện ẩn AI. AI web sau này chỉ đi qua UniWork API +
   `ai.Gateway`, không bao giờ dùng khóa giữ trong trình duyệt.

## Phương án đã cân nhắc và loại

- **Đưa mọi AI của desktop qua `ai.Gateway`.** Phá các tính năng BYO key / CLI của
  genoffice, và bắt người dùng đã có khóa riêng vẫn tiêu credit UniWork.
- **Nhúng khóa nhà cung cấp của UniWork vào ứng dụng.** Lộ bí mật (mọi bản cài đều
  trích được), bỏ qua entitlement và audit, không thu hồi được theo người dùng.
- **Tắt AI trong desktop.** Mất tính năng cốt lõi người dùng đã chọn giữ.

## Hệ quả

- Lưu lượng dùng khóa của người dùng nằm **ngoài** audit/đo đếm của UniWork và
  **ngoài** luồng đề xuất của ADR 0010. Đây là cái giá được chấp nhận: UniWork
  không thấy và không tính phí các lệnh gọi này.
- Ghi vào dữ liệu nghiệp vụ UniWork từ desktop vẫn đi qua API thường bằng phiên
  của người dùng thật, nên luật "agent không ghi nghiệp vụ trực tiếp" không đổi.
- Riêng tư: nội dung người dùng gửi tới nhà cung cấp do **chính họ chọn**; UI phải
  nói rõ điều này khi cấu hình khóa/CLI.
- Còn nguyên và không đổi: `ai.Gateway` là đường LLM duy nhất của server; không SDK
  vendor nào ngoài `server/internal/ai/provider`. Các test giữ luật:
  `TestProviderSDKOnlyInAIProvider` và `TestAIPackageOnlyCallsAiQueries`
  (`server/internal/arch_test.go`), `TestAskUniToolsAreReadOnly`
  (`server/internal/service/askuni_test.go`).
- Việc còn lại: endpoint cloud tool (GO-A7, UNI-1008); chưa có guard test mới cho
  ranh giới client (kiểm bằng review: app không chứa credential provider của
  UniWork).

## Trạng thái

`accepted` (2026-10-09, UNI-1019). Chưa thay thế ADR nào; bổ sung phạm vi cho 0010
mà không sửa nó.
