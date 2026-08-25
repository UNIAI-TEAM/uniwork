# UniWork Base Port — Pha 3 (Sweep Tầng 1: Server Go)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mang lớp hạ tầng server của usf sang uniwork — middleware, realtime hub + Redis relay, storage local/S3, metrics Prometheus, events bus, feature flags, util, migrations lint — mỗi lô có test đi kèm hoặc consumer thật.

**Architecture:** Copy cơ học, đổi module path, gỡ phần dính daemon/PAT/issue của usf. Hub realtime scope-based của usf **thay** hub 45 dòng của uniwork; `service.EventPublisher` giữ nguyên chữ ký nên services không đổi. Runner migration chuyển sang chạy ngoài transaction để luật `CONCURRENTLY` có thể áp.

**Tech Stack:** Go 1.27 · chi · pgx/sqlc · gorilla/websocket · go-redis · prometheus/client_golang · aws-sdk-go-v2.

**Spec:** `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`
**Plan trước:** `…-phase-2.md` (đọc "Ghi chép thực thi": danh sách Tầng 1 trong spec không đáng tin tới khi đọc import thật).

## Global Constraints

- Module path `github.com/unicomhub/uniwork/server`; mọi `multica-ai/multica` phải biến mất — `scripts/no-usf-leak.test.mjs` quét cả `*.go`.
- Không FOREIGN KEY, mọi index mới `CREATE INDEX CONCURRENTLY` trong file một câu lệnh — **forward-only từ `005`**; `001`–`004` là legacy, không sửa.
- Comment code tiếng Anh. `gofmt`, `go vet`, checked errors.
- Cổng sau mỗi lô: `cd server && go build ./... && go vet ./... && go test ./...` (cần `make db-up`).
- Luật nghiệm thu (spec §12.3): module port sang phải có test đi kèm xanh **hoặc** consumer thật trong cùng pha. Không đạt → cắt và **báo**.

## Bẫy đã biết (khảo sát 2026-08-25)

**A. Lint migration của usf không kiểm FK/CONCURRENTLY.** Nó chỉ kiểm cặp up/down, tiền tố duy nhất, vùng legacy đóng băng. Hai luật cứng của spec §10.2 phải viết mới. Và **runner của uniwork bọc mỗi migration trong `tx`** — `CREATE INDEX CONCURRENTLY` bị PostgreSQL từ chối trong transaction. Sửa runner trước, áp luật sau.

**B. Hub usf là scope-based, protocol khác FE hiện tại.** usf: auth qua cookie hoặc frame `{"type":"auth"}` đầu tiên, `?workspace_id=`, rồi frame `subscribe`. FE uniwork hiện tại: `?workspace=&token=` và nhận broadcast thô. `ws-client.ts` đã port ở Pha 2 nói protocol usf. → Handler mới nhận **cả hai** (query token là đường tạm, có chú thích) cho tới khi Plan 4 chuyển FE sang `ws-client.ts`.

**C. `auth/{jwt,cookie,pat_cache,cloud_pat,daemon_token_cache}` là luồng auth khác** (cookie + CSRF + PAT + daemon). uniwork dùng bearer token. Đổi mô hình auth là Tầng 2. Chỉ port `membership_cache` (+test).

**D. Dính daemon/PAT rải rác:** `realtime/hub.go` (PATResolver, Broadcast "daemon events"), `redis_relay.go` (`DaemonRuntimeDeliverer`), `metrics/registry.go` (`daemonws`, Business, Wecom, sampler), `util/proc_*.go`, `util/mention.go`, `logger.go` (`NewWriterLoggerDefault` cho daemon — vô hại, giữ).

**E. `migrations/migrations.go` của usf đọc file từ đĩa + `selfexec`.** uniwork embed SQL — giữ runner uniwork, chỉ port **test lint** và thêm hai luật.

## Bản kê

| Port | Ghi chú |
| --- | --- |
| `internal/middleware/{ratelimit,csp,client,request_logger}.go` + test | copy nguyên; `cloudfront` đi cùng S3 (Task 6) nếu tự đứng |
| `internal/auth/membership_cache.go` + test | duy nhất trong `auth/` là hạ tầng thuần |
| `internal/realtime/*` (11 file) | gỡ PAT/daemon; adapter `EventPublisher` |
| `internal/storage/*` (8 file) | consumer: avatar upload (`/me/avatar`) |
| `internal/metrics/{config,http,db,server,realtime,registry,testutil}.go` + test | `registry.go` cắt Business/Wecom/DaemonWS/sampler |
| `internal/events/bus.go` + test | có test |
| `pkg/featureflag/*` (14 file) + `internal/featureflags/keys.go` | keys của usf → rỗng |
| `internal/util/{json,pgx,text}.go` + `secretbox/` + test | bỏ `mention`, `proc_*` |
| `internal/logger/logger.go` | thêm `Init/NewLogger/RequestAttrs`, giữ `New()` |
| `internal/migrations/migrations_lint_test.go` | vào `server/migrations/`, baseline `004`, **+2 luật mới** |

