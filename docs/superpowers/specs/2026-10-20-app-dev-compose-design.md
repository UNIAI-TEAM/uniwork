# App-dev — Compose cho FE, BE, office-engine trên host có sẵn

> **Trạng thái:** in-progress — thiết kế đã chốt 2026-10-20, chưa triển khai.

**Ngày:** 2026-10-20

Môi trường development `https://uniwork.unicomhub.com` chạy ba container (frontend, backend, office-engine) trên `113.20.107.188`. Postgres, Redis, MinIO và LiveKit đã có trên host đó. Compose không dựng chúng.

## 1. File nào ở đâu

Trong git:

| File | Vai trò |
|---|---|
| `deploy/app-dev/docker-compose.yml` | Ba service lúc chạy. Không có khóa `build` |
| `deploy/app-dev/docker-compose.secrets.yml` | Chỉ gắn secret lúc `up` |
| `deploy/app-dev/env/uniwork-be.env` | Nghiệp vụ backend |
| `deploy/app-dev/env/uniwork-fe.env` | Runtime frontend |
| `deploy/app-dev/env/uniwork-fe.build.env` | `NEXT_PUBLIC_*` lúc build ảnh |
| `deploy/app-dev/env/uniwork-office-engine.env` | Nghiệp vụ office-engine |
| `deploy/app-dev/.env.example` | Tên biến secret, giá trị trống |
| `ci/Jenkinsfile.app-dev.groovy` | Build trên agent, SSH sang host để pull và up |

Không commit `.env`. `.gitignore` đã bỏ qua mọi file tên `.env`. Thêm `deploy/app-dev/env/image.env` vào `.gitignore`: file này do Jenkins ghi mỗi lần deploy.

Trên host, thư mục `/home/devops/uniwork/`:

```
.env                              # có sẵn, pipeline không ghi
docker-compose.yml
docker-compose.secrets.yml
env/uniwork-be.env
env/uniwork-fe.env
env/uniwork-office-engine.env
env/image.env                     # UNIWORK_IMAGE_TAG, ghi lại mỗi lần deploy
```

`uniwork-fe.build.env` không copy lên host. Ảnh đã nhúng `NEXT_PUBLIC_*` lúc build.

## 2. Ảnh

Registry và tên ảnh giống production (`ci/Jenkinsfile.production-app.groovy`):

- `registry-harbor.ubos.vn/uniwork/uniwork-be`
- `registry-harbor.ubos.vn/uniwork/uniwork-fe`
- `registry-harbor.ubos.vn/uniwork/uniwork-office-engine`

Tag: `dev-<YYYYMMDDHHMM>-<git sha ngắn>`. Pipeline này không push `:latest`. Production đang push `:latest` trên cùng tên ảnh.

Build trên agent Jenkins `107.188`, từ checkout:

| Ảnh | Dockerfile | Context | Build-arg |
|---|---|---|---|
| backend | `server/Dockerfile` | `./server` | không |
| frontend | `apps/web/Dockerfile` | gốc repo | ba biến trong `uniwork-fe.build.env` |
| office-engine | `apps/office-engine/Dockerfile` | gốc repo | không |

`uniwork-fe.build.env`:

```
NEXT_PUBLIC_API_URL=https://uniwork.unicomhub.com
NEXT_PUBLIC_WS_URL=wss://uniwork.unicomhub.com
NEXT_PUBLIC_APP_URL=https://uniwork.unicomhub.com
```

Một trong ba biến trống hoặc thiếu thì stage build dừng. Dockerfile mặc định `localhost` khi không có build-arg, nên thiếu arg ra ảnh sai mà Compose không thấy.

Máy chạy không build. Compose trên host chỉ có `image:`.

## 3. Biến môi trường

Backend nhận `env/uniwork-be.env`, rồi `.env` đè key trùng. Office-engine nhận file nghiệp vụ của nó và đúng hai token từ `.env`. Frontend lúc chạy chỉ nhận `env/uniwork-fe.env`.

### 3.1 `uniwork-be.env`

Giữ các giá trị không bí mật đang có trong file hiện tại, và chỉnh như sau.

Một dòng `API_PUBLIC_URL=https://uniwork.unicomhub.com`. Xóa dòng trùng.

