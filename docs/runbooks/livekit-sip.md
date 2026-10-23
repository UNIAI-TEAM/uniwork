# livekit-sip — gọi vào họp bằng điện thoại

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** alert `MeetingDialInRefusedCalls` (runbook riêng) — dựng và vận hành hạ tầng SIP của UNI-2030 cho tính năng UNI-2029 · **File:** `server/internal/service/meeting_dial_in.go`, `server/internal/meetings/livekit.go` (`CreateDialInRule`, `DeleteDialInRule`)

Người gọi bấm số tổng đài, nhập mã PIN của cuộc họp (9 số; PIN 6 số rút trước UNI-1995 vẫn dùng được) rồi bấm `#`; dịch vụ `livekit-sip` đưa họ vào phòng
`uw_mtg_<meetingID>` theo một **dispatch rule `direct`** mà server UniWork tạo khi cuộc họp bắt đầu và xoá khi kết
thúc (tên rule `uniwork <meetingID>`, `hide_phone_number = true`, chỉ trên trunk `MEETING_SIP_TRUNK_ID`). Server rút
mọi quyền nghe/nói của người gọi ngay khi nhận webhook `participant_joined` (kind SIP) và đưa họ vào hàng chờ của chủ
trì như khách; duyệt thì mở quyền và tính điểm danh dự thính, từ chối thì ngắt máy. UniWork không lưu identity
`sip_<hash>` của LiveKit (hash không muối của số máy): người gọi được lưu bằng `uw_sip_<HMAC bằng khoá server>` và tên
"Điện thoại ••• 1234".

Server UniWork **không** dựng hạ tầng. Việc của ops (UNI-2030), theo thứ tự:

1. **Redis cho SIP.** `livekit-sip` nói chuyện với LiveKit server qua Redis (psrpc). LiveKit server tự host (dùng chung
   với lms-core) phải chạy với Redis; nếu đang chạy một node không Redis, thêm khối `redis:` vào `livekit.yaml` trước.
   `livekit-sip` dùng **đúng Redis đó**.
2. **Triển khai `livekit-sip`** (image `livekit/sip`, ghim phiên bản cùng đợt với LiveKit server) cạnh LiveKit, cấu hình:
   ```yaml
   api_key: <LIVEKIT_API_KEY của LiveKit server>
   api_secret: <LIVEKIT_API_SECRET>
   ws_url: ws://<livekit-server>:7880
   redis:
     address: <redis của LiveKit>:6379
   sip_port: 5060
   rtp_port: 10000-20000
   use_external_ip: true
   logging:
     level: info
   ```
   Pod chạy `hostNetwork` (RTP cần IP công khai thật, không NAT qua Service), như LiveKit hiện nay.
   Server UniWork gửi rule trong trường `dispatch_rule` của `CreateSIPDispatchRule` (các trường cấp trên đã deprecated);
   LiveKit server phải đủ mới để đọc trường đó — thử `lk sip dispatch create` với JSON `{"dispatch_rule": {...}}` trên
   staging trước khi bật, nếu bị từ chối thì nâng LiveKit server cùng đợt.
3. **Mạng.** Mở công khai UDP+TCP `5060` và UDP `10000–20000` tới node chạy `livekit-sip`; tường lửa và NetworkPolicy chỉ
   cho dải IP báo hiệu/media của nhà mạng vào `5060`. `livekit-sip` ra được Redis và LiveKit server.
4. **Trunk và số tổng đài.** Ký SIP trunk với nhà mạng Việt Nam, một số cho mỗi môi trường (staging, production). Tạo
   inbound trunk (`lk sip inbound create trunk.json`):
   ```json
   {"trunk": {"name": "uniwork-<env>", "numbers": ["+8428XXXXXXXX"], "allowed_addresses": ["<CIDR của nhà mạng>"]}}
   ```
   Thêm `auth_username`/`auth_password` nếu nhà mạng xác thực bằng digest. Ghi lại `SipTrunkId` (`ST_…`).
5. **Bật trên server UniWork** (secret của `uniwork-be`, không commit):
   - `MEETING_SIP_ENABLED=true`
   - `MEETING_DIAL_IN_NUMBER=+84 28 XXXX XXXX` (đúng cách hiển thị cho người dùng: trang chi tiết, file .ics)
   - `MEETING_SIP_TRUNK_ID=ST_…` (bắt buộc trên môi trường thật: không có nó rule áp cho mọi trunk của LiveKit dùng chung,
     và vòng quét không dọn rule thừa vì không phân biệt được rule của triển khai khác dùng chung LiveKit)
   - webhook LiveKit → UniWork giữ nguyên (`deploy/livekit/README.md`); người gọi SIP đi chung webhook đó.
   Rolling restart `uniwork-be`.