**Không port:** `daemon*`, `cli`, `agent*`, `integrations`, `scheduler`, `selfexec`, `attribution*`, `taskusagebackfill`, `channelmedia`, `cloudruntime`, `runtimeapps`, `issue*`, `dispatch`, `skill`, `analytics` (dính agent), `pkg/{agent,composio,llm,protocol,skillbundle,taskfailure,redact}`.

---

## Task 1: go.mod + cổng chống rò rỉ

**Files:** `server/go.mod`, `scripts/no-usf-leak.test.mjs` (đã quét `.go`)

- [ ] **Step 1:** Thêm dependency trực tiếp:
```bash
cd server
go get github.com/prometheus/client_golang@v1.23.2 \
       github.com/go-redis/redismock/v9@v9.2.0 \
       github.com/aws/aws-sdk-go-v2@v1.41.5 \
       github.com/aws/aws-sdk-go-v2/config@v1.32.13 \
       github.com/aws/aws-sdk-go-v2/credentials@v1.19.13 \
       github.com/aws/aws-sdk-go-v2/service/s3@v1.97.3
go mod tidy && go build ./...
```
- [ ] **Step 2:** `git commit -m "chore(server): add prometheus, redismock and aws sdk for the infra port"`

---

## Task 2: Middleware hạ tầng

**Files:** Create `server/internal/middleware/{ratelimit,csp,client,request_logger}.go` + `_test.go`; Modify `server/internal/handler/router.go`

**Interfaces:**
- Produces: `RateLimit(rdb, limit, window, trustedProxies)`, `ContentSecurityPolicy`, `ClientMetadata` + `ClientMetadataFromContext(ctx)`, `RequestLogger`.

- [ ] **Step 1:** Copy 8 file, đổi module path:
```bash
cd /Users/phanducquang/Work/AIFactory
for f in ratelimit csp client request_logger; do cp usf/server/internal/middleware/$f.go usf/server/internal/middleware/${f}_test.go uniwork/server/internal/middleware/; done
cd uniwork && perl -pi -e 's{multica-ai/multica/server}{unicomhub/uniwork/server}g' server/internal/middleware/*.go
```
- [ ] **Step 2:** `csp.go` có `isAttachmentPreviewDocumentPath` (route usf). Giữ hàm, đổi đường dẫn khớp uniwork (`/api/v1/attachments/*/preview` chưa tồn tại → để nguyên logic, cập nhật comment). `request_logger.go` có `SetWebhookTriggerID` (webhook usf) — giữ, vô hại, có test.
- [ ] **Step 3:** Test đi kèm phải xanh nguyên trạng: `cd server && go test ./internal/middleware/`
- [ ] **Step 4:** Mount vào `router.go` — đây là consumer thật:
```go
r.Use(chimw.RequestID)
r.Use(chimw.RealIP)
r.Use(mw.ClientMetadata)
r.Use(mw.RequestLogger)
r.Use(chimw.Recoverer)
r.Use(mw.ContentSecurityPolicy)
// RateLimit chỉ khi có Redis: r.Use(mw.RateLimit(rdb, 300, time.Minute, trusted))
```
`Deps` nhận thêm `Redis *redis.Client` (nil được).
- [ ] **Step 5:** `go build ./... && go test ./...` xanh; `make e2e` 13/13. Commit `feat(server): port the infra middleware stack and mount it`.

---

## Task 3: Runner migration ngoài transaction + lint hai luật cứng

**Files:** Modify `server/migrations/embed.go`; Create `server/migrations/lint_test.go`, `server/migrations/005_concurrent_index_probe.up.sql`/`.down.sql` (probe, xoá sau khi chứng minh)

Thứ tự đúng: chứng minh runner **thất bại** với CONCURRENTLY → sửa runner → probe xanh → viết lint → xoá probe.