```
PORT=8080
APP_ENV=development
LOG_LEVEL=info
ENABLE_SWAGGER=true
REALTIME_RELAY=false
TRUSTED_PROXIES=172.30.19.0/24
DEV_VERIFICATION_CODE=123456
FRONTEND_ORIGIN=https://uniwork.unicomhub.com
API_PUBLIC_URL=https://uniwork.unicomhub.com
PREVIEW_ORIGIN=https://preview.uniwork.unicomhub.com
ALLOWED_ORIGINS=
PREVIEW_ASSET_TTL=10m
PREVIEW_ASSET_MAX_BYTES=10485760
```

`TRUSTED_PROXIES` là subnet của network Compose (§4). Proxy TLS trên host nối vào cổng publish thì container tin `X-Forwarded-For`.

Mail, desktop auth, billing, VAPID subject, chat và khối AI giữ như file hiện tại và như `deploy/app/env/uniwork-be.env` cho phần không bí mật: `AI_PROVIDER=anthropic`, `ANTHROPIC_MODEL=claude-sonnet-5`, `AI_MODEL_CONTEXT_EXTRACTION=claude-haiku-4-5-20251001`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`. Không có `ANTHROPIC_API_KEY` thì gateway tắt, process vẫn chạy.

`GOOGLE_CLIENT_ID` để trống. Client production đăng ký cho `uniworkos.com`. Redirect của server này là `https://uniwork.unicomhub.com/api/v1/auth/google/callback`.

LiveKit không bí mật:

```
LIVEKIT_URL=wss://livekit.ubos.vn:7880
MEETING_PROVIDER=livekit
```

Các timeout và batch LiveKit giữ giá trị đang có trong `deploy/app-dev/env/uniwork-be.env`.

Storage là MinIO. Không khai báo `AWS_*` hay `S3_BUCKET`. Backend `minio` không đọc credential AWS.

```
STORAGE_BACKEND=minio
MINIO_ENDPOINT=https://minio.ubos.vn
MINIO_BUCKET=uniwork-development
MINIO_REGION=us-east-1
S3_KEY_PREFIX=develop/
```

`MINIO_ENDPOINT` là origin trần: có scheme, không user, không path. Cổng 443 nằm trong scheme `https`. Server không đọc `MINIO_PORT`. `MINIO_PUBLIC_ENDPOINT` để trống: URL đã ký dùng `MINIO_ENDPOINT`. `S3_KEY_PREFIX=develop/` để object của môi trường này nằm dưới một gốc riêng trong bucket.

`OFFICE_ENGINE_URL` để trống trong file env. Compose gán lúc chạy (§4). Cùng file còn:

```
DOCUMENT_MAX_BYTES=209715200
OFFICE_ENGINE_REQUEST_TIMEOUT_MS=10000
OFFICE_JOB_MAX_DEADLINE_MS=120000
OFFICE_JOB_RECONCILE_INTERVAL_MS=5000
```

Khi viết `uniwork-be.env`, chép nguyên các dòng `OFFICE_INSTALLER_*_URLS` và `UNICHAT_INSTALLER_*_URLS` từ `deploy/app/env/uniwork-be.env`. Đó là URL GitHub public.

Không đặt `GOMEMLIMIT` và `METRICS_ADDR`. Compose không giới hạn RAM backend và không publish cổng metrics.

### 3.2 `uniwork-office-engine.env`

Giữ pool, giới hạn job, sandbox và `OFFICE_ENGINE_FAULT_OPERATIONS=0` như file hiện tại. Đổi origin file store:

```
OFFICE_ENGINE_OUTPUT_ORIGINS=https://minio.ubos.vn
```

Origin này trùng origin của URL MinIO đã ký. Engine tải được URL đó. `DOCUMENT_MAX_BYTES=209715200` trùng backend. Comment trong file nói Compose, không nói Helm hay CMC.

### 3.3 `uniwork-fe.env`

Chỉ runtime, giống production:

```
HOME=/tmp
COREPACK_HOME=/tmp/corepack
XDG_CACHE_HOME=/tmp/cache
```

Không đặt `NEXT_PUBLIC_*`, `UNICHAT_IOS_TEAM_ID`, `UNICHAT_ANDROID_SHA256`. Hai biến UniChat trống thì `/.well-known/*` trả 404.

### 3.4 `.env` trên host và `.env.example`

`deploy/app-dev/.env.example` liệt kê key, giá trị trống. File thật `/home/devops/uniwork/.env` điền chúng.

Bắt buộc để process lên:

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PREVIEW_CAPABILITY_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MINIO_ACCESS_KEY_ID`, `MINIO_SECRET_ACCESS_KEY`, `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY`.

Có thì bật thêm tính năng: `SMTP_PASSWORD`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`.

