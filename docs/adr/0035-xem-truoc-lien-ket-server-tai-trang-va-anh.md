# 0035 — Xem trước liên kết: server tải trang và ảnh lúc tin được gửi, ảnh nằm trong kho UniWork

**Trạng thái:** accepted (2026-10-18) — chủ sản phẩm trả lời "Server tải và lưu cả ảnh" (quyết định 3 của spec R5, `docs/superpowers/specs/2026-10-18-unichat-r5-deferred-features-design.md` § F3).
**Issue:** UNI-1908 · **Parent:** UNI-1881 · **Liên quan:** [0008](0008-cach-ly-tenant-o-tang-service.md) (tenant), [0009](0009-audit-va-outbox-cung-transaction.md) (outbox cùng transaction), [0023](0023-file-theo-tenant-va-ngoai-le-avatar-ca-nhan.md) và [0024](0024-fileservice-so-huu-blob-intent-gc.md) (FileService), [0029](0029-ai-cua-office-tren-web-qua-ai-gateway.md) (rào SSRF của proxy BYOK — cùng cách làm).

## Bối cảnh

Canvas `WebMessageKinds` vẽ một thẻ dưới tin có liên kết: tên trang, tiêu đề, mô tả hai dòng
và ảnh 84 px. R3 hoãn thẻ này vì phải quyết định **ai** tải trang:

- (a) **máy người xem tự tải**: mỗi người đọc tin là một lần trang ngoài thấy IP, thời điểm
  đọc và trình duyệt của họ; CORS chặn phần lớn trang; mỗi máy tải lại một lần.
- (b) **server đọc chữ, ảnh lấy thẳng từ trang ngoài**: máy người xem vẫn gọi trang ngoài để
  lấy ảnh — đủ để làm pixel theo dõi.
- (c) **server tải trang và ảnh, ảnh lưu trong kho UniWork**: trang ngoài chỉ thấy server.

Chủ sản phẩm chọn (c) ngày 2026-10-18. Cái giá là server mở kết nối tới một URL do người dùng
gõ — bề mặt SSRF kinh điển: metadata cloud (`169.254.169.254`), Postgres / Redis / MinIO /
LiveKit nội bộ, API quản trị trên loopback (`127.0.0.1:18959` là chính API này khi chạy
local), mạng pod và dịch vụ trong VPC. Quyết định dưới đây là (c) cùng hàng rào cho bề mặt đó.

## Quyết định

1. **Khi nào tải.** Tin chữ (gửi thường hoặc trả lời thread) có URL http(s) thì trong **cùng
   transaction** tạo tin ghi một hàng outbox hạ tầng `chat.link_preview.requested`
   (`room_id`, `message_id`, `organization_id`; phạm vi none) qua `audit.Recorder.Emit` (0009).
   Consumer `chat_link_preview` chạy ở lane `slow` (`Dispatcher.RegisterLane`), **không bao giờ**
   lane realtime: việc chờ trang ngoài không đứng trước khung tin nhắn nào và gửi tin không chờ
   nó. Chỉ URL **đầu tiên** của tin, theo đúng biểu thức client dùng để tô liên kết
   (`chat-message-body.tsx`); thân sticker / GIF (`![](url)`) không tính. Sửa tin không tải lại.
2. **Một lần mỗi URL mỗi tổ chức.** Khóa là (`organization_id`, sha256 của URL chuẩn hóa:
   scheme và host chữ thường, bỏ phần `#`). Bảng `chat_link_previews` (trạng thái `ok` |
   `failed` | `blocked`, tiêu đề, mô tả, tên trang, `image_file_id`, `fetched_at`; unique index
   theo khóa) và `chat_message_link_previews` (tin → thẻ), cả hai có `organization_id`, query lọc
   theo tổ chức (0008). `ok` và `blocked` giữ nguyên — thẻ là ảnh chụp lúc gửi; `failed` được
   thử lại khi có tin mới cùng URL sau một giờ. Hai tổ chức không bao giờ dùng chung một hàng.
   Hàng do hệ thống ghi, không có `created_by`.
