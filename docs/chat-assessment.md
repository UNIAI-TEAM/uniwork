# Đánh giá chat: so với chuẩn hàng đầu và khả năng chịu tải

> **Ngày đánh giá:** 2026-10-09 · **Commit:** `5b5882b2`
> - **Đọc code:** 13 khía cạnh, mỗi phát hiện được kiểm chứng lại độc lập (mục 9).
> - **Đo tải:** chạy cục bộ, bộ sinh tải mô phỏng đúng hành vi của client web (mục 3).
> - Số dòng `path:line` đúng tại commit trên.

## 1. Kết luận ngắn

**Chat chưa đạt chuẩn hàng đầu.** Điểm tổng khoảng **3/10**, so với Slack, Teams, Discord (9–10) và Zalo (khoảng 8 với người dùng Việt). UniWork có một số điểm mạnh:
- bề rộng tính năng khá: 33/44 nhóm tính năng có ít nhất một phần;
- khả năng truy cập và tiếng Việt gần chuẩn quốc tế;
- cô lập tenant được kiểm bằng test cho mọi route chat;
- gửi tin idempotent.

Ba vấn đề gốc kéo điểm xuống:

1. **Mô hình đồng bộ không chịu được tải.**
   - Frame realtime chỉ mang id, nên client nhận frame phải tự gọi lại API.
   - Số tin chưa đọc được tính lại bằng cách quét tin nhắn mỗi lần tải sidebar.
   - Sự kiện "đã đọc" và "đang gõ" của mọi kênh phát ra cả workspace.

   Số đo trên server build từ commit này:
   - **Kênh chung:** mỗi tin tốn khoảng **2 request và 13 truy vấn DB cho mỗi người đang mở trang chat**. Trên pod production (0,5 CPU), trần ước tính khoảng **1–2 tin/giây khi 100 người mở chat**, dưới 1,5 tin/giây khi 200 người, và **chưa tới 1 tin/giây khi 800 người**.
   - **Kênh 1.000 thành viên** (không phải kênh mặc định): mỗi lần gửi mất **khoảng 3 giây**, vì server ghi Redis đồng bộ cho từng thành viên. Tin có `@all` mất khoảng 5 giây.
   - **Sidebar của người ở 300 phòng:** **1,4 giây và khoảng 1.250 truy vấn mỗi lần tải**.
   - **Đổi phòng:** khi 50 người đổi phòng, mỗi lần đánh dấu "đã đọc" làm mọi trang chat khác tải lại sidebar. Kết quả là 2.856 lần tải sidebar mỗi phút, và tin hiện trên màn hình p95 7,7 giây.
   - **Đợt mở app lúc 9 giờ:** 100 người mở trang chat trong một phút làm server mất **2 phút** mới ổn định và dùng **576 MB RAM**; 200 người dùng 1,5 GB. Pod production giới hạn 512 MiB, nên sẽ bị OOMKill và kéo theo toàn bộ API.
2. **Một thành viên có thể làm sập backend.** Một pod duy nhất chạy API, mọi WebSocket và worker. Có ít nhất sáu đường để một người, cố ý hay vô tình, làm process chết hoặc treo:
   - client mạng chậm cộng ping làm server panic (C1);
   - poll 1 MiB không giới hạn số lựa chọn (C6);
   - vài file 25 MiB tải lên cùng lúc (C7);
   - `call_id` dài tùy ý (C8);
   - frame subscribe không giới hạn (C9);
   - mời 1.000 người vào nhóm trong một lần (C10).
3. **Tin nhắn và trạng thái không đáng tin.**
   - Cuộn lên xem lịch sử thì bỏ sót tin (đo được 9,5% ở phòng 7 tin/giây).
   - Reaction và phiếu bầu đồng thời ghi đè lên nhau.
   - Gửi file Word và Excel luôn lỗi kể từ ngày 07/10.
   - Huy hiệu chưa đọc sai.
   - DM và lượt nhắc đến không tạo thông báo bền: không inbox, không push, không email. Ai không đang mở trang chat sẽ bỏ lỡ.

**Ngưỡng an toàn hiện tại.** Ước tính từ số đo, cần xác nhận trên staging:
- tổ chức có vài chục người cùng mở chat;
- kênh chung vài tin mỗi phút;
- nhóm dưới vài chục người;
- mỗi người dưới khoảng 100 phòng.

Vượt các ngưỡng sau thì độ trễ lên hàng giây và pool DB cạn:
- **khoảng 50–100 người mở trang chat cùng lúc**;
- kênh **trên khoảng 200 thành viên** có trao đổi sôi nổi;
- một đợt nhiều người mở app trong cùng một phút.

Vì dùng chung pod, cả API của Công việc, Cuộc họp và Tài liệu cũng chậm theo.

**Sửa gì trước (mục 7).** Nhóm thay đổi đầu tiên phần lớn nằm ở client và cách định tuyến sự kiện, nên nhỏ và nhanh:
- bỏ việc tải lại sidebar khi người khác đọc;
- chỉ GET lại tin khi phòng đang được tải;
- bỏ GET liên kết theo từng tin.

Phép đo cho thấy nhóm này giảm 86–94% chi phí mỗi tin. Cộng thêm vá panic, giới hạn kích thước đầu vào, upload dạng stream và `GOMEMLIMIT`, ta loại được các đường làm sập pod. Phần còn lại để lên chuẩn hàng đầu là đổi mô hình đồng bộ (frame mang nội dung, bộ đếm lưu sẵn, số thứ tự để nối lại) và bổ sung thông báo, tìm kiếm, ứng dụng mobile.

## 2. Bảng điểm theo khía cạnh

| Khía cạnh | Điểm/10 | Lý do chính |
|---|---|---|
| Đường gửi tin | 3,5 | **Tốt:** idempotent, publish sau commit, media và thread nằm trong transaction. **Chưa tốt:** fan-out đồng bộ theo từng thành viên, gửi không atomic, JSONB bị ghi đè. |
| Đường đọc (lịch sử, sidebar, tìm kiếm) | 3 | **Tốt:** phân trang keyset, không N+1 trong trang lịch sử. **Chưa tốt:** sidebar N+1 kèm quét 500 tin mỗi phòng; cursor bỏ sót tin; tìm kiếm không index, không bỏ dấu. |
| Realtime phía server | 3 | **Tốt:** fan-out rẻ, có trần 25 scope. **Chưa tốt:** panic khi loại client chậm, không giới hạn frame gửi lên, sự kiện kênh phát ra cả workspace, quyền không bị thu hồi. |
| Realtime phía client | 3 | **Tốt:** outbox và dedupe. **Chưa tốt:** mỗi frame thành một GET cho mỗi người; sidebar tải lại theo mọi hoạt động và mọi lần "đã đọc"; không phát hiện mất tin. |
| Hiệu năng hiển thị | 4 | **Tốt:** ảo hóa danh sách, tải lười, xử lý IME tiếng Việt. **Chưa tốt:** memo hàng tin bị phá; ảnh tải ở kích thước gốc; bundle gấp 5 lần ngưỡng. |
| Rate limit và chống lạm dụng | 3 | **Tốt:** limiter tốt cho typing và presence. **Chưa tốt:** gửi tin vẫn tính theo IP; reaction, ghim, bỏ phiếu, mời không có limiter riêng; nhiều giới hạn chỉ có ở client. |
| Bảo mật và cô lập | 4 | **Tốt:** ma trận isolation phủ mọi route, render an toàn XSS. **Chưa tốt:** không thu hồi quyền realtime; metadata kênh riêng tư phát ra cả workspace; đồng bộ thread làm lộ phòng riêng tư. |
| Mô hình dữ liệu | 3 | **Tốt:** mỗi tin một dòng, tenant đầy đủ. **Chưa tốt:** bộ đếm không lưu sẵn, JSONB bị ghi đè, không có index tìm kiếm, không có retention, nhóm từ 99 người không tạo được. |
| Media và tích hợp | 3,5 | **Tốt:** FileService. **Chưa tốt:** upload giữ ba bản trong RAM, ảnh đi qua pod, `.docx`/`.xlsx` bị từ chối, tóm tắt AI chọn sai cửa sổ. |
| Thông báo và chưa đọc | 2,5 | Lượt nhắc đến và DM không bền, push đang tắt, huy hiệu sai, nhắc việc không chạy. |
| Tính năng so với Slack, Teams, Zalo | 4 | 33/44 nhóm có ít nhất một phần. Thiếu định dạng tin, chuyển tiếp, tìm toàn workspace, app mobile, thông báo. |
| Vận hành, quan sát, kiểm thử | 3 | **Tốt:** có metric và alert chung. **Chưa tốt:** chưa từng chạy load test chat; readiness phụ thuộc Redis và S3; không drain khi deploy; không có SLO cho chat. |
| Tính đúng và tương tranh | 3,5 | **Tốt:** idempotent, unique index. **Chưa tốt:** cursor, JSONB, lỗ hổng timeline, quyền thành viên. |
| **Tổng thể** | **3** | Nền móng đúng hướng, nhưng chưa chịu được tải và chưa đạt độ tin cậy của sản phẩm hàng đầu. |

## 3. Số đo tải

### 3.1 Cách đo

- **Server.** Build từ `5b5882b2` (`server/cmd/server`), chạy `GOMAXPROCS=1`: một nhân, gấp đôi giới hạn 500m của pod production. Postgres 16 và Redis 7 chạy trong VM colima 4 vCPU, nối qua SSH port-forward, trên MacBook i7-8850H. Vì vậy số ms tuyệt đối là bi quan. Những số mang sang production được là các số đếm (request, truy vấn, lệnh Redis) và CPU server tính bằng ms cho mỗi tin.
- **Dữ liệu.**
  - Một tổ chức 1.200 thành viên, kênh mặc định gồm cả 1.200 người.
  - Ba kênh thử: 20, 200 và 1.000 người.
  - 60 nhóm 5–20 người, 200 DM.
  - Một phòng 200.000 tin trải trên 180 ngày.
  - Một người dùng ở 300 phòng, 217 phòng còn tin chưa đọc, 56 lần được nhắc đến.
- **Bộ sinh tải.** Viết bằng Go, mở WebSocket đúng như client web: handshake `GET /api/v1/ws`, frame `auth` đầu tiên, subscribe lười tối đa 25 phòng, ping mỗi 25 s.
- **Chế độ mô phỏng client.** Bộ sinh tải làm đúng những gì client web làm khi nhận frame:
  - GET lại tin theo id sau 250 ms (`packages/core/realtime/chat-realtime-patch-scheduler.ts`).
  - GET liên kết cho phòng đang mở.
  - Tải lại `GET /chat/rooms` khi có `chat.room.activity` (qua bộ gộp 250 ms), và ngay lập tức khi có `chat.room.read` của người khác (`packages/core/chat/use-chat-room-read-sync.ts`).
  - Chạy chuỗi request khi tải trang chat, gồm cả `POST /chat/room`.
- **"Trần ở 0,5 CPU"** bằng 500 ms CPU mỗi giây chia cho CPU server mỗi tin, sau khi trừ mức nền. Con số này chưa tính giới hạn DB. Trong thực tế, pool 20 kết nối thường cạn trước CPU.
- **Các trần trong mục này là giới hạn trên.**
  - Bộ sinh tải chỉ mô phỏng người đang mở trang chat, mỗi người một tab.
  - Trong code thật, mọi tab mở ở bất kỳ trang nào của workspace cũng làm hai việc (`dashboard-layout.tsx:56-59`): GET lại tin của kênh mặc định, và tải lại sidebar khi có `chat.room.activity`.
  - Người dùng thật hay mở nhiều tab và ở các trang khác ngoài chat, nên sức chịu thực tế còn thấp hơn số trong bảng.

