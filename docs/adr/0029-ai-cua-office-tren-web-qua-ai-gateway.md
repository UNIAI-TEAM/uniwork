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
   bao giờ `internal/ai` (ADR 0010). `PUT` giữ nguyên `base_url` và `label` đã lưu khi body
   bỏ qua trường đó; chỉ chuỗi rỗng tường minh mới xóa (`base_url` rỗng = về endpoint mặc
   định của nhà cung cấp). Bỏ qua `api_key` trên dòng đã có thì giữ khóa cũ.
3. **Proxy là pass-through, không dịch giao thức (D3).** Client (`packages/ai-provider`
   của genoffice trên web) giữ nguyên wire format gốc của nhà cung cấp, chỉ đổi base URL
   sang route UniWork và bỏ khóa. Server chọn endpoint nhà cung cấp từ **bảng cố định**
   (không bao giờ từ client), gắn khóa của người dùng, chuyển body và trả byte phản hồi
   nguyên vẹn (SSE vẫn là SSE). Nhờ vậy tool calling, ảnh và streaming giống hệt desktop.
   Ba chi tiết của pass-through:

   - **Header request chuyển tiếp theo allowlist từng giao thức**, không chép cả header của
     client: anthropic nhận `anthropic-beta`; openai-compatible nhận `openai-organization`,
     `openai-project`, và riêng `openrouter` thêm `http-referer`, `x-title`; gemini không
     nhận header nào. Giá trị có ký tự điều khiển hoặc dài hơn 512 byte bị bỏ. Khóa đã lưu
     được gắn **sau cùng**, và `authorization`, `x-api-key`, `x-goog-api-key`, `cookie` không
     bao giờ được chuyển.
   - **Phản hồi được làm cứng** vì proxy trả nội dung do nhà cung cấp (hoặc `custom`) quyết
     định trên origin của API: luôn có `X-Content-Type-Options: nosniff` và
     `Content-Security-Policy: default-src 'none'; sandbox`; `Content-Type` chỉ được chuyển
     khi là `application/json`, `text/event-stream` hoặc `text/plain`, còn lại thành
     `application/octet-stream`. Header phản hồi khác ngoài `content-type` và `retry-after`
     bị bỏ. Ghi vào luồng có hạn chót 60 giây mỗi chunk, nên client ngừng đọc không giữ
     goroutine mãi mãi (dòng sử dụng chốt `stream_incomplete`).
   - **Người không phải thành viên nhận 404** ở proxy, giống các route khóa, để không dò
     được id tổ chức.
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
   token-tương-đương cố định mỗi lần gọi, khai ở đúng một bảng Go
   (`server/internal/ai/cloud.go`; đổi số là đổi giá khách trả, thuộc chủ sản phẩm):

   | Công cụ | Tính |
   | --- | --- |
   | Tìm kiếm (web hoặc ảnh) | 500 mỗi lần |
   | Sinh ảnh | 4000 mỗi ảnh trả về |
   | Phiên âm | 1000 mỗi phút **bắt đầu** (tối thiểu 1 phút), xem quy tắc dưới |
   | Phân tích media | token thật của lệnh gọi mô hình (đầu vào + đầu ra) |

   Công cụ tính cố định ghi mức token-tương-đương vào `input_tokens` của dòng sử dụng
   (bảng không có cột credit), nên báo cáo sử dụng của tổ chức cộng khớp với meter
   `ai.tokens`; lệnh gọi lỗi không tính gì, lệnh gọi bị chặn vì hết hạn mức ghi dòng
   `rejected` và không gọi nhà cung cấp. Proxy BYOK ghi `credits=0` (khóa của người dùng,
   không tiêu credit UniWork).

   **Quy tắc tính phiên âm.** Số giây lấy từ thời lượng nhà cung cấp báo (`duration` của
   whisper, khối `usage.seconds`); nếu không báo (ví dụ model `gpt-4o-transcribe`) thì ước
   lượng từ dung lượng tệp theo tốc độ byte điển hình của từng định dạng: WAV theo byte rate
   trong header (không đọc được thì 32000 B/s), `audio/mpeg` 16000 B/s, `audio/mp4`/m4a
   12000 B/s, `video/*` 125000 B/s, còn lại (opus, webm, ogg, flac) 6000 B/s. Làm tròn lên
   từng phút bắt đầu. Kiểm trước khi gọi chỉ đòi tối thiểu 1 phút (chưa biết độ dài); số thật
   được tính sau lệnh gọi. Mục đích: không để model không báo thời lượng biến hàng giờ âm thanh
   thành một phút. Ước lượng là xấp xỉ, không phải đo chính xác.

   **Đo đếm bền hơn kết nối.** Dòng sử dụng và meter `ai.tokens` được chốt trên context tách
   khỏi request (giới hạn 10 giây), và lệnh gọi nhà cung cấp của công cụ tính cố định cũng tách
   khỏi request (giới hạn 4 phút): client ngắt kết nối giữa chừng không để dòng kẹt `pending`
   và không làm một lệnh gọi đã tốn tiền nhà cung cấp thành miễn phí. Phân tích media đi qua
   `Complete` nên chốt theo cùng cách.
