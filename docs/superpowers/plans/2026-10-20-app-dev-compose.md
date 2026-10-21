# App-dev Compose Implementation Plan

> **Trạng thái:** in-progress — spec `docs/superpowers/specs/2026-10-20-app-dev-compose-design.md` đã chốt; chưa triển khai.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Máy `113.20.107.188` chỉ pull và chạy frontend, backend, office-engine; Postgres, Redis, MinIO, LiveKit có sẵn; secret nằm trong `/home/devops/uniwork/.env`.

**Architecture:** Env nghiệp vụ commit trong `deploy/app-dev/env`. Compose trên host không có `build`. Jenkinsfile trong git build ba ảnh, tag `dev-<ngày>-<sha>`, push Harbor, SSH sang host, copy compose và env, `pull` rồi `up`. `NEXT_PUBLIC_*` là build-arg.

**Tech Stack:** Docker Compose 2.24+, Jenkins Pipeline, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-20-app-dev-compose-design.md`

## Global Constraints

- Registry `registry-harbor.ubos.vn/uniwork`, ảnh `uniwork-be`, `uniwork-fe`, `uniwork-office-engine`. Tag `dev-<YYYYMMDDHHMM>-<sha ngắn>`. Không `docker tag` và không `docker push` tới `:latest`.
- `MINIO_ENDPOINT=https://minio.ubos.vn`, `MINIO_BUCKET=uniwork-development`, `MINIO_REGION=us-east-1`, `S3_KEY_PREFIX=develop/`, `OFFICE_ENGINE_OUTPUT_ORIGINS=https://minio.ubos.vn`.
- `DEPLOY_HOST=113.20.107.188`, `DEPLOY_USER=root`, `DEPLOY_DIR=/home/devops/uniwork`, `SSH_CREDENTIALS_ID=ssh-107.188`. Agent build `107.188`. Không copy và không ghi đè `.env`.
- Compose project `uniwork-app-dev`, network `172.30.19.0/24`, `TRUSTED_PROXIES=172.30.19.0/24`.
- `OFFICE_ENGINE_URL` trống trong env file. Compose gán `http://uniwork-office-engine:8090`.
- Comment trong file env viết tiếng Anh.

---

### Task 1: Contract test

**Files:**
- Create: `scripts/app-dev-env.test.mjs`
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: không
- Produces: ba test `business env files carry no secrets`, `compose files pin registry images`, `Jenkinsfile deploys by SSH without a latest tag`. Task 2–4 làm từng test này xanh.

- [ ] **Step 1: Write the failing test**