3. **Bộ tải `server/internal/linkpreview` là đường duy nhất server gọi URL người dùng gõ.**
   Hàng rào, theo thứ tự một request đi qua:
   - URL: chỉ `http` / `https`; cổng 80 hoặc 443 (mặc định hoặc ghi rõ); không userinfo.
   - DNS: mọi địa chỉ host phân giải ra phải công khai theo `netguard.AllowedIP`
     (`server/internal/emailhub/netguard`, dùng lại nguyên): IPv4 trừ `0/8`, `10/8`, CGNAT
     `100.64/10`, loopback `127/8`, link-local `169.254/16`, `172.16/12`, `192.0.0/24`,
     TEST-NET, `192.168/16`, benchmark `198.18/15`, multicast `224/4`, `240/4`; IPv6 chỉ
     `2000::/3` (nên ULA `fc00::/7`, link-local, multicast, `::1`, `::` đều bị loại), trừ
     Teredo, 6to4, tài liệu; NAT64 và IPv4-mapped xét theo IPv4 nằm bên trong. **Một** địa
     chỉ riêng trong tập trả lời là chặn cả host.
   - Quay số **thẳng tới IP đã kiểm** (không phân giải lại bằng tên), và `net.Dialer.Control`
     kiểm lại địa chỉ socket thật sự kết nối — chống DNS rebinding giữa lúc kiểm và lúc nối.
   - `Proxy: nil`: proxy môi trường sẽ quay số thay ta và đi vòng hàng rào.
   - Redirect: tối đa 3, mỗi bước kiểm lại như URL đầu (scheme, cổng, userinfo, rồi DNS và
     địa chỉ ở lần quay số).
   - Giới hạn: 5 s cho cả trang lẫn ảnh; header phản hồi ≤ 64 KiB; HTML chỉ đọc 1 MiB đầu
     (thẻ nằm trong `<head>`; phần sau không đọc); chỉ nhận `text/html`,
     `application/xhtml+xml` với mã 200.
   - Ảnh: ≤ 2 MiB (lớn hơn thì bỏ, không cắt); loại xét **từ byte** (sniff), chỉ JPEG, PNG,
     GIF, WebP — SVG và mọi thứ khác bị bỏ; ảnh đi qua cùng hàng rào; URL ảnh tương đối được
     giải theo URL cuối cùng sau redirect.
   - Không cookie jar, không `Authorization`, không giữ kết nối; `User-Agent` cố định
     `UniWorkLinkPreview/1.0 (+https://uniwork.vn)`, `Accept-Language: vi,en`.
   - Bảng mã: theo BOM, header, `<meta charset>`; không khai thì UTF-8 khi hợp lệ
     (`golang.org/x/net/html/charset`) — trang tiếng Việt cũ khai `windows-1258` vẫn đọc được.
   - Đọc: tiêu đề `og:title` → `twitter:title` → `<title>`; mô tả `og:description` →
     `twitter:description` → `description`; tên trang `og:site_name`, không có thì tên miền bỏ
     `www.`; ảnh `og:image` (và các biến thể). Gộp khoảng trắng, cắt 300 / 500 / 100 ký tự.
     Trang không có tiêu đề lẫn mô tả là `failed`.
4. **Ảnh nằm trong kho UniWork.** Purpose mới `chat_link_preview` (prefix
   `chat/link-previews`, chỉ tổ chức — thẻ dùng chung mọi phòng nên không gắn workspace; ≤ 2 MiB;
   ảnh; đọc bằng presign). Upload ngoài transaction, claim trong transaction ghi hàng thẻ (0024);
   FileService xác minh loại theo byte lần nữa. `ChatLinkPreviewImageProvider` giữ ảnh khi còn
   hàng thẻ; ảnh của lượt thua race được release cho bộ dọn rác.