### 3.2 Kết quả

**A. Fan-out thuần, không mô phỏng client, 1 tin/giây**

| Phòng | Socket | POST gửi p50 / p95 | CPU mỗi tin | Lệnh Redis mỗi tin | Trần ở 0,5 CPU |
|---|---|---|---|---|---|
| Kênh 20 người | 20 | 48 / 69 ms | 7 ms | 85 | ~68 tin/s |
| Kênh 200 người | 200 | 310 / 903 ms | 56 ms | 789 | ~9 tin/s |
| Kênh 1.000 người | 1.000 | 2.904 / 3.271 ms | 199 ms | 2.790 | ~2,4 tin/s |
| Kênh 1.000 người, tin có `@all` (0,2 tin/s) | 1.000 | 5.157 / 5.583 ms | 491 ms | 4.941 | ~1 tin/s |
| Kênh mặc định 1.200 người | 1.000 | 75 / 182 ms | 20 ms | không đáng kể | ~23 tin/s |

Mọi tin tới đủ mọi socket (60.000/60.000 frame), frame p50 25–70 ms. Bản thân hub fan-out rẻ. Phần đắt là vòng `SendToUser` theo từng thành viên chạy ngay trong request gửi (C4).

**B. Mô phỏng client trên kênh mặc định, 0,5 tin/giây**

| Người mở trang chat | Request mỗi tin | Truy vấn DB mỗi tin | CPU mỗi tin | Lần chờ pool DB trong 60 s | Tin hiện trên màn hình, p95 | Trần ở 0,5 CPU |
|---|---|---|---|---|---|---|
| 10 | 22 | 140 | 23 ms | 0 | 349 ms | ~21 tin/s |
| 25 | 55 | 345 | 51 ms | 6.434 | 342 ms | ~10 tin/s |
| 50 | 106 | 673 | 93 ms | 18.343 (cộng dồn 73 s) | 385 ms | ~5 tin/s |
| 100 | 203 | 1.315 | 152 ms | 38.496 (cộng dồn 438 s) | 443 ms | ~3 tin/s |
| 200 | 406 | 2.622 | 334 ms | 77.886 (cộng dồn 2.695 s) | 726 ms | ~1,4 tin/s |

Chi phí tăng tuyến tính theo số người mở chat: mỗi người thêm khoảng 2 request và 13 truy vấn cho mỗi tin. Ngoại suy cho 800 người: khoảng 1.600 request, 10.500 truy vấn và 1,3 s CPU mỗi tin, tức trần dưới 0,5 tin/giây.

Điểm gãy đo trực tiếp với 100 người, trên một nhân:

| Tốc độ gửi | POST gửi p50 / p95 | Tin hiện trên màn hình p50 / p95 |
|---|---|---|
| 0,5 tin/s | 31 / 41 ms | 393 / 443 ms |
| 2 tin/s | 143 / 304 ms | 529 / 802 ms |
| 4 tin/s | 903 / 1.955 ms | 1.702 / 3.336 ms |

Pod production chỉ có nửa nhân, nên điểm gãy ở đó vào khoảng 1–2 tin/giây.

**C. Chi phí đến từ đâu: 50 người trên kênh mặc định, 0,5 tin/giây**

| Biến thể client | Request mỗi tin | Truy vấn mỗi tin | CPU mỗi tin | Trần ở 0,5 CPU |
|---|---|---|---|---|
| Như hiện tại | 106 | 673 | 93 ms | ~5 tin/s |
| Bỏ GET lại tin theo id | 56 | 323 | 51 ms | ~10 tin/s |
| Bỏ GET liên kết theo từng tin | 56 | 373 | 56 ms | ~9 tin/s |
| Bỏ cả hai | 6 | 22 | 13 ms | ~37 tin/s |

Với phòng nhóm (100 người, 60 nhóm, 1 tin/giây), bỏ các lệnh refetch thì CPU mỗi tin còn 8,7 ms, trần khoảng 56 tin/s. Gần như toàn bộ chi phí là do client gọi lại API sau mỗi frame, không phải do bản thân việc gửi tin.

**D. Phòng nhóm (60 nhóm khoảng 6 người), mô phỏng client**

| Người online | Tốc độ gửi tổng | POST gửi p50 / p95 | Tin hiện trên màn hình p95 | CPU mỗi tin | Truy vấn mỗi tin |
|---|---|---|---|---|---|
| 50 | 1 tin/s | 45 / 66 ms | 304 ms | 25 ms | 61 |
| 100 | 1 tin/s | 50 / 76 ms | 316 ms | 33 ms | 96 |
| 200 | 1 tin/s | 73 / 96 ms | 329 ms | 57 ms | 177 |
| 200 | 4 tin/s | 235 / 443 ms | 573 ms | 113 ms | 172 |
| 200 | 8 tin/s | 4.231 / 7.513 ms | 10.946 ms | 99 ms | 166 |

Trên một nhân, điểm gãy nằm giữa 4 và 8 tin/giây. Trên pod nửa nhân là khoảng 2–4 tin/giây cho toàn tổ chức. Một nhóm 300 người, mỗi phòng 1 tin/10 s (S2), đã vượt mức này.

**E. Sidebar (`GET /chat/rooms`)**

| Số phòng của người dùng | p50 | p95 | Truy vấn mỗi lần | CPU mỗi lần | Dung lượng |
|---|---|---|---|---|---|
| 20 | 98 ms | 164 ms | 97 | 16,5 ms | 15 KB |
| 100 | 434 ms | 508 ms | 422 | 54,5 ms | 68 KB |
| 300 | 1.452 ms | 2.158 ms | 1.254 | 184 ms | 211 KB |
| 300, 20 người tải cùng lúc | 5.473 ms | 6.541 ms | 1.220 | 161 ms | 211 KB |

**F. Chuyển phòng.** 50 người trên kênh mặc định, mỗi người đổi phòng một lần. 78 lần đánh dấu "đã đọc" sinh ra **2.856 lần `GET /chat/rooms`** trong 60 giây (41,6/s), p50 4,8 s, p95 10,1 s. Trong lúc đó, gửi tin p95 3,8 s và tin hiện trên màn hình p95 7,7 s.

**G. Đợt mở app lúc 9 giờ (chưa ai gửi tin)**

| Số người mở trang chat trong 60 s | Thời gian đến khi mọi client sẵn sàng | `GET /chat/rooms` | Sidebar p50 | Subscription lỗi, không được retry | RSS server |
|---|---|---|---|---|---|
| 100 | 124 s (p50 84 s) | 5.566 | 36,6 s | 125 trên 41 socket | 576 MB |
| 200 | 191 s (p50 123 s) | 25.717 (23.997 timeout) | 23,2 s | 121 trên 37 socket | 1,5 GB |

Pod production giới hạn 512 MiB, nên cả hai mức trên sẽ bị **OOMKill**. Socket có subscription lỗi `lookup_failed` không nhận tin của phòng đó cho tới lần kết nối lại sau.

**H. Server khởi động lại giữa chừng (giống một lần deploy).** Với 50 và 100 người, mọi socket kết nối lại và subscribe lại sau 2,9 và 3,6 giây. Tin đầu tiên sau restart tới đủ mọi người trong 5 giây. 50 và 100 request đang chạy dở bị lỗi mạng. Ở quy mô này chưa có bão request. Bão xuất hiện khi người dùng chuyển phòng (F) hoặc mở app đồng loạt (G).

**I. Văn phòng dùng chung một IP (50 người).**
- Gửi tổng 1 tin/giây: không có lỗi.
- Gửi tổng 3 tin/giây: 175 lần 429 ở `POST /messages`, **56/181 tin (31%) thất bại sau khi client đã retry**, typing bị 429 60 lần.
- Cùng tải đó nhưng mỗi người một IP: không có lỗi.

**J. Tính đúng.**
- Phòng nhận 7 tin/giây trong 60 giây, cuộn lên bằng đúng cursor của client: timeline bỏ sót **40/420 tin (9,5%)**, bản tin (bulletin) bỏ sót 20/420 (4,8%).
- Mọi lần chạy khác: 0 tin trùng. Không mất tin nào qua WebSocket khi socket đã subscribe thành công.

### 3.3 Ước tính cho production

Production chạy 1 pod, 0,5 CPU, 512 MiB, pool 20 kết nối, và pod này dùng chung cho mọi tính năng chứ không riêng chat. Các ước tính dưới đây lấy từ bảng B, D, E, G và chưa có kiểm chứng trên staging.

| Tình huống | Chịu được hiện tại | Dấu hiệu khi vượt |
|---|---|---|
| Kênh chung, nhiều người cùng mở chat | khoảng 100 người × 1–2 tin/s, hoặc 200 người × dưới 1 tin/s | pool DB cạn, tin hiện chậm vài giây, API khác chậm theo |
| Nhóm nhỏ trong toàn tổ chức | khoảng 2–4 tin/s tổng | gửi tin vài giây, sidebar chậm |
| Kênh trên 200 thành viên (không phải kênh mặc định) | dưới 9 tin/s; 1.000 người chỉ 2 tin/s, mỗi lần gửi mất khoảng 3 s | người gửi chờ lâu |
| Người dùng nhiều phòng | dưới khoảng 100 phòng | sidebar trên 1 s, mỗi lần tải 400–1.250 truy vấn |
| Mở app đồng loạt | dưới khoảng 50 người trong 1 phút | 100 người: RSS 576 MB, có thể OOMKill |

## 4. Điểm đã làm tốt

- **Gửi tin idempotent từ đầu đến cuối.**
  - Unique index một phần `(room_id, sender_id, client_msg_id)` (`server/migrations/151_chat_messages_client_msg_id_uidx.up.sql`). Server kiểm tra trước khi insert, và khi trùng thì trả lại dòng của bên thắng (`server/internal/service/chat.go:475-519`). Thread reply và media làm giống vậy (`chat_threads.go:150-191`, `chat_media_message.go:163-221`).
  - Client giữ outbox bền 24 giờ theo từng người gửi, retry có giới hạn và giữ nguyên khóa (`packages/core/chat/send-outbox-store.ts`, `send-retry.ts`).
  - Đo được: 0 tin trùng trong mọi lần chạy.
- **Publish realtime luôn sau commit.** Người nhận không bao giờ thấy tin bị rollback. Xóa tin, gửi media và thread reply đều nằm trong transaction (`chat_actions.go:66-98`, `chat_threads.go:260-276`, `chat_media_message.go:174-224`).
- **Fan-out của hub rẻ và không chặn.**
  - Marshal một lần, enqueue non-blocking, client chậm bị tách khỏi vòng lặp (`server/internal/realtime/publisher.go:108-116`, `hub.go:583-612`).
  - Đo được: 1.000 socket nhận đủ 60.000/60.000 frame, p99 dưới 250 ms. 800 socket p99 72 ms. Mỗi tin trên kênh mặc định chỉ tốn 20 ms CPU khi không có client gọi lại.