Tạo `scripts/app-dev-env.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function assignments(relativePath) {
  const text = fs.readFileSync(path.join(root, relativePath), "utf8");
  const out = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return out;
}

const businessFiles = [
  "deploy/app-dev/env/uniwork-be.env",
  "deploy/app-dev/env/uniwork-fe.env",
  "deploy/app-dev/env/uniwork-fe.build.env",
  "deploy/app-dev/env/uniwork-office-engine.env",
];

test("business env files carry no secrets", () => {
  const forbiddenExact = new Set([
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "OFFICE_ENGINE_SERVICE_TOKEN",
    "OFFICE_ENGINE_GRANT_KEY",
  ]);
  for (const file of businessFiles) {
    for (const [key, value] of assignments(file)) {
      const sensitive =
        forbiddenExact.has(key) ||
        key.includes("PASSWORD") ||
        key.includes("SECRET") ||
        key.includes("ACCESS_KEY") ||
        key.includes("API_KEY");
      if (sensitive) assert.equal(value, "", `${file} ${key}`);
    }
  }

  const be = assignments("deploy/app-dev/env/uniwork-be.env");
  assert.equal(be.get("STORAGE_BACKEND"), "minio");
  assert.equal(be.get("MINIO_ENDPOINT"), "https://minio.ubos.vn");
  assert.equal(be.get("MINIO_BUCKET"), "uniwork-development");
  assert.equal(be.get("MINIO_REGION"), "us-east-1");
  assert.equal(be.get("S3_KEY_PREFIX"), "develop/");
  assert.equal(be.get("APP_ENV"), "development");
  assert.equal(be.get("TRUSTED_PROXIES"), "172.30.19.0/24");
  assert.equal(be.get("OFFICE_ENGINE_URL"), "");

  const office = assignments("deploy/app-dev/env/uniwork-office-engine.env");
  assert.equal(office.get("OFFICE_ENGINE_OUTPUT_ORIGINS"), "https://minio.ubos.vn");
  const officeText = fs.readFileSync(
    path.join(root, "deploy/app-dev/env/uniwork-office-engine.env"),
    "utf8",
  );
  assert.equal(officeText.includes("s3.hn-2.cloud.cmctelecom.vn"), false);

  const build = assignments("deploy/app-dev/env/uniwork-fe.build.env");
  assert.deepEqual([...build.keys()], [
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_WS_URL",
    "NEXT_PUBLIC_APP_URL",
  ]);
  assert.equal(build.get("NEXT_PUBLIC_API_URL"), "https://uniwork.unicomhub.com");
  assert.equal(build.get("NEXT_PUBLIC_WS_URL"), "wss://uniwork.unicomhub.com");
  assert.equal(build.get("NEXT_PUBLIC_APP_URL"), "https://uniwork.unicomhub.com");
});

test("compose files pin registry images", () => {
  const compose = fs.readFileSync(path.join(root, "deploy/app-dev/docker-compose.yml"), "utf8");
  assert.match(compose, /^name: uniwork-app-dev$/m);
  assert.equal(/^\s*build\s*:/m.test(compose), false);
  assert.equal(/^\s{2}(postgres|redis|minio)\s*:/m.test(compose), false);

  const secrets = fs.readFileSync(
    path.join(root, "deploy/app-dev/docker-compose.secrets.yml"),
    "utf8",
  );
  assert.match(secrets, /OFFICE_ENGINE_SERVICE_TOKEN: \$\{OFFICE_ENGINE_SERVICE_TOKEN:\?\}/);
  assert.match(secrets, /OFFICE_ENGINE_GRANT_KEY: \$\{OFFICE_ENGINE_GRANT_KEY:\?\}/);
  assert.equal(secrets.includes("dev-only-office-engine"), false);
});

test("Jenkinsfile deploys by SSH without a latest tag", () => {
  const text = fs.readFileSync(path.join(root, "ci/Jenkinsfile.app-dev.groovy"), "utf8");
  for (const value of ["113.20.107.188", "root", "/home/devops/uniwork", "ssh-107.188"]) {
    assert.equal(text.includes(value), true, value);
  }
  assert.equal(/docker\s+(tag|push)\b[^\n]*:latest/.test(text), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/app-dev-env.test.mjs`

Expected: FAIL. `business env files carry no secrets` báo thiếu `MINIO_ENDPOINT` hoặc giá trị không khớp. Hai test sau báo `ENOENT` vì chưa có `docker-compose.secrets.yml` và `ci/Jenkinsfile.app-dev.groovy`.

- [ ] **Step 3: Commit**

```bash
git add scripts/app-dev-env.test.mjs
git commit -m "$(cat <<'EOF'
test(deploy): lock the app-dev env and compose contract

EOF
)"
```

### Task 2: Env nghiệp vụ

**Files:**
- Modify: `deploy/app-dev/env/uniwork-be.env`
- Modify: `deploy/app-dev/env/uniwork-fe.env`
- Modify: `deploy/app-dev/env/uniwork-office-engine.env`
- Create: `deploy/app-dev/env/uniwork-fe.build.env`
- Create: `deploy/app-dev/.env.example`
- Modify: `.gitignore`
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: test `business env files carry no secrets` từ Task 1
- Produces: các file env mà Task 3 không đọc, và `uniwork-fe.build.env` mà Task 4 đọc từng dòng `KEY=value`

- [ ] **Step 1: Write the env files**

Ghi đè `deploy/app-dev/env/uniwork-be.env` bằng đúng nội dung sau:

