# App-dev — Thư ký AI (`meeting-agent`) trên host development

> **Trạng thái:** in-progress — thiết kế đã chốt 2026-10-26, chưa triển khai.

**Ngày:** 2026-10-26

**Liên quan:** `docs/superpowers/specs/2026-10-20-app-dev-compose-design.md` (ba container
FE, BE, office-engine), `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md`
và ADR 0045. Production đã build image `uniwork-meeting-agent` trong
`ci/Jenkinsfile.production-app.groovy` và pin digest lúc Helm rollout. Deployment
trên cluster vẫn tắt (`meetingAgent.enabled: false` trong
`deploy/app/uniwork/values.yaml`). `deploy/app/env/uniwork-be.env` giữ
`MEETING_SCRIBE_ENABLED=false`.

Môi trường `https://uniwork.unicomhub.com` thêm một container thứ tư: worker LiveKit
Agents trong `apps/meeting-agent`. Postgres, Redis, MinIO và LiveKit vẫn nằm ngoài
Compose, như spec app-dev ngày 2026-10-20.

## 1. Mục tiêu

Server development dispatch được thư ký AI theo cùng đường production: STT
AssemblyAI, agent chỉ vào phòng khi server gọi (`agent_name=uniwork-scribe`), và
mọi lời gọi khác đi qua `/api/v1/meetings/{id}/agent/*`.

Thành công là:

- Jenkins app-dev build và push image `dev-*`, rồi `docker compose up` chạy
  container agent cạnh BE.
- `MEETING_SCRIBE_ENABLED=true` trên BE development. Worker đăng ký với LiveKit
  `wss://livekit.ubos.vn`.
- Một cuộc họp của tổ chức đã bật cờ `meeting_scribe`, còn hạn mức
  `meeting.transcription`, có người thư ký trong phòng và có phụ đề.

Cờ `meeting_scribe` mặc định tắt. Không tổ chức nào có thư ký cho đến khi bật cờ
đó cho tổ chức. Cờ không phải biến môi trường.

## 2. Ngoài phạm vi

- Không sửa mã Python trong `apps/meeting-agent/`. `CMD` của image vẫn là
  `python agent.py start`.
- Không sửa Helm, `deploy/app/env/uniwork-be.env`, hay `docker-compose.yml` ở
  gốc repo. Máy local vẫn chạy agent bằng tay như `apps/meeting-agent/CLAUDE.md`.
- Không bật `AI_MEETING_TRANSCRIBE_PROVIDER`. Key AssemblyAI có mặt trong process
  BE vì BE nhận cả file `.env`, nhưng job ghi lời file chỉ chạy khi biến đó là
  `assemblyai`.
- Không mount mã nguồn vào container. Không xuất bản cổng 8081 hay 9100 ra host.
- Không thêm alert. Không chuyển agent sang host network trong thay đổi này.
- Không sửa `scripts/governance.test.mjs`. Test đó đã yêu cầu workflow chứa
  `pytest`.

## 3. File

| File | Việc |
| --- | --- |
| `deploy/app-dev/docker-compose.yml` | Thêm service `uniwork-meeting-agent` |
| `deploy/app-dev/docker-compose.secrets.yml` | Ba secret từ `.env` trên host |
| `deploy/app-dev/env/uniwork-meeting-agent.env` | File mới, biến không bí mật |
| `deploy/app-dev/env/uniwork-be.env` | Bật dispatch |
| `deploy/app-dev/.env.example` | Thêm `ASSEMBLYAI_API_KEY` |
| `ci/Jenkinsfile.app-dev.groovy` | Build image, copy file env mới |
| `ci/Jenkinsfile.production-app.groovy` | Sửa comment của stage Build Meeting Agent |
| `.github/workflows/meeting-agent-verify.yml` | Bỏ job build và push image |
| `scripts/app-dev-env.test.mjs` | Khóa các dây trên |

Trên host `/home/devops/uniwork/`, pipeline copy thêm
`env/uniwork-meeting-agent.env`. File `.env` trên host không bị pipeline ghi đè.

## 4. Container

Service dùng image

`registry-harbor.ubos.vn/uniwork/uniwork-meeting-agent:${UNIWORK_IMAGE_TAG:?}`

cùng tag với BE, FE và office-engine. File Compose này không có khóa `build`.

Lệnh ghi đè thành `python agent.py dev`. Chế độ `dev` của LiveKit Agents nhận mọi
job (`load_threshold` vô hạn, một process chờ). Chế độ `start` từ chối job khi
CPU container quá 70%, và host này chạy chung BE, FE, office-engine trong trần
1 CPU. `agent_name` vẫn lấy từ env (`uniwork-scribe`). Worker không tự vào phòng.

Container tham gia mạng default sẵn có của file Compose. Không khai báo `ports`.
Không mount volume.

Giới hạn, cùng kiểu office-engine trừ những chỗ ghi dưới đây:

- `init: true`
- `cap_drop: [ALL]`, không `cap_add`
- `security_opt: [no-new-privileges:true]`
- `cpus: 1`
- `mem_limit: 2g`
- `pids_limit: 256`
- `restart: unless-stopped`
- `stop_grace_period: 150s` (20 giây drain cộng 110 giây shutdown, dư 20 giây)

Root filesystem ghi được. Worker ghi cache LiveKit và model VAD dưới home của
uid 1000 trong image. Không đặt `read_only`.

`depends_on`: chỉ agent chờ `uniwork-be` healthy. BE không chờ agent.

Healthcheck chạy trong container, vì image Python không có `curl`:

```yaml
test:
  [
    "CMD",
    "python",
    "-c",
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/worker')",
  ]
interval: 10s
timeout: 3s
retries: 3
start_period: 40s
```

`/worker` là readiness của LiveKit Agents: process đã đăng ký với LiveKit.
Liveness `/` không dùng cho healthcheck này.

## 5. Biến môi trường

### 5.1 `env/uniwork-meeting-agent.env`

Đúng các gán sau. Comment được phép. Không thêm gán khác:

```
MEETING_SCRIBE_AGENT_NAME=uniwork-scribe
SCRIBE_STT_PROVIDER=assemblyai
SCRIBE_STT_BASE_URL=
AI_MEETING_TRANSCRIBE_BASE_URL=
UNIWORK_API_URL=http://uniwork-be:8080
LIVEKIT_URL=wss://livekit.ubos.vn
SCRIBE_HEALTH_PORT=8081
SCRIBE_METRICS_PORT=9100
SCRIBE_DRAIN_TIMEOUT_S=20
PROMETHEUS_MULTIPROC_DIR=/tmp/scribe-metrics
```

Hai base URL để trống: `scribe/config.py` chọn
`wss://streaming.assemblyai.com` (Mỹ). File này không chứa
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, hay `ASSEMBLYAI_API_KEY`.

### 5.2 Secret

`docker-compose.secrets.yml` thêm service `uniwork-meeting-agent` với đúng ba
dòng `environment`. Agent không nhận cả file `.env`, nên không thấy
`DATABASE_URL`, `JWT_SECRET` hay các secret khác của BE.

```yaml
uniwork-meeting-agent:
  environment:
    LIVEKIT_API_KEY: ${LIVEKIT_API_KEY:?}
    LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET:?}
    ASSEMBLYAI_API_KEY: ${ASSEMBLYAI_API_KEY:?}
```

`LIVEKIT_API_KEY` và `LIVEKIT_API_SECRET` đã có trong `.env` trên host. Trước lần
deploy đầu tiên có service này, thêm vào `/home/devops/uniwork/.env`:

```
ASSEMBLYAI_API_KEY=
```

`deploy/app-dev/.env.example` thêm tên đó vào nhóm bắt buộc, một dòng comment:
Compose không lên nếu thiếu. Giá trị trong example để trống.

BE vẫn nhận cả `.env` qua `env_file` như hiện tại. Không đặt
`AI_MEETING_TRANSCRIBE_PROVIDER`.

### 5.3 BE

Trong `deploy/app-dev/env/uniwork-be.env`, ngay sau
`LIVEKIT_RECORDING_S3_ENDPOINT`:

```
MEETING_SCRIBE_ENABLED=true
MEETING_SCRIBE_AGENT_NAME=uniwork-scribe
```

Server dispatch khi cuộc họp đang diễn ra, tổ chức bật `meeting_scribe`, gói còn
`meeting.transcription`, và chính sách thư ký của tổ chức không tắt. Điều kiện
này đã có trong `MeetingService.ensureScribeRun`. Spec này không đổi nó.

## 6. Đường gọi và lúc deploy

Agent gọi BE tại `http://uniwork-be:8080` trên mạng Compose. Signaling LiveKit
và WebSocket STT đi ra internet từ container (`wss://livekit.ubos.vn`,
`wss://streaming.assemblyai.com`, cổng 443).

Jenkins copy file Compose và env trước, rồi `docker compose pull` (chỉ
`--env-file env/image.env`), rồi `up` với cả `docker-compose.secrets.yml` và
`.env`. `pull` không cần `ASSEMBLYAI_API_KEY`. `up` cần. Thiếu một trong ba
secret thì Compose dừng lúc đọc biến, trước khi tạo lại container. Stage Deploy
đỏ. Container đang chạy giữ nguyên.

Deploy khi một cuộc họp đang được ghi: worker ngừng nhận job trong 20 giây
(`SCRIBE_DRAIN_TIMEOUT_S`), rồi còn tối đa 110 giây (`shutdown_process_timeout`
gắn trong `agent.py`, spec này không đổi số đó) để xả đoạn và gọi
`/agent/finished`. `stop_grace_period` 150 giây phủ hai khoảng đó. Hết giờ,
Docker dừng process. Sweep sẵn có gửi lần chạy mới khi worker mới đã đăng ký.