- **Subscribe lười, có trần.** Mỗi socket giữ tối đa 25 phòng (phòng đang mở, rồi phòng chưa đọc, rồi phòng gần đây). Client chỉ subscribe phần chênh lệch và subscribe lại sau khi kết nối lại (`packages/core/chat/lazy-chat-scopes.ts`, `packages/core/realtime/use-chat-room-scopes.ts`, `packages/core/api/ws-client.ts:232-237`).
- **Handshake WebSocket chắc chắn.**
  - Token đi trong frame đầu, không nằm trong URL.
  - Có allowlist `Origin` và giới hạn 64 KiB trước bước xác thực.
  - Keepalive 25 s cả hai chiều, chịu được việc load balancer cắt kết nối rỗi (`hub.go:194-227, 787-870, 1131-1159`).
  - Client kết nối lại theo backoff có jitter (`ws-client.ts:11-17, 196-213`).
- **Cô lập tenant được kiểm bằng test cho mọi route chat.**
  - `TestIsolationMatrix` tự tấn công mọi route chat có tham số tenant, mọi id trong body và scope WebSocket (`server/internal/handler/isolation_matrix_test.go:540-615`, `isolation_references_test.go`, `isolation_realtime_test.go`).
  - Mọi query chat có ràng buộc tenant hoặc dòng `-- tenant:`.
- **Render an toàn và upload sạch.**
  - Không dùng `dangerouslySetInnerHTML`, chỉ linkify `http(s)` (`packages/views/chat/chat-message-body.tsx`).
  - Kiểu file xác định từ nội dung byte, không theo tên file. Không cho SVG hay HTML. Response có `nosniff` và `Content-Disposition: attachment` (`server/internal/files/detect.go`, `registry.go:177`, `handler/chat_file_message.go:278-284`).
  - Access token chỉ nằm trong bộ nhớ.
- **Phân trang keyset.** Dùng `(room_id, created_at)`, mỗi trang tối đa 100 tin, không có N+1 trong trang lịch sử (`chat.sql:44-69`, migration 049). Đo được: 8–10 ms mỗi trang trong phòng 200.000 tin. Lỗi bỏ sót tin ở H2 nằm ở định dạng cursor, không phải ở thiết kế này.
- **Presence và typing thiết kế đúng.**
  - Presence là trạng thái lưu trong Redis, chỉ phát khi đổi (`chat_presence.go`).
  - Typing được giới hạn 2 s cho mỗi người mỗi phòng (`chat_typing_throttle.go`).
  - Limiter cho typing và presence tính theo người dùng đã xác thực, nên chịu được NAT (`router.go:152-154`).
- **Limiter nền tảng tốt.** `INCR+EXPIRE` trong một Lua script, deadline 100 ms, có trần số lệnh đang chạy, và fail-open khi Redis có vấn đề (`server/internal/middleware/ratelimit.go`).
- **Client có nền tốt.**
  - Timeline và sidebar được ảo hóa.
  - LiveKit và bộ chọn emoji chỉ tải khi cần.
  - Draft nằm trong store riêng nên gõ phím không render lại cả trang.
  - Xử lý IME tiếng Việt để không gửi đôi (`chat-composer.tsx:318-323`).
  - Có live region cho trình đọc màn hình, có RUM đo INP.
- **Nền tảng thông báo chung đã có:** inbox, lane push, digest theo múi giờ, ma trận tùy chọn. Chat chỉ chưa nối vào (H1).

## 5. Điểm nghẽn và rủi ro

Xếp theo mức độ sau kiểm chứng. Mỗi mục ghi trạng thái: **đã đo** (có số đo ở mục 3), **đã xác minh** (người kiểm chứng đọc lại code hoặc tái hiện được), hoặc **ước tính**.

### Nghiêm trọng (critical)

**C1. Một client mạng chậm có thể làm sập cả backend.** Trạng thái: **đã xác minh**. Hai người kiểm chứng tái hiện được crash thật của process, 5/5 lần, với frame chỉ mang id cỡ 200 byte; tôi đã đọc lại code.
- Cơ chế:
  - Khi hàng đợi 256 frame của một socket đầy, `evictSlow` đóng `c.send` nhưng không đóng kết nối (`server/internal/realtime/hub.go:704-737`).
  - `readPump` vẫn đọc frame gửi lên (`hub.go:961-995`). Ping mỗi 25 s của client đi tới `sendJSON` (`hub.go:1024-1025`).
  - `sendJSON` ghi vào channel đã đóng trong một `select`. Ghi vào channel đã đóng gây panic ngay cả trong `select` (`hub.go:1113-1124`).
  - Hai pump là goroutine trần (`hub.go:945-946`). Không có `recover()` nào trong `server/internal/realtime` hay `server/cmd/server`.
- Kịch bản:
  - Socket có chiều tải xuống bị nghẽn (4G yếu, proxy kiểm tra) nhưng chiều lên vẫn gửi ping. Laptop ngủ không gây lỗi, vì khi đó cả hai chiều đều chết.
  - Khi pod bị nghẽn CPU, nhiều socket bị loại cùng lúc, nên khả năng crash trong một đợt như vậy tiến gần 1 kể cả khi không ai cố ý.
  - Một thành viên cố ý: mở socket, ngừng đọc, tiếp tục gửi frame. Chính tin của người đó phát ra workspace cũng đủ làm đầy hàng đợi.
- Tác động:
  - Process thoát. Mọi WebSocket, mọi request đang xử lý, outbox và khoảng 15 worker trên pod duy nhất chết theo, với mọi tenant.
  - Pod khởi động lại kèm một đợt kết nối lại.
  - Người cố ý có thể lặp lại sau mỗi lần restart, gần như chắc chắn thành công.
- Cách sửa:
  - `sendJSON` kiểm tra client còn đăng ký (dưới `hub.mu.RLock` hoặc qua cờ `closed`).
  - `evictSlow` gọi `c.conn.Close()`.
  - Thêm `defer recover()` trong hai pump.
  - Thêm test tái hiện với socket thật.

**C2. Mỗi tin nhắn khiến mọi người nhận gọi lại API, và sự kiện của kênh phát ra cả workspace.** Trạng thái: **đã đo** (bảng B, C).
- Cơ chế:
  - Frame chỉ mang id (`server/internal/outbox/catalogue.go:173-175`). Client trên mọi trang, kể cả khi chưa mở phòng đó, gọi `GET /messages/{id}` cho từng tin sau 250 ms (`packages/core/realtime/use-realtime-sync.ts:377-399`, `chat-realtime-patch-scheduler.ts:45-49`, `packages/core/chat/realtime-cache.ts:185`). Mỗi lần GET tốn 6–7 truy vấn (`chat.go:308-330`, `chat_rooms.go:511-537`, `desktop_auth.go:599`).
  - Phòng đang mở còn gọi thêm `GET /message-links` cho mỗi tin (`link-hooks.ts:57-79`).
  - Trang Cuộc họp gắn `useWorkspaceEvents` lần thứ hai, nên mỗi frame thành hai lần GET (`meetings-page-view.tsx:59`, `meeting-detail-view.tsx:61`, `room-view.tsx:108`).
  - Kênh mặc định phát `chat.message.created` ra workspace (`chat_voice_message.go:229-231`).
  - Với mọi kênh, kể cả kênh riêng tư, các sự kiện sửa, xóa, reaction, ghim, poll, ghi chú, bài đăng, nhắc việc, typing và "đã đọc" đều đi qua `Publish(workspace)` (`chat_actions.go:112-113,173-174`, `chat_poll.go:213-214`, `chat_signal.go:131-133,171-173`). Trong khi đó catalogue khai báo các sự kiện này là `ScopeChat`.
- Tác động:
  - Mỗi người mở chat thêm khoảng 2 request, 13 truy vấn và 1,5 ms CPU cho mỗi tin.
  - Mỗi lần GET gọi lại tốn khoảng 0,7 ms CPU, nên pod 0,5 CPU chỉ phục vụ được khoảng 650 lần GET mỗi giây khi không làm gì khác.
  - Kênh chung có 800 người online bão hòa ở khoảng **0,4–0,8 tin/s**. Ở S1 (2 tin/s), pod cần khoảng 1,5 s CPU mỗi giây, gấp ba hạn mức.
  - Reaction, ghim và sửa tin trong kênh làm pod bão hòa ở khoảng 650/N_online sự kiện mỗi giây, tức 0,8/s khi có 800 người online.
  - Metadata của kênh riêng tư lộ cho mọi người trong workspace: ai đang gõ, ai đã đọc, id tin bị sửa hoặc xóa. Nội dung tin không lộ, vì lệnh GET của người ngoài kênh nhận 404. Lỗi 404 đó còn làm hỏng cả lô cập nhật sidebar đang chờ.
- Lưu ý: kênh mặc định phát ra workspace là đúng thiết kế, vì thành viên của nó là cả workspace. Phần định tuyến sai chỉ nằm ở các kênh không phải mặc định. Vì vậy, để giảm tải ở S1 thì phải sửa bước 2 và bước 4 bên dưới, không chỉ sửa định tuyến.
- Cách sửa:
  1. Gỡ `useWorkspaceEvents` thừa ở ba view Cuộc họp.
  2. Chỉ GET khi danh sách tin của phòng đã có trong cache. Gộp nhiều id vào một request, dùng `Promise.allSettled` và thêm jitter.
  3. Định tuyến mọi sự kiện của kênh về `chat:{room}`. Với kênh công khai, cho người chưa tham gia subscribe để đọc.
  4. Dài hạn: đưa nội dung tin, hoặc phần thay đổi, vào frame gửi tới scope đã cấp quyền, theo mô hình Slack và Discord. Việc này cần một ADR giống ADR 0015.
- Lợi ích đo được: bỏ hai lệnh GET thì request giảm 94% và CPU mỗi tin giảm 86% (bảng C).

**C3. Sidebar tính lại mọi huy hiệu bằng N+1 truy vấn, và bị tải lại sau mỗi hoạt động hoặc mỗi lần "đã đọc" của người khác.** Trạng thái: **đã đo** (bảng E, F, G).
- Cơ chế:
  - Kênh mặc định quét 500 tin hai lần (`chat_rooms.go:62-91,164-195`, `chat_mentions.go:169-202`).
  - Mỗi DM, nhóm và kênh gọi `roomSummary` tuần tự: lấy danh sách id thành viên, quét 500 tin để đếm lượt nhắc đến, rồi lấy profile người kia (`chat_rooms.go:113-160,567-617`).
  - `COUNT(*)` tin chưa đọc không có giới hạn (`chat.sql:199-210,335-346`).
  - Đo được đúng 4,2 truy vấn và khoảng 0,6 ms CPU cho mỗi phòng, ở mỗi lần gọi.
- Vòng khuếch đại:
  - Client tải lại sidebar sau mỗi `chat.room.activity` (`chat-realtime-patch-scheduler.ts:52-54`).
  - Client tải lại **ngay lập tức** khi có `chat.room.read` của người khác (`use-chat-room-read-sync.ts:21-37`). Sự kiện "đã đọc" của mọi kênh phát ra workspace (`chat_signal.go:171-173`), và mỗi lần đổi phòng phát hai sự kiện như vậy (`use-chat-catch-up-ui.ts:84-94`).
  - Query sidebar được giữ trên mọi trang qua `ChatVoiceCallHost` (`chat-voice-call-host.tsx:51`).
  - `invalidateQueries` hủy request cũ rồi gọi request mới, nhưng server vẫn chạy request cũ vì client không truyền AbortSignal (`chat-rooms.ts:20-26`).
  - Kết quả: U người mở trang chat sinh ra khoảng U²/2 lần tải sidebar.