```
# UniWork BE — development runtime for deploy/app-dev.
# Secrets stay in /home/devops/uniwork/.env on the host and are never committed.

# ==================== Server ====================
PORT=8080
APP_ENV=development
LOG_LEVEL=info
ENABLE_SWAGGER=true
REALTIME_RELAY=false
# Compose network 172.30.19.0/24. The host TLS proxy is trusted for X-Forwarded-For.
TRUSTED_PROXIES=172.30.19.0/24

# ==================== Public origins ====================
FRONTEND_ORIGIN=https://uniwork.unicomhub.com
ALLOWED_ORIGINS=
API_PUBLIC_URL=https://uniwork.unicomhub.com
PREVIEW_ORIGIN=https://preview.uniwork.unicomhub.com
PREVIEW_ASSET_TTL=10m
PREVIEW_ASSET_MAX_BYTES=10485760
# Accepted in place of the mailed code while APP_ENV is not production.
DEV_VERIFICATION_CODE=123456
# Empty hides Google login. A production client id is registered for uniworkos.com,
# not for https://uniwork.unicomhub.com/api/v1/auth/google/callback.
GOOGLE_CLIENT_ID=

# ==================== Mail (SMTP) ====================
# Password: SMTP_PASSWORD in the host .env.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USERNAME=contact@unicomhub.com
SMTP_TLS=
SMTP_TLS_INSECURE=false
SMTP_EHLO_NAME=UniWork Development
MAIL_FROM=UniWork Development <noreply@unicomhub.com>

# ==================== Storage (MinIO) ====================
# minio does not read AWS_* credentials. Keys: MINIO_ACCESS_KEY_ID and
# MINIO_SECRET_ACCESS_KEY in the host .env.
STORAGE_BACKEND=minio
MINIO_ENDPOINT=https://minio.ubos.vn
MINIO_BUCKET=uniwork-development
MINIO_REGION=us-east-1
S3_KEY_PREFIX=develop/

# ==================== LiveKit (non-secret) ====================
# API key and secret: the host .env.
LIVEKIT_URL=wss://livekit.ubos.vn:7880
MEETING_PROVIDER=livekit
LIVEKIT_TOKEN_TTL=30m
LIVEKIT_ROOM_EMPTY_TIMEOUT=
LIVEKIT_ROOM_DEPARTURE_TIMEOUT=20s
MEETING_WORKER_TICK=1s
MEETING_OUTBOX_BATCH=50
MEETING_WEBHOOK_BATCH=50
MEETING_WEBHOOK_CONCURRENCY=8
LIVEKIT_RECORDING_BUCKET=
LIVEKIT_RECORDING_S3_ENDPOINT=

# ==================== Desktop auth (public PKCE clients) ====================
DESKTOP_AUTH_CLIENTS=uniwork-office=uniwork-office://auth/callback,uniwork-office-dev=uniwork-office-dev://auth/callback,uniwork-chat-desktop=uniworkchat://auth/callback|uniworkchat-dev://auth/callback,uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback
DESKTOP_AUTH_DEPLOYMENT_IDS=default
DESKTOP_AUTH_CODE_TTL=120s
DESKTOP_AUTH_ATTEMPT_TTL=10m

# ==================== Billing ====================
BILLING_PROVIDER=manual

# ==================== Push (Web Push / VAPID) ====================
# Private key: VAPID_PRIVATE_KEY in the host .env. Both keys empty turns push off.
VAPID_PUBLIC_KEY=
VAPID_SUBJECT=mailto:noreply@unicomhub.com

# ==================== Chat / misc ====================
TENOR_API_KEY=
ADMIN_RATE_LIMIT_PER_MIN=60
RUM_SAMPLE_RATE=0.2

# ==================== AI ====================
# ANTHROPIC_API_KEY in the host .env. Empty key disables the gateway; the process still starts.
AI_PROVIDER=anthropic
OPENAI_BASE_URL=https://openrouter.ai/api/v1
AI_TIMEOUT_SECONDS=60
ANTHROPIC_MODEL=claude-sonnet-5
AI_MODEL_CONTEXT_EXTRACTION=claude-haiku-4-5-20251001

# ==================== Office engine (BE client) ====================
# Compose sets OFFICE_ENGINE_URL=http://uniwork-office-engine:8090.
# Tokens: the host .env, injected only into the engine by docker-compose.secrets.yml.
OFFICE_ENGINE_URL=
OFFICE_ENGINE_REQUEST_TIMEOUT_MS=10000
OFFICE_JOB_MAX_DEADLINE_MS=120000
OFFICE_JOB_RECONCILE_INTERVAL_MS=5000
DOCUMENT_MAX_BYTES=209715200
OFFICE_INSTALLER_DEV_URLS={"win32-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.13/UniWork-Office_0.11.0-dev.13_unsigned_win32_x64-setup.exe","darwin-arm64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.13/UniWork-Office_0.11.0-dev.13_unsigned_darwin_arm64.dmg","darwin-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.13/UniWork-Office_0.11.0-dev.13_unsigned_darwin_x64.dmg","linux-x64-deb":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.13/UniWork-Office_0.11.0-dev.13_unsigned_linux_x64.deb","linux-x64-appimage":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.13/UniWork-Office_0.11.0-dev.13_unsigned_linux_x64.AppImage"}
OFFICE_INSTALLER_BETA_URLS={"win32-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v1.0.0-beta.2/UniWork-Office_1.0.0-beta.2_unsigned_win32_x64-setup.exe","darwin-arm64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v1.0.0-beta.2/UniWork-Office_1.0.0-beta.2_unsigned_darwin_arm64.dmg","darwin-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v1.0.0-beta.2/UniWork-Office_1.0.0-beta.2_unsigned_darwin_x64.dmg","linux-x64-deb":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v1.0.0-beta.2/UniWork-Office_1.0.0-beta.2_unsigned_linux_x64.deb","linux-x64-appimage":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v1.0.0-beta.2/UniWork-Office_1.0.0-beta.2_unsigned_linux_x64.AppImage"}
OFFICE_INSTALLER_STABLE_URLS=
UNICHAT_INSTALLER_DEV_URLS=
UNICHAT_INSTALLER_BETA_URLS={"win32-x64":"https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-beta.1/unichat_0.1.0-beta.1_unsigned_win32_x64-setup.exe","darwin-arm64":"https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-beta.1/unichat_0.1.0-beta.1_unsigned_darwin_arm64.dmg","darwin-x64":"https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-beta.1/unichat_0.1.0-beta.1_unsigned_darwin_x64.dmg","linux-x64-deb":"https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-beta.1/unichat_0.1.0-beta.1_unsigned_linux_x64.deb","linux-x64-appimage":"https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-beta.1/unichat_0.1.0-beta.1_unsigned_linux_x64.AppImage"}
UNICHAT_INSTALLER_STABLE_URLS=
```

