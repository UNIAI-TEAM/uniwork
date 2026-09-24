# Meeting STT Agent (LiveKit → UniWork)

Worker server-side thay Web Speech: subscribe audio trong phòng LiveKit, nhận diện giọng nói, đẩy transcript lên UniWork API.

## Yêu cầu

- Python 3.11+
- LiveKit server (`LIVEKIT_URL`, credentials khớp với API UniWork)
- UniWork API đang chạy với `MEETING_STT_AGENT_SECRET` (cùng giá trị với worker)
- Deepgram API key (hoặc STT provider tương thích LiveKit Agents)

## Cấu hình

Sao chép `.env.example` → `.env`:

| Biến | Mô tả |
| --- | --- |
| `LIVEKIT_URL` | `ws://localhost:7880` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Cặp key LiveKit |
| `UNIWORK_API_URL` | `http://localhost:8080` (origin API, không có slash cuối) |
| `MEETING_STT_AGENT_SECRET` | Trùng secret trên server UniWork |
| `DEEPGRAM_API_KEY` | Key STT (tiếng Việt + Anh) |

## Chạy local

```bash
cd deploy/meeting-stt-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python agent.py dev
```

LiveKit Agents CLI sẽ đăng ký worker; khi có participant trong room `uw_mtg_*`, job được dispatch.

## Luồng dữ liệu

1. Room name `uw_mtg_{meetingId}` (do UniWork cấp khi start meeting).
2. Worker join bằng service token, subscribe audio tracks.
3. Mỗi segment STT → `POST /api/v1/meetings/{meetingId}/transcript/agent`:

```json
{
  "participant_identity": "uw_participant_{participantRowId}",
  "speaker_name": "An Nguyễn",
  "text": "Chốt ship thứ Sáu",
  "spoken_at": "2026-09-08T10:00:00Z"
}
```

Header: `X-Meeting-Agent-Secret: <secret>`

4. Clients nhận `transcript.appended` qua WebSocket và refresh transcript.

## Dispatch

**Mặc định (file này):** LiveKit Agents auto-dispatch khi room active — không cần poll UniWork.

**Thay thế:** webhook `room_started` trên LiveKit → queue job (triển khai riêng nếu cần scale).

## Kiểm tra nhanh

1. Set `MEETING_STT_AGENT_SECRET` trên server + worker.
2. `GET /api/v1/workspaces/{wsId}/meeting-capabilities` → `server_stt: true`.
3. Vào phòng, nói — transcript xuất hiện với `speaker_name` đa participant (không chỉ mic local).

## Chi phí & quota

Meter STT chưa nối entitlement — theo dõi usage Deepgram/LiveKit riêng. Roadmap: capability `meeting_stt` trong gateway AI.