6. **Giới hạn tốc độ (D6)** theo danh tính (bearer user), **theo nhóm route chứ không theo
   URL** (`mw.RateLimitByIdentityBucket`: bộ đếm khóa theo tên nhóm nên `{orgID}` và
   `{aiProvider}` trong đường dẫn không nhân ngân sách): `ai-credentials` 30/phút (ba route
   khóa), `ai-byok` 60/phút (bốn route proxy), `ai-cloud` 20/phút (bốn route công cụ đám mây
   chung một ngân sách; `GET .../ai/cloud` chỉ chịu giới hạn toàn cục). Chỉ có khi có Redis,
   fail-open như CLAUDE.md.
7. **Không ghi bảng nghiệp vụ (D7).** `internal/ai` nhận khóa đã giải mã như một giá trị
   trong request và chỉ gọi query `Ai*` (sự kiện sử dụng). Query của bảng khóa **không**
   đặt tên `Ai*`, để `internal/ai` không gọi được; `TestAIPackageOnlyCallsAiQueries` giữ
   luật. HTTP tới nhà cung cấp chỉ nằm trong `internal/ai/provider`
   (`TestProviderSDKOnlyInAIProvider`).
8. **Không bao giờ trả khóa (D8).** Phản hồi chỉ có `key_hint` = "…" + 4 ký tự cuối. Khóa
   không xuất hiện trong log, payload audit, lỗi, trace hay sự kiện outbox. Body lỗi của
   nhà cung cấp chỉ được chuyển tiếp sau khi thay mọi chỗ khóa lặp lại bằng `[redacted]`.
9. **Frame web (D9).** Handler proxy và công cụ đám mây là mountable: chúng nhận tác nhân
   (user, org) từ một `AIActorResolver` duy nhất (`handler.NewAIMountable`), mặc định là user
   của phiên + `{orgID}` trên path. Lane web modules (UNI-1014) tự mount chúng dưới
   `/office-frame/documents/{documentID}/ai/...` với resolver đọc claim frame-token, sau khi
   merge lane này; lane này không phụ thuộc middleware frame của GO-B2/B3. Trang host web
   dùng được route session ngay.

## Công cụ đám mây UniWork

Khóa nhà cung cấp phía UniWork nằm trong biến môi trường của server, tất cả có trong
`.env.example` (`scripts/env-example.test.mjs` giữ):

| Biến | Giá trị / ý nghĩa |
| --- | --- |
| `AI_CREDENTIAL_KEY` | khóa chủ secretbox của kho khóa người dùng, base64 của 32 byte; trống thì server vẫn chạy và route khóa trả 503 `ai_credentials_unavailable` |
| `AI_CLOUD_SEARCH_PROVIDER`, `AI_CLOUD_SEARCH_API_KEY` | `tavily` \| `brave` \| `fake` |
| `AI_CLOUD_IMAGE_PROVIDER`, `AI_CLOUD_IMAGE_API_KEY`, `AI_CLOUD_IMAGE_MODEL`, `AI_CLOUD_IMAGE_BASE_URL` | `openai` \| `fake`; model mặc định `gpt-image-1` |
| `AI_CLOUD_TRANSCRIBE_PROVIDER`, `AI_CLOUD_TRANSCRIBE_API_KEY`, `AI_CLOUD_TRANSCRIBE_MODEL`, `AI_CLOUD_TRANSCRIBE_BASE_URL` | `openai` \| `fake`; model mặc định `whisper-1` |

Phân tích media dùng nhà cung cấp chính của Gateway (model có vision qua `AI_MODEL_<CAP>`),
không có biến riêng. Tên nhà cung cấp lạ hoặc thiếu khóa thì công cụ đó không có: báo
`available:false` và route trả 503 `cloud_unavailable`. `fake` chỉ để phát triển, test, E2E.

Client gửi **byte** media, server không bao giờ tự tải URL media, nên không có mặt SSRF ở
đây. Mỗi lệnh gọi: `RequireMember` → `Can(office.ai_cloud)` → kiểm đầu vào →
`CheckQuota(ai.tokens)` → `ai.Gateway` → sự kiện sử dụng + `RecordUsage`. Sinh slide vẫn ẩn.

**Giới hạn đầu vào.**

- Body: tìm kiếm ≤ 1 MiB; **sinh ảnh ≤ 44 MiB** (4 ảnh tham chiếu × 8 MiB = 32 MiB nhị phân,
  ~42,7 MiB base64, cộng prompt ≤ 4000 ký tự và JSON); phân tích media và phiên âm ≤ 36 MiB
  (25 MiB nhị phân). Kích thước nhị phân kiểm lại sau khi giải mã.
