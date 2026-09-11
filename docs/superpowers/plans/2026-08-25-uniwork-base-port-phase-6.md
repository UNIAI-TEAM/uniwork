# UniWork Base Port — Pha 6 (Tooling, CI, bộ tài liệu agent)

> **Trạng thái:** shipped

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa vận hành của uniwork lên ngang usf — Makefile tự mô tả với worktree isolation, pipeline `make check`, CI 4 job, `.env.example` đủ mọi knob đang dùng — và viết bộ tài liệu agent (`AGENTS.md`, `CLAUDE.md`, `docs/conventions.md`) mô tả **đúng cái đã tồn tại** sau Pha 0–4.

**Architecture:** Port script shell của usf, đổi tên biến, bỏ phần daemon/CLI/selfhost/helm. CI cắt từ 8 job xuống 4. Tài liệu viết cuối, mỗi luật soi được vào một lệnh/test có thật.

**Tech Stack:** GNU make · bash · Docker Compose · GitHub Actions · turbo cache.

**Spec:** §8, §9 của `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`
**Đã làm ở Pha 0:** `turbo.json` (globalDependencies + cache-inputs), `.github/workflows/ci.yml` placeholder, `scripts/{catalog-check,turbo-cache-check,no-usf-leak}`.

## Global Constraints

- `make check` phải chạy được trên máy dev với stack đang mở (phát hiện "already running", không giết process của người khác).
- Script chỉ kill process **do chính nó** khởi động.
- Worktree: mỗi worktree một DB + cặp cổng riêng qua `.env.worktree`; `.env.worktree` **không** commit.
- Tài liệu agent: tiếng Anh; mỗi luật kiểm chứng được. `AGENTS.md` là con trỏ, `CLAUDE.md` là nguồn sự thật.
- Không có `actionlint` trên máy — YAML CI được kiểm bằng `node` parse + review tay; **CI chỉ thật sự được chứng minh khi push**, ghi rõ điều đó.

## Khảo sát (2026-08-25)

- Makefile uniwork: 13 target, không `help`, không worktree, `test-go` không đảm bảo DB/migration trước.
- usf `check.sh` chờ `/health`; uniwork là `/healthz`. usf `test-go.sh` có guard agent CLI — bỏ, chỉ giữ `go test -race`.
- Env đang được server đọc mà `.env.example` chưa có: `METRICS_ADDR`, `STORAGE_BACKEND`, `LOCAL_UPLOAD_DIR`, `LOCAL_UPLOAD_BASE_URL`, `AWS_*`, `TRUSTED_PROXIES`, `FEATURE_FLAGS_FILE`, `LOG_LEVEL`; test: `REDIS_TEST_URL`, `TEST_DATABASE_URL`; e2e: `E2E_BASE_URL`.
- Go test cần DB test (`uniwork_test`, cổng 5433 local). CI: một service postgres với `POSTGRES_DB=uniwork_test`, `TEST_DATABASE_URL` trỏ vào 5432.
- usf CI không chạy Playwright; e2e là việc của `make check` local. Giữ nguyên.

---

## Task 1: Makefile + scripts (worktree isolation, check pipeline)

**Files:** Replace `Makefile`; Create `scripts/{local-env.sh,ensure-postgres.sh,init-worktree-env.sh,dev.sh,check.sh,test-go.sh}`; Modify `.gitignore` (+`.env.worktree`), `docker-compose.yml` (giữ), `.env.example`.

- [ ] **Step 1 (đỏ):** `make help` → lỗi "No rule to make target". `bash scripts/init-worktree-env.sh /tmp/x` → không tồn tại.
- [ ] **Step 2:** Port `local-env.sh` (biến: `POSTGRES_*`, `PORT`, `FRONTEND_PORT/ORIGIN`, `NEXT_PUBLIC_API_URL/WS_URL/APP_URL`, `LOCAL_UPLOAD_BASE_URL`, `E2E_BASE_URL`), `ensure-postgres.sh` (compose service `postgres`, tạo DB theo `POSTGRES_DB`; **thêm** tạo `${POSTGRES_DB}_test` cho Go test trong worktree), `init-worktree-env.sh` (DB `uniwork_<slug>_<offset>`, cổng `18080+offset`/`13000+offset`, `TEST_DATABASE_URL` trỏ DB test cùng container), `dev.sh`, `check.sh` (`/healthz`, `pnpm --filter @uniwork/e2e test` với `E2E_BASE_URL`), `test-go.sh` (`go test -race ./...`, `REDIS_TEST_URL` mặc định).
- [ ] **Step 3:** Makefile: `help` (awk `##`), `setup/start/stop/check`, `db-up/db-down/db-reset`, `worktree-env`, `setup|start|stop|check-worktree`, `dev`, `server`, `web`, `build` (server + migrate), `test` (= `test-go` + `test-fe`), `test-go` (ensure DB → migrate → `test-go.sh`), `test-fe`, `e2e`, `migrate-up/down`, `sqlc`, `clean`. `ENV_FILE` tự chọn `.env` → `.env.worktree`.
- [ ] **Step 4 (xanh):** `make help` liệt kê target; `WORKTREE_NAME=probe bash scripts/init-worktree-env.sh /tmp/probe.env` sinh file có DB/cổng khác main; `make test-go` xanh; `make check` xanh **trên stack đang chạy** (phải in "already running", không restart).
- [ ] **Step 5:** `.env.example` đầy đủ, nhóm theo mục (Database / Server / Realtime & Redis / Storage / Metrics / Feature flags / Frontend / Test), mỗi knob một dòng chú thích. Commit `chore: makefile with worktree isolation and the check pipeline`.

