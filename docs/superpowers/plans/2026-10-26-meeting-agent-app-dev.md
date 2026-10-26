# App-dev meeting-agent Implementation Plan

> **Trạng thái:** in-progress — chưa triển khai.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy worker thư ký AI trên host development, dispatch bật, STT AssemblyAI, image do Jenkins app-dev build.

**Architecture:** Container `uniwork-meeting-agent` đứng trong Compose app-dev, gọi BE bằng tên mạng Compose và LiveKit `wss://livekit.ubos.vn`. Ba secret chỉ vào container qua `docker-compose.secrets.yml`. Workflow GitHub giữ ruff, pytest và pip-audit, không build và không push image.

**Tech Stack:** Docker Compose, Jenkins Pipeline (Groovy), GitHub Actions, Node.js `node:test` (`scripts/app-dev-env.test.mjs`). Không sửa Python.

**Spec:** `docs/superpowers/specs/2026-10-26-meeting-agent-app-dev-design.md`

## Global Constraints

- Không sửa `apps/meeting-agent/**`, Helm, `deploy/app/env/uniwork-be.env`, `docker-compose.yml` ở gốc repo, `scripts/governance.test.mjs`.
- Không đặt `AI_MEETING_TRANSCRIBE_PROVIDER`.
- Không push tag `:latest` trên Jenkins app-dev.
- `MEETING_SCRIBE_ENABLED=true`, `MEETING_SCRIBE_AGENT_NAME=uniwork-scribe`.
- `SCRIBE_STT_PROVIDER=assemblyai`. `SCRIBE_STT_BASE_URL` và `AI_MEETING_TRANSCRIBE_BASE_URL` là chuỗi rỗng.
- `UNIWORK_API_URL=http://uniwork-be:8080`, `LIVEKIT_URL=wss://livekit.ubos.vn`.
- Lệnh container: `python agent.py dev`. `SCRIBE_DRAIN_TIMEOUT_S=20`. `stop_grace_period: 150s`.
- Image: `registry-harbor.ubos.vn/uniwork/uniwork-meeting-agent:${UNIWORK_IMAGE_TAG:?}`.
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ASSEMBLYAI_API_KEY` không nằm trong file env commit. Chúng vào container bằng `${TÊN:?}`.
- `pip-audit==2.9.0`.
- Commit bằng `git commit` thường, không `--no-verify`. Checkout này dùng Git 2.25.1: nếu lệnh bị chèn `--trailer` và Git báo `unknown option trailer`, gọi `git commit -F <file>` từ `python3` (`subprocess`) với cùng message. Không thêm `--no-verify`.

---

### Task 1: Env không bí mật và công tắc dispatch

**Files:**
- Create: `deploy/app-dev/env/uniwork-meeting-agent.env`
- Modify: `deploy/app-dev/env/uniwork-be.env` (sau dòng `LIVEKIT_RECORDING_S3_ENDPOINT=`)
- Modify: `deploy/app-dev/.env.example` (nhóm bắt buộc, sau `LIVEKIT_API_SECRET=`)
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: không có task trước.
- Produces: file env agent với đúng mười tên gán ở dưới. Task 2 gắn file này bằng `env_file`. Task 3 copy đường dẫn `deploy/app-dev/env/uniwork-meeting-agent.env`.

- [ ] **Step 1: Write the failing test**

Trong `businessFiles`, thêm phần tử cuối:

```javascript
"deploy/app-dev/env/uniwork-meeting-agent.env",
```

Ngay sau `assert.equal(be.get("OFFICE_ENGINE_URL"), "");` thêm:

```javascript
  assert.equal(be.get("MEETING_SCRIBE_ENABLED"), "true");
  assert.equal(be.get("MEETING_SCRIBE_AGENT_NAME"), "uniwork-scribe");

  const example = fs.readFileSync(path.join(root, "deploy/app-dev/.env.example"), "utf8");
  const exampleKey = example.indexOf("ASSEMBLYAI_API_KEY=");
  const exampleOptional = example.indexOf("# Optional.");
  assert.equal(exampleKey > 0 && exampleOptional > exampleKey, true);
  assert.match(example, /^ASSEMBLYAI_API_KEY=$/m);
