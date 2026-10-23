# Meetings: Thư ký AI — kết quả spike S0

> **Trạng thái:** shipped — kết quả spike S0 ngày 2026-10-20

**Issue:** UNI-2022 (S0 của UNI-1995). **Spec:** `2026-10-20-meeting-scribe-agent-design.md`
§12 dòng S0, §3, §4.1, §1.2, D3–D9. **Mã spike** (chỉ để tham khảo, không nối vào sản
phẩm): `spikes/meeting-scribe-s0/`, cách chạy trong `README.md` ở đó.

**Môi trường đo:** MacBook Intel (x86_64), livekit-server **v1.9.12** chạy Docker cục bộ
(`scripts/ensure-livekit.sh`), Python 3.13 (venv qua `uv`), livekit-agents 1.8.8, Go 1.27 +
`server-sdk-go/v2` v2.12.2. Không có key AssemblyAI: STT là **STT giả** (mỗi 0,5 giây âm
thanh có tiếng thành một "từ", câu chốt khi VAD báo hết tiếng). Âm thanh là giọng đọc tiếng
Anh do lệnh `say` của macOS tạo, phát theo thời gian thực vào phòng.

## 1. Kết quả từng mục

| # | Mục S0 | Kết quả | Bằng chứng và số đo |
|---|---|---|---|
| 1 | LiveKit server đủ mới cho agent dispatch | **đạt** ở local; production **chưa đo được (cần ops)** | Local v1.9.12: worker đăng ký `agent_name=uniwork-scribe` (protocol 16), dispatch chạy. Phiên bản tối thiểu theo changelog LiveKit: API `AgentDispatchService` (Create/List/DeleteDispatch) có từ **v1.7.2** (2024-08-10, "Agent protocol v2", PR #2872 "agent dispatch management"); `CreateDispatch` tự tạo phòng chưa có từ **v1.8.3** (PR #3158); trần metadata 512 KiB áp cho dispatch từ v1.13.2 (PR #4602). Khuyến nghị production **≥ v1.9.12** (đã chạy thử), tốt nhất **≥ v1.13.5** để S-nợ `StartEgress` dùng chung lần nâng cấp. |
| 2 | Agent vào phòng bằng `CreateDispatch`, không vào phòng khác | **đạt** | `e2e.py`, 2 lần chạy, đều PASS. Phòng A có người, **trước** dispatch không có agent (đặt `agent_name` thì không tự dispatch). `CreateDispatch` mất 49–122 ms; agent vào phòng A sau **2,35 s / 2,76 s** tính từ lúc gọi (gồm `go run`). Phòng B có người nói suốt ~70 s, không dispatch → không có agent. Phòng C dispatch với metadata sai (`meeting_id` không khớp tên phòng) → `on_request` từ chối, không có agent. Agent trong phòng A: kind `AGENT`, identity `uw_agent_scribe`, tên "UniWork AI", attribute `uw.kind=scribe` (LiveKit tự thêm `lk.agent.name`, `lk.agent_name`), quyền `can_publish=false`, `can_publish_data=true`, `can_update_metadata=false`, `hidden=false`. |
| 3 | Luồng STT theo từng người; AssemblyAI tiếng Việt; độ trễ | Kiến trúc **đạt** (STT giả); chất lượng tiếng Việt và độ trễ STT **chưa đo được** (không có key) | 2 người nói → 2 track → mỗi track một luồng STT riêng (log: `stt open track=… session=1` cho từng track). Câu chốt khớp số câu nói: alice 3/3, bob 2/2. 35/35 phụ đề đến trong khung giờ người đó đang nói (+2 s), không phụ đề nào gán nhầm người. Người nói lấy từ identity của track, không đoán. Model và tùy chọn S1 dùng: §2.3. |
| 4 | Phát `uw.caption`, client đọc đúng người | **đạt** | Client Python (`livekit` rtc 1.1.20) đăng ký `register_text_stream_handler("uw.caption")`, nhận đủ 4 attribute `uw.participant_identity`, `uw.segment_id`, `uw.final`, `uw.language`. Thứ tự: mỗi `uw.segment_id` là các interim rồi **đúng một** final ở cuối; số đoạn tăng dần theo track. Độ trễ từ lúc STT giả phát sự kiện đến lúc client đọc xong text stream (cùng máy, một đồng hồ): lần 1 interim p50 **7,2 ms**, p95 36,9 ms, max 54,0 ms (n=30), final p50 5,7 ms, max 7,6 ms (n=5); lần 2 interim p50 **6,9 ms**, p95 15,6 ms, max 36,9 ms, final p50 6,8 ms, max 7,2 ms. Số này chỉ là phần LiveKit (agent → SFU → client trên localhost); chưa gồm độ trễ của AssemblyAI và mạng thật. Web: `livekit-client` 2.22.0 trong repo có `registerTextStreamHandler` (chưa chạy thử trên web trong spike). |
| 5a | Đóng/mở phiên STT khi im lặng có làm mất chữ không | **đạt** (logic, với STT giả) | Track alice: phiên 1 mở lúc 11:45:34.602, đóng vì im lặng lúc 11:46:18.991 (30 s sau lúc VAD báo hết tiếng câu 2), mở lại 4,5 s sau khi alice nói câu 3, câu 3 có final, `segment_id` nối tiếp (`…-1`, `…-2`, `…-3`, không trùng). `boundary_check.py`: đóng phiên khi còn một lượt nói chưa chốt → lượt đó ra thành final, không mất. **Lỗi tìm thấy và đã sửa trong spike:** lần chạy đầu mở phiên mới (từ task VAD) trong lúc phiên cũ còn đang xả → hai final cùng một `segment_id`. Cách đúng: mở và đóng phiên chỉ trong vòng lặp khung âm thanh (tuần tự), xem §2.5. |
| 5b | AssemblyAI tính tiền theo thời gian mở phiên hay theo âm thanh | **theo thời gian mở phiên** — dựa trên tài liệu, **chưa đo** | Bảng giá: "Streaming is billed per session duration — the time the WebSocket connection is open, not the duration of audio sent" ([pricing](https://www.assemblyai.com/pricing.md)). Thời gian rảnh cũng tính tiền; phiên không đóng tự đóng sau 3 giờ và tính đủ 3 giờ; gửi `Terminate` là thứ dừng tính tiền ([billing](https://www.assemblyai.com/docs/billing-and-pricing.md), [FAQ](https://www.assemblyai.com/docs/faq/how-does-universal-streaming-session-based-pricing-work.md)). Sau `Terminate` server gửi nốt `Turn` cuối rồi mới gửi `Termination` (`audio_duration_seconds`, `session_duration_seconds` — "This is the duration the session is billed on"); đóng socket ngay sau `Terminate` thì mất transcript cuối ([message sequence](https://www.assemblyai.com/docs/streaming/message-sequence.md)). Plugin 1.8.8 làm đúng: gửi `Terminate` khi `end_input()` rồi đọc tiếp đến khi socket đóng; nó chỉ **log** `session_duration`, không trả ra ngoài. Giá `universal-3-6-pro` **$0,45/giờ phiên**; `speaker_labels` **+$0,12/giờ** (tính cả phiên); `voice_focus` +$0,10/giờ; keyterms (≤ 100) không tính thêm. Giới hạn: số **phiên mới mỗi phút** (Free 5, trả phí 100+, tự tăng 10% khi dùng ≥ 70%), vượt thì lỗi 1008 ([rate limits](https://assemblyai.com/docs/streaming/rate-limits)). |
| 6 | Cảm nhận chất lượng trên 2 cuộc họp thật | **chưa đo được** | Cần chủ sản phẩm: key AssemblyAI và 2 cuộc họp thật (xem §3). |

**Kết luận:** mọi mục đo được ở local đều đạt; không có gì chặn S1 về mặt kỹ thuật. S1 vẫn
cần ops trả lời phiên bản LiveKit production (mục 1) trước khi bật cờ, và chủ sản phẩm đo
mục 3 (tiếng Việt), 5b (đối chiếu hóa đơn), 6 bằng key thật — có thể làm song song với S1
vì đổi nhà cung cấp chỉ là `SCRIBE_STT_PROVIDER` (D13).

## 2. Thiết lập khuyến nghị cho S1

### 2.1 Phiên bản

| Thành phần | Ghim |
|---|---|
| Python | 3.13 (spike chạy 3.13 qua `uv`; 3.14 chưa thử) |
| `livekit-agents` | `==1.8.8` (kéo theo `livekit` rtc `==1.1.20`; ghim `livekit==1.1.21` sẽ xung đột) |
| `livekit-plugins-silero` | `==1.8.8` (onnxruntime 1.23.2 có wheel macOS x86_64) |
| `livekit-plugins-assemblyai` | `==1.8.8` |
| `livekit-api` | `==1.2.2` (chỉ cần cho test client) |
| Go | `github.com/livekit/server-sdk-go/v2 v2.12.2` đã có trong `server/go.mod`, không cần nâng |
| LiveKit server | ≥ v1.9.12 (xem mục 1) |

### 2.2 Gọi agent (Go, trong `ensureScribe`)

```go
c := lksdk.NewAgentDispatchServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
d, err := c.CreateDispatch(ctx, &livekit.CreateAgentDispatchRequest{
    AgentName: "uniwork-scribe",                 // MEETING_SCRIBE_AGENT_NAME
    Room:      "uw_mtg_" + meetingID,
    Metadata:  `{"meeting_id":"…","token":"…","locale":"vi"}`, // D6; ≤ 512 KiB
})
// lưu d.Id vào meeting_scribe_runs để DeleteDispatch khi tắt thư ký giữa chừng
```

Không đặt `RestartPolicy` (chỉ Cloud). `ListDispatch` của một phòng luôn có thêm **một
dispatch không tên** (`agent_name=""`, metadata rỗng) mà LiveKit tạo khi tạo phòng: đó là
dispatch tự động cho worker không đặt tên. Vậy D3 đứng được chỉ khi **không có worker nào
không đặt `agent_name`** đăng ký vào LiveKit dùng chung — chủ sản phẩm đã xác nhận lms-core
không chạy agent; ops nên giữ điều đó (§3). Khi đếm lần chạy, lọc theo `AgentName`.

### 2.3 STT AssemblyAI (khi có key)

```python
assemblyai.STT(
    model="universal-3-6-pro",       # không dùng universal-streaming-* (D13, §4.1)
    language_codes=["vi", "en"],     # language_code bị bỏ qua trên 3.6 và đã deprecated
    keyterms_prompt=keyterms[:100],  # A2; cập nhật giữa phiên bằng stream.update_options
    mode="max_accuracy",             # "for scribes/post-call"; đo lại với "balanced" (§3)
    voice_focus="near-field",        # A3 micro hội trường: "far-field" + speaker_labels=True
)
```

- Chọn **Universal-3.6 Pro**, không phải 3.5: tài liệu AssemblyAI chỉ ghi danh sách ngôn ngữ
  streaming cho 3.6 (32 ngôn ngữ, **có tiếng Việt**, tự chuyển ngôn ngữ trong một luồng);
  3.5 không có danh sách streaming nào ghi tiếng Việt, và bảng giá chỉ còn 3.6
  ([models](https://www.assemblyai.com/llms/models.md)). Plugin 1.8.8 cũng lấy 3.6 làm mặc
  định. Spec §4.1 cho phép "3.5 hoặc 3.6", nên đây không phải đổi quyết định; D13 nên ghi
  lại là 3.6 khi S1 sửa spec.
- `speaker_labels=True` (+ `max_speakers`) **chỉ** cho luồng micro hội trường (D4, A3): phụ
  phí tính trên cả phiên. Khi bật, `continuous_partials` mặc định tắt và có thêm một
  `SpeakerRevision` (~400 ms) lúc đóng phiên.
- `language_detection` plugin tự bật cho họ U3 Pro. Endpoint EU
  (`wss://streaming.eu.assemblyai.com`) có sẵn qua `base_url` nếu pháp lý cần (spec cha §7.5).
- Với AssemblyAI **không** gọi `flush()` khi VAD báo hết tiếng: nhà cung cấp tự chốt lượt.
  STT giả trong spike chốt bằng `flush()` chỉ để có kết quả xác định.

### 2.4 Worker và job

- `AgentServer(setup_fnc=prewarm, permissions=WorkerPermissions(can_publish=False,
  can_subscribe=True, can_publish_data=True, can_update_metadata=False))`, health mặc định
  `:8081` (spike đổi sang `:8091` chỉ để tránh trùng cổng egress local); `prewarm` nạp
  `silero.VAD.load()` một lần mỗi tiến trình.
- `@server.rtc_session(agent_name="uniwork-scribe", on_request=…)`; `on_request` kiểm
  metadata là JSON, có `meeting_id` và `token`, và tên phòng bằng `uw_mtg_<meeting_id>`, sai
  thì `req.reject()`; đúng thì `req.accept(identity="uw_agent_scribe", name="UniWork AI",
  attributes={"uw.kind": "scribe"})`.
- Trong job: `ctx.add_participant_entrypoint(fn)` rồi `ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)`.
  Mặc định `add_participant_entrypoint` chỉ gọi cho kind STANDARD, SIP, CONNECTOR — **đã loại
  AGENT và EGRESS**; giữ thêm điều kiện tiền tố `uw_agent_` cho chắc. Chỉ nhận track nguồn
  `SOURCE_MICROPHONE`, mỗi `track.sid` một task; `rtc.AudioStream(track, sample_rate=16000,
  num_channels=1)`.

### 2.5 Phụ đề và đóng/mở phiên

- Mỗi interim/final là **một** text stream:
  `room.local_participant.send_text(text, topic="uw.caption", attributes={"uw.participant_identity": p.identity, "uw.segment_id": seg_id, "uw.final": "1"|"0", "uw.language": lang})`,
  gửi tuần tự (await) trong task của track để giữ thứ tự. `seg_id = f"{track.sid}-{n}"`,
  bộ đếm `n` thuộc về **track**, không thuộc phiên STT, để id không trùng qua các lần mở lại.
  Attribute `uw.spike_emit_ns` chỉ dùng để đo trong spike, S1 bỏ.
- `SCRIBE_IDLE_CLOSE_S=30`. Task VAD chỉ đánh dấu (`speaking`, thời điểm hết tiếng, khung
  pre-roll `ev.frames` của `START_OF_SPEECH`). **Vòng lặp khung âm thanh là nơi duy nhất mở
  và đóng phiên:** chưa có phiên mà có pre-roll → mở phiên, đẩy pre-roll; đang có phiên, không
  nói, im ≥ 30 s → `end_input()`, `await` task phát phụ đề đến hết, `aclose()`. Trong lúc
  xả, khung mới nằm chờ trong `AudioStream` (không mất, chỉ trễ).
- Chi phí: mỗi lần im quá 30 s tốn thêm đúng 30 s phiên; trong spike, phiên 1 của alice mở
  44,4 s cho khoảng 6–7 s lời nói. S1 nên ghi `session_duration_seconds` (tự đo từ lúc mở đến
  lúc đóng, vì plugin chỉ log) cạnh `speech_ms` trong `meeting_scribe_runs` để đối chiếu chi
  phí thật với phút tính cho khách (D9). Mở lại phiên tạo phiên mới, nên tính cả giới hạn
  "phiên mới mỗi phút" khi họp đông.

## 3. Cần chủ sản phẩm / ops

- **Ops:** phiên bản livekit-server production (dùng chung với lms-core). Cần ≥ v1.8.3, khuyến
  nghị ≥ v1.9.12, tốt nhất ≥ v1.13.5 (gộp với `StartEgress`).
- **Ops:** xác nhận và giữ quy tắc "không worker nào đăng ký vào LiveKit dùng chung mà không
  đặt `agent_name`" — nếu có, nó tự vào **mọi** phòng UniWork (dispatch không tên có sẵn ở
  mỗi phòng, §2.2).
- **Chủ sản phẩm:** key AssemblyAI (tài khoản trả phí) và **2 cuộc họp thật** để đo: chất lượng
  tiếng Việt và chuyển Việt–Anh, độ trễ phụ đề thật (STT + mạng), so sánh `mode`
  `max_accuracy` với `balanced`, keyterms tên người, đóng/mở phiên với `Terminate` thật, và
  tỉ lệ `session_duration_seconds` / giây nói để kiểm hóa đơn.
- **Công cụ đo** (2026-10-23): `apps/meeting-agent/eval/` phát lại 2–5 giờ cuộc họp thật qua
  đúng đường live và batch, ra WER và độ phủ thực thể theo giọng vùng miền và loại micro, p95 độ
  trễ và tỉ lệ phiên / giây nói; điền mục 3, 5b, 6 ở §1 từ `report.md` của nó. Bật
  `meeting_scribe` cho khách chỉ sau khi nó ra Đạt (`docs/ops/MEETINGS_AI_GO_LIVE.md`).
- **Chủ sản phẩm / sales:** giới hạn phiên mới mỗi phút của AssemblyAI (trả phí 100+) cho giờ
  cao điểm đầu cuộc họp đông; DPA và vùng xử lý (spec cha §7.5; có endpoint EU).

## 4. Chưa làm trong spike

Không thử client web (chỉ client Python), không thử mất kết nối STT / thử lại, không đo
CPU/RAM mỗi job, không thử người rời phòng giữa câu, không thử Python 3.14.