Ghi đè `deploy/app-dev/env/uniwork-fe.env`:

```
# UniWork FE — runtime only. NEXT_PUBLIC_* are build-args in uniwork-fe.build.env.
HOME=/tmp
COREPACK_HOME=/tmp/corepack
XDG_CACHE_HOME=/tmp/cache
```

Tạo `deploy/app-dev/env/uniwork-fe.build.env`:

```
# Baked into the FE image. A blank value must fail the Jenkins build.
NEXT_PUBLIC_API_URL=https://uniwork.unicomhub.com
NEXT_PUBLIC_WS_URL=wss://uniwork.unicomhub.com
NEXT_PUBLIC_APP_URL=https://uniwork.unicomhub.com
```

Ghi đè `deploy/app-dev/env/uniwork-office-engine.env`:

```
# UniWork office-engine — development runtime for deploy/app-dev.
# Tokens stay in the host .env (OFFICE_ENGINE_SERVICE_TOKEN, OFFICE_ENGINE_GRANT_KEY).
# Every variable the engine reads (apps/office-engine/src/config.ts) is listed here.
# Bounds are enforced at start: a bad value stops the container.

# ==================== Listener ====================
OFFICE_ENGINE_HOST=0.0.0.0
OFFICE_ENGINE_PORT=8090

# ==================== File store ====================
# Bare origin of presigned input/output URLs. Must match MINIO_ENDPOINT in uniwork-be.env.
# Empty refuses every output write.
OFFICE_ENGINE_OUTPUT_ORIGINS=https://minio.ubos.vn

# ==================== Pool / queue ====================
# Compose caps the container at 2g and mounts /tmp as a 512m tmpfs.
OFFICE_ENGINE_MAX_WORKERS=2
OFFICE_ENGINE_MAX_QUEUE=16

# ==================== Per-job limits ====================
OFFICE_ENGINE_MAX_JOB_MS=120000
OFFICE_ENGINE_CPU_MS=60000
OFFICE_ENGINE_MEMORY_MB=512
OFFICE_ENGINE_TEMP_MB=512
DOCUMENT_MAX_BYTES=209715200
OFFICE_ENGINE_MAX_INPUT_BYTES=209715200
OFFICE_ENGINE_MAX_OUTPUT_BYTES=209715200

# ==================== Supervisor ====================
OFFICE_ENGINE_SAMPLE_MS=100
OFFICE_ENGINE_RETENTION_MS=900000
OFFICE_ENGINE_MAX_RETAINED_JOBS=1024
OFFICE_ENGINE_SHUTDOWN_GRACE_MS=10000

# ==================== Sandbox ====================
OFFICE_ENGINE_SANDBOX=required
OFFICE_ENGINE_WORKER_UID_BASE=60100
OFFICE_ENGINE_WORKER_GID_BASE=60100

# ==================== Test switch ====================
OFFICE_ENGINE_FAULT_OPERATIONS=0

# ==================== Set by the image (do not override) ====================
# NODE_ENV=production
# OFFICE_ENGINE_TEMP_DIR=/tmp/uniwork-office-engine
# UNIWORK_PDF_ASSETS=/app/pdf-assets
# UNIWORK_XLSX_ASSETS=/app/xlsx-assets
```