```

Thêm test mới ở cuối file:

```javascript
test("meeting agent env lists only non-secret assignments", () => {
  const agent = assignments("deploy/app-dev/env/uniwork-meeting-agent.env");
  assert.deepEqual([...agent.keys()], [
    "MEETING_SCRIBE_AGENT_NAME",
    "SCRIBE_STT_PROVIDER",
    "SCRIBE_STT_BASE_URL",
    "AI_MEETING_TRANSCRIBE_BASE_URL",
    "UNIWORK_API_URL",
    "LIVEKIT_URL",
    "SCRIBE_HEALTH_PORT",
    "SCRIBE_METRICS_PORT",
    "SCRIBE_DRAIN_TIMEOUT_S",
    "PROMETHEUS_MULTIPROC_DIR",
  ]);
  assert.equal(agent.get("MEETING_SCRIBE_AGENT_NAME"), "uniwork-scribe");
  assert.equal(agent.get("SCRIBE_STT_PROVIDER"), "assemblyai");
  assert.equal(agent.get("SCRIBE_STT_BASE_URL"), "");
  assert.equal(agent.get("AI_MEETING_TRANSCRIBE_BASE_URL"), "");
  assert.equal(agent.get("UNIWORK_API_URL"), "http://uniwork-be:8080");
  assert.equal(agent.get("LIVEKIT_URL"), "wss://livekit.ubos.vn");
  assert.equal(agent.get("SCRIBE_HEALTH_PORT"), "8081");
  assert.equal(agent.get("SCRIBE_METRICS_PORT"), "9100");
  assert.equal(agent.get("SCRIBE_DRAIN_TIMEOUT_S"), "20");
  assert.equal(agent.get("PROMETHEUS_MULTIPROC_DIR"), "/tmp/scribe-metrics");
  for (const secret of ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "ASSEMBLYAI_API_KEY"]) {
    assert.equal(agent.has(secret), false, secret);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern "meeting agent env" scripts/app-dev-env.test.mjs`

Expected: FAIL, `ENOENT` vì chưa có `deploy/app-dev/env/uniwork-meeting-agent.env`.

Không chạy cả file ở bước này. Test `compose files pin registry images` đang đỏ sẵn: assertion đòi subnet `10.230.19.0/24`, file Compose đang ghi `10.250.0.0/24`. Task 2 xử lý.

- [ ] **Step 3: Write the env files**

Tạo `deploy/app-dev/env/uniwork-meeting-agent.env`:

```
# UniWork meeting-agent — development runtime for deploy/app-dev.
# LIVEKIT_API_KEY, LIVEKIT_API_SECRET and ASSEMBLYAI_API_KEY stay in the host
# .env and are injected by docker-compose.secrets.yml.

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

Trong `deploy/app-dev/env/uniwork-be.env`, ngay sau dòng `LIVEKIT_RECORDING_S3_ENDPOINT=`:

```
# Meeting scribe (apps/meeting-agent). The meeting_scribe flag still decides per organization.
MEETING_SCRIBE_ENABLED=true
MEETING_SCRIBE_AGENT_NAME=uniwork-scribe
```

Trong `deploy/app-dev/.env.example`, nhóm bắt buộc, ngay sau `LIVEKIT_API_SECRET=`:

```
# Compose refuses to start uniwork-meeting-agent when this is empty.
ASSEMBLYAI_API_KEY=
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern "meeting agent env|business env files" scripts/app-dev-env.test.mjs`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/app-dev-env.test.mjs deploy/app-dev/env/uniwork-meeting-agent.env deploy/app-dev/env/uniwork-be.env deploy/app-dev/.env.example
git commit -m "$(cat <<'EOF'
feat(deploy): enable the meeting scribe on app-dev

The dev backend may dispatch uniwork-scribe. The agent env file carries
no API key; AssemblyAI stays a host secret.

EOF
)"
```

---

### Task 2: Service Compose và secret

**Files:**
- Modify: `deploy/app-dev/docker-compose.yml` (thêm service trước `uniwork-fe`)
- Modify: `deploy/app-dev/docker-compose.secrets.yml`
- Test: `scripts/app-dev-env.test.mjs` (test `compose files pin registry images`)

**Interfaces:**
- Consumes: `env/uniwork-meeting-agent.env` từ Task 1, mười tên gán đó.
- Produces: service Compose `uniwork-meeting-agent` và ba biến `${…:?}` trong file secrets. Task 3 không đổi lệnh `up` trên host.

- [ ] **Step 1: Point the subnet assertion at the subnet already in the file**

Trong `scripts/app-dev-env.test.mjs`, đổi:

```javascript
  assert.match(compose, /subnet: 10\.230\.19\.0\/24/);
```

thành:

```javascript
  assert.match(compose, /subnet: 10\.250\.0\.0\/24/);
```

Không đổi `subnet` trong Compose và không đổi `TRUSTED_PROXIES=10.230.19.0/24`. Hai dải khác nhau là nợ có sẵn, ngoài spec.

Run: `node --test --test-name-pattern "compose files pin" scripts/app-dev-env.test.mjs`

Expected: PASS. Nếu vẫn đỏ, dừng. Đừng sửa subnet cho đến khi hiểu vì sao file và test lại lệch thêm.

- [ ] **Step 2: Write the failing compose assertions**

Cuối test `compose files pin registry images`, sau assertion `dev-only-office-engine`, thêm:

```javascript
  assert.match(secrets, /LIVEKIT_API_KEY: \$\{LIVEKIT_API_KEY:\?\}/);
  assert.match(secrets, /LIVEKIT_API_SECRET: \$\{LIVEKIT_API_SECRET:\?\}/);
  assert.match(secrets, /ASSEMBLYAI_API_KEY: \$\{ASSEMBLYAI_API_KEY:\?\}/);

  const agentAt = compose.indexOf("\n  uniwork-meeting-agent:\n");
  const feAt = compose.indexOf("\n  uniwork-fe:\n");
  assert.equal(agentAt > 0 && feAt > agentAt, true);
  const agentService = compose.slice(agentAt, feAt);
  assert.match(agentService, /image: registry-harbor\.ubos\.vn\/uniwork\/uniwork-meeting-agent:\$\{UNIWORK_IMAGE_TAG:\?\}/);
  assert.match(agentService, /command: \["python", "agent\.py", "dev"\]/);
  assert.match(agentService, /path: env\/uniwork-meeting-agent\.env/);
  assert.match(agentService, /init: true/);
  assert.match(agentService, /cap_drop:\n {6}- ALL/);
  assert.match(agentService, /no-new-privileges:true/);
  assert.match(agentService, /restart: unless-stopped/);
  assert.match(agentService, /stop_grace_period: 150s/);
  assert.match(agentService, /cpus: 1/);
  assert.match(agentService, /mem_limit: 2g/);
  assert.match(agentService, /pids_limit: 256/);
  assert.match(agentService, /http:\/\/127\.0\.0\.1:8081\/worker/);
  assert.match(agentService, /uniwork-be:\n {8}condition: service_healthy/);
  assert.equal(agentService.includes("ports:"), false);
  assert.equal(agentService.includes("read_only:"), false);
  assert.equal(agentService.includes("cap_add:"), false);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test --test-name-pattern "compose files pin" scripts/app-dev-env.test.mjs`

Expected: FAIL vì chưa có `uniwork-meeting-agent` hoặc chưa có ba dòng secret.

- [ ] **Step 4: Add the service and the secrets**

Trong `deploy/app-dev/docker-compose.yml`, chèn trước `uniwork-fe:`:

```yaml
  uniwork-meeting-agent:
    image: registry-harbor.ubos.vn/uniwork/uniwork-meeting-agent:${UNIWORK_IMAGE_TAG:?}
    command: ["python", "agent.py", "dev"]
    env_file:
      - path: env/uniwork-meeting-agent.env
        required: true
    init: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    cpus: 1
    mem_limit: 2g
    pids_limit: 256
    stop_grace_period: 150s
    depends_on:
      uniwork-be:
        condition: service_healthy
    healthcheck:
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
    restart: unless-stopped

```

Giữ một dòng trống trước `uniwork-fe:`. Không thêm `ports`, `read_only`, `cap_add`, `build`.

Thêm vào cuối `deploy/app-dev/docker-compose.secrets.yml`:

```yaml
  uniwork-meeting-agent:
    environment:
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY:?}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET:?}
      ASSEMBLYAI_API_KEY: ${ASSEMBLYAI_API_KEY:?}