- [ ] **Step 1 (đỏ):** Tạo `005_concurrent_index_probe.up.sql`: `CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_probe_idx ON tasks (workspace_id);` và `.down.sql`: `DROP INDEX IF EXISTS tasks_probe_idx;`. Chạy `go test ./migrations/ -run TestUpIsIdempotent` → FAIL với `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`.
- [ ] **Step 2:** Sửa `Up` trong `embed.go`: thực thi từng file bằng `conn.Exec` **không** bọc `tx`, rồi `INSERT schema_migrations` riêng. Ghi comment: PostgreSQL từ chối concurrent index trong tx; migration đa câu lệnh thường vẫn tự nguyên tử theo từng câu; file một câu lệnh là quy ước bắt buộc cho index. `Down` tương tự.
- [ ] **Step 3 (xanh):** `go test ./migrations/` PASS. Xoá cặp probe.
- [ ] **Step 4:** Port lint: copy `usf/server/internal/migrations/migrations_lint_test.go` → `server/migrations/lint_test.go` (package `migrations`), đọc file qua `fsys` embed thay vì đĩa; `maxLegacyMigrationPrefix = 4`; `legacyDuplicateMigrationStems` rỗng. Thêm hai test:
```go
func TestNewMigrationsHaveNoForeignKeys(t *testing.T)      // prefix > 4: grep /\b(FOREIGN\s+KEY|REFERENCES)\b/i → t.Errorf
func TestNewMigrationsCreateIndexesConcurrently(t *testing.T) // prefix > 4: mọi CREATE [UNIQUE] INDEX phải có CONCURRENTLY, và file chứa nó phải đúng MỘT câu lệnh
```
- [ ] **Step 5:** Chứng minh luật bắn: tạo tạm `005_bad.up.sql` có `REFERENCES` → FAIL; xoá. Commit `feat(migrations): run outside a transaction; lint no-FK and concurrent-index rules`.

---

## Task 4: Realtime — hub scope-based + Redis relay

**Files:** Replace `server/internal/realtime/{hub,client,publisher}.go`; Create 11 file từ usf; Modify `server/internal/handler/ws.go`, `cmd/server/main.go`

**Interfaces:**
- Consumes: `service.EventPublisher{Publish(ctx, workspaceID, Event)}` — **giữ nguyên**, services không đổi.
- Produces: `realtime.Hub` (scope-based), `realtime.Broadcaster`, `realtime.NewPublisher(b Broadcaster) service.EventPublisher`, `realtime.HandleWebSocket(...)`.

- [ ] **Step 1:** Giữ test hiện có làm hợp đồng hồi quy: đọc `hub_test.go` của uniwork, viết lại 3 case của nó trên API mới (`BroadcastToWorkspace`) vào `publisher_test.go` trước khi thay hub.
- [ ] **Step 2:** Copy 11 file usf, đổi module path. Gỡ:
  - `hub.go`: `PATResolver` → `TokenParser func(token string) (userID string, err error)`; `authenticateToken` gọi nó. Xoá comment "daemon events".
  - `redis_relay.go`: `DaemonRuntimeDeliverer` + `SetDaemonRuntimeDeliverer` + nhánh trong `deliverEnvelope` — bỏ.
  - Import `internal/auth` (JWTSecret, AuthCookieName) → nhận qua tham số/`HandleWebSocketOptions{CookieName}`.
- [ ] **Step 3:** `HandleWebSocket` nhận thêm query `workspace` (alias `workspace_id`) và `token` (tạm — chú thích rõ: FE hiện tại; gỡ khi Plan 4 chuyển sang `ws-client.ts`). Auto-subscribe scope `workspace` như usf đã làm (hub.go:332).
- [ ] **Step 4:** `publisher.go` mới: `NewPublisher(b Broadcaster) service.EventPublisher` → marshal `Event` → `b.BroadcastToWorkspace(id, frame)`. `main.go`: `hub := realtime.NewHub(); go hub.Run()`; nếu `REDIS_URL` → `relay := realtime.NewRedisRelay(hub, rdb); relay.Start(ctx); broadcaster = realtime.NewDualWriteBroadcaster(hub, relay)`.
- [ ] **Step 5:** `ws.go`: gọi `realtime.HandleWebSocket(hub, membershipChecker{h.Workspaces}, h.Minter.Parse, nil, opts, w, r)`.
- [ ] **Step 6:** `go test ./internal/realtime/` — test usf đi kèm xanh (gỡ case daemon/PAT). `make e2e` 13/13 — smoke test tạo task/meeting đi qua `Publish`. Commit `feat(realtime): replace the hub with usf's scope-based hub and Redis relay`.

---

## Task 5: util + logger + events + feature flags