- Số đo:
  - Người ở 300 phòng: 1,45 s và 1.254 truy vấn mỗi lần tải.
  - 50 người đổi phòng: 2.856 lần tải sidebar mỗi phút. Server dùng 60% CPU, tin hiện trên màn hình p95 7,7 s. Bỏ riêng việc tải lại khi người khác đọc thì CPU còn 6% và p95 còn 0,39 s.
- Sức chịu, theo người kiểm chứng: mỗi lần tải sidebar tốn 15–60 ms CPU, nên pod chỉ phục vụ được khoảng **10–20 lần tải mỗi giây**. Các tình huống sau đã vượt mức đó:
  - khoảng 50–60 người đang mở chat, mỗi người đổi phòng một lần mỗi phút;
  - một kênh không mặc định có 200 người online, nhắn từ 0,1 tin/s;
  - S2.
- Phải sửa cả hai phía. Chỉ giảm chi phí mỗi lần tải thì S3 với 500 người vẫn vượt khoảng 4 lần. Chỉ chặn sự kiện "đã đọc" thì kênh không mặc định và S2 vẫn vượt.
- Cách sửa:
  1. Client không tải lại sidebar khi người khác đọc; với DM chỉ cập nhật `peer_last_read_at` cục bộ. Server chỉ gửi "đã đọc" cho chính người đọc và người kia trong DM, và chỉ khi con trỏ thật sự tiến.
  2. Mọi invalidation của sidebar đi qua scheduler với `cancelRefetch: false`, và truyền AbortSignal.
  3. Bỏ N+1: tính lượt nhắc đến và profile người kia ngay trong truy vấn danh sách (LATERAL), giới hạn COUNT ở "99+", bỏ `member_user_ids`.
  4. Dài hạn: lưu sẵn bộ đếm (tổng tin của phòng, số đã đọc và số lượt nhắc đến của từng thành viên), cập nhật trong transaction gửi, và đẩy phần thay đổi qua frame.
- Lưu ý: sửa (1) xong thì huy hiệu kênh mặc định sẽ đứng yên hẳn (H6), nên phải sửa H6 cùng lúc.

**C4. Fan-out theo từng thành viên chạy đồng bộ trong request gửi, không có giới hạn; ai cũng dùng được `@all`.** Trạng thái: **đã đo** (bảng A).
- Cơ chế:
  - Mỗi tin trong DM, nhóm hay kênh không mặc định gọi `publishChatRoomActivity`. Hàm này đọc mọi id thành viên, kể cả người offline, rồi gọi `SendToUser` cho từng người (`chat_org.go:41-64`, `chat_voice_message.go:233-234`).
  - Mỗi lần gọi là một lần marshal và một lần XADD+EXPIRE đồng bộ tới Redis (`redis_relay.go:286-311,638-667`), tất cả chạy trước khi trả response (`chat.go:551-553`).
  - `@all` không kiểm tra vai trò hay kích thước phòng, lưu cả danh sách id vào metadata (khoảng 29 KB cho 1.000 người) và chạy thêm một vòng như trên (`chat_mentions.go:41-62,147-167`).
- Số đo:
  - Kênh 1.000 người: POST p50 2,9 s, 199 ms CPU và 2.790 lệnh Redis mỗi tin.
  - Tin có `@all`: 5,2 s và 491 ms CPU.
  - Log server ghi limiter fail-open ("too many redis calls in flight") hàng nghìn lần mỗi phút khi tải cao: rate limit tự tắt đúng lúc cần nó nhất. Nguyên nhân nhiều khả năng là XADD dùng chung pool Redis với limiter (suy luận, chưa đo riêng).
- Mức độ: riêng vòng lặp đồng bộ là high. Mục này thành critical khi cộng với việc mỗi frame activity làm mọi client tải lại sidebar (C3), và với việc ai cũng dùng được `@all`.
- Khi Redis chậm nhưng chưa chết: client Redis không bật `ContextTimeoutEnabled`, nên mỗi XADD có thể chờ tới 5 s. Một lần gửi vào kênh 800 người có thể treo hàng chục phút. Server không có timeout nào ở tầng trên.
- `@all` trong một thread biến mọi thành viên thành người theo dõi thread đó vĩnh viễn.
- Cách sửa:
  - Phát một sự kiện activity cho cả phòng, hoặc pipeline toàn bộ XADD trong một lần, chạy ngoài request path.
  - Chỉ gửi cho người đang có socket.
  - Giới hạn `@all` theo vai trò và kích thước phòng, và lưu một cờ thay cho danh sách id.
  - Khi chỉ có một replica, cho phép tắt relay (xem H12).

**C5. Đợt mở app lúc 9 giờ đẩy pod vượt giới hạn bộ nhớ.** Trạng thái: **đã đo** (bảng G).
- Cơ chế:
  - Mỗi lần mở trang chat gọi `POST /chat/room` (`use-sync-chat-rooms-on-auth.ts:21-31`). Request này đồng bộ thành viên kênh mặc định bằng một truy vấn cho mỗi thành viên workspace, không có transaction, khoảng N+6 câu lệnh (`chat.go:140-272`, `workspaces.sql:63-69`). Route này không có limiter riêng.
  - Mỗi lần mở trang còn phát "đã đọc" ra workspace (C3).
  - Không có `GOMEMLIMIT`. Không giới hạn số request chạy đồng thời. Server không đặt `ReadTimeout` hay `WriteTimeout` (`main.go:520-529`).
- Số đo:
  - 100 người mở trong 60 s: mất 124 s mới ổn định, 85/100 `POST /chat/room` timeout, RSS 576 MB.
  - 200 người: RSS 1,5 GB, 24.000 request timeout.
  - Khi client bỏ request, log ghi `context canceled` thành lỗi 500, tới 21.365 lần.
- Tác động: pod 512 MiB bị OOMKill đúng giờ cao điểm, kéo theo toàn bộ API.
- Cách sửa:
  - Đồng bộ thành viên dạng set-based (`INSERT ... SELECT ... ON CONFLICT DO NOTHING`) ngay khi thành viên workspace thay đổi, không đợi tới lúc mở trang.
  - Sửa C3.
  - Đặt `GOMEMLIMIT` khoảng 400 MiB.
  - Thêm load shedding: khi quá số request đồng thời thì trả 503 kèm `Retry-After`.

**C6. Poll không có giới hạn phía server: một request 1 MiB tạo ra khoảng 15 MB metadata mà mọi người online đều tải về.** Trạng thái: **đã xác minh**. Reviewer đã đo bằng bản sao struct; tôi đã đọc lại code.
- Cơ chế:
  - `normalizePollOptions` không giới hạn số lựa chọn hay độ dài nhãn (`chat_poll.go:90-104,120-134`). Giới hạn 10 lựa chọn, 120 ký tự chỉ có ở client (`packages/core/chat/poll-utils.ts:2-4`).
  - Mọi thành viên đều được tạo poll theo mặc định (`chat_room_permissions.go:24-31`).
  - Poll trong kênh phát ra workspace (`chat_poll.go:213-214`).
  - Mỗi lần đọc giải mã metadata 6 lần (`chat_voice.go:668-680`).
- Số đo:
  - Request 1 MiB tạo 15,2 MB metadata.
  - Mỗi lần đọc tốn 1–2 s CPU và cấp phát khoảng 460 MiB.
  - Mỗi lần bỏ phiếu tốn khoảng 1,4 s CPU và 640 MiB, vì server đọc lại cả dòng rồi giải mã sáu lần nữa để trả response.
- Tác động:
  - Khoảng **5 lần đọc đồng thời** là vượt 512 MiB và pod bị OOMKill, nên một nhóm 10 người đang online là đủ.
  - Poll nằm trong trang mới nhất và trong cửa sổ 500 tin của sidebar, nên sau khi restart pod tiếp tục sập theo vòng lặp.
- Cách sửa:
  - Giới hạn trong service: tối đa 20 lựa chọn, mỗi nhãn tối đa 100 ký tự.
  - Giới hạn kích thước metadata.
  - Giải mã metadata một lần cho mỗi dòng.
  - Chuyển phiếu bầu sang bảng riêng.

**C7. Upload file và voice giữ ba bản sao trong heap trước khi kiểm tra quyền, không giới hạn số upload đồng thời.** Trạng thái: **đã xác minh**.
- Cơ chế:
  - `r.FormFile` giữ phần file trong bộ nhớ, tối đa 32 MiB. Handler `io.ReadAll` thêm một bản (`handler/chat_file_message.go:155-176`). Service `io.ReadAll` thêm bản thứ ba (`chat_media_message.go:89`).
  - Chỉ sau ba bản đó mới tới FileService, vốn đã biết spool ra đĩa (`file_upload.go:72,482-489`).
  - Composer gửi đồng thời mọi file đã chọn (`chat-composer.tsx:163-165`).
- Số đo của người kiểm chứng (bản sao bằng std-lib, `GOMAXPROCS=2` như production):

  | Số file 25 MiB tải cùng lúc | RSS đỉnh |
  |---|---|
  | 1 | 222 MiB |
  | 3 | 469 MiB |
  | 4 | 568 MiB (vượt 512 MiB) |
  | 6 | 763 MiB |

  Đặt `GOMEMLIMIT=400MiB` cũng không cứu được: 5 upload vẫn lên 529 MiB.
- Tác động: một người kéo vào 4–5 file lớn (ví dụ hợp đồng scan) là đủ làm pod bị OOMKill, vì composer gửi tất cả cùng lúc. Người ngoài phòng ép được hai bản sao, nên cần khoảng 6 request.
- Không riêng chat: upload đính kèm của việc (`task_attachments.go:69-82`) và avatar dùng cùng mẫu này.
- Cách sửa:
  - Dùng `r.MultipartReader()` và stream thẳng vào FileService, theo mẫu ở `documents.go:74-121`. Client phải gửi `client_msg_id` trước phần file, hoặc chuyển nó lên header.
  - Thêm semaphore tính theo số byte đang tải cho toàn pod, quá thì trả 503 kèm `Retry-After`.
  - Kiểm tra `Content-Length` trước khi đọc.
  - Composer gửi tuần tự.

**C8. `call_id` không giới hạn độ dài, và phiên gọi nằm trong một `sync.Map` toàn cục không bao giờ được dọn.** Trạng thái: **đã xác minh**. Người kiểm chứng đo được 1,9 MiB bị giữ lại cho mỗi lời mời không bao giờ cúp máy.
- Bằng chứng:
  - Không giới hạn độ dài: `sdi/chat.go:98-101`, `chat_signal.go:12-16`.
  - Map toàn cục, chỉ xóa khi cúp máy: `chat_voice.go:59-61,91-109,466`.
  - Danh sách lời mời đang chờ quét toàn bộ map kèm truy vấn DB, cho mọi tenant (`chat_voice.go:336-357`).
  - `call_id` dài hơn 239 byte gây panic, được Recoverer bắt lại và trả 500 (`chat_voice.go:294-298`).
- Tác động:
  - Một thành viên gửi lời mời trong nhóm hoặc kênh với `call_id` khoảng 1 MiB. Mỗi lời mời giữ lại khoảng 2 MiB, nên sau khoảng 100–200 lời mời, tức 20–60 s, pod bị OOMKill. Có thể lặp lại sau mỗi restart.
  - Trong kênh 1.000 người, một lời mời như vậy tốn khoảng 10 s CPU của pod và ghi khoảng 1 GiB vào Redis.
  - Kể cả với `call_id` ngắn hợp lệ, một người vẫn giữ được khoảng 1.500 lời mời DM đang chờ cho mỗi đường dẫn phòng. Khi đó mỗi lần ai đó mở app sẽ tốn hơn 1.500 truy vấn.
  - Restart làm mất mọi phiên: không ai lấy được token để vào lại cuộc gọi đang diễn ra, và người gọi trong nhóm cúp máy thì nhận 403. Riêng phần này chỉ ở mức trung bình.