```

Service `uniwork-be` trong file secrets giữ `env_file: .env`. Không gắn file đó vào agent.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/app-dev-env.test.mjs`

Expected: PASS, 3 tests. Test Jenkins chưa đổi nên vẫn xanh.

- [ ] **Step 6: Commit**

```bash
git add deploy/app-dev/docker-compose.yml deploy/app-dev/docker-compose.secrets.yml scripts/app-dev-env.test.mjs
git commit -m "$(cat <<'EOF'
feat(deploy): run the meeting agent in app-dev compose

The worker joins the existing compose network and reads LiveKit and
AssemblyAI keys only from the host env file.

EOF
)"
```

---

### Task 3: Jenkins app-dev build và copy env

**Files:**
- Modify: `ci/Jenkinsfile.app-dev.groovy` (stage sau `Build Office Engine`, dòng `stash`, khối `scp` env)
- Test: `scripts/app-dev-env.test.mjs` (test `Jenkinsfile deploys by SSH without a latest tag`)

**Interfaces:**
- Consumes: đường dẫn `deploy/app-dev/env/uniwork-meeting-agent.env` và service Compose từ Task 2. Lệnh remote `docker compose pull` / `up` giữ nguyên.
- Produces: image `registry-harbor.ubos.vn/uniwork/uniwork-meeting-agent:${IMAGE_TAG}` được push, file env có trên host sau `scp`.