Worker không đăng ký được LiveKit: healthcheck `/worker` đỏ,
`restart: unless-stopped` dựng lại. Sweep coi dispatch không thành `ACTIVE`
trong 60 giây là một lỗi. Lần thứ ba thì run `FAILED`, thử lại sau 10 phút.
Hành vi sweep này đã có. Spec này không đổi.

Key AssemblyAI sai hoặc nhà cung cấp lỗi: agent vẫn vào phòng. Phiên STT lỗi
liên tục 20 giây thì agent đặt `uw.scribe_state=degraded`. Web bật lại phụ đề
trên máy. 45 giây không còn lỗi thì về `ok`.

Agent có mặt trong phòng mà không có đoạn lời: signaling đã xong, media WebRTC
qua NAT của Docker thì chưa. Việc làm sau, không nằm trong spec này: chạy riêng
service agent với host network và `UNIWORK_API_URL=http://127.0.0.1:8086`.

## 7. CI

### 7.1 Jenkins app-dev

Stage `Build Meeting Agent` đứng sau `Build Office Engine`, trước
`Write image tag`. Cùng trần bộ nhớ `2g` với BE:

```bash
docker build \
  --memory="${DOCKER_BUILD_MEMORY}" \
  --memory-swap="${DOCKER_BUILD_MEMORY}" \
  -t "${REGISTRY}/uniwork-meeting-agent:${IMAGE_TAG}" \
  apps/meeting-agent
docker push "${REGISTRY}/uniwork-meeting-agent:${IMAGE_TAG}"
```

Context là `apps/meeting-agent` (Dockerfile nằm trong thư mục đó). Không push
`:latest`.

`stash` và `scp` thêm `deploy/app-dev/env/uniwork-meeting-agent.env`. Lệnh
`pull` và `up` trên host giữ nguyên.

### 7.2 GitHub

Sửa `.github/workflows/meeting-agent-verify.yml`. Job `agent` giữ checkout,
Python 3.13, `pip install -r requirements-dev.txt`, ruff và pytest. Thêm một
bước sau pytest, working directory vẫn là `apps/meeting-agent`:

```bash
python -m pip install pip-audit==2.9.0
pip-audit --progress-spinner off -r requirements.txt
```

Xóa cả job `image`: build, smoke trong image, login Harbor, push digest, và
comment đầu file nói về build hay push. Trigger theo path giữ nguyên.

Comment trong `ci/Jenkinsfile.production-app.groovy` (stage Build Meeting Agent)
sửa thành: workflow GitHub chạy ruff, pytest và pip-audit; Jenkins production
vẫn là nơi build image và pin digest.

### 7.3 Test trong repo

`scripts/app-dev-env.test.mjs`:

- Thêm `deploy/app-dev/env/uniwork-meeting-agent.env` vào `businessFiles`. Luật
  key nhạy cảm hiện có vẫn áp dụng. Tập tên gán của file đó đúng bằng mười tên
  ở §5.1. `SCRIBE_STT_BASE_URL` và `AI_MEETING_TRANSCRIBE_BASE_URL` là chuỗi
  rỗng. Ba tên `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ASSEMBLYAI_API_KEY`
  không xuất hiện.
- BE: `MEETING_SCRIBE_ENABLED` là `true`, `MEETING_SCRIBE_AGENT_NAME` là
  `uniwork-scribe`.
- Agent: `SCRIBE_STT_PROVIDER` là `assemblyai`, `UNIWORK_API_URL` là
  `http://uniwork-be:8080`, `LIVEKIT_URL` là `wss://livekit.ubos.vn`,
  `SCRIBE_DRAIN_TIMEOUT_S` là `20`.
- `docker-compose.secrets.yml` chứa ba dòng `${LIVEKIT_API_KEY:?}`,
  `${LIVEKIT_API_SECRET:?}`, `${ASSEMBLYAI_API_KEY:?}`.
- `ci/Jenkinsfile.app-dev.groovy` chứa context build `apps/meeting-agent` và
  đường dẫn `deploy/app-dev/env/uniwork-meeting-agent.env` trong `stash` lẫn
  `scp`. Luật cấm `:latest` hiện có vẫn áp dụng.

CI không mở phòng LiveKit và không gọi AssemblyAI. Pytest dùng STT giả.

## 8. Kiểm tra sau deploy

Trên `https://uniwork.unicomhub.com`, với một tổ chức đã bật `meeting_scribe` và
còn hạn mức `meeting.transcription`: vào một cuộc họp đang diễn ra. Phòng có
thành viên thư ký và có phụ đề từ lời nói trong phòng. Tổ chức chưa bật cờ thì
cuộc họp không có thư ký, và container agent vẫn healthy.