`DATABASE_URL` và `REDIS_URL` chứa IP host và mật khẩu, nên cả chuỗi nằm trong `.env`. Container gọi các dịch vụ đó bằng IP host đã publish, không dùng `127.0.0.1` (trong container đó là chính container).

## 4. Compose lúc chạy

`docker-compose.yml` có `name: uniwork-app-dev` để không dùng chung project `uniwork` của compose ở gốc repo. Network `172.30.19.0/24` (gateway `172.30.19.1`). Không `network_mode: host`. Không service Postgres, Redis, MinIO, LiveKit. Không khóa `build`. Host cần Docker Compose 2.24 trở lên vì `env_file.required`.

| Service | Ảnh | Cổng trên host |
|---|---|---|
| `uniwork-be` | `registry-harbor.ubos.vn/uniwork/uniwork-be:${UNIWORK_IMAGE_TAG}` | `8080:8080` |
| `uniwork-fe` | `registry-harbor.ubos.vn/uniwork/uniwork-fe:${UNIWORK_IMAGE_TAG}` | `3000:3000` |
| `uniwork-office-engine` | `registry-harbor.ubos.vn/uniwork/uniwork-office-engine:${UNIWORK_IMAGE_TAG}` | `127.0.0.1:8090:8090` |

`UNIWORK_IMAGE_TAG` dùng cú pháp `${UNIWORK_IMAGE_TAG:?}`. Thiếu tag thì Compose dừng trước khi gọi Docker.

Backend đặt `OFFICE_ENGINE_URL=http://uniwork-office-engine:8090` trong `environment` của Compose, nên giá trị này thắng dòng trống trong env file. Frontend không nhận `.env`.

Office-engine giữ sandbox của `docker-compose.yml` ở gốc repo: `init`, `read_only`, tmpfs `/tmp:size=512m,mode=1777`, `mem_limit: 2g`, `cpus: 2`, `pids_limit: 256`, `cap_drop: [ALL]`, `cap_add: [CHOWN, SETUID, SETGID, KILL, DAC_OVERRIDE, FOWNER]`, `security_opt: [no-new-privileges:true]`, `stop_grace_period: 15s`. Healthcheck của engine là `node -e` gọi `fetch('http://127.0.0.1:8090/healthz')`, cùng lệnh đã có trong `apps/office-engine/Dockerfile`, vì ảnh runtime không có `curl`. Backend dùng `wget -q -O /dev/null http://127.0.0.1:8080/readyz` (ảnh Alpine có busybox wget). `start_period` của backend là 60s vì `CMD` của ảnh là `migrate up && server`. Backend chờ engine healthy. Frontend không healthcheck. Cả ba service `restart: unless-stopped`.

`docker-compose.secrets.yml` chỉ thêm:

- Backend: `env_file` đường dẫn `.env`, `required: true`.
- Office-engine: `OFFICE_ENGINE_SERVICE_TOKEN` và `OFFICE_ENGINE_GRANT_KEY` bằng `${…:?}`. Process engine không nhận `DATABASE_URL`.

Proxy TLS nằm ngoài Compose. Nó đã có trên host: `https://uniwork.unicomhub.com` vào cổng 3000 và 8080, `https://preview.uniwork.unicomhub.com` vào cổng 8080.

## 5. Pipeline

`ci/Jenkinsfile.app-dev.groovy`. Tham số, default commit trong file:

| Tham số | Default |
|---|---|
| `BRANCH` | `develop` |
| `DEPLOY_HOST` | `113.20.107.188` |
| `DEPLOY_SSH_PORT` | `2232` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_DIR` | `/home/devops/uniwork` |
| `SSH_CREDENTIALS_ID` | `ssh-107.188` |
| `HARBOR_CREDENTIALS_ID` | `fsales.registry.harbor.id` |
| `GIT_CREDENTIALS_ID` | `git-synam141` |

`BRANCH` mặc định `develop` và job được phép chạy nhánh khác. Pipeline này không rollout Kubernetes.

**Build** trên agent `107.188`. Đọc `uniwork-fe.build.env`, build ba ảnh, push tag `dev-…`. Không push `:latest`. Ghi `UNIWORK_IMAGE_TAG` ra file để stage sau copy thành `env/image.env`.

**Deploy** không có bước duyệt tay. Từ agent build, SSH tới `root@113.20.107.188` cổng `2232` bằng credential `ssh-107.188` (SSH Username with private key). Agent `107.188` đã có host key của `113.20.107.188` trong `known_hosts`. Pipeline không tắt kiểm tra host key. Copy đúng các file sau vào `$DEPLOY_DIR`, không `rsync --delete` cả thư mục, không copy `.env`:

- `docker-compose.yml`
- `docker-compose.secrets.yml`
- `env/uniwork-be.env`, `env/uniwork-fe.env`, `env/uniwork-office-engine.env`
- `env/image.env`

Trong phiên SSH, `docker login` dùng `HARBOR_CREDENTIALS_ID`. Password đi qua stdin, không nằm trên argv. `DOCKER_CONFIG` là thư mục `mktemp` riêng của phiên đó, `trap` xóa thư mục khi SSH kết thúc, kể cả khi `pull` lỗi, nên credential Harbor không nằm lại trong `~/.docker/config.json` của root và không nằm trong `$DEPLOY_DIR`. `pull` lỗi thì không chạy `up`. Container đang chạy giữ nguyên.

```bash
cd "$DEPLOY_DIR"
docker compose -f docker-compose.yml --env-file env/image.env pull
docker compose \
  -f docker-compose.yml \
  -f docker-compose.secrets.yml \
  --env-file env/image.env \
  --env-file .env \
  up -d
