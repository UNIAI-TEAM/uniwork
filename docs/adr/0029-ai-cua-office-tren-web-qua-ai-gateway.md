# 0029 — AI của Office trên web: khóa của người dùng lưu mã hóa phía server, mọi lệnh gọi đi qua `ai.Gateway`

**Trạng thái:** accepted (2026-10-09, UNI-1008; quyết định người dùng 2026-10-09: khóa lưu mã hóa phía server, web gọi qua `ai.Gateway`, không giữ khóa trong trình duyệt)
**Issue:** UNI-1008 · **Parent:** UNI-1001 · **Liên quan:** [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) (AI phía server), [0028](0028-ai-phia-client-cua-uniwork-office.md) (AI phía client), [0008](0008-cach-ly-tenant-o-tang-service.md), [0009](0009-audit-va-outbox-cung-transaction.md).
**Bổ sung cho 0028** (không sửa nó): dòng "Frame web" ở Quyết định 5 của 0028 nói AI web sau này chỉ đi qua UniWork API + `ai.Gateway`; ADR này là quyết định đó.

---

## Bối cảnh

ADR 0028 chia AI của UniWork Office làm hai: khóa của người dùng gọi thẳng nhà cung
cấp từ desktop, còn mọi thứ tốn credit UniWork đi qua UniWork API. Frame genoffice
nhúng trong web (các route `office-frame` của GO-B2/GO-B3) khi đó ẩn AI vì trình
duyệt không được giữ khóa nhà cung cấp, và trình duyệt cũng không gọi thẳng nhà cung
cấp được (CORS, lộ khóa trong DevTools/extension).

Ngày 2026-10-09 người dùng chốt: web cũng có AI bằng khóa riêng của người dùng, khóa
lưu **mã hóa phía server**, lệnh gọi đi qua `ai.Gateway`. Cùng lúc GO-A7 (UNI-1008)
dựng các công cụ đám mây UniWork (tìm kiếm, sinh ảnh, phân tích media, phiên âm) mà
0028 đã giao cho lane này.

## Quyết định

1. **Desktop giữ nguyên BYOK của 0028 (D1).** App desktop vẫn gọi thẳng nhà cung cấp
   bằng khóa của người dùng. Kho khóa phía server và proxy dưới đây phục vụ **host
   web**; desktop có thể dùng proxy về sau, v1 thì không.
2. **Khóa lưu phía server, mã hóa (D2).** Bảng `ai_provider_credentials`
   (`organization_id`, `user_id`, `provider`, duy nhất theo ba cột) giữ
   `secret_ciphertext` mã hóa bằng secretbox AES-256-GCM, khóa chủ là biến môi trường
   `AI_CREDENTIAL_KEY` (base64 của 32 byte). Không FK, id ULID, theo luật migration
   chung. Chỉ **service** ghi bảng này (`internal/service/ai_credentials.go`), không
   bao giờ `internal/ai` (ADR 0010).
3. **Proxy là pass-through, không dịch giao thức (D3).** Client (`packages/ai-provider`
   của genoffice trên web) giữ nguyên wire format gốc của nhà cung cấp, chỉ đổi base URL
   sang route UniWork và bỏ khóa. Server chọn endpoint nhà cung cấp từ **bảng cố định**
   (không bao giờ từ client), gắn khóa của người dùng, chuyển body và trả byte phản hồi
   nguyên vẹn (SSE vẫn là SSE). Nhờ vậy tool calling, ảnh và streaming giống hệt desktop.
4. **Giao thức hỗ trợ (D4):** chỉ `openai-compatible`, `anthropic`, `gemini`. Loại
   `codex` (CLI cục bộ), `genspark` và mọi thứ cần tiến trình cục bộ. Nhà cung cấp
   `custom` (openai-compatible với `base_url` của người dùng) được phép nhưng phải là
   `https://`, host công khai (phân giải DNS, kiểm **mọi** IP: không loopback, riêng tư,
   link-local, CGNAT, multicast, unspecified; v4 lẫn v6, **kiểm lại lúc dial** để chặn DNS
   rebinding), không userinfo, không theo redirect. Đây là rào SSRF.
5. **Entitlement và credit (D5).** Hai khóa tính năng seed bằng migration, đọc qua
   `EntitlementService.Can` (fail-closed): `office.ai_byok` (`PUT` khóa và proxy; `GET`/`DELETE` khóa không bị chặn để người hạ plan vẫn gỡ được khóa) và
   `office.ai_cloud` (mọi công cụ đám mây). Credit dùng meter `ai.tokens` có sẵn:
   `CheckQuota` trước, `RecordUsage` sau; công cụ không có số token thì tính một mức
   token-tương-đương cố định mỗi lần gọi, khai ở đúng một bảng Go. Proxy BYOK ghi
   `credits=0` (khóa của người dùng, không tiêu credit UniWork).
6. **Giới hạn tốc độ (D6)** theo danh tính (`mw.RateLimitByIdentity`, bearer user): khóa
   30/phút, proxy 60/phút, công cụ đám mây 20/phút; chỉ có khi có Redis, fail-open như
   CLAUDE.md.
