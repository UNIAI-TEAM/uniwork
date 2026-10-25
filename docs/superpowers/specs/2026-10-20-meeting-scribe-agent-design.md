# Meetings: Thư ký AI trong phòng họp (LiveKit Agents)

> **Trạng thái:** in-progress — spec đã duyệt ngày 2026-10-20 (chủ sản phẩm trả lời §13 cùng ngày); S0 xong (kết quả ở `2026-10-20-meeting-scribe-agent-s0-results.md`), S1 (UNI-2023) và S2 (UNI-2024) đang triển khai. S2 dùng tên param `{speakerLabelID}` thay `{labelID}` ở §7.2 (`{labelID}` đã là nhãn task trong router).

**Issue:** UNI-1995 (cha); S0 UNI-2022, S1 UNI-2023, S2 UNI-2024, S3 UNI-2025, S4
UNI-2026, S5 UNI-2027, S6 UNI-2028, S7 UNI-2029; hạ tầng SIP UNI-2030; ghi hình sang
`StartEgress` UNI-2031.

**Liên quan:** spec cha `2026-10-20-meeting-follow-through-design.md` (UNI-1995). Spec
này **thay đợt 5a** của spec cha (ghi lời từ bản ghi MP4); 5a và 5b cũ của spec cha gộp
thành đợt 5, chỉ còn ghi lời file tải lên (§11). Thay
khuyến nghị "bước tiếp theo" của `2026-09-08-meeting-stt-agents-evaluation.md`.

## 1. Mục tiêu

Đưa một **thư ký AI** vào mỗi phòng họp: một agent LiveKit vào phòng cùng mọi người, nghe
từng người, và làm những việc một thư ký giỏi làm.

**Nhóm A — nền (làm trước):**

- A1. Ghi lời từng người ngay lúc nói, phụ đề cho cả phòng.
- A2. Nhận đúng tên người và thuật ngữ nhờ từ khóa lấy từ ngữ cảnh cuộc họp.
- A3. Micro hội trường: một máy trong phòng họp trực tiếp, nhiều người nói, vẫn tách được
  người nói.
- A4. Việc đề xuất hiện ngay trong lúc họp.
- A5. Tóm tắt tự tạo khi họp xong.
- A6. Vận hành đúng chuẩn: chỉ vào phòng được gọi, token theo cuộc họp, tính phí, theo
  dõi.

**Nhóm B — sau khi A chạy ổn:**

- B7. Tóm tắt phần đã lỡ cho người vào muộn.
- B8. Hỏi UNI về cuộc họp bằng chữ.
- B9. Phụ đề dịch Việt ↔ Anh.
- B10. Gọi vào họp bằng điện thoại (SIP).

Thành công là: mọi cuộc họp online có transcript đúng người nói mà không ai phải bấm gì;
người khiếm thính hay ngồi chỗ ồn đọc được phụ đề; việc được giao ngay trong buổi họp;
tóm tắt có sẵn vài giây sau khi họp xong.

### 1.1 Hiện trạng

- Phụ đề hiện dùng Web Speech trong trình duyệt (`packages/views/meetings/meeting-captions.tsx`):
  chỉ nghe micro máy mình, không tách người nói, tiếng Việt yếu, phụ thuộc trình duyệt.
- `deploy/meeting-stt-agent/` là khung Python (`agent.py`: "attach STT pipeline here"),
  `livekit-agents>=0.12`, chưa chạy ở đâu.
- Route nhận lời từ agent: `POST /meetings/{meetingID}/transcript/agent`
  (`service/meeting_ai.go` `AppendTranscriptFromAgent`), xác thực bằng một secret chung
  `MEETING_STT_AGENT_SECRET`, so sánh `!=`, không chống trùng, không mốc ms.
- `GET /workspaces/{id}/meeting-capabilities` có `server_stt`; bật thì giao diện tắt Web
  Speech.
- LiveKit **tự host**, dùng chung với lms-core (`deploy/livekit/README.md`). Phòng tên
  `uw_mtg_{meetingID}`, người tham gia `uw_participant_{participantID}`
  (`internal/meetings/provider.go`). Go SDK `server-sdk-go/v2 v2.12.2` đã có
  `AgentDispatchClient`. Phòng được tạo ngay trong request Bắt đầu / Họp tức thì
  (`ensureProviderSession`); dòng outbox `provider.ensure_session` sau đó thường thoát sớm
  (`ensureAlreadySettled`), và reconcile chỉ xếp lại ensure cho phiên `IDLE`. Phòng có thể
  trống giữa cuộc họp rồi mở lại (`ReconcileProviderDesync`).
- Chủ sản phẩm xác nhận ngày 2026-10-20: lms-core **không** chạy LiveKit agent nào, nên
  không có agent lạ tự vào phòng UniWork.
- Server đã bỏ qua identity không bắt đầu bằng `uw_participant_` khi ghi lượt vào/ra
  (`participantIDFromIdentity`), nên agent không lọt vào điểm danh phía server.
- Quyền gói hiện có (`service/entitlement.go`): `meeting.participant_minutes`,
  `meeting.recording`, `meeting.ai_summary`. Chưa có `meeting.transcription`.
- `Summarize` chỉ chạy cho chủ trì/admin là người, lấy `userID` và locale của họ;
  `meeting_summaries` không có `created_by_kind`.
- Ask UNI đã có tool đọc `get_meeting_context` (`service/askuni_sources.go`) và luồng tóm
  tắt phần đã lỡ cho chat (`service/askuni_catchup.go`, C-13.7).

### 1.2 LiveKit Agents: dùng gì, không dùng gì

Đã đọc tài liệu ngày 2026-10-20 (nguồn ở §14).

| Dùng (chạy được khi tự host) | Không dùng |
|---|---|
| Gọi agent vào phòng theo tên (`agent_name`, `CreateDispatch`/`ListDispatch`/`DeleteDispatch`, job metadata ≤ 512 KiB) | LiveKit Inference, Krisp, Agent Insights, Simulations, Agent Builder — chỉ có trên LiveKit Cloud |
| Một job mỗi phòng (`JT_ROOM`), hàm chạy cho từng người (`ctx.add_participant_entrypoint`) | Một job mỗi người nói (`JT_PUBLISHER`): họp 300 người thành 300 tiến trình |
| STT dạng luồng qua plugin với key của mình; Silero VAD trên CPU | Turn detector: không có tiếng Việt, bản đầy đủ cần Cloud |
| Text stream (`stream_text`, topic và attribute tự đặt); kind participant `AGENT` để client lọc | Trợ lý nói bằng giọng (TTS/model realtime): xem §2. Phát `lk.transcription` từ luồng STT tự viết: tài liệu không có, nên không dựa vào |
| Từ khóa cho STT; tách người nói (`speaker_id`) cho một micro chung | Wakeword, avatar, AI xem chia sẻ màn hình |
| LLM qua endpoint chuẩn OpenAI hoặc gọi API của mình; OpenTelemetry; drain, health `:8081`, `load_threshold` | Tự dispatch lại khi lỗi (`restart_policy`): chỉ Cloud |