```

`--env-file` tính từ thư mục hiện tại, nên lệnh chạy sau `cd`. `.env` đứng sau `image.env`. Hai file không trùng key. `pull` không dùng file secrets, nên không cần `.env`. `up` cần `.env` vì hai token office được nội suy.

## 6. Khi nào dừng

| Tình huống | Kết quả |
|---|---|
| Thiếu `UNIWORK_IMAGE_TAG` | `pull` và `up` dừng trước Docker |
| Thiếu `.env` hoặc một trong hai token office | `up` dừng, không tạo container |
| `DATABASE_URL`, `REDIS_URL` hoặc nhóm MinIO sai, kể cả URL `127.0.0.1` | Container tạo xong, process backend thoát, `restart` lặp, `readyz` không xanh |
| Thiếu `ANTHROPIC_API_KEY` hoặc `SMTP_PASSWORD` | Process chạy. AI tắt. Gửi mail lỗi lúc dùng |
| `OFFICE_ENGINE_OUTPUT_ORIGINS` khác origin URL đã ký | Engine từ chối ghi file. Phần còn lại của backend vẫn phục vụ |
| `pull` thất bại | Không `up`. Container đang phục vụ giữ nguyên |
| Build frontend thiếu một `NEXT_PUBLIC_*` | Stage build dừng |

`docker compose config` của file secrets in token. Job không ghi output đó vào log.

## 7. Kiểm tra trong repo

`scripts/app-dev-env.test.mjs`, gọi trong dòng `node --test` của `scripts/check.sh`. Test đọc file đã commit, không chạy container, không SSH.

- Dòng gán (bỏ qua comment) trong file nghiệp vụ không có giá trị khác rỗng cho `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, mọi key chứa `PASSWORD`, `SECRET`, `ACCESS_KEY` hoặc `API_KEY`, và hai token office.
- `uniwork-be.env` có `STORAGE_BACKEND=minio`, `MINIO_ENDPOINT=https://minio.ubos.vn`, `MINIO_BUCKET=uniwork-development`, `MINIO_REGION=us-east-1`, `S3_KEY_PREFIX=develop/`, `APP_ENV=development`, `TRUSTED_PROXIES=172.30.19.0/24`, và `OFFICE_ENGINE_URL` trống.
- `uniwork-office-engine.env` có `OFFICE_ENGINE_OUTPUT_ORIGINS=https://minio.ubos.vn` và không chứa host CMC `s3.hn-2.cloud.cmctelecom.vn`.
- `uniwork-fe.build.env` có đúng ba URL `https://uniwork.unicomhub.com` và `wss://uniwork.unicomhub.com`.
- `docker-compose.yml` không có `build:`, không có service `postgres`, `redis`, `minio`, và có `name: uniwork-app-dev`.
- `docker-compose.secrets.yml` nêu tên hai token office và không chứa giá trị của chúng.
- `ci/Jenkinsfile.app-dev.groovy` chứa default `113.20.107.188`, `2232`, `root`, `/home/devops/uniwork`, `ssh-107.188`, và không có lệnh `docker tag` hay `docker push` tới `:latest`.

## 8. Ngoài phạm vi

Cấu hình proxy TLS trên host. Nội dung `.env` thật (người vận hành điền từ `.env.example`). Sửa pipeline production và `deploy/app/env`. Dựng Postgres, Redis, MinIO, LiveKit.