7. **Không ghi bảng nghiệp vụ (D7).** `internal/ai` nhận khóa đã giải mã như một giá trị
   trong request và chỉ gọi query `Ai*` (sự kiện sử dụng). Query của bảng khóa **không**
   đặt tên `Ai*`, để `internal/ai` không gọi được; `TestAIPackageOnlyCallsAiQueries` giữ
   luật. HTTP tới nhà cung cấp chỉ nằm trong `internal/ai/provider`
   (`TestProviderSDKOnlyInAIProvider`).
8. **Không bao giờ trả khóa (D8).** Phản hồi chỉ có `key_hint` = "…" + 4 ký tự cuối. Khóa
   không xuất hiện trong log, payload audit, lỗi, trace hay sự kiện outbox. Body lỗi của
   nhà cung cấp chỉ được chuyển tiếp sau khi thay mọi chỗ khóa lặp lại bằng `[redacted]`.
9. **Frame web (D9).** Cùng service proxy và công cụ đám mây sẽ được mount thêm dưới
   `/office-frame/documents/{documentID}/ai/...`, tác nhân (user, org) lấy từ claim của
   frame-token. Route frame nằm trên nhánh GO-B2/B3, chưa có trên nền này, nên lane này
   chỉ dựng tầng service để việc mount là một route mỏng; việc mount ghi là **chờ merge
   gốc GO-B2/B3**. Trang host web dùng được route session ngay.

## Công cụ đám mây UniWork

Khóa nhà cung cấp phía UniWork nằm trong biến môi trường của server
(`AI_CLOUD_SEARCH_PROVIDER`, `AI_CLOUD_IMAGE_PROVIDER`, `AI_CLOUD_TRANSCRIBE_PROVIDER`,
… đều có trong `.env.example`); công cụ chưa cấu hình báo `available:false` và route trả
503 `cloud_unavailable`. Client gửi **byte** media, server không bao giờ tự tải URL media,
nên không có mặt SSRF ở đây. Mỗi lệnh gọi: `RequireMember` → `Can(office.ai_cloud)`
→ `CheckQuota(ai.tokens)` → `ai.Gateway` → sự kiện sử dụng + `RecordUsage`. Sinh slide vẫn ẩn.

## Phương án đã cân nhắc và loại

- **Giữ khóa trong trình duyệt và gọi thẳng nhà cung cấp.** Lộ khóa, dính CORS, không đo
  đếm được; 0028 đã cấm.
- **Dịch mọi giao thức về một dạng chung ở server.** Mất tool calling/vision/streaming
  nguyên bản và phải bảo trì ánh xạ theo từng nhà cung cấp; pass-through đơn giản và đúng.
- **Cho client chọn endpoint nhà cung cấp.** Biến server thành relay mở (SSRF); endpoint
  chỉ từ bảng cố định, riêng `custom` qua rào ở Quyết định 4.
- **Ép desktop dùng proxy luôn.** Phá luồng BYOK/CLI của genoffice mà 0028 đã giữ.

## Hệ quả

- Server giữ bí mật của người dùng. Mất `AI_CREDENTIAL_KEY` hoặc lộ nó thì lộ mọi khóa;
  khóa chủ phải ở secret manager, và đổi khóa chủ cần chạy lại mã hóa (chưa có công cụ xoay
  khóa trong v1).
- Lưu lượng proxy đi qua server nên **có** đo đếm (sự kiện sử dụng, token nếu đọc được từ
  khối usage cuối) và có thể bị giới hạn tốc độ/entitlement, khác với đường desktop trực tiếp.
- Proxy chuyển tiếp prompt của người dùng tới nhà cung cấp do **chính họ chọn**; server không
  lưu nội dung prompt hay phản hồi (chỉ số liệu sử dụng).
- Lỗi chuẩn: `entitlement_required` 403, `credits_exhausted` 402, `credential_missing`
  404, `provider_not_supported` 400, `base_url_refused` 400, `provider_auth_failed` 424 (nhà cung
  cấp trả 401/403), 429 (giới hạn tốc độ hoặc nhà cung cấp), `provider_unreachable` 502,
  `cloud_unavailable` 503.
- Còn nguyên: `ai.Gateway` là đường LLM duy nhất của server, ADR 0010 không đổi.

## Giới hạn đã biết

- Khi thành viên bị gỡ hoặc vô hiệu hóa tổ chức, khóa **không** bị xóa tự động: chúng
  không dùng được vì `RequireMember` từ chối, và chỉ `DELETE` mới xóa dòng. (Sẽ ghi lại ở đây nếu
  nối được vào service gỡ thành viên.)
- Không xoay khóa chủ, không mã hóa theo từng tổ chức; một khóa chủ cho cả máy chủ.
- `custom` chống rebinding bằng kiểm lại lúc dial, nhưng không chặn được nhà cung cấp tự
  trỏ về địa chỉ công khai rồi chuyển tiếp nội bộ phía họ.
- Route frame (`/office-frame/...`) chưa mount (xem Quyết định 9).

## Trạng thái

`accepted` (2026-10-09, UNI-1008). Bổ sung phạm vi cho [0028](0028-ai-phia-client-cua-uniwork-office.md)
(Quyết định 5, frame web); không thay thế ADR nào và không sửa 0010.
