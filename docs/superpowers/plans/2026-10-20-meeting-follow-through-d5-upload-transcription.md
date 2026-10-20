# Sau họp đợt 5 (UNI-2001): họp trực tiếp không có máy trong phòng — kế hoạch triển khai

> **Trạng thái:** in-progress — đủ server (held, purpose `meeting_audio` trên phiên tải BIGUP, bảng và worker ghi lời, provider BytePlus + gateway, nguồn transcript §7.3, thông báo) và web (hai hộp thoại, trạng thái ghi lời) trên nhánh `feature/UNI-2001-…`; chưa chạy với BytePlus thật, chờ review và merge; cờ ngoài nội bộ chờ thỏa thuận xử lý dữ liệu (§7.5).

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §1.1 G6/G7,
§1.3 D9, D10, D14, D15, §5.3, §5.5, §6.4, §7.3, §7.4, §7.5, §8.1–8.3, §9.2 mục 3, §12 dòng 5,
§13.1 đợt 5; spec thư ký AI §6.3 (nhãn `upload:<transcription_id>:<nhãn>`). Nền: S1
(UNI-2023, hợp đồng segment, quyền gói `meeting.transcription` theo phút) và S2 (UNI-2024,
bảng `meeting_speaker_labels`). Cờ `meeting_transcription`.

## Mục tiêu

Họp trực tiếp không có máy trong phòng vẫn có lời: chủ trì/admin "Ghi nhận đã họp"
(`SCHEDULED → ENDED`), clerk tải file ghi âm lên (phiên tải BIGUP, purpose `meeting_audio`),
server ghi lời theo lô qua BytePlus (gửi/hỏi) trong worker của `MeetingService`, tính vào
sổ phút `meeting.transcription`, báo người yêu cầu khi xong hoặc lỗi.

## Việc và test chứng minh

1. **Ghi nhận đã họp.** `POST /meetings/{meetingID}/held {started_at, ended_at}` (chủ
   trì/admin): chỉ từ `SCHEDULED` (khác → 409 `invalid_meeting_state`), `ended_at >
   started_at` và không ở tương lai (→ 422), ghi giờ thật, `ENDED`, dòng thời gian
   `MEETING_RECORDED_HELD`, audit `meeting.held_recorded` + sự kiện `meeting.ended`.
   Test DB: thành công; giờ sai 422; từ `ENDED` 409; thành viên thường 403.
2. **Purpose + phiên tải.** `files.MeetingAudio` (2 GiB, chỉ âm thanh: mpeg, mp4 (M4A),
   wav, ogg, webm; không `video/mp4`), migration mở purpose ở hai CHECK của
   `file_upload_sessions` và `opened_via='meeting_audio'` ở `file_multipart_uploads`.
   Lõi BIGUP (`document_upload_sessions.go`) nhận thêm đích `meeting_audio`: không ngưỡng
   20 MiB dưới, loại tệp đọc từ đầu tệp (probe) theo registry, kiểm lại khi hoàn tất bằng
   một lượt đọc băm (không spool), hoàn tất thì stage như phiên phiên bản. Route mở:
   `POST /meetings/{meetingID}/audio-upload-sessions` (clerk, `ENDED`, cờ + quyền gói);
   GET/complete/DELETE dùng chung `/upload-sessions/{id}`. Provider tham chiếu tệp cho
   `meeting_transcriptions.file_id`. Test DB: mở + tải + hoàn tất ra `upload_id`; tệp
   không phải âm thanh 415.
3. **Bảng `meeting_transcriptions`** (§5.3, có `organization_id`, `workspace_id`) + index
   `(meeting_id, created_at)`, unique `(file_id) WHERE status IN ('QUEUED','RUNNING')`,
   index hàng đợi; mỗi index một file CONCURRENTLY.
4. **Yêu cầu ghi lời.** `POST /meetings/{meetingID}/transcriptions {upload_id, language,
   consent}` (clerk, `ENDED`): thiếu `consent` → 422; claim tệp; đang chạy → 409
   `transcription_in_progress`; ước phút từ dung lượng (`EstimateAudioSecondsFromSize`)
   vượt phần còn lại → 402 `quota_exceeded`, không nhận; `starts_at` = giờ bắt đầu thực
   tế + tổng thời lượng các phần trước. Audit `meeting.transcription_requested`
   (metadata `consent_confirmed`), sự kiện `transcription.requested`.
   `GET /meetings/{meetingID}/transcriptions` cho thành viên.
5. **Provider + gateway.** `provider.FileTranscriber` (`Submit`, `Poll`); `BytePlusFileTranscriber`
   theo hợp đồng §7.4 (header `X-Api-Status-Code`, thiếu header là lỗi), `FakeFileTranscriber`;
   `ai.MeetingTranscribeFromEnv` (`AI_MEETING_TRANSCRIBE_*`). Gateway capability
   `meeting_transcribe`: dòng `ai_usage_events` lúc gửi, chốt lúc xong; phút vào sổ
   `meeting.transcription` (không vào tín dụng AI). Test httptest.
6. **Worker** trong `MeetingService.RunWorkers` (15 s): nhận bằng `FOR UPDATE SKIP LOCKED`
   + `lease_until`, gửi rồi hỏi, hạn `max(2 giờ, 3 × thời lượng ước)`, 3 lần thử có giãn
   cách, rồi `FAILED` + `error_code`. Xong trong một transaction: segment `TRANSCRIPTION`
   (`spoken_at = starts_at + start_ms`), nhãn `upload:<id>:<nhãn>`, `COMPLETE`, phút, audit
   `meeting.transcription_completed`, sự kiện `transcription.completed`, dòng thời gian
   `TRANSCRIPTION_COMPLETED`. Test DB với provider giả: lease, node khác nhận khi lease hết,
   lỗi 3 lần → `FAILED`, tính phí theo giây báo / theo dung lượng.
7. **Chọn nguồn §7.3** cho đọc transcript và đầu vào tóm tắt: hợp `AGENT` + lần `COMPLETE`
   mới nhất mỗi file; không có thì `CAPTION`. Test: hai file ghép đúng thứ tự với `AGENT`.
8. **Thông báo** `meeting_transcript_ready` / `meeting_transcript_failed` cho người yêu
   cầu (đẩy tắt). `TestKindsMatchClientList`, `TestTitles`.
9. **Web.** Core: endpoint + schema + test sai định dạng, hook, key `transcriptions`,
   realtime `transcription.*`, đích tải `meeting_audio`. Views: nút "Ghi nhận đã họp" ở
   hero (hộp thoại giờ), "Tải file ghi âm" ở mục Transcript (hộp thoại chọn tệp, ngôn ngữ,
   xác nhận) và trạng thái lần ghi lời gần nhất. Vitest hai hộp thoại.

## Quyết định

Ghi ở báo cáo (`Decision: …`). Hai điều spec giao kiểm đầu đợt:

- `video/mp4`: tài liệu BytePlus (file "bigmodel") chỉ liệt kê raw/wav/mp3/ogg; bản tham khảo
  chạy thật gửi thêm m4a, webm. Không nhận `video/mp4`; nhận mp3, m4a (`audio/mp4`), wav, ogg,
  webm.
- Phút ghi lời file tính vào cùng sổ `meeting.transcription` với thư ký AI, kiểm trước bằng
  ước lượng từ dung lượng cộng các việc đang chờ của tổ chức; 402 khi không đủ. Bật cờ ngoài nội bộ chờ §7.5 (thỏa thuận xử lý dữ liệu với
BytePlus).