- Cách sửa:
  - Kiểm tra `call_id` là UUID hoặc ULID, tối đa 64 byte; tốt nhất là server tự tạo.
  - Lưu phiên trong Redis hoặc DB, có TTL.
  - Thêm limiter theo người dùng cho lời mời gọi.

**C9. Frame WebSocket gửi lên không bị giới hạn, và mỗi lần subscribe tốn 3–4 truy vấn không có cache.** Trạng thái: **đã xác minh**.
- Bằng chứng:
  - Không rate limit, không giới hạn số scope trên một socket (`hub.go:961-1051`).
  - Không có cache (`chat_authorizer.go:16-26`), khác với `meeting_authorizer.go:17-20` có cache 30 s.
  - Pool 20 kết nối (`dbpool.go:21`).
- Tác động:
  - Một thành viên mở 3–9 socket và lặp lệnh subscribe là đủ làm CPU của pod chạm trần. Mở từ 20 socket thì chiếm thẳng pool DB.
  - Subscribe lại một scope đã có vẫn kiểm tra quyền lại từ đầu, nên đây là đường rẻ nhất cho kẻ tấn công.
  - Các request khác bị bỏ đói. `/readyz` có thể lỗi, kéo theo cả API.
- Cách sửa:
  - Token bucket cho mỗi socket, khoảng 10 frame/s.
  - Tối đa khoảng 50 scope mỗi socket và 10 socket mỗi người.
  - Bỏ qua kiểm tra quyền khi scope đã được giữ.
  - Cache quyền chat 30–60 s như meetings.
  - Gộp kiểm tra quyền thành một truy vấn.

**C10. Không có ngân sách ghi theo từng người: reaction, ghim, bỏ phiếu, gọi và quản trị phòng không có limiter riêng; mời thành viên không giới hạn và tốn O(N²).** Trạng thái: **đã xác minh**. Cả hai người kiểm chứng đều giữ mức critical cho phần mời thành viên.
- Bằng chứng:
  - Các route này không gắn `chatWriteLimit` (`router/chat.go:183,191,199,207,293-330`).
  - Khóa của limiter chung gồm cả đường dẫn cụ thể, nên mỗi id tin là một ngân sách 300/phút mới (`ratelimit.go:114,235-239`).
  - Mỗi reaction trong kênh phát `chat.message.updated` ra workspace, và mọi client gọi GET lại tin đó (C2).
  - Mời thành viên chỉ cần là thành viên phòng và nhận danh sách id không giới hạn. Mỗi người mới sinh một dòng outbox `ScopeRoom`, dòng này lại được phát tới từng thành viên (`chat_rooms.go:289-349`, `realtime_consumer.go:113-124`).
- Tác động:
  - Một bài đăng toàn công ty, 800 người online, nhận 1–1,7 reaction mỗi giây sinh khoảng 900–1.300 GET/s, tức 1,3–2 lần hạn mức CPU trong suốt đợt đó. Các reaction trong đợt này còn dễ bị mất (H3).
  - Một thành viên toggle 5 lần mỗi giây trên các tin khác nhau là đủ làm pod bão hòa khi workspace có khoảng 100–150 socket online.
  - Thêm 1.000 người vào nhóm trong một lần sinh khoảng 1 triệu lệnh Redis. Mọi sự kiện realtime của mọi tenant phải chờ phía sau 7–20 phút, gồm cả duyệt khách vào phòng họp, `meeting.started` và `task.created`.
  - Phía client cũng tăng theo bình phương: mỗi dòng outbox làm mọi tab online tải lại sidebar. Chỉ cần thêm 10–20 người vào một kênh đang có 800 người online là pod bão hòa hàng chục giây.
- Lưu ý: chỉ gắn `chatWriteLimit` thì không đủ, vì limiter này cũng khóa theo IP cộng đường dẫn cụ thể.
- Cách sửa:
  - Limiter theo người dùng đã xác thực, khóa theo route pattern thay vì đường dẫn cụ thể, cho reaction, ghim, bỏ phiếu, gọi và quản trị.
  - Mời thành viên phải là admin, tối đa khoảng 100 id mỗi lần.
  - Một dòng outbox `members_added` cho cả lô.

### Cao (high)

**H1. DM, lượt nhắc đến và trả lời thread không tạo thông báo bền.** Trạng thái: **đã xác minh**. Ban đầu xếp critical, người kiểm chứng hạ xuống high vì không mất tin.
- Bằng chứng:
  - `chat.mention.created` là sự kiện ephemeral trên `ScopeUser` (`catalogue.go:178`). DM không sinh sự kiện nhắc đến (`chat_mentions.go:33-35`).
  - Bộ quy tắc thông báo không có quy tắc nào cho tin chat (`server/internal/notification/rules.go:72-83`).
  - Push đang tắt vì `VAPID_PUBLIC_KEY` rỗng (`deploy/app/env/uniwork-be.env:85-88`).
  - Toast chỉ hiện trên trang chat và không ghi ai gửi (`use-chat-mention-notify.ts:19-32`).
  - Menu Chat không có huy hiệu (`app-sidebar.tsx:144`). `showWebNotification` không có nơi nào gọi.
- Tác động:
  - Người đang ở trang Công việc hay Cuộc họp, đã đóng laptop, hoặc đang dùng điện thoại sẽ không biết có DM hay có người nhắc đến mình.
  - Huy hiệu @ chỉ tính trong 500 tin mới nhất. Với đội quen Zalo hay Slack, chat không thể là kênh liên lạc chính.
- Cách sửa:
  - Ghi outbox `chat.message.mentioned` và `chat.dm.received` ngay trong transaction gửi, thêm quy tắc và loại thông báo, gộp theo phòng.
  - Cấu hình VAPID.
  - Thêm huy hiệu tổng trên menu Chat và trong `document.title`.
  - Gọi `showWebNotification` khi tab đang ẩn.

**H2. Cuộn lên xem lịch sử bỏ sót tin.** Trạng thái: **đã đo** (bảng J: 9,5% ở 7 tin/s). Mô phỏng của người kiểm chứng: 2,1% số tin bị bỏ sót ở 2 tin/s, và lỗi xảy ra ở mọi tốc độ.
- Cơ chế:
  - `created_at` được trả về dạng RFC3339, bỏ phần lẻ của giây (`handler/chat.go:25`), trong khi cột lưu tới micro giây.
  - Client dùng giá trị đó làm cursor (`native-chat-message-panel.tsx:294-297`).
  - SQL dùng `created_at < before` mà không có id làm tiebreaker (`chat.sql:44-68`).
  - Gửi nhiều file một lúc tạo ra các tin cùng giây ngay cả trong phòng yên tĩnh.
- Cách sửa:
  - Dùng cursor mờ `(created_at, id)` được trả nguyên về server, điều kiện `(m.created_at, m.id) < ($1, $2)`, kèm index `(room_id, created_at DESC, id DESC)`.
  - Chỉ đổi sang RFC3339Nano là chưa đủ, vì `toISOString()` cắt về mili giây.
  - Mẫu đúng đã có sẵn ở `meeting_chat.sql:17-18`.

**H3. Reaction, phiếu bầu và ghim ghi đè lên nhau khi xảy ra đồng thời.** Trạng thái: **đã xác minh**.
- Cơ chế: đọc cả cột metadata JSONB, sửa trong Go rồi ghi đè, không có khóa (`chat.go:593-606`, `chat_poll.go:234-319`, `chat_actions.go:131-151`, `chat.sql:152-156`).
- Tác động: phiếu bị mất hẳn. Tổng phiếu vẫn khớp danh sách người bầu, chỉ là phiếu biến mất.
  - Pod rảnh: mất khoảng 0,2–0,5% phiếu.
  - Pod quá tải (cửa sổ khoảng 100 ms, 3 phiếu/s): mất khoảng 23%.
- Cách sửa: dùng UPDATE nguyên tử (`jsonb_set` trong một câu lệnh) hoặc `SELECT ... FOR UPDATE`. Tốt hơn là chuyển sang bảng `chat_message_reactions` và `chat_poll_votes`.

**H4. Timeline có lỗ hổng.** Trạng thái: **đã xác minh**.
- Cơ chế: trang mới nhất (80 tin, trong React Query) và các trang cũ (trong state của component) được ghép lại mà không kiểm tra liền mạch (`native-chat-message-panel.tsx:112-150,286-311`, `native-chat-message-timeline.ts:27-48`).
- Tác động:
  - Khi đã tải trang cũ, một lần refetch (do reaction, ghim, bỏ phiếu, gửi file của chính mình, mở bản tin, kết nối lại) làm biến mất đúng số tin đã đến kể từ lần tải trước. Ở tốc độ S1, khoảng 80 tin biến mất sau 40 s.
  - Không refetch cũng có lỗ: sau hơn 920 tin mới, cache cắt bỏ dòng cũ.
  - Cập nhật trên một tin cũ bị chèn vào cửa sổ hiện tại.
- Cách sửa: gom timeline vào một `useInfiniteQuery`, hoặc một store chuẩn hóa theo id. Tách "tạo" với "cập nhật" khi patch cache. Thêm `revision` cho tin.

**H5. Mất sự kiện mà không ai biết.** Trạng thái: **đã đo** (bảng G: 121–125 subscription lỗi không được retry) và **đã xác minh**.
- Cơ chế:
  - Mỗi 15 phút, khi đổi access token, socket bị dựng lại (`provider.tsx:37-55`) mà không chạy refetch như khi kết nối lại (`ws-client.ts:219-230`). Các sự kiện trong khoảng trống bị mất.
  - Subscribe bị từ chối với `lookup_failed` (quá 5 s khi DB chậm) không được client retry (`use-chat-room-scopes.ts:16-48`), trong khi meetings đã có retry (`use-meeting-scope.ts`).
  - Frame không có số thứ tự hay cursor để nối lại.
- Tác động:
  - Phòng mở cả ngày có lỗ hổng mỗi ngày (khoảng 0,2–2 lỗ cho mỗi người đọc).
  - Sau một đợt tải cao, có phòng không nhận tin mới tới 15 phút mà giao diện không báo gì.
- Cách sửa:
  - Coi việc dựng lại client là một lần kết nối lại, hoặc xác thực lại trên socket cũ.
  - Retry `lookup_failed`, nhưng các lỗi vĩnh viễn như `chat_not_member` phải được ánh xạ thành `forbidden` trước.
  - Sau subscribe hoặc kết nối lại, gọi `messages?after=<id mới nhất>`.
  - Dài hạn: số thứ tự cho từng phòng cộng với resume token.