**Files:** Create `server/internal/util/{json,pgx,text}.go` + test, `server/internal/util/secretbox/`, `server/internal/events/`, `server/pkg/featureflag/`, `server/internal/featureflags/keys.go`; Modify `server/internal/logger/logger.go`, `cmd/server/main.go`

- [ ] **Step 1:** Copy; đổi module path. `util/ids.go` hiện có giữ. Bỏ `mention*`, `proc_*`.
- [ ] **Step 2:** `logger.go`: ghép `Init/NewLogger/RequestAttrs/parseLevel` của usf vào, **giữ** `New()` hiện có (gọi `NewLogger("server")`). `main.go` thêm `logger.Init()`.
- [ ] **Step 3:** `featureflags/keys.go`: giữ `EvaluateFrontendPublicFlags(ctx, flags) map[string]bool` trả `{}`, xoá các hàm `*Enabled` của usf. `main.go`: `flags, _ := featureflag.NewServiceFromEnv(...)` và `Deps.FeatureFlags`.
- [ ] **Step 4:** `events`: `bus := events.New()` trong `main.go`, truyền vào `Deps` (consumer: Task 6 phát `avatar.updated`).
- [ ] **Step 5:** `go test ./internal/util/... ./internal/events/ ./pkg/featureflag/ ./internal/featureflags/` xanh. Commit `feat(server): port util, logger, events bus and feature-flag service`.

---

## Task 6: Storage local/S3 + consumer avatar

**Files:** Create `server/internal/storage/*` (8), `server/internal/handler/avatar.go` + test; migration `005_user_avatar_url` (nếu cột chưa có — kiểm `users`); `cmd/server/main.go`

- [ ] **Step 1:** Copy 8 file; `storage.go` giữ nguyên interface. `cloudfront.go` (middleware) + `auth/cloudfront.go`: port **chỉ nếu** import tự đứng; nếu kéo theo PAT/cookie → bỏ, ghi lại.
- [ ] **Step 2:** `main.go`: `store := storage.NewLocal(LOCAL_UPLOAD_DIR, LOCAL_UPLOAD_BASE_URL)` hoặc `storage.NewS3(...)` theo `STORAGE_BACKEND=local|s3`; serve `/uploads/*` khi local.
- [ ] **Step 3 (TDD):** `avatar_test.go`: `POST /api/v1/me/avatar` multipart PNG → 200, `users.avatar_url` khớp `store.ObjectURL(key)`; file quá 2MB → 413; không phải ảnh → 415. Viết test → đỏ → handler → xanh.
- [ ] **Step 4:** Cột `avatar_url` đã có trong `UserSchema` FE (`avatar_url?`) — kiểm `001_init` có cột chưa; nếu chưa: `005_user_avatar_url.up.sql` **không FK, không index** (lint xanh).
- [ ] **Step 5:** `go test ./internal/storage/ ./internal/handler/` xanh. Commit `feat(storage): port local/S3 storage; avatar upload is its first consumer`.

---

## Task 7: Metrics Prometheus

**Files:** Create `server/internal/metrics/{config,http,db,server,realtime,registry,testutil}.go` + test; Modify `cmd/server/main.go`, `router.go`

- [ ] **Step 1:** Copy; `registry.go` cắt `DaemonWS`, `BusinessSampler`, `businessMetrics`, `wecomMetrics` và các `MustRegister` tương ứng. Bỏ `record_event*`, `labels*`, `business*`, `pricing`, `wecom`, `channel_media`, `daemonws.go`.
- [ ] **Step 2:** `main.go`: `mcfg := metrics.ConfigFromEnv(); if mcfg.Enabled() { reg := metrics.NewRegistry(RegistryOptions{Pool, Realtime: hub.Metrics()}); go metrics.NewServer(mcfg.Addr, reg.Gatherer).ListenAndServe() }`; `router.go`: `r.Use(httpMetrics.Middleware)` khi bật.
- [ ] **Step 3:** `go test ./internal/metrics/` xanh (test đi kèm, gỡ case business). `METRICS_ADDR=127.0.0.1:9090 go run ./cmd/server` → `curl :9090/metrics` có `http_requests_total`. Commit `feat(metrics): port the Prometheus registry, HTTP/DB/realtime collectors`.

---

## Task 8: `membership_cache` + cổng ra

