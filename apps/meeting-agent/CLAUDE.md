# apps/meeting-agent

Thư ký AI của Meetings (UNI-2023, S1): một worker LiveKit Agents bằng Python, một
job mỗi cuộc họp, chỉ vào phòng khi server gọi (`CreateDispatch` với
`agent_name=uniwork-scribe`). Spec: `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md`;
số liệu S0: `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-s0-results.md`;
plan: `docs/superpowers/plans/2026-10-20-meeting-scribe-s1-base.md`; ADR 0037.

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
  `stt.py` (`FakeSTT`, `make_stt`), `config.py`.

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