**H6. Huy hiệu chưa đọc sai trong các luồng thường ngày.** Trạng thái: **đã xác minh**.
- Kênh mặc định không tự tăng huy hiệu. Migration 165 đổi kind thành `channel`, nhưng client chỉ tăng cho kind `workspace` (`realtime-cache.ts:175-177`), và test vẫn dùng kind cũ. Hiện huy hiệu chỉ "đúng" nhờ cơn bão refetch ở C3.
- Poll, bài đăng, ghi chú và nhắc việc ở mọi kênh không làm huy hiệu nào tăng.
- Con trỏ đọc chỉ tiến khi vào hoặc rời phòng (`chat-hooks-rooms.ts:187-196`, `use-chat-catch-up-ui.ts:84-94`), nên:
  - phòng đang đọc vẫn tăng huy hiệu;
  - "Đã xem" trong DM trễ;
  - tin đã đọc trực tiếp lại hiện là chưa đọc ở phiên sau;
  - tóm tắt AI không bao giờ thấy phần tồn đọng trước khi mở phòng.
- `UpdateChatRoomMemberLastRead` ghi đè vô điều kiện, có thể làm con trỏ lùi lại (`chat.sql:38-42`).
- Cách sửa:
  - Dùng `isDefaultWorkspaceChannel` trong `realtime-cache.ts` (giữ nguyên `lazy-chat-scopes.ts`, vì scope đó mang cả cập nhật poll).
  - Đánh dấu đã đọc khi phòng đang hiển thị và cuộn tới đáy (debounce 1–2 s), nhưng chỉ làm sau khi sửa C3.
  - Dùng `GREATEST` khi ghi con trỏ đọc.
  - Giữ con trỏ trước khi mở phòng để làm vạch "Tin mới" và cho tóm tắt AI.

**H7. Gửi tin bị chặn theo IP văn phòng, và client xử lý 429 sai.** Trạng thái: **đã đo** (bảng I: 31% tin thất bại).
- Cơ chế phía server: `chatWriteLimit` vẫn tính theo IP cộng đường dẫn phòng, 120 tin/phút (`router.go:151`). Giới hạn bị chạm khi riêng một văn phòng đăng hơn 120 tin top-level (tính cả sticker và GIF) vào một phòng trong 60 s, ví dụ cả công ty cùng gửi lời chúc mừng.
- Cơ chế phía client (`send-retry.ts:3-18`, `use-chat-page-actions.ts:139-146,187-192`):
  - Thử 3 lần trong 1,6 s, bỏ qua `Retry-After`, dù client đã parse header này (`http.ts:246`).
  - Sau đó đưa tin vào outbox kèm thông báo "Tin nhắn đã được lưu và sẽ gửi khi có mạng", trong khi người dùng vẫn đang online.
  - Outbox chỉ được xả lại vào lần dựng socket kế tiếp, trung bình sau khoảng 7,5 phút. Tin tới muộn và sai thứ tự.
  - Thread reply trong outbox mất `thread_root_id` và bị đăng ra kênh chính.
- Cách sửa:
  - Limiter theo người dùng đã xác thực.
  - Tôn trọng `Retry-After`. Thêm nút gửi lại và hủy trên bong bóng tin. Tách thông báo "bị giới hạn" khỏi thông báo "mất mạng".
  - Lưu `thread_root_id` trong outbox.

**H8. Khi DB quá tải, request bị trả 401, và người dùng có thể bị đăng xuất.** Trạng thái: **đã xác minh** (tôi đọc code). Log của bộ đo ghi 99 lần 401 trong một lần chạy.
- Cơ chế:
  - Mọi request đã xác thực đều kiểm tra phiên thiết bị. Với phiên web, truy vấn này luôn không trả về dòng nào, nên là một lượt DB lãng phí (`desktop_auth.go:595-610`).
  - Middleware trả 401 cho **mọi** lỗi của bước này, kể cả timeout DB (`server/internal/middleware/auth.go:34-41`).
  - Client nhận 401 thì refresh token. Nếu refresh cũng lỗi, client xóa access token, tức người dùng bị đăng xuất (`packages/core/api/http.ts:322-342`). Nếu refresh thành công, socket bị dựng lại (H5).
- Cách sửa:
  - Trả 503 cho lỗi hạ tầng, chỉ trả 401 khi thiết bị bị thu hồi hoặc không hợp lệ.
  - Cache kết quả kiểm tra phiên trong thời gian ngắn, hoặc bỏ qua bước này với phiên web.

**H9. Gửi file Word và Excel trong chat luôn lỗi 415 kể từ ngày 07/10.** Trạng thái: **đã xác minh**. Người kiểm chứng đã chạy probe với chính chính sách của FileService.
- Cơ chế: commit `1230e787` thêm `.docx` và `.xlsx` vào danh sách cho phép ở client (`chat-file-accept.ts`) và ở service (`chat_file_message.go:26-35`), nhưng danh sách MIME `chatFileMIMETypes` của FileService (`server/internal/files/registry.go:178`) không có hai định dạng này. Probe cho kết quả `purpose=chat_attachment sample=docx ... allowed=false`.
- Tác động: định dạng văn phòng phổ biến nhất không gửi được. File đã chọn bị xóa khỏi composer, kèm một toast "Thử lại" chung chung.
- Cách sửa: thêm hai MIME OOXML vào `chatFileMIMETypes`, và thêm một test khóa ba danh sách lại với nhau.

**H10. Deploy cắt mọi socket cùng lúc mà không drain.** Trạng thái: **đã xác minh**. Bảng H cho thấy hệ thống hồi phục trong 3,6 s ở 100 người; mức 500 người trở lên là ước tính.
- Cơ chế:
  - Shutdown không động tới hub (`main.go:548-631`).
  - Client kết nối lại sau 1 s ±20% (`ws-client.ts:16-17`).
  - Lệnh upgrade WebSocket bị giới hạn 300 lần/phút theo IP (`router.go:76-77`).
  - Mỗi socket subscribe lại tối đa 25 scope, không có cache.
- Ước tính với 500 người (khoảng 700 socket): 54.000–128.000 truy vấn, hệ thống bão hòa 15–40 s, và `lookup_failed` không được retry (H5).
- Cách sửa:
  - Khi nhận SIGTERM, đóng socket với mã 1012 theo từng lô ngẫu nhiên trong 10–20 s.
  - Client dùng full jitter.
  - Giới hạn WebSocket theo identity, ví dụ bằng một ticket ngắn hạn.
  - Thêm frame `subscribe_many`.

**H11. Quyền realtime không bị thu hồi.** Trạng thái: **đã xác minh**.
- Cơ chế:
  - Socket chỉ được kiểm tra một lần lúc kết nối (`hub.go:872-907`).
  - Hub không có API để ngắt một user hay thu hồi một scope.
  - `MembershipCache.Invalidate` không có nơi nào gọi.
  - Gỡ khỏi workspace hay vô hiệu hóa tài khoản không đánh dấu `chat_room_members` là đã rời phòng.
  - Kết nối WebSocket bỏ qua bước kiểm tra phiên thiết bị.
  - Kick không được ghi audit.
- Tác động:
  - Client web thông thường: bị vô hiệu hóa thì mất quyền trong vài giây; bị gỡ khỏi workspace thì tới khoảng 20 phút; bị kick khỏi phòng thì tới khoảng 15 phút.
  - Script hoặc access token bị đánh cắp: giữ được socket tới lần deploy kế tiếp, vẫn nhận tiêu đề và trạng thái việc qua `task.updated`.
- Cách sửa:
  - Thêm `Hub.DisconnectUser` và `Hub.RevokeScope`, gọi từ deactivate, gỡ thành viên, kick, đăng xuất và RevokeAll.
  - Đóng socket khi token hết hạn.

**H12. Nội dung phòng riêng tư vẫn bị lộ sau khi người dùng rời phòng.** Trạng thái: **đã xác minh**.
- Phần nặng là đồng bộ thread sang việc. Một ô tick trong hộp thoại "Tạo việc từ tin nhắn" đẩy mọi trả lời sau đó của thread trong phòng riêng tư thành bình luận của việc, mà mọi thành viên workspace đều đọc được. Giao diện không có cách hủy đồng bộ, và gỡ thẻ việc thì đồng bộ vẫn chạy (`chat_links.go:400-476`, `chat_task_sync.go:58-95`).
- Phần nhẹ hơn: ex-member vẫn thấy các bản sửa của tin gốc mà họ đang theo dõi, và thấy follow-up (`chat.sql:652-684`, `chat_follow_ups.sql:19-65`).
- Cách sửa:
  - Thêm điều kiện quyền truy cập hiện tại khi đọc follower và follow-up.
  - Chặn đồng bộ thread sang việc ở phòng riêng tư, hoặc giới hạn người xem của việc không rộng hơn phòng.
  - Thêm nút hủy đồng bộ.

**H13. Relay Redis theo từng scope tốn kém, trong khi chỉ có một replica.** Trạng thái: **đã xác minh**.
- Cơ chế:
  - Mỗi lần publish là một XADD giữ tới 10.000 bản ghi cho mỗi stream (`redis_relay.go:29-40,286-311`).
  - Mỗi scope có một goroutine và một kết nối XREADGROUP; pool tối đa 1.024 (`relay_read_client.go:5-21`).
  - Pool Redis chung 20 kết nối phải chia với rate limiter.
- Tác động:
  - Đây là phần lớn chi phí của C4.
  - Bộ nhớ Redis tăng khoảng 400–450 B cho mỗi bản ghi, cộng dồn qua mọi tenant.
- Cách sửa:
  - Khi chỉ có một replica, cho phép tắt relay.
  - Khi cần nhiều node, nối `ShardedStreamRelay`.
  - Không XADD tới user không có socket. Cắt stream theo thời gian.

**H14. `/readyz` của pod duy nhất phụ thuộc Redis, S3 và độ trễ của pool DB, trong ngân sách 500 ms.** Trạng thái: **đã xác minh**.
- Bằng chứng: `readiness.go:24,69-101`, `deployment-be.yaml:161-164`.
- Tác động:
  - S3 hoặc Redis chập chờn quá 10–15 s là API ngừng hoàn toàn với mọi kết nối mới.
  - Lần deploy có migration lâu hơn khoảng 10–15 s cũng gây ra điều tương tự, vì kiểm tra lệch phiên bản schema dùng `!=` (`readiness.go:89`).
- Cách sửa:
  - Readiness chỉ kiểm tra DB, với ngân sách ít nhất 2 s.
  - Bỏ Redis và S3 khỏi readiness; cảnh báo hai thứ này qua metric.
  - Chỉ báo lỗi khi schema cũ hơn binary.

**H15. Ảnh đi qua pod API ở kích thước gốc, `no-store`, không có thumbnail.** Trạng thái: **đã xác minh**.
- Cơ chế:
  - Mỗi lần xem ảnh tốn khoảng 8 truy vấn và tải toàn bộ file gốc qua pod (`chat_file_message.go:245-288`).
  - Mỗi ảnh trong một album là một tin riêng.
  - Voice chỉ tải khi bấm Play, nên ảnh hưởng không đáng kể.
  - `no-store` là chủ ý, để thu hồi quyền có hiệu lực ngay.
- Tác động: khoảng 120–250 người cùng xem một ảnh 4 MB là đủ làm pod chậm hẳn.
- Cách sửa:
  - Tạo thumbnail khi upload (đã có thiết kế `file_derivatives`).
  - Dùng presigned URL TTL ngắn, hoặc `max-age` ngắn kèm `private`.

**H16. Nhắc việc trong chat không bao giờ chạy từ server.** Trạng thái: **đã xác minh**.
- Cơ chế:
  - `remind_at` và `repeat` chỉ được lưu lại (`chat_reminder.go:76-161`).
  - Việc "chạy" nhắc chỉ là `setTimeout` phía client, dựa trên 80 tin đang có trong cache, và chỉ khi trang chat đang mở (`use-chat-reminder-notify.ts:57-90`).