## Task 2: CI 4 job

**Files:** Replace `.github/workflows/ci.yml`.

- [ ] **Step 1:** `changes` (dorny/paths-filter: `apps/**`, `packages/**`, `package.json`, `pnpm-*.yaml`, `turbo.json`, `scripts/**`, `.github/workflows/ci.yml`, `server/internal/service/reserved_slugs.json`) → output `frontend`.
- [ ] **Step 2:** `frontend-build`: pnpm 10 (`pnpm/action-setup@v4` đọc `packageManager`), Node 22, turbo cache key có `node --version` + sha; `pnpm generate:reserved-slugs && git diff --exit-code packages/core/paths/reserved-slugs.ts`; `node --test scripts/catalog-check.test.mjs scripts/no-usf-leak.test.mjs`; `pnpm exec turbo build typecheck lint`.
- [ ] **Step 3:** `frontend-test`: turbo cache riêng; `pnpm exec turbo test`. `frontend` aggregate job (status check tên ổn định).
- [ ] **Step 4:** `backend`: services `postgres:16-alpine` (`POSTGRES_DB=uniwork_test`) + `redis:7-alpine` với healthcheck; env `DATABASE_URL`, `TEST_DATABASE_URL` (cùng DB test), `REDIS_TEST_URL=redis://localhost:6379/1`, `JWT_SECRET=ci`; steps: setup-go 1.27 (cache theo `server/go.sum`), `gofmt -l` phải rỗng, `go vet ./...`, `go build ./...`, `go run ./cmd/migrate up`, `bash scripts/test-go.sh`.
- [ ] **Step 5:** Kiểm YAML parse bằng `node -e` (dùng gói `yaml` đã có trong catalog qua `pnpm dlx`? — dùng `npx --yes yaml` hoặc đọc bằng `js-yaml` nếu có); review tay tên action/version. Ghi rõ trong commit: **chưa chạy trên GitHub**. Commit `ci: four-job pipeline`.

## Task 3: `docs/conventions.md`

- [ ] **Step 1:** Viết theo cấu trúc usf: (1) Code naming — routes (`/{orgSlug}/{wsSlug}/{section}`, global một từ hoặc `/{noun}/{verb}`), packages boundary table, files/components/hooks/stores/tests, DB (snake_case, `*_id`, `*_at`, migration NNN + up/down, no-FK, CONCURRENTLY), Go, TypeScript (snake_case trên dây; **không** convert camelCase — uniwork giữ snake_case trong types, ghi rõ khác usf), query key factories, API boundary; (2) **Glossary vi–en**: everyday nouns dịch (task → *việc* hay *nhiệm vụ*? — theo locale hiện tại: đọc `vi.json` để lấy từ đang dùng, không tự bịa), UniWork-specific giữ English (`workspace`? hiện `vi.json` dùng "workspace" nguyên — ghi nhận), brands/acronyms không dịch, roles/status enum lowercase English, plural `_one/_other` (tiếng Việt chỉ `_other`), interpolation, key naming `feature.component.action`; (3) **Vietnamese voice**: dấu câu, xưng hô (không "bạn" dư thừa; nút = động từ đầu; lỗi = nhẹ nhưng rõ; placeholder = ví dụ), khoảng trắng quanh từ tiếng Anh; (4) Commit convention.
- [ ] **Step 2:** Mọi ví dụ glossary lấy từ `packages/core/i18n/locales/vi.json` thật (grep). Commit `docs: conventions — naming, vi–en glossary, Vietnamese voice`.

## Task 4: `CLAUDE.md` chính thức + `AGENTS.md`