### 1.3 Quyết định

D1 và D2 lấy từ spec cha. D3–D12 là đề xuất của spec này, duyệt cùng spec. D13–D16 chủ
sản phẩm đã chốt ngày 2026-10-20 (§13).

| # | Quyết định |
|---|---|
| D1 | Một luồng cho mọi cuộc họp (spec cha D1). |
| D2 | AI chỉ đề xuất, người chốt (ADR 0010). Agent không ghi bảng nghiệp vụ; nó gửi lời và yêu cầu qua API, server quyết định. |
| D3 | **Một agent tên `uniwork-scribe`, một job mỗi cuộc họp**, viết bằng **Python** (plugin đủ nhất: hàm theo từng người, tách người nói, MCP). Không bao giờ chạy chế độ tự vào mọi phòng: LiveKit dùng chung với lms-core. |
| D4 | **Mỗi người một luồng STT**, có VAD; người nói là identity của track, không đoán. Chỉ luồng "micro hội trường" (A3) bật tách người nói. |
| D5 | **Agent gọi STT trực tiếp; mọi lời gọi LLM đi qua server** (`ai.Gateway`). Agent không giữ key LLM. Đây là ngoại lệ của luật "chỉ `internal/ai/provider` nói chuyện với nhà cung cấp model", nên đợt S1 viết **ADR 0045**. |
| D6 | **Token theo cuộc họp** thay secret chung: server ký khi gọi agent vào phòng, gắn `meeting_id`, đặt trong job metadata. Route agent chỉ nhận token này và chỉ cho đúng cuộc họp đó. *Sửa (UNI-1995 benchmark #25):* token sống theo **lần chạy** — nhận khi lần chạy còn mở hoặc trong 10 phút sau khi đóng, trần cứng 24 giờ kể từ lúc gọi; không còn "giờ kết thúc dự kiến + 4 giờ". Gặp 404 giữa chừng ở `/agent/segments`, agent rời phòng để vòng quét gọi lần chạy mới. Lời nói sau lúc lần chạy đóng (tắt thư ký đóng lần chạy trong cùng transaction) không bao giờ được lưu, kể cả khi thư ký được bật lại. |
| D7 | **Phụ đề do agent phát** lên text stream topic riêng `uw.caption` ngay trong phòng (primitive có tài liệu); client UniWork tự đọc. Không dùng `lk.transcription` (không có tài liệu cho luồng STT tự viết). Chỉ đoạn **final** được lưu vào DB. |
| D8 | **Agent không tính là người tham gia.** Server đã bỏ qua identity không phải `uw_participant_` khi ghi lượt vào/ra; client lọc theo **kind participant `AGENT`** của LiveKit (không theo tiền tố identity) ra khỏi lưới hình, danh sách người, điều hành, đếm người; hiện riêng thành chip "AI ghi lời". |
| D9 | **Hạn mức là số phút ghi lời mỗi tháng theo gói** (`meeting.transcription`, đo như `meeting.participant_minutes`, ghi vào cùng sổ đo của gói, không vào tín dụng AI). Tính theo giây nói (sau VAD) agent báo. **Hết hạn mức giữa cuộc họp: cuộc họp đang dở vẫn ghi đến hết**, phần vượt được ghi nhận; cuộc họp bắt đầu sau đó không có thư ký (Web Speech). Báo owner/admin tổ chức khi dùng 80% và 100%. Các lời gọi LLM (việc trong lúc họp, tóm tắt, dịch, tóm tắt phần đã lỡ) vẫn trừ tín dụng AI qua `ai.Gateway`. Quyền gói này mở cả thư ký AI lẫn ghi lời file (spec cha D15). |
| D10 | **Trợ lý chỉ trả lời bằng chữ, riêng cho người hỏi** (B8). Không có bot lên tiếng trong phòng. |
| D11 | **Phụ đề dịch do agent phát** theo nhu cầu: chỉ dịch khi trong phòng có người chọn ngôn ngữ khác; bản dịch không lưu. Lựa chọn ngôn ngữ đi qua server; token phòng **không bao giờ** có `canUpdateOwnMetadata` (nếu có, ai cũng tự đổi được tên, attribute `uw.shared_mic`, `uw.kind`). |
| D17 | **Tóm tắt phần đã lỡ và Hỏi UNI chỉ cho thành viên workspace**, không cho khách. Khách vẫn thấy phụ đề trực tiếp. |
| D18 | **Một cuộc họp có thể có nhiều lần chạy agent.** LiveKit kết thúc job khi phòng không còn ai; phòng mở lại thì gọi agent lần mới. Hết phòng là kết thúc bình thường, không tính là lỗi. |
| D12 | **Lỗi agent không làm hỏng cuộc họp:** không có agent trong phòng thì client quay về Web Speech như hiện nay. |
| D13 | Nhà cung cấp STT trực tiếp: **AssemblyAI Universal-3.6 Pro Streaming** (`universal-3-6-pro`, chọn ở S0) (có tiếng Việt, tự chuyển Việt–Anh, tách người nói, từ khóa, plugin Python và Node), **đo thử ở S0** trước khi làm S1. Agent chọn qua `SCRIBE_STT_PROVIDER`, nên đổi nhà cung cấp không phải sửa code. Ghi lời file tải lên cũng dùng AssemblyAI (API file ghi sẵn, spec cha D14, thay BytePlus ngày 2026-10-21): một nhà cung cấp STT duy nhất. |
| D14 | **Mặc định bật** cho tổ chức có quyền gói; phòng luôn hiện báo hiệu; chủ trì/admin tắt hoặc bật lại cho từng cuộc họp, kể cả giữa chừng. |
| D15 | **Việc đề xuất trong lúc họp** nằm trong nhóm A (A4). |
| D16 | **Tóm tắt tự tạo** khi họp xong, nếu có lời hoặc ghi chú (A5); tổ chức tắt được. |
| D10a | (UNI-1995 access, 2026-10-23) Ngoại lệ duy nhất của D10: người gọi điện thoại không thấy chip, nên khi chủ trì nhận họ vào (`uw.dial_in=admitted`) agent phát **một lần** lời báo thư ký AI tiếng Việt (`apps/meeting-agent/assets/sip-notice-vi.wav`), track chỉ người gọi đó được subscribe. Agent vì thế có quyền publish nguồn microphone, chỉ cho track này. |
| D14a | (UNI-1995 access) **Chính sách thư ký của tổ chức** `meeting_settings.scribe_policy`: `on` (mặc định, như D14) \| `opt_in` (cuộc họp tạo từ nay tắt thư ký; chủ trì bật trong form lên lịch, trang cuộc họp hoặc phòng) \| `off` (không bao giờ gọi agent; `PUT /scribe` bật lại trả 409 `scribe_off_by_policy`). Owner/admin tổ chức đổi, ghi audit `meeting.settings_changed`. |
| D14b | (UNI-1995 access) **Báo trước khi vào:** prejoin, phòng chờ và trang mời của khách hiện một lần mỗi cuộc họp lời báo ai lưu bản ghi, ai đọc được, và âm thanh được xử lý ở ngoài Việt Nam; khách thấy chip thư ký chỉ đọc trong phòng. |
| D17a | (UNI-1995 access) **Nội dung AI chỉ cho người của cuộc họp:** transcript, tóm tắt AI, dòng trích dẫn, tóm tắt phần đã lỡ, nhãn người nói, Ask UNI/MCP đọc transcript/tóm tắt — chỉ chủ trì, thư ký, người tham gia có dòng `ACTIVE` (được mời, được nhận vào, đã dự; bị gỡ thì mất), quản trị workspace (owner/admin tổ chức là admin ngầm). Người khác nhận 403 `meeting_ai_restricted`. Chủ trì/thư ký bật "chia sẻ nội dung AI với cả workspace" (`PUT /meetings/{id}/ai-sharing`, audit `meeting.ai_sharing_changed`, mặc định tắt). Thông tin cuộc họp (tiêu đề, giờ, chương trình, việc) giữ phạm vi workspace. |

## 2. Ngoài phạm vi

- Trợ lý nói bằng giọng, lệnh bằng giọng ("UNI ơi"), wakeword, avatar, AI xem chia sẻ màn
  hình. Lý do: turn detector không có tiếng Việt, model realtime không ghi hỗ trợ tiếng
  Việt, một phiên agent chỉ nghe một người, wakeword chạy phía client và không có SDK web,
  video chỉ Python và chỉ đọc một track.
- Ghi lời từ file bản ghi MP4 (bỏ khỏi spec cha, §11).
- Chuyển ghi hình sang `StartEgress`: `StartRoomCompositeEgress` đã deprecated, bản thay
  cần LiveKit server ≥ v1.13.5. Làm ở một issue nợ kỹ thuật riêng (§12).
- Lọc ồn phía agent (Krisp là Cloud; ai-coustics cần license riêng).
- Lưu bản dịch phụ đề; dịch transcript đã lưu.

**Thất bại dù chạy đúng kỹ thuật:** agent vào phòng của lms-core; agent được tính vào
điểm danh hay tỉ lệ có mặt; nội dung lời nói xuất hiện trong log; một cuộc họp thiếu
transcript chỉ vì agent lỗi mà không ai biết; phí STT tính cả lúc im lặng.

## 3. Kiến trúc

```
Bắt đầu họp ──► outbox provider.ensure_session ──► EnsureSession (phòng uw_mtg_…)
                                                     │ thư ký đang bật?
                                                     ▼
                                     CreateDispatch(agent_name="uniwork-scribe",
                                                    room, metadata{meeting_id, token, locale})
                                                     │
              ┌──────────────────────────────────────▼───────────────────────────────┐
              │ Job agent (Python, một tiến trình mỗi cuộc họp)                      │
              │  GET /agent/context ──► từ khóa, ngôn ngữ, ai là micro hội trường    │
              │  mỗi người tham gia ──► mỗi track mic: VAD ─► luồng STT              │
              │      interim/final ──► text stream uw.caption (phụ đề)               │
              │      final (lô 2 giây) ──► POST /agent/segments                      │
              │  nhịp "việc trong lúc họp" ──► POST /agent/extract                   │
              │  nhu cầu dịch ──► POST /agent/translate ──► text stream uw.caption.en│
              │  phòng đóng ──► xả nốt ──► POST /agent/finished                      │
              └──────────────────────────────────────────────────────────────────────┘
Server: lưu đoạn (chống trùng), tính phí, rút việc qua ai.Gateway → action_item.created,
        kết thúc → tóm tắt tự động → thông báo "Tóm tắt đã sẵn sàng".
```

## 4. Nhóm A

### 4.1 A1 — Ghi lời từng người và phụ đề

**Gọi agent vào phòng.** Một hàm duy nhất `ensureScribe(meetingID)` sở hữu việc này,
được gọi từ hai chỗ:
- Ngay sau `ensureProviderSession` thành công trong Bắt đầu / Họp tức thì, không chặn
  request; lỗi chỉ ghi log.
- Một vòng quét mỗi 15 giây trong `MeetingService.RunWorkers` cho mọi cuộc họp
  `IN_PROGRESS`.

Không đặt ở `applyOutbox`: dòng `provider.ensure_session` thường thoát sớm vì phòng đã có.

`ensureScribe` gọi agent (`CreateDispatch`, metadata như D6) khi **đủ cả**:
- cuộc họp `IN_PROGRESS`, thư ký bật (D14), cờ bật, cấu hình agent có trên server;
- quyền gói `meeting.transcription` còn phút **lúc bắt đầu lần chạy** (D9);
- phiên hội nghị `ACTIVE`, tức có người trong phòng (phòng trống thì LiveKit kết thúc job
  ngay);
- chưa có lần chạy `DISPATCHED`/`ACTIVE` (§6.1).

Mỗi lần gọi tạo một dòng `meeting_scribe_runs`. Thêm vào `ConferenceProvider` hai hàm
`DispatchScribe` / `RemoveScribe`; adapter giả trong test. Tắt thư ký giữa chừng thì
`DeleteDispatch` và gỡ participant agent.

**Nhiều lần chạy (D18).**
- Phòng trống: agent xả nốt rồi gọi `/agent/finished`; lần chạy thành `FINISHED` và chốt
  phí của lần đó. Phòng có người lại thì vòng quét gọi lần mới.
- **Lỗi** chỉ tính khi lần chạy không `ACTIVE` trong 60 giây mà phòng vẫn có người. Ba lần
  lỗi liên tiếp → `FAILED`, phòng báo "AI ghi lời đang gặp lỗi", vòng quét thử lại sau 10
  phút.

**Identity và quyền của agent.** Identity `uw_agent_scribe`, tên hiển thị "UniWork AI"
(i18n phía client theo identity), attribute `uw.kind=scribe`. Quyền: subscribe, publish
data; không publish âm thanh/hình; không ẩn (người trong phòng phải thấy nó).
`on_request` từ chối mọi job không có metadata hợp lệ.

**Trong job.**
- `ctx.connect(auto_subscribe=AUDIO_ONLY)`; `add_participant_entrypoint` cho mọi người
  tham gia, bỏ qua identity bắt đầu bằng `uw_agent_` và participant egress.
- Mỗi track mic một luồng: Silero VAD → luồng STT của plugin. Model AssemblyAI phải là
  Universal-3.5 Pro hoặc 3.6 Pro (chỉ hai bản này có tiếng Việt; không dùng
  `universal-streaming*`).
- **Đóng phiên STT sau 30 giây im lặng** (theo VAD), mở lại khi có tiếng. Nhà cung cấp có
  thể tính tiền theo thời gian mở phiên; không đóng thì chi phí thật cao hơn hẳn số giây
  nói ta tính cho khách. S0 xác nhận cách AssemblyAI tính tiền.
- Người rời phòng thì đóng luồng. Mất kết nối STT thì thử lại có giãn cách, không làm rơi
  job.
- Ngôn ngữ: `locale` của tổ chức trong metadata (mặc định `vi`), bật tự chuyển ngôn ngữ
  nếu plugin hỗ trợ.
- **Phụ đề:** mỗi đoạn interim/final phát lên topic `uw.caption`, attribute
  `uw.participant_identity`, `uw.segment_id`, `uw.final` (`1`/`0`), `uw.language`.
  Interim và final của cùng một đoạn chung `uw.segment_id`.
- **Lưu:** đoạn final gom lô (tối đa 2 giây hoặc 20 đoạn) gửi `POST /agent/segments`.
  Mỗi đoạn có `segment_id` do agent đặt, `participant_identity`, `spoken_at`/`ended_at`
  (RFC 3339, ms), `speech_ms` (thời lượng có tiếng theo VAD), `text`, `language`, và
  `speaker_label` nếu là micro hội trường.
- **Không log nội dung lời nói**, chỉ id và độ dài (cùng tinh thần `scripts/no-pii-log.test.mjs`).

**Server nhận đoạn.** Thay `AppendTranscriptFromAgent` bằng `AppendAgentSegments`:
- Chỉ nhận khi cuộc họp `IN_PROGRESS`, hoặc `ENDED` trong 10 phút để xả nốt.
- Chống trùng bằng `(meeting_id, client_segment_id)`.
- Ghi `source='AGENT'`, `start_ms`/`end_ms` tính từ giờ bắt đầu thực tế.
- Cộng `speech_ms` vào lần chạy (§6.1) để tính phí.
- Phát `transcript.appended` như hiện nay.

**Client.**
- Handler text stream topic `uw.caption`. Tên người lấy từ participant LiveKit có identity
  trong `uw.participant_identity`; tên đó do server đặt trong token và client không đổi
  được. Interim hiện mờ, final thay thế. Có nút bật/tắt phụ đề cho từng người xem.
- Có participant kind `AGENT` trong phòng thì tắt Web Speech; không có thì giữ Web Speech
  (D12).
- Chip "AI đang ghi lời" ở thanh phòng. Lọc agent khỏi lưới hình, danh sách người, điều
  hành và đếm người theo kind `AGENT` (D8).

### 4.2 A2 — Từ khóa theo ngữ cảnh

`GET /agent/context` trả: tiêu đề cuộc họp, tên hiển thị của người được mời và người
tham gia, tên dự án, tên workspace, `locale`, danh sách participant đang là micro hội
trường. Agent dựng danh sách từ khóa (tối đa 100, cắt theo giới hạn plugin) và đặt vào
tùy chọn từ khóa của plugin (AssemblyAI `keyterms_prompt`, Deepgram `keyterm`). Người mới
vào phòng thì cập nhật luồng của người đó. Server không trả email hay dữ liệu ngoài cuộc
họp.

### 4.3 A3 — Micro hội trường

- Clerk bật "Micro hội trường" cho một người tham gia (thường là laptop đặt giữa phòng).
  Server ghi `meeting_participants.shared_mic_at` và đặt attribute LiveKit
  `uw.shared_mic=1` qua `UpdateParticipant`.
- Agent thấy attribute đổi thì mở lại luồng của track đó với tách người nói. Mỗi đoạn mang
  `speaker_label` dạng `<participant>:<số lần mở luồng>:<nhãn nhà cung cấp>`, vì nhãn của
  nhà cung cấp chỉ đúng trong một phiên. Chỉ server đặt attribute này (D11).
- Giới hạn đã biết của AssemblyAI khi bật tách người nói: phụ đề interim thưa hơn; đoạn
  ngắn dưới khoảng 1 giây không có nhãn, ghi "Hội trường · Không rõ".
- **Gán người nói** ở cấp cuộc họp (bảng §6.3): clerk gán mỗi nhãn cho một thành viên hoặc
  một tên tự do. Bảng này **dùng chung với file tải lên** (spec cha đợt 5, thay cột
  `speakers` của `meeting_transcriptions`).
- Tên người nói: tên đã gán → "Hội trường · Người nói n".

### 4.4 A4 — Việc đề xuất trong lúc họp

- **Nhịp.** Agent gọi `POST /agent/extract` khi đủ cả hai điều kiện:
  - từ lần trước ≥ 3 phút và có ≥ 15 đoạn final mới; **hoặc** có khoảng lặng ≥ 20 giây
    sau ≥ 5 đoạn mới;
  - chưa vượt trần 20 lần mỗi giờ.

  Agent gọi thêm một lần khi phòng đóng.
- **Server.**
  1. Đọc các đoạn sau con trỏ của lần chạy (§6.1).
  2. Prompt `meeting_live_items@1` qua `ai.Gateway`, kèm khối việc đã có trong
     `<untrusted>`, cùng luật không đoán người, không đoán hạn như `meeting_summary@3`.
  3. Thêm việc mới vào `meeting_action_items` (spec cha §5.1) với `source='LIVE'`, lọc
     trùng tiêu đề với mọi việc của cuộc họp.
  4. Phát `action_item.created`, dời con trỏ.

  Kiểm quyền gói và hạn mức như tóm tắt; hết hạn mức thì im lặng bỏ qua, ghi metric.
- Việc `LIVE` sống như việc tay khi tạo lại tóm tắt: không bị thay (sửa spec cha D6).
- Copilot trong phòng và mục "Việc sau họp" đã có ở spec cha đợt 3; việc `LIVE` có nhãn
  "Trong lúc họp" và mốc giờ.

### 4.5 A5 — Tóm tắt tự tạo khi họp xong

- Chỉ **cuộc họp chuyển `ENDED`** mới mở tóm tắt tự động; `/agent/finished` của một lần
  chạy giữa chừng (phòng trống, D18) thì không. Có lần chạy đang mở → chờ
  `POST /agent/finished`, tối đa 90 giây. Không có → chờ 10 giây.
- Sau đó, nếu có nguồn tóm tắt (lời, ghi chú, chat, biểu quyết) và tổ chức có quyền gói
  `meeting.ai_summary`, worker trong `MeetingService.RunWorkers` chạy, không qua outbox vì
  một lần tóm tắt có thể vượt 120 giây.
- Worker gọi hàm mới **`SummarizeAuto(ctx, meetingID)`**, không phải `Summarize`.
  `Summarize` đòi chủ trì/admin là người và dùng `userID`/locale của họ.
  - `SummarizeAuto` dùng chung phần thân với `Summarize`, actor hệ thống
    `meeting_auto_summary`, locale theo tổ chức.
  - Dùng chung khóa thuê `meeting_summary_runs` để không trùng với người bấm tay.
  - Migration thêm `meeting_summaries.created_by_kind TEXT NOT NULL DEFAULT 'human'`
    (luật cặp attribution).
- Thành công → kind thông báo mới `meeting_summary_ready` cho chủ trì và thư ký, thay
  `meeting_summary_reminder` cho cuộc họp đó. Thất bại hoặc tắt → giữ nhắc như cũ.
- Tổ chức tắt được tóm tắt tự động trong cài đặt cuộc họp (mặc định bật).

### 4.6 A6 — Vận hành

- **Mã nguồn:** `apps/meeting-agent/` (Python, có `CLAUDE.md` riêng như
  `apps/chat-desktop`), thay `deploy/meeting-stt-agent/`. Ghim `livekit-agents` 1.8.x và
  plugin; ruff + pytest trong một workflow CI riêng (như `mobile-verify.yml`), không nằm
  trong turbo.
- **Triển khai:** Deployment k8s namespace `uniwork`.
  - Khởi đầu 4 CPU/8 GB mỗi pod (tài liệu LiveKit: 10–25 job mỗi pod).
  - `num_idle_processes` theo CPU, `load_threshold` 0,7, HPA theo CPU ở 50%.
  - Health `:8081`.
  - Drain: `drain_timeout` và `terminationGracePeriodSeconds` bằng 4 giờ.
  - NetworkPolicy chỉ ra LiveKit, nhà cung cấp STT và `uniwork-be`.
- **Cấu hình server Go** (khai báo trong `.env.example`): `MEETING_SCRIBE_AGENT_NAME`
  (mặc định `uniwork-scribe`), `MEETING_SCRIBE_ENABLED`. Bỏ `MEETING_STT_AGENT_SECRET`.
- **Cấu hình agent:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `UNIWORK_API_URL`, `SCRIBE_STT_PROVIDER`, key của nhà cung cấp STT, OTLP endpoint.
- **Theo dõi:** trace OpenTelemetry vào collector có sẵn (`deploy/otel-collector.yaml`).
  Metric: job đang chạy, độ trễ STT, lỗi STT, số đoạn, giây nói, số lần rút việc.
  Thêm alert "thư ký không vào được phòng" vào `deploy/alerts.yml`, kèm runbook bốn phần
  trong `docs/runbooks/`.
- **Kiểm phòng thiếu agent:** chính vòng quét 15 giây của `ensureScribe` (§4.1), bù cho
  `restart_policy` chỉ có trên Cloud.
- **Hạn mức (D9):** cộng `speech_ms` của mọi lần chạy vào sổ đo phút của gói. Kiểm còn phút
  khi bắt đầu một lần chạy, không cắt lần đang chạy. Báo owner/admin khi đạt 80% và 100%,
  dùng cơ chế cảnh báo hạn mức sẵn có của gói nếu có; không có thì thêm kind
  `meeting_transcription_quota`.
- **Pháp lý:** đúng điều kiện spec cha §7.5 cho nhà cung cấp STT trực tiếp (thỏa thuận xử
  lý dữ liệu, vùng xử lý, hồ sơ chuyển dữ liệu ra nước ngoài). Không bật cờ cho khách
  trước khi xong.
- **Bật/tắt:** cờ `meeting_scribe` (`review_at` 90 ngày), quyền gói
  `meeting.transcription`, cài đặt cuộc họp (D14).

## 5. Nhóm B

### 5.1 B7 — Tóm tắt phần đã lỡ

- Người vào phòng muộn ≥ 10 phút so với giờ bắt đầu thực tế thấy thẻ "Bạn vào sau 23 phút
  — xem tóm tắt phần đã lỡ" trong copilot. Bấm mới tạo, không tự tốn tiền.
- `POST /meetings/{meetingID}/catch-up`: **chỉ thành viên workspace** (D17); khách nhận
  403 và không thấy thẻ. Server dùng lại khung `askuni_catchup.go` với nguồn là đoạn lời và ghi chú từ
  đầu họp, prompt `meeting_catch_up@1` qua `ai.Gateway`.
- Kết quả gom theo cuộc họp trong 2 phút (Redis nếu có, không thì bộ nhớ). Năm người vào
  muộn cùng lúc chỉ tốn một lần gọi.
- Trả về cho riêng người hỏi. Mỗi ý có mốc giờ trỏ về đoạn lời.

### 5.2 B8 — Hỏi UNI về cuộc họp

- Ô "Hỏi UNI" trong copilot (trong phòng và trên trang chi tiết), chỉ hiện cho thành viên
  workspace (D17). Gọi Ask UNI có sẵn với phạm vi cuộc họp; tool chạy qua `RequireMember`
  như mọi tool Ask UNI.
- Thêm tool đọc `get_meeting_transcript` (đọc theo khoảng thời gian, tìm theo từ, tối đa
  200 đoạn mỗi lần, đúng quyền đọc cuộc họp), cạnh `get_meeting_context`.
  `TestAskUniToolsAreReadOnly` vẫn phải xanh.
- Câu trả lời chỉ người hỏi thấy, có trích mốc giờ. Nút "Chia sẻ vào chat cuộc họp" gửi
  như một tin nhắn của người hỏi.
- Tính vào capability Ask UNI hiện có.

### 5.3 B9 — Phụ đề dịch Việt ↔ Anh

- Người xem chọn ngôn ngữ phụ đề trong phòng (Gốc / Tiếng Việt / English). Client gọi
  `PUT /meetings/{meetingID}/caption-language {lang}` (người đang trong phòng, kể cả
  khách); server đặt attribute `uw.caption_lang` cho đúng participant đó qua
  `UpdateParticipant`. Client không tự đổi attribute (D11).
- Agent đọc attribute của mọi người. Có ít nhất một người cần ngôn ngữ L khác ngôn ngữ của
  đoạn → gom đoạn final (tối đa 1 giây) gửi `POST /agent/translate {segments, target}`.
- Server dịch qua `ai.Gateway` (prompt `caption_translate@1`, giữ nguyên tên riêng và
  thuật ngữ trong danh sách từ khóa). Agent phát lên topic `uw.caption.<L>` cùng
  `uw.segment_id`.
- Không lưu bản dịch. Trần 1 lần gọi mỗi giây mỗi ngôn ngữ mỗi cuộc họp. Tính phí theo
  capability `caption_translate`.

### 5.4 B10 — Gọi vào họp bằng điện thoại

**Điều kiện hạ tầng.** Đây là issue riêng, do ops quyết:
- Dịch vụ `livekit-sip` có Redis.
- Mở công khai cổng 5060 và RTP 10000–20000.
- Một SIP trunk của nhà mạng Việt Nam.
- Một số tổng đài cho mỗi môi trường.

**Sản phẩm.**
- Mỗi cuộc họp có mã PIN 6 số (`meetings.dial_in_pin`, sinh khi tạo, đổi được). Khi bắt
  đầu họp, server tạo SIP dispatch rule `direct` trỏ vào phòng với PIN đó; khi kết thúc
  thì xoá.
- Người gọi vào có identity `uw_sip_<id>`, tên "Điện thoại ••• 1234" (chỉ 4 số cuối). Họ
  đi qua phòng chờ như khách: chủ trì duyệt.
- Họ được ghi lời như mọi người (A1), được tính điểm danh như khách (dự thính).
- Trang chi tiết và thư mời hiện số tổng đài và PIN.

## 6. Mô hình dữ liệu

Theo luật migration của repo (spec cha §5).

### 6.1 `meeting_scribe_runs`

Mỗi lần gọi agent vào phòng một dòng; một cuộc họp có thể có nhiều dòng (D18).

| Cột | Ghi chú |
|---|---|
| `id`, `organization_id`, `workspace_id`, `meeting_id` | |
| `dispatch_id` | id dispatch của LiveKit |
| `status` | `DISPATCHED` / `ACTIVE` / `FINISHED` / `FAILED` |
| `failures INT` | số lần không `ACTIVE` trong 60 giây khi phòng có người (§4.1) |
| `started_at`, `finished_at` | `ACTIVE` khi agent gọi `/agent/started` |
| `speech_ms BIGINT`, `segments INT` | cộng dồn khi nhận đoạn |
| `metered_ms BIGINT` | phần `speech_ms` đã ghi vào sổ đo phút của gói (ghi mỗi 5 phút và khi `FINISHED`) |
| `extract_cursor_segment_id`, `extracts INT`, `last_extract_at` | A4 |
| `created_by`, `created_by_kind` | `meeting_scribe` / `system` |
| `created_at`, `updated_at` | |

Index: `(meeting_id, created_at)`; **unique** `(meeting_id) WHERE status IN
('DISPATCHED','ACTIVE')`.

### 6.2 Cột mới

- `meetings.scribe_off_at`, `meetings.scribe_off_by`: tắt thư ký cho cuộc họp (D14);
  `NULL` = theo mặc định của tổ chức.
- `meeting_participants.shared_mic_at`, `shared_mic_by` (A3).
- `meetings.dial_in_pin`, `meetings.sip_dispatch_rule_id` (B10).
- `meeting_action_items.source` thêm giá trị `LIVE`.
- `meeting_transcript_segments`: các cột của spec cha §5.4 (`source` thêm `AGENT`,
  `client_segment_id` + unique, `start_ms`, `end_ms`, `speaker_label`) và `language`.
- Cài đặt tổ chức: `auto_summary` (A5), lưu cùng chỗ với các cài đặt cuộc họp sẵn có của
  tổ chức; builder chọn đúng bảng.

### 6.3 `meeting_speaker_labels`

| Cột | Ghi chú |
|---|---|
| `id`, `organization_id`, `workspace_id`, `meeting_id` | |
| `label_key` | như §4.3, hoặc `upload:<transcription_id>:<nhãn>` cho file tải lên |
| `user_id` NULL, `name` | một trong hai; `name` tối đa 120 ký tự |
| `created_by`, `created_by_kind`, `created_at`, `updated_at` | |

Unique `(meeting_id, label_key)`. Thay cột `speakers` của `meeting_transcriptions` ở spec
cha.

## 7. API

### 7.1 Cho agent (token cuộc họp, D6)

Middleware `RequireMeetingAgentToken`: đọc `Authorization: Bearer uwma_…`, kiểm chữ ký và
hạn, `meeting_id` của token phải trùng `{meetingID}`, nếu không thì 404. Gắn actor hệ thống
`meeting_scribe` vào request. Rate limit theo token: `meeting-agent`, 600 lần/phút. Không
nhận session JWT.

| Method + path | Ghi chú |
|---|---|
| `POST /meetings/{meetingID}/agent/started` | run → `ACTIVE` |
| `GET /meetings/{meetingID}/agent/context` | A2 |
| `POST /meetings/{meetingID}/agent/segments` | A1; tối đa 50 đoạn, mỗi đoạn ≤ 4.000 ký tự |
| `POST /meetings/{meetingID}/agent/extract` | A4 |
| `POST /meetings/{meetingID}/agent/translate` | B9 |
| `POST /meetings/{meetingID}/agent/finished` | run → `FINISHED`, chốt phí, mở A5 |

Route cũ `POST /transcript/agent` bị xoá cùng đợt S1 (khung agent chưa chạy ở môi trường
nào).

### 7.2 Cho người dùng

| Method + path | Quyền | Ghi chú |
|---|---|---|
| `PUT /meetings/{meetingID}/scribe` `{enabled}` | chủ trì/admin | D14; giữa cuộc họp thì dispatch hoặc gỡ ngay |
| `PUT /meetings/{meetingID}/participants/{participantID}/shared-mic` `{enabled}` | clerk | A3 |
| `GET /meetings/{meetingID}/speaker-labels` | thành viên | nhãn chưa gán và đã gán |
| `PUT /meetings/{meetingID}/speaker-labels/{labelID}` `{user_id?, name?}` | clerk | `user_id` phải là thành viên được giao việc |
| `POST /meetings/{meetingID}/catch-up` | thành viên workspace | B7 |
| `PUT /meetings/{meetingID}/caption-language` `{lang}` | người đang trong phòng (cả khách) | B9; server đặt attribute |
| `GET /meetings/{meetingID}/dial-in` | thành viên | B10: số tổng đài, PIN |

`GET /workspaces/{id}/meeting-capabilities`: `server_stt` thay bằng `scribe` (thư ký có
cho workspace này không). Trạng thái từng cuộc họp (`scribe_enabled`, `scribe_status`)
nằm trong chi tiết cuộc họp. Param mới `{labelID}` cần case trong `openapi.go`. Mỗi
endpoint mới có test phản hồi sai định dạng phía client.

## 8. AI

| Prompt / capability | Dùng ở | Ghi chú |
|---|---|---|
| `meeting_live_items@1` / `meeting_live_items` | A4 | đầu vào: đoạn mới + khối việc đã có (`<untrusted>`); đầu ra như `action_items` của tóm tắt |
| `meeting_summary@4+` / `meeting_summarization` | A5 | prompt của spec cha; actor hệ thống |
| `meeting_catch_up@1` / `meeting_catch_up` | B7 | khung `askuni_catchup.go` |
| Ask UNI (có sẵn) | B8 | thêm tool đọc `get_meeting_transcript` |
| `caption_translate@1` / `caption_translate` | B9 | giữ tên riêng, không thêm ý |
| STT (không qua gateway) | A1 | đo phút vào sổ của gói `meeting.transcription` (D9), không vào tín dụng AI |

Mọi nội dung lời nói đưa vào prompt đều nằm trong `<untrusted>`. Lời nói là dữ liệu, không
là lệnh: không ai "ra lệnh" được cho UNI bằng cách nói trong phòng.

## 9. Audit, sự kiện, thông báo

- **Audit:** `meeting.scribe_toggled`, `meeting.shared_mic_toggled`,
  `meeting.speaker_label_assigned`, `meeting.dial_in_pin_rotated`, và `meeting.action_item_created`
  cho việc `LIVE` (actor hệ thống `meeting_scribe`). Đoạn lời **không** audit từng đoạn,
  như hiện nay. Tóm tắt tự động dùng audit `meeting.summary_created` sẵn có, actor hệ
  thống. Thêm từng action vào `audit_coverage_test.go`.
- **Sự kiện** (đủ ba catalogue): `scribe.updated` `{meeting_id, workspace_id}` (bật/tắt,
  trạng thái run); `speaker_label.updated` `{meeting_id, workspace_id}`. Việc `LIVE` dùng
  `action_item.created` của spec cha.
- **Thông báo:** kind `meeting_summary_ready` (A5): trong app và email bật, đẩy bật. Tiêu
  đề vi: "Tóm tắt “{{meeting}}” đã sẵn sàng · Xem và giao việc".

## 10. Web

- **Phòng họp** (`packages/views/meetings/`):
  - Lớp phụ đề mới (thay `meeting-captions.tsx` khi có agent): người nói, interim mờ, bật/tắt,
    chọn ngôn ngữ (B9).
  - Chip "AI đang ghi lời" với popover giải thích; nút tắt/bật cho chủ trì.
  - Danh sách người tách agent và người gọi điện.
  - Menu người tham gia: "Đặt làm micro hội trường" (clerk).
  - Copilot: việc `LIVE` hiện ngay; thẻ người vào muộn (B7); ô Hỏi UNI (B8).
- **Trang chi tiết:** mục Transcript (spec cha) đọc đoạn `AGENT`; hộp gán người nói; chip
  "Tóm tắt tự tạo"; thông tin gọi điện (B10).
- **Core:** endpoint, schema khoan dung, hook, key cho mọi route §7.2. Realtime:
  `scribe.updated` → chi tiết cuộc họp; `speaker_label.updated` → nhãn và transcript.
- i18n vi trước; mọi chữ qua `t()`; icon theo `MODULE_ICONS`.

## 11. Sửa spec cha

Khi spec này được duyệt, sửa `2026-10-20-meeting-follow-through-design.md`:

- **D9 và §7.4:** ghi lời sau họp chỉ còn nguồn `UPLOAD` (nhà cung cấp: AssemblyAI từ 2026-10-21, trước đó BytePlus). Bỏ nguồn
  `RECORDING` và rủi ro MP4 video.
- **§5.3:** bỏ `recording_id` và cột `speakers` (dùng `meeting_speaker_labels`).
- **§6.4:** route gán người nói chuyển sang §7.2 spec này.
- **§7.3 chọn nguồn:** hợp `AGENT` với `TRANSCRIPTION` (mỗi file lấy lần `COMPLETE` mới
  nhất), xếp theo `spoken_at`; `CAPTION` chỉ dùng khi không có cả hai. *Sửa 2026-10-23
  (UNI-1995 #11):* file tải lên **thay** lời thoại `AGENT`/`CAPTION`, không hợp; xem §7.3
  của spec cha.
- **D6:** việc `LIVE` không bị thay khi tạo lại tóm tắt.
- **§7.8 (ngân sách họp dài)** giữ nguyên, chuyển sang đợt S1 của spec này.
- **§12:** đợt 5a (UNI-2000) bị thay bằng các đợt S0–S7 dưới đây và đóng lại; 5a + 5b
  gộp thành đợt 5 (UNI-2001): "Ghi nhận đã họp", tải file, ghi lời theo lô (AssemblyAI từ 2026-10-21), dùng
  bảng nhãn của §6.3.

Các sửa trên đã được áp vào spec cha cùng ngày, duyệt cùng spec này.

## 12. Chia đợt

| Đợt | Nội dung | Phụ thuộc | Cờ |
|---|---|---|---|
| S0 | **Spike 2–3 ngày, từng mục đạt/không đạt:** (1) LiveKit server production đủ mới cho agent dispatch (local đang v1.9.12); (2) agent vào phòng bằng `CreateDispatch`, không vào phòng khác; (3) luồng STT theo người với AssemblyAI Universal-3.5/3.6 Pro tiếng Việt, độ trễ phụ đề; (4) phát `uw.caption` và client đọc đúng người; (5) AssemblyAI tính tiền theo thời gian mở phiên hay theo âm thanh, và đóng/mở phiên khi im lặng có làm mất chữ không; (6) cảm nhận chất lượng trên 2 cuộc họp thật. Kết quả ghi vào spec; S1 chỉ bắt đầu khi S0 qua. | — | — |
| S1 | **Thư ký AI nền:** A1, A2, A6, ADR 0045, token cuộc họp, `ensureScribe` + vòng quét, `meeting_scribe_runs`, quyền gói `meeting.transcription` theo phút (D9), ngân sách họp dài (spec cha §7.8), lọc agent ở client theo kind `AGENT`, xoá route cũ | S0; spec cha đợt 1 nên xong trước | `meeting_scribe` |
| S2 | **Micro hội trường + gán người nói:** A3, `meeting_speaker_labels` | S1 | `meeting_scribe` |
| S3 | **Việc trong lúc họp:** A4 | S1; spec cha đợt 3 | `meeting_scribe` |
| S4 | **Tóm tắt tự tạo:** A5, kind `meeting_summary_ready`, cài đặt tổ chức | spec cha đợt 3 | — |
| S5 | **Người vào muộn + Hỏi UNI:** B7, B8 | S1 | — |
| S6 | **Phụ đề dịch:** B9 | S1 | `meeting_caption_translate` |
| S7 | **Gọi vào bằng điện thoại:** B10 | issue hạ tầng SIP | `meeting_dial_in` |
| — | **Nợ kỹ thuật:** chuyển ghi hình sang `StartEgress` (cần LiveKit ≥ v1.13.5) | ops nâng LiveKit | — |

### 12.1 Kiểm thử

- **Go (DB test):**
  - Token agent: sai chữ ký, hết hạn, khác `meeting_id` → 404; session JWT → 401.
    Isolation: token của cuộc họp tổ chức A không đọc/ghi được cuộc họp tổ chức B.
  - `ensureScribe`: không gọi khi phòng trống, thư ký tắt, hết phút, cờ tắt; gọi một lần dù
    vòng quét và request Bắt đầu chạy cùng lúc (unique run đang mở); phòng trống rồi có
    người lại → lần chạy mới, không tính lỗi; 3 lần không `ACTIVE` khi phòng có người →
    `FAILED`.
  - Đoạn lời: gửi lại cùng `segment_id` → một dòng; `speech_ms` cộng đúng; hết phút giữa
    lần chạy vẫn nhận đoạn; lần chạy mới bị từ chối khi hết phút.
  - Việc trong lúc họp: trần 20 lần/giờ; lọc trùng tiêu đề; việc `LIVE` không bị thay khi
    tạo lại tóm tắt.
  - `SummarizeAuto`: chỉ khi `ENDED`; không trùng với người bấm tay (khóa thuê);
    `created_by_kind = 'system'`.
  - Khách gọi catch-up → 403. `caption-language` đặt attribute qua adapter giả.
  - `audit_coverage_test.go`, `events-catalogue.test.mjs`, lint migration,
    `TestEveryQueryNamesItsTenant`, `TestAskUniToolsAreReadOnly`, snapshot prompt mới.
- **Python (`apps/meeting-agent`, pytest, không cần phòng thật):**
  - STT giả phát đoạn cố định, kiểm lô gửi `/agent/segments` và phụ đề `uw.caption`.
  - Đóng phiên sau 30 giây im lặng, mở lại khi có tiếng.
  - Bỏ qua participant `uw_agent_*`/egress.
  - Nhịp rút việc; xả nốt khi phòng đóng; thử lại khi server lỗi.
- **Web (vitest):** lớp phụ đề (interim/final, tên người, bật/tắt); lọc kind `AGENT`;
  chip và nút bật/tắt; thẻ người vào muộn ẩn với khách; schema khoan dung và test phản hồi
  sai định dạng cho mọi endpoint mới.
- **E2E (`E2E_LIVEKIT=1`, `SCRIBE_STT_PROVIDER=fake`):** bắt đầu họp → agent vào → phụ đề
  hiện → đoạn được lưu → kết thúc → tóm tắt tự tạo và thông báo. Chỉ chạy spec này.

## 13. Câu hỏi đã chốt

Chủ sản phẩm trả lời ngày 2026-10-20; kết quả đã ghi vào §1.3.

| # | Câu hỏi | Trả lời |
|---|---|---|
| Q1 | Nhà cung cấp STT trực tiếp? | AssemblyAI, đo thử ở S0 (D13). Ghi lời file cũng AssemblyAI (từ 2026-10-21), nên chỉ một thỏa thuận xử lý dữ liệu và một hồ sơ chuyển dữ liệu ra nước ngoài (spec cha §7.5). |
| Q2 | Thư ký tự vào mọi cuộc họp có quyền gói? | Có, luôn có báo hiệu, chủ trì tắt được (D14). |
| Q3 | Việc trong lúc họp làm ngay ở nhóm A? | Có (D15, S3). |
| Q4 | Tự tạo tóm tắt khi họp xong? | Có, tổ chức tắt được (D16, S4). |
| Q5 | Làm B10 (gọi điện) khi nào? | Mở issue hạ tầng SIP ngay để ops ước lượng; S7 làm sau khi hạ tầng xong. |
| Q6 | Hạn mức ghi lời trực tiếp, và hết hạn mức giữa cuộc họp? | Phút mỗi tháng theo gói; cuộc họp đang dở ghi đến hết, cuộc họp mới không có thư ký; báo 80%/100% (D9). |
| Q7 | Khách có dùng tóm tắt phần đã lỡ và Hỏi UNI? | Không, chỉ thành viên workspace (D17). |
| Q8 | lms-core có agent tự vào mọi phòng không? | Không có (§1.1). |

## 14. Nguồn

Tài liệu LiveKit đọc ngày 2026-10-20:
[Agents](https://docs.livekit.io/agents.md),
[STT](https://docs.livekit.io/agents/models/stt.md),
[keyterms](https://docs.livekit.io/agents/models/stt/keyterms.md),
[diarization](https://docs.livekit.io/agents/models/stt/diarization.md),
[AssemblyAI STT](https://docs.livekit.io/agents/models/stt/assemblyai.md),
[text & transcriptions](https://docs.livekit.io/agents/multimodality/text.md),
[sessions](https://docs.livekit.io/agents/logic/sessions.md),
[turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector.md),
[OpenAI-compatible LLMs](https://docs.livekit.io/agents/models/llm/openai-compatible-llms.md),
[agent dispatch](https://docs.livekit.io/agents/server/agent-dispatch.md),
[job](https://docs.livekit.io/agents/server/job.md),
[server options](https://docs.livekit.io/agents/server/options.md),
[deployments](https://docs.livekit.io/deploy/custom/deployments.md),
[self-hosting](https://docs.livekit.io/transport/self-hosting.md),
[noise cancellation](https://docs.livekit.io/transport/media/noise-cancellation.md),
[Egress API](https://docs.livekit.io/reference/other/egress/api.md).
Mẫu tham khảo: [OpenVidu transcriber agent](https://openvidu.io/blog/2026/08/04/transcriber-summarizer-agent/),
[Fora Soft notetaker](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/livekit-meeting-notetaker-full-repo).
