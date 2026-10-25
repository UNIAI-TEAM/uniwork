# apps/meeting-agent

Thư ký AI của Meetings (UNI-2023, S1): một worker LiveKit Agents bằng Python, một
job mỗi cuộc họp, chỉ vào phòng khi server gọi (`CreateDispatch` với
`agent_name=uniwork-scribe`). Spec: `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md`;
số liệu S0: `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-s0-results.md`;
plan: `docs/superpowers/plans/2026-10-20-meeting-scribe-s1-base.md`; ADR 0045.

## Luật

- **Không SDK LLM, không key LLM.** Agent chỉ gọi nhà cung cấp STT (`SCRIBE_STT_PROVIDER`:
  `assemblyai` | `fake`). Việc cần model là một request tới server, server gọi
  `ai.Gateway`. `scripts/governance.test.mjs` fail nếu `requirements.txt` có SDK LLM.
- **Chỉ nói chuyện với server qua `/api/v1/meetings/{id}/agent/*`** bằng token `uwma_` trong
  job metadata. Không DB, không Redis, không outbox.
- **Không log lời nói**: chỉ id, số đoạn, độ dài.
- **Không bao giờ chạy chế độ tự vào mọi phòng**: LiveKit dùng chung với lms-core;
  `agent_name` luôn đặt.
- Phiên STT mở và đóng **chỉ trong vòng lặp khung âm thanh** (`TrackTranscriber.push`), đóng
  sau `SCRIBE_IDLE_CLOSE_S` (30 s) im lặng theo VAD: nhà cung cấp tính tiền theo thời gian mở
  phiên.
- **Micro hội trường (S2, UNI-2024):** chỉ server đặt attribute `uw.shared_mic`; agent thấy nó
  đổi thì đóng phiên đang mở và phiên sau tách người nói (`speaker_labels=True` chỉ cho track
  đó; phiên đó đóng sau 300 s im thay vì 30 s để nhãn không vỡ qua mỗi lần ngắt). Nhãn mỗi đoạn: `<identity>:<job>-<track>-<số phiên>:<nhãn nhà cung cấp>`, `?` khi nhà
  cung cấp không gán được.
- **Âm thanh chỉ có một:** lời báo thư ký AI cho người gọi điện thoại (UNI-1995, `scribe/notice.py`,
  `assets/sip-notice-vi.wav` sinh bằng `say -v Linh`). Agent chỉ phát khi server đặt `uw.dial_in=admitted` cho người
  gọi, mỗi người một lần mỗi job, và quyền subscribe của track chỉ ghi identity người gọi đó. Không phát gì khác.
- **Sức khoẻ STT (UNI-1995 #1):** `scribe/health.py` — mọi phiên của cuộc họp lỗi liên tục 20 s mà
  không track nào ra lời (phải có lỗi ở cả hai đầu 20 s; một lỗi rồi phòng im không tính) thì agent
  đặt attribute của chính nó `uw.scribe_state=degraded` (về `ok` ở lời đầu tiên, hoặc khi 45 s không
  còn lỗi nào); web đọc nó để hiện "tạm dừng, đang thử lại" và bật lại phụ đề trên máy. Đây là lý
  do duy nhất worker có `can_update_metadata=True`: agent chỉ ghi attribute của mình.
- **Lỗi STT không làm mất lời (#13):** âm thanh chưa có final (tối đa `BUFFER_MAX_S` = 30 s mỗi
  track) và âm thanh nghe được trong lúc lùi lại được gửi vào phiên kế tiếp, trừ âm thanh nghe được
  khi cuộc họp đang `degraded` (phòng đã tự ghi bằng phụ đề trên máy; phát lại sẽ ghi hai lần); lùi lại có jitter
  (0,5–1× của 1 s→30 s). `scribe_stt_errors_total{reason}`: `stream` | `push` | `session_limit`
  (1008/429 — giới hạn phiên mới mỗi phút); `scribe_stt_sessions_opened_total` đếm phiên mở.
- **Micro hội trường:** `voice_focus="far-field"` và `max_speakers=10`; micro cá nhân `near-field`.
- **Vùng STT (#15):** `SCRIBE_STT_BASE_URL`; rỗng thì theo `AI_MEETING_TRANSCRIBE_BASE_URL` (EU →
  `wss://streaming.eu.assemblyai.com`, còn lại US) — `scribe/config.py` `stt_base_url`.
- **404 giữa chừng ở `/agent/segments` (#25):** token/lần chạy không còn hiệu lực → agent rời phòng
  (`ctx.shutdown`) để vòng quét gọi lần chạy mới; 409 thì không rời.
- **Track rời đi thì đóng luồng (UNI-2161):** `track_unsubscribed`, `track_unpublished` và
  `participant_disconnected` đều gọi `stop_track`; một luồng để mở sau khi tải lại trang nhận luôn track mới
  (WebRTC dùng lại receiver) và mỗi câu bị ghi hai lần.
- Phiên bản ghim theo kết quả S0 (`livekit-agents==1.8.8`); đổi phiên bản là đổi có chủ đích.

## Cấu trúc

- `agent.py` — wiring: `AgentServer`, `on_request`, job (kết nối phòng, mỗi track mic một
  `TrackTranscriber`, phát `uw.caption`, xả và `/agent/finished` khi tắt). Smoke tay.
- `scribe/` — module thuần, test được không cần phòng: `job.py` (nhận job nào, chép lời ai),
  `transcriber.py` (VAD → phiên STT → phụ đề + đoạn final), `batcher.py` (lô 2 s / 20 đoạn,
  giữ lô lỗi để gửi lại), `extract.py` (S3, UNI-2025: nhịp `/agent/extract` — ≥ 3 phút và ≥ 15
  đoạn mới, hoặc lặng ≥ 20 s sau ≥ 5 đoạn; ≤ 20 lần mỗi giờ; một lần nữa khi phòng đóng; không
  thử lại vì mỗi lần là một lời gọi model), `translate.py` (S6, UNI-2028: phụ đề dịch — đọc
  attribute `uw.caption_lang` do server đặt, gom final theo ngôn ngữ đích, tối đa 1 lần gọi
  `/agent/translate` mỗi giây mỗi ngôn ngữ, phát `uw.caption.<L>`, không thử lại), `api.py` (client token `uwma_`, thử lại 5xx), `keyterms.py` (A2),
  `stt.py` (`FakeSTT`, `make_stt`), `health.py` (`uw.scribe_state`), `config.py`, `notice.py` (ai được nghe lời báo, đọc WAV, cắt khung 10 ms).
- `eval/` — bộ đánh giá chất lượng STT trên cuộc họp thật (WER, độ phủ thực thể, độ trễ, tỉ lệ
  phiên/giây nói; live và batch); không vào image. Bật `meeting_scribe` cho khách chỉ sau khi
  nó ra `Đạt`: `eval/README.md`.

## Chạy

```bash
cd apps/meeting-agent
uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/python -m pytest -q
# Với LiveKit local (bash scripts/ensure-livekit.sh .env.worktree) và server có MEETING_SCRIBE_ENABLED=true:
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… UNIWORK_API_URL=http://localhost:8080 \
  SCRIBE_STT_PROVIDER=fake .venv/bin/python agent.py dev
```

CI: `.github/workflows/meeting-agent-verify.yml` (ruff + pytest), không nằm trong turbo.
Triển khai: `apps/meeting-agent/Dockerfile`, Helm `deploy/app/uniwork/templates/deployment-meeting-agent.yaml`
(`meetingAgent.enabled`), runbook `docs/runbooks/MeetingScribeCannotJoin.md`.