- [ ] **Step 1:** Copy `auth/membership_cache.go` + test; prefix key `mul:` → `uw:`. Consumer: `WorkspaceService.RequireMember` tra cache trước DB khi có Redis; invalidate ở remove-member.
- [ ] **Step 2:** Cổng ra đầy đủ:
```bash
cd server && gofmt -l . && go vet ./... && go test ./... -count=1
cd .. && node --test scripts/no-usf-leak.test.mjs && pnpm typecheck && pnpm test && pnpm --filter @uniwork/e2e test
```
- [ ] **Step 3:** Commit. Ghi "Ghi chép thực thi" vào cuối plan này.

---

## Ghi chép thực thi (2026-08-25)

Hoàn tất trên `feat/base-port-phase-0-1`, 9 commit. Mọi cổng ra xanh: `gofmt`/`go vet`/`go test ./...`
(có Redis thật cho rate-limit và membership cache) · leak gate quét cả `*.go` · typecheck/test/lint FE ·
turbo probe · catalog · web build · **13/13 e2e** trên server đã restart với code mới · `/metrics` đo trên
server đang chạy (`uniwork_http_requests_total{route="/api/v1/me"…}`).

### Điều plan đoán sai hoặc phải quyết tại chỗ

**1. Runner migration.** Bẫy A đúng như dự đoán: `CREATE INDEX CONCURRENTLY` bị PostgreSQL từ chối trong
transaction (SQLSTATE 25001) — chứng minh bằng probe trước khi sửa. Runner giờ chạy từng file ngoài
transaction; hai luật no-FK / CONCURRENTLY được lint kèm baseline `004`, và đã chứng minh luật bắn bằng
một migration xấu tạm thời.

**2. Hub realtime.** Port nguyên khối được, nhưng phần gỡ nhiều hơn plan liệt kê: `DaemonRuntimeDeliverer`
xuất hiện ở **4 file** (broadcaster, redis_relay, sharded_stream_relay, relay_lifecycle), không chỉ hai.
`MirroredRelay` có nhánh bỏ qua mirror cho scope daemon. Một test (`TestMirroredRelayDoesNotMirrorDaemonRuntimeEvents`)
bị cắt — lần cắt đầu nuốt luôn kiểu `recordingManagedRelay` nằm sau nó; phải cắt lại theo cân bằng ngoặc.

**3. Ba test hồi quy của hub cũ** cần viết lại theo API mới, và cả ba đều lộ sai lầm của tôi chứ không phải
của hub: (a) hub usf **đóng kênh `send`** khi gỡ client — đọc từ kênh đóng trả về ngay, test phải phân
biệt `ok=false` với "nhận tin"; (b) helper đăng ký client chờ `HasLocalSubscribers` — nó đúng ngay khi client
**đầu tiên** vào phòng, nên broadcast có thể chạy trước khi client thứ hai kịp đăng ký → flaky. Sửa: chờ đúng
client đó có mặt trong phòng. Chạy `-race -count=3` xanh.

**4. Storage cần `go get` lại.** `go mod tidy` ở Task 1 đã gỡ các module AWS vì chưa có gì import; phải
`go get` lần nữa khi `storage/` xuất hiện. Không phải lỗi, nhưng plan nên ghi thứ tự.

**5. Metrics.** `registry.go` cắt được như plan; nhưng `testutil.go` là helper **thuần business** (xoá), và
`http.go` còn một histogram cho route daemon `/api/daemon/workspaces` (xoá kèm test). Namespace metric đổi
`multica_` → `uniwork_`. CloudFront signing **không port**: kéo theo Secrets Manager cho một CDN uniwork chưa có.

**6. Membership cache** chỉ dùng được ở nơi cần *presence* (WS connect), vì `RequireMember` trả về **role**
mà cache của usf chỉ lưu bool. Chỉ cache kết quả dương; TTL 5 phút là giới hạn stale vì uniwork **chưa có
thao tác xoá thành viên** để invalidate.

**7. Định danh đã lưu — lần thứ hai.** Như Pha 2 với localStorage/cookie, phía server có: prefix khoá Redis
(`mul:` → `uw:`), env (`MULTICA_TRUSTED_PROXIES`, `MULTICA_FEATURE_FLAGS_FILE`), namespace Prometheus, và
hostname trong test. Leak gate bắt được tất cả; không cái nào lộ qua typecheck hay test.

### Việc dời sang plan sau

`auth/{jwt,cookie,pat_cache,cloud_pat,daemon_token_cache}` (mô hình auth cookie/PAT — Tầng 2, Plan 4);
`middleware/{auth,workspace,owner_lookup}.go` (viết lại hai tầng org/workspace — Plan 4); cloudfront (khi có
CDN); `analytics` server (dính agent). Đường `?token=` trên WS là **tạm** — gỡ khi FE chuyển sang `ws-client.ts`.
