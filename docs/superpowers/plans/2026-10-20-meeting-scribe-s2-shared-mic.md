# Thư ký AI S2 (UNI-2024): micro hội trường và gán người nói — kế hoạch triển khai

> **Trạng thái:** in-progress — đủ server (migration, route shared-mic và speaker-labels, tên người nói trong transcript và tóm tắt), agent (tách người nói theo attribute), web (mục menu, hộp thoại gán) và hai việc sót của S1 trên nhánh `feature/UNI-2024-…`; chưa chạy thật với AssemblyAI, chờ review và merge.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.3, §6.2
(`meeting_participants.shared_mic_at/_by`), §6.3, §7.2 (shared-mic, speaker-labels), §9,
§10, §12 dòng S2, §12.1; spec cha §7.3 (thứ tự tên người nói). Nền: S1 (UNI-2023),
`2026-10-20-meeting-scribe-s1-base.md`. Cờ `meeting_scribe`.

## Mục tiêu

Clerk đặt một người tham gia (laptop giữa phòng) làm micro hội trường; server ghi DB và
đặt attribute LiveKit `uw.shared_mic=1`; agent mở lại luồng STT của track đó với tách
người nói, mỗi đoạn mang nhãn `<identity>:<lần mở phiên>:<nhãn nhà cung cấp>`. Clerk gán
mỗi nhãn cho một thành viên hoặc một tên tự do; transcript và tóm tắt dùng tên đã gán.

## Việc và test chứng minh

1. **Migration + query.** `meeting_participants.shared_mic_at/_by`; bảng
   `meeting_speaker_labels` (`label_key`, `user_id` NULL, `name`, `created_by(_kind)`) +
   unique `(meeting_id, label_key)` (file riêng, CONCURRENTLY). Test: lint migration,
   `TestEveryQueryNamesItsTenant`.
2. **Server.**
   - `ConferenceProvider.SetParticipantAttributes` (LiveKit `UpdateParticipant` chỉ với
     `Attributes`, không đụng quyền); token vào phòng mang `uw.shared_mic=1` khi đang bật
     (vào lại vẫn giữ). Token không bao giờ có `canUpdateOwnMetadata`.
   - `PUT /meetings/{meetingID}/participants/{participantID}/shared-mic {enabled}` (clerk):
     ghi cột, audit `meeting.shared_mic_toggled`, sự kiện `participant.updated`, đặt
     attribute khi đang họp. Test: chỉ clerk; attribute do server đặt (adapter giả);
     tắt thì xoá attribute.
   - `/agent/context` trả `shared_mic_identities`.
   - `AppendAgentSegments`: nhãn phải bắt đầu bằng `<participant_identity>:`; nhãn mới
     (trừ nhãn không rõ `…:?`) tạo dòng `meeting_speaker_labels`, phát `speaker_label.updated`.
   - `GET /meetings/{meetingID}/speaker-labels` (thành viên), `PUT
     …/speaker-labels/{speakerLabelID} {user_id?, name?}` (clerk; `user_id` không phải thành
     viên workspace → 422; cả hai rỗng → bỏ gán). Audit `meeting.speaker_label_assigned`,
     sự kiện `speaker_label.updated` (đủ ba catalogue).
   - Tên người nói (transcript đọc ra và đầu vào tóm tắt): tên đã gán → "Hội trường ·
     Người nói X" → "Hội trường · Không rõ"; đoạn không có nhãn giữ tên người tham gia.
     Test: tóm tắt nhận tên đã gán.
   - Hai việc sót của S1: SDI `segment_id` mô tả đúng dạng `<job>-<track>-<n>`; drain
     timeout của agent = grace − 120 s.
3. **Agent.** `make_stt(diarize=True)` → AssemblyAI `speaker_labels=True` chỉ cho track
   micro hội trường; `TrackTranscriber.set_diarize()` đóng phiên đang mở, phiên sau mở
   với tách người nói; `Final.speaker_label`. `FakeSTT(diarize=True)` gán nhãn `A` (đoạn
   ngắn không nhãn). Pytest: đổi attribute → mở lại luồng có tách người nói; nhãn đúng
   dạng; đoạn không nhãn → `…:?`.
4. **Web.** Core: `ParticipantSchema.shared_mic`, `setParticipantSharedMic`,
   `getSpeakerLabels`, `assignSpeakerLabel` + test phản hồi sai định dạng, hook, key
   `speakerLabels`, realtime `speaker_label.updated` → nhãn + transcript. Views: mục menu
   "Đặt làm micro hội trường" (clerk, khi thư ký đang trong phòng), nút "Gán người nói"
   cạnh transcript mở hộp thoại gán. Vitest: hộp thoại gán, mục menu.

## Quyết định

- Param `{speakerLabelID}` thay `{labelID}` của spec: `{labelID}` đã là nhãn task trong
  router và isolation matrix.
- Dòng nhãn được tạo khi đoạn đầu tiên mang nhãn đó tới (chưa gán: `user_id` NULL, `name`
  rỗng), để `GET` có id ổn định cho `PUT`.
- "Lần mở phiên" = `<job id>-<track sid>-<số phiên>`: nhãn nhà cung cấp chỉ đúng trong một
  phiên, và phiên đóng sau 30 giây im lặng; job id giữ nhãn khác nhau giữa các lần chạy.
- Đặt attribute sau khi commit, lỗi chỉ ghi log; token vào phòng mang attribute nên vào
  lại là đúng.

## Vòng sửa 1 (review)

- `meeting_speaker_labels` được xuất trong gói dữ liệu tổ chức (tên đã gán là nội dung);
  `meeting_scribe_runs` bị loại (sổ kỹ thuật, sửa trên nhánh S1).
- Người nói chưa gán được đánh số theo cuộc họp, theo lần xuất hiện đầu
  (`row_number() OVER (ORDER BY created_at, id)`): "Hội trường · Người nói n". Nhãn "A" của
  hai phiên STT là hai người khác nhau; không gộp nhãn qua phiên theo chữ của nhà cung cấp.
- Track micro hội trường đóng phiên STT sau **300 giây** im (track thường vẫn 30 giây), để một
  lần ngắt không sinh bộ nhãn mới. Chi phí: khoảng **+5,6 US cent cho mỗi lần ngắt thêm 5 phút
  trên mỗi micro hội trường** (thời gian mở phiên có tách người nói).
- Ngôn ngữ: tóm tắt truyền locale vào việc đặt tên ("Room · Speaker n" khi `en`); transcript
  trả thêm `speaker_label` + `room_speaker` cho dòng chưa gán để client tự viết tên qua i18n.
  `speaker_name` vẫn có bản tiếng Việt dựng sẵn cho client cũ.
- Gán nhãn: đọc dòng trước khi gán trong giao dịch (`FOR UPDATE`), trả một dòng (không đọc lại
  cả danh sách).
- Index `(meeting_id, speaker_label, spoken_at) WHERE speaker_label <> ''` cho câu đầu của nhãn.