- [ ] **Step 1: Write the failing test**

Cuối test `Jenkinsfile deploys by SSH without a latest tag`, trước dấu `});`, thêm:

```javascript
  assert.equal(text.includes("apps/meeting-agent"), true);
  assert.equal(text.includes('uniwork-meeting-agent:${IMAGE_TAG}'), true);
  assert.equal(
    (text.match(/deploy\/app-dev\/env\/uniwork-meeting-agent\.env/g) || []).length,
    2,
  );
```

Số 2 là một lần trong `stash` và một lần trong `scp`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern "Jenkinsfile deploys" scripts/app-dev-env.test.mjs`

Expected: FAIL, `apps/meeting-agent` chưa có trong Jenkinsfile.

- [ ] **Step 3: Add the build stage, stash path, and scp path**

Sau stage `Build Office Engine`, trước stage `Write image tag`:

```groovy
        stage('Build Meeting Agent') {
          steps {
            sh '''
              set -e
              docker build \\
                --memory="${DOCKER_BUILD_MEMORY}" \\
                --memory-swap="${DOCKER_BUILD_MEMORY}" \\
                -t "${REGISTRY}/uniwork-meeting-agent:${IMAGE_TAG}" \\
                apps/meeting-agent
              docker push "${REGISTRY}/uniwork-meeting-agent:${IMAGE_TAG}"
            '''
          }
        }
```

Đổi dòng `stash` thành:

```groovy
            stash name: 'app-dev-deploy', includes: 'deploy/app-dev/docker-compose.yml,deploy/app-dev/docker-compose.secrets.yml,deploy/app-dev/env/uniwork-be.env,deploy/app-dev/env/uniwork-fe.env,deploy/app-dev/env/uniwork-office-engine.env,deploy/app-dev/env/uniwork-meeting-agent.env,target/image.env'
```

Trong khối `scp` env, thêm một dòng sau `uniwork-office-engine.env`:

```groovy
                deploy/app-dev/env/uniwork-meeting-agent.env \
```

Không sửa lệnh `docker compose pull` và `up`. Không thêm `docker tag` hay `docker push` với `:latest`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/app-dev-env.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add ci/Jenkinsfile.app-dev.groovy scripts/app-dev-env.test.mjs
git commit -m "$(cat <<'EOF'
ci: build the meeting agent image for app-dev

The dev pipeline pushes the dev tag and copies the agent env file.
The host .env is still not overwritten.

EOF
)"
```

---

### Task 4: Workflow GitHub không build image

**Files:**
- Modify: `.github/workflows/meeting-agent-verify.yml`
- Modify: `ci/Jenkinsfile.production-app.groovy` (comment trong stage `Build Meeting Agent`, khoảng dòng 168–169)
- Test: `scripts/app-dev-env.test.mjs`

**Interfaces:**
- Consumes: không dùng file của Task 1–3.
- Produces: workflow chỉ còn job `agent`. Jenkins production vẫn build image và pin digest. Comment production nói đúng việc đó.

- [ ] **Step 1: Write the failing test**

Thêm ở cuối `scripts/app-dev-env.test.mjs`:

```javascript
test("meeting-agent workflow audits without building an image", () => {
  const wf = fs.readFileSync(
    path.join(root, ".github/workflows/meeting-agent-verify.yml"),
    "utf8",
  );
  assert.equal(wf.includes("pip-audit==2.9.0"), true);
  assert.equal(wf.includes("python -m pytest -q"), true);
  assert.equal(wf.includes("docker/build-push-action"), false);
  assert.equal(wf.includes("docker/login-action"), false);
  assert.equal(wf.includes("docker/setup-buildx-action"), false);
  const prod = fs.readFileSync(path.join(root, "ci/Jenkinsfile.production-app.groovy"), "utf8");
  assert.equal(prod.includes("builds and pip-audits"), false);
  assert.equal(prod.includes("runs ruff, pytest and pip-audit"), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern "meeting-agent workflow" scripts/app-dev-env.test.mjs`

Expected: FAIL vì file workflow còn `docker/build-push-action` và chưa có `pip-audit==2.9.0` trong job `agent`.

- [ ] **Step 3: Replace the workflow and the production comment**

Ghi đè `.github/workflows/meeting-agent-verify.yml` bằng:

```yaml
name: Meeting Agent Verify

# apps/meeting-agent (ADR 0045): the Python LiveKit worker of the AI scribe.
# Beside the main CI workflow: it is not a pnpm/turbo workspace.
# ruff, pytest, and pip-audit of the pinned requirements. Tests use the fake
# STT and never reach a LiveKit room or a vendor; tests/test_eval_run.py also
# pins the STT harness to the server's batch request, hence the
# file_transcribe.go path below.
# Jenkins app-dev builds the dev tag. Jenkins production builds the image and
# pins the digest. This workflow does not build or push an image.

on:
  push:
    branches: [main, develop]
    paths:
      - "apps/meeting-agent/**"
      - "server/internal/ai/provider/file_transcribe.go"
      - ".github/workflows/meeting-agent-verify.yml"
  pull_request:
    branches: [main, develop]
    paths:
      - "apps/meeting-agent/**"
      - "server/internal/ai/provider/file_transcribe.go"
      - ".github/workflows/meeting-agent-verify.yml"

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  agent:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: apps/meeting-agent
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
          cache: pip
          cache-dependency-path: apps/meeting-agent/requirements*.txt
      - run: pip install -r requirements-dev.txt
      - name: Ruff
        run: ruff check . && ruff format --check .
      - name: Pytest
        run: python -m pytest -q
      - name: pip-audit
        run: |
          python -m pip install pip-audit==2.9.0
          pip-audit --progress-spinner off -r requirements.txt
```

Trong `ci/Jenkinsfile.production-app.groovy`, thay hai dòng comment:

```groovy
              // The AI scribe worker (apps/meeting-agent, ADR 0045); its directory is the context.
              // .github/workflows/meeting-agent-verify.yml builds and pip-audits it on every PR.
```

bằng:

```groovy
              // The AI scribe worker (apps/meeting-agent, ADR 0045); its directory is the context.
              // .github/workflows/meeting-agent-verify.yml runs ruff, pytest and pip-audit.
              // This Jenkinsfile builds the image and the rollout pins the digest.
```

Không đổi lệnh `docker build` của stage production đó.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/app-dev-env.test.mjs scripts/governance.test.mjs`

Expected: `app-dev-env.test.mjs` PASS, 4 tests. `governance.test.mjs` PASS (nó đòi workflow chứa `pytest`; file mới vẫn chứa `python -m pytest -q`).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/meeting-agent-verify.yml ci/Jenkinsfile.production-app.groovy scripts/app-dev-env.test.mjs
git commit -m "$(cat <<'EOF'
ci: stop the meeting-agent workflow from pushing images

GitHub still runs ruff, pytest and pip-audit. Jenkins production keeps
building the image and pinning the digest.

EOF
)"
```

---

## Sau khi merge

Không có bước tự động nào mở phòng LiveKit. Người vận hành thêm `ASSEMBLYAI_API_KEY` vào `/home/devops/uniwork/.env` trước lần deploy đầu tiên có service này, rồi làm mục 8 của spec: một cuộc họp của tổ chức đã bật `meeting_scribe` có thư ký và phụ đề. Tổ chức chưa bật cờ thì container vẫn healthy và phòng không có thư ký.