- **MIME của phân tích media** (danh sách cho phép; so sau khi bỏ tham số như `;codecs=opus`
  và hạ chữ thường): `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `audio/mpeg`,
  `audio/wav`, `audio/mp4`, `audio/webm`, `video/mp4`, `video/webm`, `application/pdf`. Loại
  ngoài danh sách trả **422 `media_unsupported`** trước khi giải mã; loại trong danh sách mà
  mô hình chính không đọc được (video, hoặc PDF/âm thanh tùy nhà cung cấp) cũng trả 422 từ
  Gateway. Chuỗi MIME của client **không bao giờ** được chép vào prompt: prompt nhận giá trị
  chuẩn lấy từ danh sách.
- MIME ảnh tham chiếu: png, jpeg, webp (400 nếu khác). MIME phiên âm phải là token
  `type/subtype` thường (`audio/*`, `video/mp4`, `video/webm`), nên không đưa được CR/LF hay
  khoảng trắng vào header multipart (400 nếu khác).
- Lỗi của nhà cung cấp công cụ đám mây vào log chỉ gồm host, đường dẫn, mã trạng thái và mã
  lỗi ngắn của nhà cung cấp (nếu là token đơn giản): không chuỗi truy vấn (nội dung tìm
  kiếm), không thông điệp của nhà cung cấp, không khóa.

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
  khóa chủ phải ở secret manager. Chưa có công cụ xoay khóa trong v1: đổi `AI_CREDENTIAL_KEY`
  làm mọi khóa đã lưu không giải mã được, `Resolve` trả `credential_missing` (404) và mỗi
  người phải lưu lại khóa của mình.
- Lưu lượng proxy đi qua server nên **có** đo đếm (sự kiện sử dụng, token nếu đọc được từ
  khối usage cuối) và có thể bị giới hạn tốc độ/entitlement, khác với đường desktop trực tiếp.
- Proxy chuyển tiếp prompt của người dùng tới nhà cung cấp do **chính họ chọn**; server không
  lưu nội dung prompt hay phản hồi (chỉ số liệu sử dụng).
- Lỗi chuẩn: `entitlement_required` 403, `credits_exhausted` 402, `credential_missing`
  404, `provider_not_supported` 400, `base_url_refused` 400, `provider_auth_failed` 424 (nhà cung
  cấp trả 401/403), 429 (giới hạn tốc độ hoặc nhà cung cấp), `provider_unreachable` 502,
  `cloud_unavailable` 503, `media_unsupported` 422 (loại tệp ngoài danh sách phân tích media
  hoặc mô hình không đọc được).
- Còn nguyên: `ai.Gateway` là đường LLM duy nhất của server, ADR 0010 không đổi.

## Giới hạn đã biết

- `GET` và `DELETE` khóa **không** bị chặn bởi entitlement `office.ai_byok` (chỉ `PUT` và
  proxy cần): người hạ plan vẫn xem và gỡ được khóa của mình, gỡ khóa không bao giờ bị tính phí.
- Khi thành viên bị gỡ hoặc vô hiệu hóa tổ chức, khóa **không** bị xóa tự động: chúng
  không dùng được vì `RequireMember` từ chối, nhưng vẫn nằm trong bảng, và chỉ `DELETE` mới xóa
  dòng. Không có hook dọn dẹp chung ở service gỡ thành viên; sẽ nối khi có.
- Không xoay khóa chủ, không mã hóa theo từng tổ chức; một khóa chủ cho cả máy chủ.
- `custom` chống rebinding bằng kiểm lại lúc dial, nhưng không chặn được nhà cung cấp tự
  trỏ về địa chỉ công khai rồi chuyển tiếp nội bộ phía họ.
- Proxy openai-compatible ở chế độ stream chỉ ghi token khi client đặt
  `stream_options.include_usage`: body không bị viết lại (pass-through), nên nếu không có thì
  dòng sử dụng ghi 0 token. Dòng sử dụng của proxy chỉ để đo đếm, không trừ credit.
- Chỉ body **lỗi** của nhà cung cấp được lọc khóa (`[redacted]`); body 2xx chuyển nguyên vẹn,
  không lọc.
- Hạn chót 15 giây chờ header chỉ áp cho lệnh gọi streaming và `GET` model; lệnh gọi không
  stream chỉ chịu tổng 10 phút vì nhà cung cấp trả header sau khi sinh xong.
- Phiên âm bằng model không báo thời lượng chỉ tính theo ước lượng từ dung lượng (xem Quyết
  định 5); tệp có bitrate rất khác điển hình có thể lệch.
- Route frame (`/office-frame/...`) chưa mount (xem Quyết định 9): chờ merge gốc GO-B2/B3.

## Trạng thái

`accepted` (2026-10-09, UNI-1008). Bổ sung phạm vi cho [0028](0028-ai-phia-client-cua-uniwork-office.md)
(Quyết định 5, frame web); không thay thế ADR nào và không sửa 0010.