6. **Bật cờ** `meeting_dial_in` cho tổ chức thử (override theo tổ chức trong `/admin`), rồi E2E bằng softphone trên
   staging: bắt đầu một cuộc họp → gọi số → nhập PIN + `#` → chủ trì thấy "Điện thoại ••• 1234" trong hàng chờ → duyệt
   → nghe/nói hai chiều → thư ký AI ghi lời người gọi → kết thúc họp → `lk sip dispatch list` không còn rule `uniwork …`.

7. **Chống dò PIN** — mục go-live: cờ `meeting_dial_in` **chỉ bật cho tổ chức khách hàng khi cả bốn ô dưới đây đã
   được kiểm và ghi tên người kiểm, ngày** (trong issue UNI-2030). Một trunk phục vụ mọi tổ chức, nên một người dò PIN
   trúng là gõ cửa được cuộc họp của tổ chức khác, và nghe được vài trăm ms (tệ nhất ~15 s) trước khi bị giữ.
   - [ ] **PIN 9 số** (từ UNI-1995: 10^9 khả năng; PIN 6 số rút trước đó vẫn dùng được tới khi đổi PIN hoặc họp xong).
     Kiểm: `SELECT length(dial_in_pin), count(*) FROM meetings WHERE status IN ('SCHEDULED','IN_PROGRESS') GROUP BY 1;`
     — cuộc họp mới phải là 9.
   - [ ] **Giới hạn sai PIN trong một cuộc gọi** ở `livekit-sip` hoặc SBC: 3 lần rồi ngắt máy. Kiểm bằng softphone: nhập
     sai 3 lần thì cuộc gọi bị ngắt.
   - [ ] **Giới hạn tốc độ theo caller ID** ở nhà mạng hoặc SBC: ≤ 10 cuộc/phút/số, ≤ 100 cuộc/giờ/số; chặn cuộc gọi ẩn
     số nếu nhà mạng cho. Kiểm bằng 11 cuộc gọi liên tiếp từ một số trong một phút.
   - [ ] **Alert sai PIN** từ log/metric của `livekit-sip` hoặc SBC (> 20 lần sai trong 5 phút trên một trunk) nối vào
     cùng kênh on-call. UniWork không thấy lần sai PIN hoàn toàn (không khớp rule nào thì không vào phòng, không có
     webhook); UniWork chỉ đếm phần nó thấy: `uniwork_meetings_total{event="dial_in_call_refused"}` (cuộc gọi vào qua PIN
     cũ, rule lạ hoặc cuộc họp đã kết thúc, bị ngắt máy) có alert `MeetingDialInRefusedCalls`
     (`docs/runbooks/MeetingDialInRefusedCalls.md`), và `dial_in_call_knocked` (mỗi lần gõ cửa của người gọi) để so.
   Khi alert bắn: chặn số gọi ở SBC và đổi PIN các cuộc họp đang diễn ra nếu cần.

8. **Thông báo thư ký AI cho người gọi.** Khi chủ trì nhận người gọi vào và cuộc họp có thư ký AI, agent phát một đoạn
   âm thanh tiếng Việt ngắn chỉ cho người gọi đó nghe (quyền subscribe track theo identity):
   `apps/meeting-agent/assets/sip-notice-vi.wav`, văn bản trong `apps/meeting-agent/scribe/notice.py`. Kiểm bằng softphone
   ở bước 6: sau khi được duyệt, người gọi nghe lời báo một lần; người trong phòng web không nghe thấy.

Giới hạn đã biết (chủ sản phẩm đã được báo):

- **Hở khi vào phòng.** LiveKit tự host không có phòng chờ chặn trước (MoveParticipant/ForwardParticipant chỉ có trên
  Cloud, dispatch rule không mang quyền), nên người gọi vào thẳng phòng rồi mới bị rút quyền. Thường là một vòng webhook +
  một RPC (vài trăm ms); nếu webhook bị LiveKit bỏ (hàng đợi đầy) hoặc lệnh giữ lỗi, vòng quét 15 giây giữ lại — tệ nhất
  khoảng 15 giây người có PIN nghe/nói được trước khi bị giữ.
- Lời nhắc nhập PIN là giọng tiếng Anh mặc định của `livekit-sip`; lời báo thư ký AI (bước 8) là tiếng Việt, chỉ phát
  khi thư ký đang ở trong phòng lúc người gọi được nhận.