- Tác động:
  - Nhắc "Ngày mai 9:00" hầu như không bao giờ chạy. Nhắc lặp lại không bao giờ chạy lại.
  - Câu chữ trong hộp thoại hứa một điều không xảy ra.
- Cách sửa: lưu thời điểm tới hạn vào bảng có index, thêm worker kiểu `MeetingReminder` phát thông báo, và tính lần lặp kế tiếp.

**H17. Cuộc gọi giả có thể làm cạn quota AI của cả tổ chức.** Trạng thái: **đã xác minh**.
- Cơ chế:
  - Cuộc gọi nhóm được tính là đã nhận ngay khi mời. Thời lượng do client gửi lên vẫn được dùng (`chat_voice.go:105-106,540-549`). Thời lượng từ 30 s trở lên sẽ sinh một job tóm tắt LLM trên lane `slow`, lane này chỉ có 2 worker (`main.go:344-347`, `lane.go:59-64`).
  - Không có giới hạn cho từng người. Người dùng có thể tự lập kênh riêng chỉ có mình để làm việc này mà không ai biết.
  - Gỡ thành viên đó cũng không dừng được hàng đợi.
- Tác động: quota hết thì Hỏi UNI, tóm tắt cuộc họp và tóm tắt chat của cả tổ chức trả 402 cho tới hết tháng.
- Cách sửa:
  - Server tự tính thời lượng và yêu cầu có người thứ hai tham gia.
  - Giới hạn số tóm tắt theo người, phòng và giờ.
  - Lane `slow` cần cơ chế công bằng giữa các tenant.

**H18. Nhóm từ khoảng 99 thành viên không tạo được.** Trạng thái: **đã xác minh**.
- Cơ chế: khóa định danh nhóm là toàn bộ danh sách id thành viên, đặt trong một unique B-tree (`chat_rooms.go:261,676-682`, migration 054). Từ khoảng 99 id, khóa vượt giới hạn 2.704 B của một dòng B-tree, và INSERT trả 500.
- Ngoài ra: mời hay rời nhóm không cập nhật khóa này.
- Cách sửa: chỉ dùng khóa cho DM; với nhóm, lưu digest kích thước cố định hoặc bỏ khử trùng lặp; giới hạn kích thước nhóm và trả 400 rõ ràng.

**H19. Chat chưa có bằng chứng tải nào trong CI.** Trạng thái: **đã xác minh**.
- Bằng chứng:
  - `perf-nightly.yml` không chạy `chat-read-5000`, và đã chạy 0/154 lần thành công. Lịch chạy checkout `main`, vốn chậm hơn `develop` 2.814 commit.
  - Seed không tạo dữ liệu chat. `perf-lib.js` bỏ qua bước GET tin khi chưa có phòng.
  - Job e2e chứa các spec chat bị hủy vì quá 25 phút ở 4/4 lần push gần nhất lên `develop`.
  - Bản DoD chat ghi mục này là "done".
- Cách sửa: xem mục 8.

### Trung bình (medium)

- **Gửi tin không atomic.** INSERT commit trước, rồi mới ghi lượt nhắc đến, độ ưu tiên và publish. Retry với cùng `client_msg_id` trả lại tin cũ mà không publish, và hành vi này được test khóa lại (`chat_test.go:1054-1087`). Người nhận không thấy tin cho tới khi refetch. Ngoài ra, nhấn Enter lần nữa trong lúc gửi chậm sẽ gửi đôi.
- **Tóm tắt AI bỏ qua toàn bộ phần tồn đọng** kể từ `1230e787`, vì mở phòng đã đánh dấu đọc. Cửa sổ tóm tắt còn chỉ lấy 20 tin cũ nhất (`askuni_catchup.go:18,205-211`, `ai/context.go:12`).
- **Tìm kiếm.**
  - `ILIKE '%q%'` không có index, chỉ trong một phòng, chỉ tin văn bản, không bỏ dấu tiếng Việt: gõ "tien do" không ra "tiến độ" (`chat.sql:460-483`).
  - Repo đã có `foldForSearch` và `pg_trgm` cho tài liệu và người.
  - Không có `statement_timeout` riêng cho tìm kiếm.
- **Hiệu năng hiển thị.**
  - Memo của hàng tin bị phá: `onFollowUp` phụ thuộc object mutation, và `nameContext` đổi sau mỗi tin. Mỗi tin tốn khoảng 70–130 ms main thread trên laptop văn phòng (`use-chat-follow-up-ui.tsx:29,47-55`).
  - Bundle của route chat là 1.011 KB, gấp 5,2 lần ngưỡng, nhưng chỉ hiện cảnh báo.
- **Quan sát production.**
  - NetworkPolicy chặn scrape metrics khi `metricsScrapeNamespace` rỗng.
  - Log là text. Không có metric hay SLO riêng cho chat.
  - `lookup_failed` không để lại log.
  - Alert p95 chỉ áp cho GET, nên gửi tin chậm không kích hoạt alert nào.
- **Lệch giữa các handler.** Chặn DM chỉ được áp cho tin văn bản, không áp cho poll, ghi chú, bài đăng, nhắc việc, reaction hay gọi. Moderator không xóa được tin của người khác. Kick và thay đổi quyền của phòng không được ghi audit.
- **Tranh chấp khi tạo phòng.** Tạo DM hoặc nhóm đồng thời trả 500. Rời rồi được mời lại có thể không vào lại được (lỗi 23505).
- **Dữ liệu.**
  - Thêm một kind tin mới sẽ thay CHECK constraint dưới khóa ACCESS EXCLUSIVE, quét toàn bảng.
  - Không có retention, xóa hay xuất dữ liệu chat; Nghị định 13 cần những thứ này.
  - Media chat không được xóa hay tính vào quota, khoảng 6 GB/ngày cho tổ chức 1.000 người.
- **Payload thừa.** Danh sách id của `@all`, `votes_by_user`, `member_user_ids` trên mỗi dòng sidebar, và danh sách thành viên kèm email.
- **Ghim và bản tin chỉ thấy 80 tin mới nhất.** Ghim là một cờ trong metadata, không có index.
- **Mỗi tab là một client realtime riêng.** Các tab ghi đè outbox của nhau.
- **Presence.**
  - Đóng hoặc tải lại bất kỳ tab nào cũng gửi "offline" cho cả người dùng, nên người đó hiện offline với cả workspace tới 15 s dù vẫn còn tab khác mở (`use-chat-presence-heartbeat.ts:43-53`).
  - Mỗi tab gửi heartbeat 15 s một lần, và mỗi lần trả về tới 1.000 id đang online.
- **Thẻ việc không cập nhật** sau khi tạo, gắn hay gỡ liên kết, cho tới khi rời phòng quá 5 phút.
- **Bộ chọn @nhắc đến** render toàn bộ thành viên và phân biệt theo tên hiển thị, nên hai người trùng tên thì người vào sau không bao giờ được nhắc đến.
- **Ảnh markdown trỏ tới URL bên ngoài** được trình duyệt mọi người xem tự tải, làm lộ IP và thời điểm đọc.
- **Lỗi tải lịch sử** hiện ra như một cuộc trò chuyện trống, không có nút thử lại. Gửi file không có thanh tiến độ.

### Thấp (low)

Live region đọc từng tin trong phòng đông. Mỗi hàng tin gắn một toolbar khoảng 7 phần tử. Cache liên kết tăng dần theo phiên. Số trả lời của thread không bao giờ giảm. Giới hạn ký tự ở server tính theo byte UTF-8 trong khi composer đếm theo UTF-16, nên tin tiếng Việt dài khoảng 3.000 ký tự bị từ chối. Client bỏ qua các sự kiện `chat.channel.*`. Hub còn một số việc thừa trên mỗi frame.

## 6. Tính năng so với Slack, Teams và Zalo

Đối chiếu 44 nhóm tính năng: **14 có đủ, 19 có một phần, 11 thiếu**. UniWork có vài thứ Slack chỉ có qua tích hợp: biến tin nhắn thành việc, đồng bộ thread với bình luận của việc, follow-up, tóm tắt AI. Điểm yếu lớn nhất là không có gì kéo người dùng quay lại chat (xem H1), và không có app mobile.

| Nhóm | Có đủ | Có một phần | Thiếu |
|---|---|---|---|
| Hội thoại | DM, nhóm, kênh công khai và riêng, thư mục kênh, trả lời có trích dẫn | Thread (không có khung bên, không có trang "Thread", không có thông báo), xóa (moderator không xóa được tin của người khác, không để lại dấu "đã xóa") | Chuyển tiếp tin, sao chép link tin, hẹn giờ gửi |
| Soạn tin | Gửi tin thoại, sticker và GIF, biệt danh | Nháp (chỉ trong bộ nhớ, mất khi tải lại), sửa tin (không có lịch sử) | Định dạng (in đậm, code block, danh sách), slash command |
| Tương tác | Thăm dò ý kiến, ghi chú, bài đăng, follow-up | Reaction (thực tế chỉ có 👍, không có bộ chọn, không xem được ai đã thả), ghim (chỉ tìm trong 80 tin mới nhất), nhắc việc (không chạy từ server) | Emoji tùy chỉnh |
| Nhận biết | Typing, "đã xem" trong DM | Trạng thái gửi (không có trạng thái lỗi), presence (chỉ online/offline), huy hiệu chưa đọc (sai ở kênh chung) | Thông báo ngoài trang chat (inbox, push, email, OS), huy hiệu trên menu, "đã xem" trong nhóm, nhảy tới tin chưa đọc đầu tiên |
| Tìm kiếm | — | Trong một phòng, chỉ tin văn bản, phải gõ đúng dấu | Tìm toàn workspace, bộ lọc (từ ai, phòng nào, ngày, có file) |
| File và media | Gọi thoại và video, chia sẻ màn hình | Chia sẻ file (25 MiB, 8 định dạng, ảnh full-size, không có thumbnail) | Xem trước link (unfurl), file trong thread, quét virus |
| AI | Biến tin thành việc | Tóm tắt phần chưa đọc (bỏ qua phần tồn đọng trước khi mở phòng, xem mục 5) | Dịch tin |
| Mở rộng | — | Quản trị phòng (vai trò, tắt tiếng, kick, quyền) | Bot, incoming webhook, API công khai, khách, kênh dùng chung giữa tổ chức |
| Tuân thủ | Cô lập tenant | Audit (chỉ xóa tin và thay đổi thành viên) | Chính sách lưu trữ, xuất dữ liệu, eDiscovery (cần cho Nghị định 13) |
| Nền tảng | Trợ năng, i18n vi/en (855/855 khóa) | Offline (chỉ hàng đợi gửi văn bản), phím tắt, PWA | App mobile, app desktop cho chat |

Không có mã hóa đầu cuối (E2EE). Slack và Teams cũng không có cho tin thường, nên mục này ưu tiên thấp.

## 7. Lộ trình đề xuất

### Ngay (P0, khoảng 1 tuần): chặn các đường làm sập pod, gỡ ba nguồn khuếch đại rẻ nhất

1. **Vá panic C1:** sửa `sendJSON`, cho `evictSlow` đóng kết nối, thêm `recover` trong hai pump, thêm test tái hiện.
2. **Chặn đầu vào phía server:**
   - Poll: tối đa 20 lựa chọn, mỗi nhãn 100 ký tự (C6).
   - `call_id`: UUID, tối đa 64 byte (C8).
   - Reaction: kiểm tra là emoji, giới hạn số loại trên mỗi tin.
   - Giới hạn kích thước metadata.
