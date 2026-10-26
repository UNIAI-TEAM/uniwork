# MeetingScribeSttErrors — thư ký AI lỗi nhận dạng giọng nói

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Nền:** spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.1, §4.6; ADR 0045; benchmark UNI-1995 #1, #13

## Triệu chứng

- Alert `MeetingScribeSttErrors`: hơn 5% phiên STT agent mở trong 10 phút bị lỗi, và lỗi nhiều hơn 3 lần mỗi phút.
- Trong phòng họp: chip "Thư ký AI tạm dừng, đang thử lại" (agent đặt attribute `uw.scribe_state=degraded` khi mọi phiên của cuộc họp lỗi liên tục 20 giây mà không track nào ra được lời); phụ đề quay về giọng nói trên máy từng người cho tới khi STT chạy lại.
- Lời nói trong lúc lỗi được giữ tối đa 30 giây mỗi track (`BUFFER_MAX_S`) rồi gửi lại khi mở được phiên; lỗi dài hơn thì transcript của cuộc họp thiếu đoạn đó.

## Kiểm tra

1. Lỗi theo lý do:
   ```promql
   sum by (reason) (rate(scribe_stt_errors_total[10m]))
   sum(rate(scribe_stt_sessions_opened_total[1m])) * 60
   ```
   - `session_limit`: AssemblyAI từ chối phiên mới (đóng 1008 hoặc trả 429) vì vượt giới hạn **phiên mới mỗi phút** của tài khoản (S0 results dòng 5b). So số phiên mở mỗi phút ở dòng thứ hai với hạn mức tài khoản.
   - `stream`: phiên chết giữa chừng hoặc không mở được: key sai/hết hạn, nhà cung cấp sự cố, mạng ra ngoài bị chặn.
   - `push`: không gửi được âm thanh vào phiên đã chết; thường đi cùng `stream`.
2. Log agent (chỉ id và độ dài, không có lời nói): `kubectl -n uniwork logs deploy/uniwork-meeting-agent --since=15m | grep -E 'stt failed|stt dropped|scribe state'`. `reason=session_limit` hay `reason=stream` ở mỗi dòng `stt failed`.
3. Trang trạng thái của AssemblyAI (status.assemblyai.com) và vùng đang dùng: env `SCRIBE_STT_BASE_URL` của pod agent (rỗng thì theo `AI_MEETING_TRANSCRIBE_BASE_URL`: EU khi đó là `api.eu.assemblyai.com`).
4. Key: secret `uniwork-meeting-agent` khoá `ASSEMBLYAI_API_KEY` còn hiệu lực trên dashboard AssemblyAI.
5. Mạng: NetworkPolicy `uniwork-meeting-agent` mở 443 ra ngoài (`meetingAgent.egress.stt`).

## Khắc phục

- Key hết hạn hoặc bị thu hồi: thay secret `ASSEMBLYAI_API_KEY`, rồi `kubectl -n uniwork rollout restart deploy/uniwork-meeting-agent`. Pod cũ drain tới 4 giờ; pod mới nhận các cuộc họp mới, các phòng đang họp được sweep gửi lại agent khi agent cũ rời phòng.
- `session_limit`: xin AssemblyAI nâng hạn mức phiên mới mỗi phút (ghi số đã thoả thuận vào S0 results §3). Trong lúc chờ, agent tự lùi lại có jitter và giữ âm thanh; có thể tăng `SCRIBE_IDLE_CLOSE_S` (mặc định 30 giây) để bớt mở phiên, đổi lại tốn thêm tiền phiên mở (~0,45 USD/giờ phiên).
- Nhà cung cấp sự cố: không cần làm gì; agent tự thử lại, phòng dùng phụ đề trên máy. Báo cho chủ sản phẩm nếu kéo dài quá 30 phút giờ họp.
- Cần tắt ngay cho mọi tổ chức: tắt cờ `meeting_scribe` trong `/admin` hoặc `MEETING_SCRIBE_ENABLED=false` trên BE.

## Leo thang

- Lỗi kéo dài quá 30 phút trong giờ họp, hoặc mọi cuộc họp đều "tạm dừng": nâng sev 2, gọi on-call backend và người giữ tài khoản AssemblyAI.
- `session_limit` lặp lại mỗi đầu giờ: chủ sản phẩm thương lượng hạn mức với AssemblyAI (việc của owner, ghi trong report UNI-1995).
- Nghi rò key: thu hồi key trên dashboard AssemblyAI trước, rồi thay secret.