Tạo `deploy/app-dev/.env.example`:

```
# Host-only secrets for /home/devops/uniwork/.env. Do not commit that file.
# Required for the process to stay up:
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
PREVIEW_CAPABILITY_SECRET=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
MINIO_ACCESS_KEY_ID=
MINIO_SECRET_ACCESS_KEY=
OFFICE_ENGINE_SERVICE_TOKEN=
OFFICE_ENGINE_GRANT_KEY=
# Optional. Empty leaves the feature off or mail send failing:
SMTP_PASSWORD=
ANTHROPIC_API_KEY=
GOOGLE_CLIENT_SECRET=
VAPID_PRIVATE_KEY=
```

Thêm vào cuối `.gitignore`:

```
# Written by ci/Jenkinsfile.app-dev.groovy on the deploy host.
deploy/app-dev/env/image.env
```

- [ ] **Step 2: Run the env test**

Run: `node --test --test-name-pattern "business env files carry no secrets" scripts/app-dev-env.test.mjs`

Expected: PASS. Hai test kia vẫn FAIL cho đến Task 3 và Task 4.

- [ ] **Step 3: Commit**

```bash
git add deploy/app-dev/env/uniwork-be.env deploy/app-dev/env/uniwork-fe.env deploy/app-dev/env/uniwork-fe.build.env deploy/app-dev/env/uniwork-office-engine.env deploy/app-dev/.env.example .gitignore
git commit -m "$(cat <<'EOF'
chore(deploy): pin app-dev business env for the shared host

EOF
)"
```

### Task 3: Compose lúc chạy

**Files:**
- Modify: `deploy/app-dev/docker-compose.yml`
- Create: `deploy/app-dev/docker-compose.secrets.yml`
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: `OFFICE_ENGINE_URL` trống trong `uniwork-be.env` (Task 2)
- Produces: project `uniwork-app-dev`. Service `uniwork-be` đặt `OFFICE_ENGINE_URL=http://uniwork-office-engine:8090`. Service `uniwork-office-engine` đọc hai biến `${OFFICE_ENGINE_SERVICE_TOKEN:?}` và `${OFFICE_ENGINE_GRANT_KEY:?}` từ file secrets.

- [ ] **Step 1: Replace the compose files**

Ghi đè `deploy/app-dev/docker-compose.yml`:

```yaml
name: uniwork-app-dev

services:
  uniwork-office-engine:
    image: registry-harbor.ubos.vn/uniwork/uniwork-office-engine:${UNIWORK_IMAGE_TAG:?}
    env_file:
      - path: env/uniwork-office-engine.env
        required: true
    init: true
    read_only: true
    tmpfs:
      - /tmp:size=512m,mode=1777
    mem_limit: 2g
    cpus: 2
    pids_limit: 256
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
      - KILL
      - DAC_OVERRIDE
      - FOWNER
    security_opt:
      - no-new-privileges:true
    stop_grace_period: 15s
    ports:
      - "127.0.0.1:8090:8090"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8090/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))",
        ]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 15s
    restart: unless-stopped

  uniwork-be:
    image: registry-harbor.ubos.vn/uniwork/uniwork-be:${UNIWORK_IMAGE_TAG:?}
    env_file:
      - path: env/uniwork-be.env
        required: true
    environment:
      OFFICE_ENGINE_URL: http://uniwork-office-engine:8090
    ports:
      - "8080:8080"
    depends_on:
      uniwork-office-engine:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/readyz"]
      interval: 10s
      timeout: 3s
      retries: 12
      start_period: 60s
    restart: unless-stopped

  uniwork-fe:
    image: registry-harbor.ubos.vn/uniwork/uniwork-fe:${UNIWORK_IMAGE_TAG:?}
    env_file:
      - path: env/uniwork-fe.env
        required: true
    ports:
      - "3000:3000"
    restart: unless-stopped

networks:
  default:
    ipam:
      config:
        - subnet: 172.30.19.0/24
```

Tạo `deploy/app-dev/docker-compose.secrets.yml`:

```yaml
services:
  uniwork-be:
    env_file:
      - path: .env
        required: true
  uniwork-office-engine:
    environment:
      OFFICE_ENGINE_SERVICE_TOKEN: ${OFFICE_ENGINE_SERVICE_TOKEN:?}
      OFFICE_ENGINE_GRANT_KEY: ${OFFICE_ENGINE_GRANT_KEY:?}
```

- [ ] **Step 2: Run the compose test**

Run: `node --test --test-name-pattern "compose files pin registry images" scripts/app-dev-env.test.mjs`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add deploy/app-dev/docker-compose.yml deploy/app-dev/docker-compose.secrets.yml
git commit -m "$(cat <<'EOF'
chore(deploy): run app-dev from registry images

EOF
)"
```

### Task 4: Jenkinsfile

**Files:**
- Create: `ci/Jenkinsfile.app-dev.groovy`
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: `deploy/app-dev/env/uniwork-fe.build.env` (Task 2) và hai file compose (Task 3)
- Produces: file `target/image.env` chứa đúng một dòng `UNIWORK_IMAGE_TAG=dev-<YYYYMMDDHHMM>-<sha>`. Stage deploy copy dòng đó thành `$DEPLOY_DIR/env/image.env`.

- [ ] **Step 1: Write the pipeline**

Tạo `ci/Jenkinsfile.app-dev.groovy`. File không chứa chuỗi `:latest`.

```groovy
#!/usr/bin/env groovy

/**
 * UniWork app-dev: build on agent 107.188, push dev-* tags, SSH to the
 * host that already has Postgres, Redis, MinIO, and LiveKit, then pull and up.
 * The host .env is never copied and never overwritten.
 * Production publishes a floating tag on these image names; this pipeline does not.
 */