5. **Đọc.** `GET /workspaces/{workspaceID}/chat/rooms/{roomID}/link-previews?message_ids=…`
   (tối đa 200 id) qua cổng `authorizeRoomRead`, như liên kết tin ↔ việc; chỉ trả thẻ `ok`; ảnh
   là URL presign ngắn hạn của kho UniWork. Client gom theo phòng và chỉ hỏi những tin có URL.
6. **Sự kiện.** Khi một tin được gắn thẻ `ok`, server phát `chat.message.preview_ready`
   (`room_id`, `message_id`), **ephemeral**, phạm vi chat (kênh mặc định: workspace), như
   `chat.message.updated`. Mất một khung chỉ làm thẻ hiện ở lần tải sau — đạt ngưỡng "losing it
   costs nobody anything" của `CLAUDE.md`. Client làm mới thẻ của phòng đó.
7. **Audit.** Thẻ là bộ đệm hạ tầng do hệ thống dựng, không phải trạng thái nghiệp vụ một
   người đổi: không có dòng `audit_events` và `audit_coverage_test.go` không thêm lệnh. Hàng
   outbox yêu cầu vẫn ghi cùng transaction với tin (0009); ảnh tải lên với actor hệ thống
   `chat-link-previews`.

### Quyền riêng tư: bên thứ ba thấy gì

- **Trang ngoài thấy**: request từ IP của server UniWork, `User-Agent` cố định, **một lần mỗi
  URL mỗi tổ chức** (cộng lần thử lại sau `failed`). Không cookie, không biết ai gửi, ai đọc,
  bao nhiêu người đọc, hay tổ chức nào — trừ khi chính URL mang dấu đó (token chia sẻ, tham số
  theo dõi).
- **Máy người xem** chỉ gọi API UniWork và kho UniWork (URL presign). Trang ngoài chỉ được gọi
  khi người đó tự bấm vào thẻ.
- **UniWork lưu**: URL (đã có trong tin), tiêu đề / mô tả / tên trang và ảnh công khai của
  trang, trong tổ chức của tin. Một URL bí mật (liên kết chia sẻ có token) được server mở một
  lần và tiêu đề của nó (thường là tên tài liệu) lưu trong tổ chức đã có URL đó — chấp nhận.

### Khi lỗi

| Tình huống | Kết quả |
| --- | --- |
| Hàng rào từ chối (scheme, cổng, userinfo, địa chỉ không công khai, redirect tới đó) | Không gửi byte nào tới đích; lưu `blocked`; không thẻ; không thử lại |
| DNS lỗi, quá 5 s, mã ≠ 200, không phải HTML, quá 3 redirect, không có tiêu đề / mô tả | Lưu `failed`; không thẻ; thử lại khi có tin mới cùng URL sau 1 giờ |
| Ảnh lỗi (quá 2 MiB, sai loại, bị chặn, không tải được, kho từ chối) | Thẻ vẫn có chữ, không ảnh |
| Lỗi DB hoặc kho khi ghi thẻ | Consumer trả lỗi, outbox thử lại theo lịch của nó |
| Tin đã xóa hoặc không còn URL khi consumer chạy | Bỏ qua, không lỗi |

### Ngoài phạm vi

Mobile (dùng cùng API, làm sau); bỏ thẻ khỏi một tin; thẻ cho URL thứ hai trở đi; tải lại khi
sửa tin; làm mới thẻ `ok` cũ; công tắc tắt theo tổ chức hay người dùng; oEmbed, video, trình
phát nhúng; trang chỉ hiện nội dung sau khi chạy JavaScript; tin chuyển tiếp (F1) và tin do AI
đăng (không tạo yêu cầu); xóa thẻ theo yêu cầu quyền riêng tư (bảng không nằm trong luồng xóa
dữ liệu cá nhân — thẻ không chứa dữ liệu của người gửi ngoài URL đã nằm trong tin).