- Người gọi chờ duyệt nghe im lặng (không có nhạc chờ hay lời báo).
- Mỗi cuộc gọi là một lần gõ cửa: gọi lại sau khi rớt máy phải được duyệt lại.
- Người gọi ẩn số (không có caller ID) dùng chung một danh tính trong cuộc họp: chủ trì gỡ một người như vậy là chặn mọi
  người gọi ẩn số khác vào cuộc họp đó cho đến khi họp xong.
- Đổi `JWT_SECRET` đổi luôn khoá HMAC của id người gọi (`uw_sip_…`, khoá `JWT_SECRET` + tiền tố `dial-in:`): cuộc gọi đang
  diễn ra mất liên tục điểm danh (phiên cũ không khớp id mới); đổi khoá ngoài giờ họp.

## Triệu chứng

- Người gọi nhập đúng PIN nhưng bị báo sai PIN, hoặc cuộc gọi rớt ngay sau PIN.
- Người gọi vào phòng nhưng chủ trì không thấy họ trong hàng chờ, hoặc họ nghe được cuộc họp trước khi được duyệt.
- Trang chi tiết cuộc họp không hiện mục "Gọi vào bằng điện thoại" dù đã bật.
- `lk sip dispatch list` còn rule `uniwork <id>` của cuộc họp đã kết thúc (log server: `meeting dial-in: stray rule not deleted`).

## Kiểm tra

1. Server có bật không: env `MEETING_SIP_ENABLED`, `MEETING_DIAL_IN_NUMBER` khác rỗng, cờ `meeting_dial_in` của tổ chức.
   Thiếu một trong ba thì `GET /api/v1/meetings/{id}/dial-in` trả `enabled: false` và không có rule nào được tạo.
2. Rule của cuộc họp: `SELECT id, status, dial_in_pin, sip_dispatch_rule_id FROM meetings WHERE id = '<id>';` rồi
   `lk sip dispatch list` — rule `uniwork <id>` phải có đúng PIN đó, đúng phòng `uw_mtg_<id>`, đúng trunk.
3. Log `uniwork-be`: `meeting dial-in: ensure failed` (tạo rule lỗi; vòng quét 15 giây thử lại), `caller not held`,
   `caller not admitted`, `caller not dropped`. Metric `uniwork_meetings_total{event="dial_in_rule_failed"}`.
4. Webhook: người gọi phải tạo `participant_joined` có `kind = SIP` và attribute `sip.ruleID` bằng
   `sip_dispatch_rule_id`; rule khác thì server ngắt máy (chặn cuộc gọi lọt vào phòng qua rule lạ).
5. Hạ tầng: `livekit-sip` có kết nối Redis không, cổng 5060/RTP có mở không (gọi thử bằng softphone từ ngoài mạng).

## Khắc phục

- Rule thiếu khi cuộc họp đang diễn ra: chờ vòng quét 15 giây hoặc chủ trì bấm "Đổi mã PIN" (tạo rule mới với PIN mới).
- Rule thừa sau khi họp xong: vòng quét tự xoá khi `sip_dispatch_rule_id` còn trên dòng `meetings`, và xoá mọi rule tên
  `uniwork …` không dòng nào trỏ tới khi rule đã quá 1 phút (cần LiveKit trả `created_at`). Còn sót (log
  `stray rule not deleted`) thì xoá tay: `lk sip dispatch delete <SDR_…>`.
- Tạo rule bị từ chối vì trunk đã có rule cùng PIN: server tự đổi PIN cuộc họp (audit `meeting.dial_in_pin_rotated`,
  actor hệ thống) và thử lại ở vòng quét sau.
- PIN bị lộ: chủ trì/admin bấm "Đổi mã PIN" trên trang chi tiết (audit `meeting.dial_in_pin_rotated`); người đang trong
  phòng không bị ngắt.
- Tắt khẩn: tắt cờ `meeting_dial_in` (theo tổ chức hoặc toàn cục) — vòng quét xoá rule của mọi cuộc họp đang diễn ra trong
  15 giây; hoặc `MEETING_SIP_ENABLED=false` + restart (rule đang có vẫn được vòng quét dọn).

## Leo thang

- Hạ tầng SIP, trunk, nhà mạng: ops (UNI-2030).
- Server UniWork (rule, phòng chờ, điểm danh): nhóm meetings (UNI-2029).
- Người gọi nghe được cuộc họp khi chưa được duyệt: coi là sự cố bảo mật Sev 2 — tắt cờ `meeting_dial_in` ngay rồi báo
  nhóm meetings.