3. **Upload dạng stream** cộng semaphore (C7). Đặt `GOMEMLIMIT≈400MiB` (C5, C6, C7). Thêm hai MIME OOXML vào `chatFileMIMETypes` (H9).
4. **Ngừng tải lại sidebar khi người khác đọc** (C3 bước 1). Server chỉ gửi "đã đọc" cho chính người đọc và người kia trong DM. Làm cùng lúc với sửa `isDefaultWorkspaceChannel` (H6). Số đo: CPU giảm từ 60% xuống 6%, tin hiện trên màn hình p95 từ 7,7 s xuống 0,39 s khi người dùng đổi phòng.
5. **Giảm GET lại sau mỗi frame** (C2 bước 1–3):
   - gỡ `useWorkspaceEvents` thừa ở ba view Cuộc họp;
   - chỉ GET khi phòng đã có trong cache;
   - định tuyến sự kiện kênh về `chat:{room}`.
6. **Limiter theo người dùng, khóa theo route pattern** cho gửi tin, reaction, ghim, bỏ phiếu, gọi, mời và `POST /chat/room` (C10, H7). Client tôn trọng `Retry-After` và lưu `thread_root_id` trong outbox.
7. **Chặn frame WebSocket gửi lên:** token bucket, trần số scope, cache quyền chat (C9).
8. **Cursor `(created_at, id)`** cho timeline và bản tin (H2).
9. **Auth middleware trả 503 thay vì 401** khi lỗi hạ tầng (H8).

Sau P0, kênh chung chịu được khoảng gấp 5–7 lần tải hiện tại (theo bảng C), và một thành viên không còn đường nào để làm sập pod.

### Ngắn hạn (2–6 tuần): sửa mô hình dữ liệu và đồng bộ

- **Fan-out:** sự kiện activity ở mức phòng, fan-out bất đồng bộ và pipeline. Quản trị `@all` theo vai trò và kích thước phòng (C4). Tắt relay khi chỉ có một replica (H13).
- **Sidebar:** một truy vấn, không N+1, bộ đếm lưu sẵn, đẩy phần thay đổi qua frame (C3).
- **Thành viên kênh mặc định:** đồng bộ theo sự kiện, không chạy khi mở trang. Thêm load shedding (C5).
- **Thông báo:** thông báo bền cho DM, lượt nhắc đến và thread. Cấu hình VAPID, thêm huy hiệu trên menu và tiêu đề tab (H1).
- **Reaction và phiếu bầu:** chuyển sang bảng riêng hoặc dùng UPDATE nguyên tử (H3).
- **Timeline và tính liên tục:**
  - một `useInfiniteQuery` cho timeline;
  - retry `subscribe_error`;
  - xác thực lại trên socket cũ thay vì dựng socket mới;
  - gọi `after=<id>` sau khi kết nối lại (H4, H5).
- **Con trỏ đọc:** tiến khi người dùng đang xem, ghi bằng `GREATEST`, có vạch "Tin mới". Tóm tắt AI dùng con trỏ trước khi mở phòng (H6 và mục tóm tắt AI).
- **Deploy:** drain khi deploy, full jitter, giới hạn WebSocket theo identity (H10).
- **Thu hồi quyền:** API thu hồi trong hub, điều kiện quyền truy cập khi đọc follower và follow-up, chặn đồng bộ thread sang việc ở phòng riêng tư (H11, H12).
- **Readiness** chỉ kiểm tra DB (H14).
- **Media:** thumbnail, presigned URL TTL ngắn (H15).
- **Nhắc việc** chạy từ server (H16).
- **Tóm tắt cuộc gọi:** server tự tính thời lượng, có giới hạn, lane `slow` công bằng giữa các tenant (H17).
- **Nhóm lớn:** khóa digest cho nhóm, giới hạn kích thước nhóm (H18).
- **Load test và quan sát:** đưa bộ đo tải vào nightly (mục 8). Mở scrape metrics, thêm SLI và SLO cho chat: tỉ lệ gửi thành công ≥ 99,9%, POST gửi p95 < 300 ms, tin tới người nhận p95 < 1 s.

### Dài hạn (1–3 tháng): lên chuẩn sản phẩm hàng đầu

- **Mô hình đồng bộ kiểu Slack và Discord:** frame mang nội dung (cần ADR), số thứ tự theo phòng cùng resume token, và client không gọi lại API sau mỗi frame.
- **Tìm kiếm:** cột văn bản đã bỏ dấu cộng trigram, tìm toàn workspace, có bộ lọc.
- **Tính năng nền tảng còn thiếu:** định dạng tin, chuyển tiếp, xem trước link, file trong thread, emoji picker, lịch sử sửa, nhảy tới tin chưa đọc đầu tiên.
- **Ứng dụng mobile** (ADR 0011) với push.
- **Tuân thủ:** retention, xuất dữ liệu và xóa dữ liệu theo Nghị định 13.
- **Scale ngang:** hoàn tất leader lock theo ADR 0025, nối `ShardedStreamRelay`, chạy từ hai replica BE trở lên.

## 8. Load test cần đưa vào CI

Hiện chat chưa có bằng chứng tải nào chạy trong CI:
- `perf-nightly.yml` không chạy `chat-read-5000.k6.js`, và chưa từng chạy thành công lần nào: 0/154 lần, gãy ở bước seed vì `organization_id`.
- Seed không tạo dữ liệu chat.
- Các "load test" Go chỉ broadcast trong bộ nhớ, không có socket thật (H19).

Bộ đo dùng cho báo cáo này (Go, mô phỏng client web) nên được đưa vào `scripts/load/chat/`, chạy trong nightly với ngưỡng đạt và trượt:

1. **Fan-out theo kích thước phòng** (bảng A). Kênh 200 và 1.000 người, 1 tin/s. Ngưỡng: POST gửi p95 dưới 300 ms, CPU mỗi tin không tăng theo số thành viên.
2. **Kênh chung có mô phỏng client** (bảng B). 200 người mở chat, 1 tin/s. Ngưỡng: tin hiện trên màn hình p95 dưới 1 s, dưới 5 truy vấn DB mỗi tin cho mỗi người nhận, không chờ pool DB.
3. **Phòng nhóm** (bảng D). 300 người, 60 nhóm, 6 tin/s. Ngưỡng như trên.
4. **Sidebar** (bảng E). Người dùng 300 phòng. Ngưỡng: p95 dưới 300 ms, tối đa 10 câu lệnh mỗi lần. Thêm một test Go đếm số câu lệnh bằng pgx tracer.
5. **Chuyển phòng và đọc** (F). 200 người, mỗi người đổi phòng mỗi 30 s. Ngưỡng: `GET /chat/rooms` không tăng theo số người khác.
6. **Đợt mở app** (G). 300 người tải trang chat trong 60 s. Ngưỡng: mọi client sẵn sàng trong 10 s, RSS dưới 400 MiB, 0 subscription lỗi.
7. **Deploy** (H). Restart giữa chừng với 500 socket. Ngưỡng: subscribe lại xong trong 10 s, không lỗi `readyz`, không mất tin.
8. **NAT văn phòng** (I). 300 người trên một IP. Ngưỡng: 0 tin thất bại vì 429.
9. **Tính đúng** (J). Phòng 7 tin/s, cuộn hết lịch sử. Ngưỡng: 0 tin bị bỏ sót. 200 phiếu bầu đồng thời: 0 phiếu mất.
10. **Lạm dụng.** Socket ngừng đọc nhưng vẫn ping (C1). Poll 1 MiB (C6). 5 upload 25 MiB song song (C7). Ngưỡng: process không chết, RSS dưới giới hạn.

Hai điều cần lưu ý khi chạy:
- Đặt `TRUSTED_PROXIES` và gán cho mỗi người dùng ảo một `X-Forwarded-For` riêng. Nếu không, phần lớn số đo sẽ chỉ là 429.
- Chạy trên một node có giới hạn CPU và RAM giống pod production.

## 9. Phương pháp và giới hạn

- **Đọc code.**
  - 13 người đánh giá độc lập, mỗi người phụ trách một khía cạnh: đường gửi, đường đọc, realtime phía server và phía client, hiệu năng hiển thị, rate limit, bảo mật, mô hình dữ liệu, media, thông báo, tính năng, vận hành, tính đúng.
  - Tổng cộng 137 phát hiện, gộp còn 68.
  - Phát hiện critical được hai người kiểm chứng độc lập (một người dò code, một người tính tác động), và có người thứ ba khi hai người bất đồng. Phát hiện high có một người kiểm chứng riêng. Các mục còn lại được kiểm chứng theo nhóm ba.
  - Mức độ trong báo cáo là mức sau kiểm chứng. Kết quả: 68/68 phát hiện được xác nhận, không mục nào bị bác bỏ. Nhiều mục được chỉnh lại mức độ và ngưỡng.
  - Các mục H8, H9 và mục presence được thêm sau, dựa trên log của bộ đo và vòng kiểm chứng; tôi đã tự đọc lại code của từng mục.
- **Đo tải.**
  - Chạy cục bộ trên MacBook với DB trong VM, nên mọi số ms là bi quan. Số đếm và CPU mỗi tin là con số đáng tin.
  - Chưa đo trên staging. Chưa đo bộ nhớ trình duyệt. Chưa đo LiveKit.
  - Hai lần chạy 1.000 socket làm sập SSH port-forwarder của colima. Đó là giới hạn của môi trường đo, không phải của UniWork. Các lần chạy sau dùng 2 socket mỗi người để giữ dưới 850 kết nối Redis.
- **Chưa xem.** Ứng dụng mobile (chưa tồn tại), cấu hình Postgres production (kích thước, PgBouncer), cụm Redis production, mạng giữa FE, BE và S3.
- **Vòng phản biện đề xuất ba hướng, chưa điều tra xong.** Tôi dừng lại để kịp bàn giao báo cáo. Các điểm dưới đây đã có dấu hiệu trong code nhưng chưa được kiểm chứng độc lập:
  1. **Vùng vận hành an toàn.** Cần một mô hình tải gộp mọi hệ số nhân: nhiều tab, tab ở trang khác ngoài chat, heartbeat presence, xoay token 15 phút. Mô hình đó sẽ cho biết chính xác cỡ tổ chức và tốc độ tin nhắn mà hệ thống chịu được hôm nay.
  2. **Downtime khi deploy.** Container chạy `migrate up && server` (`server/Dockerfile:14`). Liveness probe là `/healthz` với độ trễ ban đầu 10 s và không có `startupProbe` (`deployment-be.yaml:157-164`). Vì vậy một migration chạy lâu hơn khoảng 30 s có thể bị kill giữa chừng. Ngoài ra, `/readyz` của bản cũ báo lỗi ngay khi bản mới ghi migration đầu tiên (`readiness.go:88-92`).
  3. **Pod tự kẹt.** Thread reply giữ khóa dòng của tin gốc (`chat_threads.go:194`) trong khi lấy thêm một kết nối pool thứ hai (`chat_threads.go:211` gọi `chat_mentions.go:41`). Không có `statement_timeout`, `lock_timeout` hay timeout cho request. Đây cùng dạng với lỗi tự deadlock pool từng xếp critical trong `docs/meeting-concurrency-assessment.md` (G2). Thêm vào đó, limiter fail-open khi tải cao (đã thấy trong log khi đo), nên rate limit tắt đúng lúc pod đang quá tải.