## Phương án đã cân nhắc và loại

- **(a) Client tự tải** và **(b) ảnh lấy thẳng từ trang ngoài**: lộ người xem cho bên thứ ba
  (mục Bối cảnh); chủ sản phẩm loại.
- **Tải ngay trong request gửi tin**: gửi tin phải chờ tới 5 s một bên thứ ba; trái luật lane.
- **Consumer đọc `chat.message.created`**: đó là khung ephemeral, không qua outbox; và một
  consumer lane chậm trên một topic sẽ kéo cả topic xuống lane chậm. Một topic hạ tầng riêng
  không đụng đường đi của tin nhắn.
- **Dịch vụ unfurl bên ngoài (iframely, microlink)**: thêm một bên thứ ba thấy mọi URL của mọi
  tổ chức.
- **Viết lại bảng địa chỉ cấm**: `netguard` đã là danh sách *cho phép* có test (IPv6 chỉ
  `2000::/3`), chặt hơn danh sách cấm của proxy BYOK; dùng lại một nguồn.

## Hệ quả

- Server có thêm một đường ra Internet theo URL người dùng; mọi kết nối của nó đi qua hàng rào
  ở mục 3 và chỉ chạy trên lane chậm. Môi trường triển khai nên vẫn chặn egress tới mạng nội
  bộ ở tầng mạng — hàng rào trong code không thay cho lớp đó.
- Hai bảng tenant mới không có route nào ghi; `TestIsolationMatrix` liệt kê chúng trong
  `isoUnseeded` (chỉ consumer ghi, thế giới cách ly không chạy dispatcher), route đọc mới được
  ma trận phủ theo `roomID`.
- Ảnh thẻ chiếm kho của tổ chức (≤ 2 MiB mỗi URL khác nhau), không bao giờ bị xóa vì thẻ không
  bị xóa.
- `CLAUDE.md` không thêm luật: hàng rào là hành vi của một package và được giữ bằng test của
  chính nó (dưới đây), không phải một ranh giới import mà arch test kiểm được.

Test giữ quyết định:

- `server/internal/linkpreview/linkpreview_test.go` — `TestFetchRefusesBlockedAddressesWithoutDialling`
  (loopback, metadata, `::1`, IPv4-mapped, `10/8`, DNS trả địa chỉ riêng, tập trả lời lẫn,
  ULA, CGNAT, cổng, scheme, userinfo: không quay số, không request),
  `TestFetchRechecksEveryRedirect`, `TestFetchFollowsAtMostThreeRedirects`,
  `TestFetchRefusesWhatIsNotACard` (JSON, ảnh, 404, không thẻ, quá 1 MiB),
  `TestFetchDropsAnImageThatFailsACheck` (quá 2 MiB, SVG, host riêng, cổng),
  `TestFetchGivesUpAtTheDeadline`, `TestControlRefusesNonPublicAddresses`,
  `TestFetchReadsOpenGraphAndResolvesARelativeImage` (không Cookie, `User-Agent` cố định, quay
  số đúng IP đã kiểm), `TestFetchDecodesTheDeclaredCharset`.
- `server/internal/emailhub/netguard/netguard_test.go` — `TestAllowedIP`, bảng địa chỉ.
- `server/internal/service/chat_link_preview_test.go` — một lần mỗi URL mỗi tổ chức, giữ
  `blocked`, thử lại `failed` sau một giờ, cổng phòng, trần lô 200, ảnh được giữ.
- `scripts/events-catalogue.test.mjs` (hai topic mới), `TestIsolationMatrix`,
  `TestEveryFileIDColumnHasAReferenceSource`.

## Trạng thái

`accepted` (2026-10-18). Chủ sản phẩm chọn (c) "Server tải và lưu cả ảnh" trong spec R5; code
F3 (UNI-1908) xây theo quyết định này. Không thay thế ADR nào.
