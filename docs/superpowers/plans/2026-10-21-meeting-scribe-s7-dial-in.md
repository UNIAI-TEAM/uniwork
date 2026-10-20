# Thư ký AI S7 (UNI-2029): gọi vào họp bằng điện thoại — kế hoạch triển khai

> **Trạng thái:** in-progress — đủ 5 việc trên nhánh `feature/UNI-2029-meetings-thu-ky-ai-s7-goi-vao-hop-bang-d` (migration, adapter LiveKit SIP, server + phòng chờ cho người gọi, web, runbook `docs/runbooks/livekit-sip.md`); chưa gọi thật được vì hạ tầng SIP (UNI-2030) chưa có, chờ review và merge.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §5.4 (B10),
§6.2 (`meetings.dial_in_pin`, `meetings.sip_dispatch_rule_id`), §7.2 (`GET /dial-in`),
§9 (audit `meeting.dial_in_pin_rotated`), §10 (trang chi tiết, thư mời), §12 dòng S7 (cờ
`meeting_dial_in`). Hạ tầng (dịch vụ `livekit-sip`, cổng, trunk) là UNI-2030 của ops.

## Mục tiêu

Người có PIN gọi số tổng đài, nhập PIN, vào đúng phòng của cuộc họp; chủ trì duyệt ở phòng
chờ như khách; được ghi lời và điểm danh như dự thính. Mọi thứ sau cờ `meeting_dial_in` và
công tắc env `MEETING_SIP_ENABLED` (mặc định tắt); không bao giờ gọi dịch vụ SIP thật trong
test.

## Việc

1. **Migration + query.** `meetings.dial_in_pin` (6 số, sinh bằng default của DB từ
   `gen_random_uuid()`, điền cho cuộc họp chưa kết thúc), `meetings.sip_dispatch_rule_id`;
   unique index `CONCURRENTLY` trên `dial_in_pin WHERE sip_dispatch_rule_id IS NOT NULL`
   (PIN duy nhất giữa các cuộc họp đang có rule trong cùng một triển khai). Test: lint
   migration, `TestEveryQueryNamesItsTenant`.
2. **Adapter.** `ConferenceProvider.CreateDialInRule/DeleteDialInRule` (LiveKit
   `SIPClient`, rule `direct` có PIN, `hide_phone_number`, giới hạn trunk); `UpdateParticipant`
   mang thêm tên và attribute. Fake ghi lại lời gọi. Test: httptest Twirp kiểm request.
3. **Server.** `service/meeting_dial_in.go`:
   - `ensureDialIn`: họp `IN_PROGRESS` + cờ + env → tạo rule, lưu id (đụng PIN thì đổi PIN);
     không còn họp → xoá rule. Gọi ngay khi Bắt đầu / Họp tức thì / Kết thúc, và vòng quét
     15 giây làm lưới đỡ.
   - Người gọi (`participant_joined`, kind SIP, rule đúng): giữ ngay trong webhook (không
     nghe, không nói, tên "Điện thoại ••• 1234"), rồi tạo yêu cầu vào phòng của khách
     `guest_id = identity SIP`. Duyệt → mở quyền + mở phiên điểm danh; từ chối / bị gỡ →
     ngắt máy; gác máy → huỷ yêu cầu đang chờ, đóng phiên.
   - `GET /meetings/{id}/dial-in` (thành viên), `POST /meetings/{id}/dial-in/pin` (chủ
     trì/admin, audit `meeting.dial_in_pin_rotated`, phát `meeting.updated`).
   - ICS: thêm số tổng đài + PIN vào DESCRIPTION khi bật.
   - Ghi lời: map identity SIP → người tham gia khi lưu đoạn của agent.
   Test (DB): vòng đời rule tạo/xoá, đụng PIN, đổi PIN có audit, người gọi qua phòng chờ
   (giữ → duyệt → mở quyền + điểm danh dự thính; từ chối → ngắt), cờ/env tắt thì không làm gì.
4. **Web.** endpoint + schema khoan dung + test phản hồi sai; hook; thẻ "Gọi vào bằng điện
   thoại" trên trang chi tiết (số, PIN, nút đổi PIN cho chủ trì); trong phòng: chip
   "Điện thoại", người gọi đang chờ không hiện trong lưới/danh sách.
5. **Ops.** `docs/runbooks/livekit-sip.md`: các bước và giá trị ops cần cho UNI-2030.

## Quyết định

- LiveKit tự host không cho đặt identity của người gọi vào (EvaluateDispatchRule cố định
  `sip_<hash>`), nên identity trong phòng là `sip_<hash>` của LiveKit; UniWork dùng đúng
  chuỗi đó làm `guest_id`, không thêm bảng.
- Phòng chờ cấp phòng không giữ được người gọi SIP (họ vào phòng ngay sau PIN; MoveParticipant
  chỉ có trên Cloud): server rút quyền ngay khi nhận webhook. Khoảng hở còn lại là độ trễ
  webhook + một RPC (~vài trăm ms).
- Mỗi cuộc gọi là một lần gõ cửa mới (số ẩn danh dùng chung identity).