- [ ] **Step 1:** `CLAUDE.md` 16 mục theo thứ tự spec §9.1: Conventions (trỏ `docs/conventions.md`) · Project Shape · State Rules · Package Boundaries · Sharing Rules · Commands (từ Makefile mới) · Database & Migration Rules · Coding Rules · API Compatibility · Backend UUID/ID Rules (uniwork dùng ULID `TEXT` — viết đúng thực tế, không copy UUID của usf) · Web Features (guard, adapter, AppLink; ghi rõ sidebar/pages chưa chuyển — Pha 5) · UI Rules · Testing (bảng vị trí test + 4 test-contract) · Verification · Commits · Domain Reminders (hai tầng thành viên, `X-Workspace-ID`? — kiểm: uniwork chưa dùng header này, workspace đi qua path → **viết đúng**).
- [ ] **Step 2:** `AGENTS.md`: con trỏ + Quick Reference (kiến trúc, state, ranh giới, migration, lệnh). `apps/web/AGENTS.md` giữ khối Next tự sinh.
- [ ] **Step 3:** Kiểm chứng: mỗi lệnh trong Commands chạy được (`make -n <target>` cho từng target; `pnpm run` cho script); mỗi đường dẫn file nêu trong CLAUDE.md tồn tại (`grep -oE '\`[a-z@./\-]+\.(ts|tsx|go|json|css|md)\`' CLAUDE.md` → `test -e`). Dòng nào không qua → xoá dòng. Commit `docs: authoritative CLAUDE.md and AGENTS.md`.

## Task 5: README + cổng ra

- [ ] **Step 1:** README: mục "Chạy dev" → `make dev`; "Worktree" → `make worktree-env && make setup-worktree && make start-worktree`; "Kiểm tra" → `make check`; giữ phần LiveKit/deploy.
- [ ] **Step 2:** Cổng ra: `make check` xanh (13/13 e2e) · `git status` sạch · `node --test scripts/*.test.mjs` · `bash scripts/turbo-cache-check.sh`. Ghi "Ghi chép thực thi". Commit.

---

## Ghi chép thực thi (2026-08-25)

Hoàn tất trên `feat/base-port-phase-0-1`, 6 commit. `make check` chạy trọn trên máy dev với stack đang
mở (phát hiện "already running", không restart) và xanh toàn bộ: typecheck · lint · 368 test đơn vị
(views 46 · ui 87 · core 235) + 2 contract test + turbo probe · Go `-race`/gofmt/vet · **13/13 e2e**.

### Điều thực thi lộ ra

**1. Pipeline bắt lỗi ngay lần chạy đầu — hai lỗi thật.** (a) Makefile `export` toàn bộ env của app, nên
`LOCAL_UPLOAD_BASE_URL` rò vào test avatar → URL tuyệt đối thay vì `/uploads/…`. Sửa ở **test** (ghim env
mình phụ thuộc), không sửa Makefile: test phải tự đứng dù shell dev có gì. Đã đưa thành luật trong
CLAUDE.md § Testing. (b) `render-smoke.test.tsx` trượt timeout 5s dưới tải toàn máy (ba worker vitest +
Go `-race`) dù chạy riêng chỉ 1.5s → 30s/case, kèm lý do ngay cạnh.

**2. CI chưa được chứng minh.** YAML parse được (js-yaml), review tay từng action/version, nhưng nhánh
chưa push nên **chưa có lần chạy thật nào trên GitHub**. Commit message nói rõ. Lần push đầu là phép thử
thật; hai chỗ dễ trượt: `pnpm/action-setup@v4` đọc `packageManager` (cần pnpm ≥ 9 trên runner — có), và
`scripts/turbo-cache-check.sh` sửa rồi `git checkout` một file — cần checkout đầy đủ, `actions/checkout@v4`
mặc định là đủ.

**3. Tài liệu mô tả đúng cái đã có, kể cả nợ.** CLAUDE.md nêu rõ sidebar + pages còn `useRouter` là nợ
Pha 5; luật ID viết theo ULID `TEXT` thật của uniwork chứ không chép UUID của usf; `X-Workspace-ID` của usf
**không** xuất hiện vì uniwork đưa workspace qua path. Mọi đường dẫn/target/script nêu trong hai file đã
được kiểm bằng lệnh (`test -e`, `make -n`, `package.json`).

**4. Glossary lấy từ locale thật.** `workspace` giữ tiếng Anh trong bản vi (đúng như `vi.json`), `tổ chức`,
`công việc`/`việc`, `cuộc họp`. Phát hiện nhỏ: parity test buộc `vi.json` có cả `_one` lẫn `_other` dù
tiếng Việt không chia số — ghi thành quy tắc thay vì bịa quy tắc "chỉ `_other`".

### Còn lại

Pha 5 (dựng lại FE theo 5 lát dọc) — plan riêng. Khi xong: cập nhật mục *Web Features* của CLAUDE.md
(gỡ đoạn "known debt") và xoá lớp `--uw-*` trong `tokens.css`.