pipeline {
  agent none

  options {
    disableConcurrentBuilds()
    timeout(time: 150, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
  }

  parameters {
    string(name: 'BRANCH', defaultValue: 'develop', description: 'Any branch is allowed. Default is develop.')
    string(name: 'DEPLOY_HOST', defaultValue: '113.20.107.188', description: 'SSH host that runs the containers')
    string(name: 'DEPLOY_USER', defaultValue: 'root', description: 'SSH user')
    string(name: 'DEPLOY_DIR', defaultValue: '/home/devops/uniwork', description: 'Directory that already contains .env')
    string(name: 'SSH_CREDENTIALS_ID', defaultValue: 'ssh-107.188', description: 'Jenkins SSH private key credential')
    string(name: 'HARBOR_CREDENTIALS_ID', defaultValue: 'fsales.registry.harbor.id', description: 'Harbor credentials')
    string(name: 'GIT_CREDENTIALS_ID', defaultValue: 'git-synam141', description: 'Git credentials')
  }

  environment {
    REGISTRY = 'registry-harbor.ubos.vn/uniwork'
    DOCKER_BUILDKIT = '1'
    DOCKER_BUILD_MEMORY = '2g'
  }

  stages {
    stage('Build images') {
      agent { label '107.188' }
      stages {
        stage('Checkout') {
          steps {
            checkout([
              $class: 'GitSCM',
              branches: [[name: "*/${params.BRANCH}"]],
              extensions: [[$class: 'CleanBeforeCheckout']],
              userRemoteConfigs: [[
                url: scm.userRemoteConfigs[0].url,
                credentialsId: "${params.GIT_CREDENTIALS_ID}"
              ]]
            ])
            script {
              env.GIT_COMMIT_SHORT = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
              env.BUILD_DATE = sh(returnStdout: true, script: 'date +%Y%m%d%H%M').trim()
              env.IMAGE_TAG = "dev-${env.BUILD_DATE}-${env.GIT_COMMIT_SHORT}"
            }
          }
        }

        stage('Registry Login') {
          steps {
            withCredentials([usernamePassword(
              credentialsId: "${params.HARBOR_CREDENTIALS_ID}",
              usernameVariable: 'REGISTRY_USER',
              passwordVariable: 'REGISTRY_PASS'
            )]) {
              sh 'echo "${REGISTRY_PASS}" | docker login registry-harbor.ubos.vn -u "${REGISTRY_USER}" --password-stdin'
            }
          }
        }

        stage('Build BE') {
          steps {
            sh '''
              set -e
              docker build \\
                --memory="${DOCKER_BUILD_MEMORY}" \\
                --memory-swap="${DOCKER_BUILD_MEMORY}" \\
                -t "${REGISTRY}/uniwork-be:${IMAGE_TAG}" \\
                -f server/Dockerfile ./server
              docker push "${REGISTRY}/uniwork-be:${IMAGE_TAG}"
            '''
          }
        }

        stage('Build FE') {
          steps {
            sh '''
              set -e
              file=deploy/app-dev/env/uniwork-fe.build.env
              api=$(grep -E '^NEXT_PUBLIC_API_URL=' "$file" | cut -d= -f2-)
              ws=$(grep -E '^NEXT_PUBLIC_WS_URL=' "$file" | cut -d= -f2-)
              app=$(grep -E '^NEXT_PUBLIC_APP_URL=' "$file" | cut -d= -f2-)
              if [ -z "$api" ] || [ -z "$ws" ] || [ -z "$app" ]; then
                echo "FAIL: NEXT_PUBLIC_* missing in $file" >&2
                exit 1
              fi
              docker build \\
                --memory="${DOCKER_BUILD_MEMORY}" \\
                --memory-swap="${DOCKER_BUILD_MEMORY}" \\
                --build-arg "NEXT_PUBLIC_API_URL=${api}" \\
                --build-arg "NEXT_PUBLIC_WS_URL=${ws}" \\
                --build-arg "NEXT_PUBLIC_APP_URL=${app}" \\
                -t "${REGISTRY}/uniwork-fe:${IMAGE_TAG}" \\
                -f apps/web/Dockerfile .
              docker push "${REGISTRY}/uniwork-fe:${IMAGE_TAG}"
            '''
          }
        }

        stage('Build Office Engine') {
          steps {
            sh '''
              set -e
              docker build \\
                -t "${REGISTRY}/uniwork-office-engine:${IMAGE_TAG}" \\
                -f apps/office-engine/Dockerfile .
              docker push "${REGISTRY}/uniwork-office-engine:${IMAGE_TAG}"
            '''
          }
        }

        stage('Write image tag') {
          steps {
            sh '''
              set -e
              mkdir -p target
              printf 'UNIWORK_IMAGE_TAG=%s\n' "${IMAGE_TAG}" > target/image.env
            '''
            stash name: 'app-dev-deploy', includes: 'deploy/app-dev/docker-compose.yml,deploy/app-dev/docker-compose.secrets.yml,deploy/app-dev/env/uniwork-be.env,deploy/app-dev/env/uniwork-fe.env,deploy/app-dev/env/uniwork-office-engine.env,target/image.env'
          }
        }
      }
    }

    stage('Deploy') {
      agent { label '107.188' }
      steps {
        unstash 'app-dev-deploy'
        withEnv([
          "DEPLOY_USER=${params.DEPLOY_USER}",
          "DEPLOY_HOST=${params.DEPLOY_HOST}",
          "DEPLOY_DIR=${params.DEPLOY_DIR}",
        ]) {
          sshagent(credentials: ["${params.SSH_CREDENTIALS_ID}"]) {
            sh '''
              set -euo pipefail
              dest="${DEPLOY_USER}@${DEPLOY_HOST}"
              ssh -o BatchMode=yes "$dest" "mkdir -p ${DEPLOY_DIR}/env"
              scp -o BatchMode=yes deploy/app-dev/docker-compose.yml deploy/app-dev/docker-compose.secrets.yml "$dest:${DEPLOY_DIR}/"
              scp -o BatchMode=yes \
                deploy/app-dev/env/uniwork-be.env \
                deploy/app-dev/env/uniwork-fe.env \
                deploy/app-dev/env/uniwork-office-engine.env \
                target/image.env \
                "$dest:${DEPLOY_DIR}/env/"
            '''
            withCredentials([usernamePassword(
              credentialsId: "${params.HARBOR_CREDENTIALS_ID}",
              usernameVariable: 'REGISTRY_USER',
              passwordVariable: 'REGISTRY_PASS'
            )]) {
              sh '''
                set -euo pipefail
                dest="${DEPLOY_USER}@${DEPLOY_HOST}"
                # Unquoted EOF expands REGISTRY_* and DEPLOY_DIR locally.
                # Backslash keeps $(mktemp) and $cfg for the remote shell.
                ssh -o BatchMode=yes "$dest" "bash -s" <<EOF
set -euo pipefail
cfg=\$(mktemp -d)
trap 'rm -rf "\$cfg"' EXIT
export DOCKER_CONFIG="\$cfg"
docker login registry-harbor.ubos.vn -u '${REGISTRY_USER}' --password-stdin <<'PW'
${REGISTRY_PASS}
PW
cd '${DEPLOY_DIR}'
docker compose -f docker-compose.yml --env-file env/image.env pull
docker compose -f docker-compose.yml -f docker-compose.secrets.yml --env-file env/image.env --env-file .env up -d
EOF
              '''
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Run the Jenkinsfile test**

Run: `node --test --test-name-pattern "Jenkinsfile deploys by SSH" scripts/app-dev-env.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run the whole contract**

Run: `node --test scripts/app-dev-env.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add ci/Jenkinsfile.app-dev.groovy
git commit -m "$(cat <<'EOF'
ci: deploy app-dev by SSH after a registry push

EOF
)"
```

### Task 5: Gắn test vào make check

**Files:**
- Modify: `scripts/check.sh` (dòng `node --test` thứ hai, ngay sau `scripts/env-example.test.mjs`)
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: `scripts/app-dev-env.test.mjs` đã xanh từ Task 4
- Produces: `make check` chạy test này cùng các contract test khác

- [ ] **Step 1: Register the test**

Trong `scripts/check.sh`, đổi đoạn:

```
scripts/env-example.test.mjs scripts/no-pii-log.test.mjs
```

thành:

```
scripts/env-example.test.mjs scripts/app-dev-env.test.mjs scripts/no-pii-log.test.mjs
```

- [ ] **Step 2: Run the contract once more**

Run: `node --test scripts/app-dev-env.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add scripts/check.sh docs/superpowers/specs/2026-10-20-app-dev-compose-design.md
git commit -m "$(cat <<'EOF'
test(deploy): run the app-dev contract from make check

EOF
)"
```

Commit này gồm cả chỉnh spec (healthcheck, `DOCKER_CONFIG` tạm, `name: uniwork-app-dev`) nếu những dòng đó còn đang sửa và chưa commit.

## Self-review

- Spec §1–§8 mỗi yêu cầu có task: file layout Task 2–4, ảnh và tag Task 4, env Task 2, compose Task 3, pipeline Task 4, lỗi lúc chạy là hành vi của Compose `:?` và `set -e` trong Task 4, test Task 1 và Task 5. Ngoài phạm vi không có task.
- Không có chỗ trống cần người triển khai tự nghĩ nội dung file.
- Tên service `uniwork-be`, `uniwork-fe`, `uniwork-office-engine` và hai biến token giống nhau ở Task 3 và Task 4.
