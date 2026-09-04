# UniWork — Platform Admin tối thiểu, Observability và Feature Flag theo tổ chức

**Ngày:** 2026-09-04  
**Trạng thái:** Đã duyệt (2026-09-04, quangpd — UNI-421). Câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.  
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md` §8, `2026-08-27-workspace-permissions-design.md`, `2026-09-04-tenant-subscription-entitlement-design.md` (gói, quota), `2026-09-04-audit-domain-events-design.md` (correlation id, outbox lag), `2026-09-04-ai-platform-gateway-design.md` (AI cost)  
**Tham chiếu:** `docs/vision/PROJECT_VISION.md` §5.2 (#16), §6.2–6.4, §6.3 ngưỡng hiệu năng; bản cũ `unidigiwork/docs/performance/OBSERVABILITY_GAPS.md`, `src/routes/_authenticated/admin*.tsx`; Blueprint v1.0 §24; hiện có `server/internal/metrics/*`, `server/internal/middleware/request_logger.go`, `server/pkg/featureflag/*`, `server/internal/featureflags/keys.go`


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Ba việc gộp một spec vì chúng chia sẻ cùng nền (identity `platform_admin`, correlation id, cấu hình theo organization):

- **(a) Platform admin tối thiểu:** một vai trò nằm ngoài organization và một console `/admin` đủ để vận hành SaaS: xem/tạm ngưng organization, đổi gói thủ công, xem quota, bật flag theo organization, tra trace theo correlation id. **Không** dựng lại `admin.trace.tsx` 4.387 dòng hay 16 tab của bản cũ.
- **(b) Observability:** OpenTelemetry trace/metric/log từ Go, RUM web‑vitals từ web, dashboard và alert có runbook, health/readiness thật, ngân sách hiệu năng và k6 hằng đêm trong CI.
- **(c) Feature flag phía server theo organization**, mở rộng `pkg/featureflag` đã có (chưa khai báo flag nào).

Thành công khi: một sự cố production được tra từ alert → dashboard → trace → log → audit trong dưới 10 phút, không cần SSH; tiêu chí thoát giai đoạn F (§8 Vision): thanh 6.4 có cơ chế ép buộc trong CI; k6 5.000 VU đạt ngưỡng §6.3.

### 1.1 Hiện trạng đúng như code

| Thành phần | Thực tế |
|---|---|
| Metrics | Prometheus: `uniwork_http_*` (requests, duration histogram, in‑flight), `uniwork_meeting_*` (join, webhook, outbox done/retry/dead‑letter, provider desync), realtime, db. Bật khi `METRICS_ADDR` đặt; endpoint riêng cổng, khuyến nghị loopback. |
| Log | `slog` + tint; `request_logger` có request id, user, client platform; redact token webhook. |
| Trace | **Không có** OpenTelemetry. Không có trace id xuyên service → DB → outbox. |
| Health | `GET /healthz` trả `{"status":"ok"}` không kiểm DB/Redis. |
| Feature flag | `pkg/featureflag`: Service, Provider (static YAML/env/chain), `EvalContext{UserID, WorkspaceID, Attributes}`, percent rollout. `internal/featureflags/keys.go`: catalogue rỗng, `frontendPublicFlags = []`. Không có provider theo DB, không có organization trong EvalContext. |
| Admin | Không có vai trò platform admin, không có route `/admin`. |
| CI | typecheck/lint/unit/Go race/govulncheck/gitleaks/Playwright. Không có k6, không size‑limit. |

## 2. Quyết định đã chốt

| # | Quyết định |
|---|------------|
| 1 | `platform_admin` là **cột trên `users`** (`platform_role TEXT NULL CHECK IN ('admin','support')`), không phải organization đặc biệt. Cấp/thu chỉ bằng lệnh CLI `uniwork-admin grant-platform-role` (không có UI cấp quyền), audit ghi. |
| 2 | Mọi route `/api/v1/admin/*` đi qua middleware `RequirePlatformRole("admin")`; `support` chỉ đọc. Route admin **không** đi qua `RequireMember` và **không** bao giờ trả dữ liệu nội dung (task body, tin nhắn, file) — chỉ metadata vận hành. |
| 3 | Console `/admin` là app route riêng trong `apps/web/app/admin/*`, views ở `packages/views/admin/*`, tối đa **6 màn hình**: Organizations, Organization detail, Flags, Trace lookup, Quota, System. Không thêm màn hình khi chưa có runbook cần nó. |
| 4 | Observability chuẩn **OpenTelemetry** (OTLP/gRPC) cho trace và log correlation; **giữ Prometheus** cho metric (đã có, không đổi tên metric cũ). Exporter cấu hình bằng `OTEL_EXPORTER_OTLP_ENDPOINT`; không đặt → tracer no‑op, app vẫn chạy. |
| 5 | Mỗi request có `trace_id` (W3C traceparent) và các attribute: `organization_id`, `workspace_id`, `actor_id`, `actor_kind` (`human`\|`agent`\|`system`), `client_platform`. `correlation_id` = `trace_id`; ghi vào `audit_events.correlation_id` và `outbox_events.correlation_id`. |
| 6 | Log **có cấu trúc JSON** ở production (`LOG_FORMAT=json`), tint ở dev; mọi dòng log trong request mang `trace_id`. Không PII (email, tên) trong log; user chỉ bằng id. |
| 7 | Health tách 2 endpoint: `/healthz` (liveness, không phụ thuộc) và `/readyz` (readiness: DB `SELECT 1` ≤ 500 ms, Redis PING nếu cấu hình, migration đã áp đủ). |
| 8 | RUM: web gửi `web-vitals` (LCP, INP, CLS, TTFB) tới `POST /api/v1/rum` (không auth, rate‑limit, tối đa 1 KB, sample 20%), server đổi thành histogram Prometheus `uniwork_web_vitals_seconds{metric,route_pattern}`. Không dùng dịch vụ RUM bên thứ ba ở F. |
| 9 | Feature flag theo organization: thêm **`DBProvider`** đọc bảng `feature_flag_overrides`, xếp trong `ChainProvider` **trước** static/env (override thắng). `EvalContext` thêm `OrganizationID`. Cache 30 s in‑memory, invalidate qua event `flag.updated`. |
| 10 | Alert **không có runbook thì không tạo**; runbook nằm ở `docs/runbooks/<alert-name>.md` và test governance kiểm tra mỗi rule alert trong `deploy/alerts.yml` có file runbook tương ứng. |

## 3. Phạm vi

### Trong spec
(a) vai trò, middleware, CLI, 6 màn hình admin, API admin; (b) OTel tracing + log correlation, middleware timing đủ attribute, metric mới (outbox lag, realtime, AI cost, web vitals), health/readiness, dashboard Grafana JSON, alert rules + runbooks, k6 hằng đêm, size‑limit; (c) DBProvider, override API/UI, public flags catalogue.

### Ngoài spec
Billing/thanh toán (spec tenant‑subscription), backup/restore (docs vận hành riêng), status page công khai (giai đoạn C), log retention/SIEM, on‑call rota, Grafana Cloud vs self‑host (quyết định hạ tầng, xem câu hỏi mở).

## 4. Data model

| Bảng | Cột | Ghi chú |
|---|---|---|
| `users` (ALTER) | `platform_role TEXT NULL`, `platform_role_granted_by TEXT`, `platform_role_granted_at TIMESTAMPTZ` | CHECK `('admin','support')`. |
| `organizations` (ALTER) | `status TEXT NOT NULL DEFAULT 'active'` CHECK `('active','suspended','archived')`, `suspended_at`, `suspended_reason`, `plan_code TEXT NOT NULL DEFAULT 'free'` (chi tiết gói ở spec tenant‑subscription) | Middleware auth chặn mọi request vào org `suspended` với `403 ORGANIZATION_SUSPENDED`, trừ đọc trang thông báo. |
| `feature_flag_overrides` | `id, flag_key, scope_type ('organization'\|'user'\|'global'), scope_id TEXT, enabled BOOLEAN, note, created_by, created_at, expires_at` | `UNIQUE (flag_key, scope_type, scope_id)`. `expires_at` bắt buộc cho `user` scope (tối đa 30 ngày) để không quên. |
| `admin_actions` | `id, actor_id, action, target_type, target_id, before JSONB, after JSONB, reason TEXT NOT NULL, trace_id, created_at` | Mọi thao tác admin ghi vào đây **và** `audit_events`; `reason` bắt buộc trong UI. |
| `rum_samples` | **không có bảng** | RUM chỉ thành metric; không lưu hàng. |

Index: `feature_flag_overrides (flag_key, scope_type, scope_id)` unique; `admin_actions (target_type, target_id, created_at)`; `organizations (status)`.

## 5. Platform admin

### 5.1 Middleware và phân quyền

```
RequirePlatformRole(min Role) → 404 nếu user không có platform_role   (không lộ route tồn tại)
                              → 403 PLATFORM_ROLE_INSUFFICIENT nếu support gọi route ghi
```
`arch_test.go` thêm luật: chỉ `internal/handler/admin_*.go` được gọi `service/admin`; `service/admin` không import `service/task|chat|meeting` (chỉ đọc bảng metadata qua sqlc riêng `queries/admin.sql`).

### 5.2 API `/api/v1/admin`

| Method | Route | Vai trò | Mục đích |
|---|---|---|---|
| GET | `/organizations?q=&status=&plan=&cursor=` | support | Danh sách: id, name, slug, status, plan_code, member_count, workspace_count, created_at, last_activity_at |
| GET | `/organizations/{id}` | support | Chi tiết + quota usage (từ spec subscription) + flags hiệu lực + 20 admin_actions gần nhất |
| POST | `/organizations/{id}/suspend` `{reason}` | admin | status → suspended; event `organization.suspended`; email owner (spec transactional‑email) |
| POST | `/organizations/{id}/unsuspend` `{reason}` | admin | |
| POST | `/organizations/{id}/plan` `{plan_code, reason}` | admin | Đổi gói thủ công (pilot, đối tác); ghi admin_actions |
| GET | `/flags` | support | Catalogue key + mô tả + default + số override |
| GET/PUT/DELETE | `/flags/{key}/overrides` | admin | Danh sách/ghi/xóa override theo scope |
| GET | `/trace/{traceId}` | support | Tổng hợp: request log lines (từ Loki/OTel backend qua API server proxy **hoặc** chỉ audit+outbox+admin_actions nếu backend log không cấu hình), audit_events, outbox_events, admin_actions cùng `trace_id`. Trả tối đa 500 dòng. |
| GET | `/system` | support | Phiên bản build, migration hiện tại, readiness chi tiết, outbox pending/dead‑letter, realtime connections, flag provider chain |
| POST | `/impersonation` | **không có** | Cố ý không hỗ trợ đăng nhập thay người dùng ở F (câu hỏi mở). |

Mọi route ghi yêu cầu body `reason` ≥ 10 ký tự. Rate‑limit riêng nhóm admin.

### 5.3 CLI `server/cmd/uniwork-admin`

`grant-platform-role --email --role admin|support`, `revoke-platform-role --email`, `list-platform-roles`. Chạy trong container/host, dùng DB URL; ghi `admin_actions` với `actor_id='cli'` và `audit_events`. Đây là cách duy nhất tạo platform admin đầu tiên.

### 5.4 Console `/admin` (web)

| Màn hình | Route | Nội dung |
|---|---|---|
| Organizations | `/admin` | Bảng có tìm kiếm, lọc status/plan, sắp xếp last_activity; hàng bấm vào detail. Số liệu inline, không hero KPI (PRODUCT.md). |
| Organization detail | `/admin/organizations/{id}` | Header status + plan; tab: Tổng quan (members/workspaces/usage), Flags (override có `reason`), Lịch sử (admin_actions). Nút Suspend/Unsuspend/Change plan mở dialog bắt `reason`. |
| Flags | `/admin/flags` | Catalogue; mỗi key: mô tả, default, public?, override global toggle. |
| Trace | `/admin/trace` | Ô nhập trace id → timeline (log, audit, outbox, admin_actions) theo thời gian; copy link. Một component ≤ 500 dòng; không filter builder. |
| Quota | `/admin/quota` | Top organization theo usage/quota %; link sang detail. (Dữ liệu từ spec subscription; nếu chưa ship, màn hình ẩn sau flag `admin_quota`.) |
| System | `/admin/system` | Readiness, versions, outbox, realtime, provider chain. |

Guard: `apps/web/app/admin/layout.tsx` gọi `GET /api/v1/admin/me`; 404 → redirect `/`. Layout riêng, không dùng sidebar workspace. i18n keys `admin.*`; vi/en.

## 6. Observability

### 6.1 Tracing (OTel)

- Thư viện: `go.opentelemetry.io/otel`, `otelhttp` cho Chi, `otelpgx` cho pgx, `redisotel` cho Redis, propagation W3C. Tracer provider trong `server/internal/telemetry/` (mới), khởi tạo ở `cmd/server/main.go`; `OTEL_EXPORTER_OTLP_ENDPOINT` trống → `noop`.
- Span attributes chuẩn (đặt trong middleware sau auth): `uniwork.organization_id`, `uniwork.workspace_id`, `uniwork.actor_id`, `uniwork.actor_kind`, `uniwork.client_platform`, `http.route` (pattern Chi, không phải path thật để tránh cardinality).
- Outbox worker: span con `outbox.process` link tới span gốc bằng `correlation_id` lưu trong row. Realtime relay: span `realtime.publish`.
- Sampling: parent‑based, 10% ở production, 100% khi header `X-Debug-Trace: 1` từ platform admin.
- `trace_id` trả về client trong header `X-Trace-Id` để support có thể hỏi người dùng.

### 6.2 Log

- `LOG_FORMAT=json|text`; json ở production. Handler `slog` bọc để tự thêm `trace_id`, `span_id`, `organization_id`, `workspace_id`, `actor_id` từ context (mở rộng `logger.WithRequest`).
- Cấm PII: test `scripts/no-pii-log.test.mjs` grep các pattern `slog.*email`, `display_name` trong `server/`; ngoại lệ phải có `// log-pii-ok: <lý do>`.
- Access log giữ redact webhook token; thêm redact query `token=`, `code=`.

### 6.3 Metric mới (Prometheus, namespace `uniwork`)

| Metric | Kiểu | Label | Nguồn |
|---|---|---|---|
| `outbox_pending_age_seconds` | gauge (max age của row pending) | `topic` | worker tick 15 s |
| `outbox_pending_total`, `outbox_dead_letter_total` | gauge | `topic` | |
| `realtime_connections` | gauge | `scope_type` | relay (nếu chưa có) |
| `realtime_publish_latency_seconds` | histogram | | commit → gửi frame |
| `ai_requests_total`, `ai_tokens_total{direction}`, `ai_cost_usd_total` | counter | `provider, model, organization_id` | AI gateway (spec AI) — organization_id chỉ khi ≤ 1.000 org, sau đó bỏ label và dựa vào bảng usage |
| `web_vitals_seconds` | histogram | `metric, route_pattern` | `/rum` |
| `db_query_duration_seconds` | histogram | `query_name` | otelpgx → bridge |
| `build_info` | gauge 1 | `version, commit, go_version` | main |

Bucket cho latency: giữ bucket `http` hiện có.

### 6.4 Health

- `/healthz`: 200 luôn khi process sống.
- `/readyz`: kiểm DB, Redis (nếu `REDIS_URL`), migration version == embedded latest, storage `HEAD` bucket (nếu S3); trả JSON từng check + tổng; 503 khi bất kỳ check fail. Không log ở info khi OK. Kubernetes/compose dùng readiness này; `IsHealthProbePath` bỏ qua metric cho cả hai.

### 6.5 Dashboard và alert

- `deploy/grafana/dashboards/*.json` (commit): **API** (RPS, p50/p95/p99 theo route, error rate), **Outbox & Realtime** (pending age, dead‑letter, connections, publish latency), **DB** (query p95, pool), **AI** (requests, tokens, cost/org top 10), **Web Vitals** (LCP/INP/CLS p75 theo route), **Business** (org active, meetings live, tasks mutations).
- `deploy/alerts.yml` (Prometheus rules), mỗi rule có `runbook_url` trỏ `docs/runbooks/<name>.md`:

| Alert | Điều kiện | Sev |
|---|---|---|
| `ApiErrorRateHigh` | 5xx / total > 2% trong 5 phút | 1 |
| `ApiLatencyP95High` | p95 > 400 ms đọc 10 phút | 2 |
| `OutboxLagHigh` | `outbox_pending_age_seconds` > 60 | 2 |
| `OutboxDeadLetter` | tăng > 0 trong 15 phút | 2 |
| `ReadinessFailing` | `/readyz` 503 > 2 phút | 1 |
| `RealtimePublishSlow` | p95 > 1 s | 3 |
| `AiCostSpike` | cost 1 giờ > 3× trung bình 7 ngày | 2 |
| `WebVitalsLCPPoor` | p75 LCP > 2,5 s 30 phút | 3 |

- `scripts/governance.test.mjs` thêm: mọi `runbook_url` trong `deploy/alerts.yml` tồn tại; runbook có mục “Triệu chứng / Kiểm tra / Khắc phục / Leo thang”.

### 6.6 Hiệu năng trong CI

- **Size‑limit**: `apps/web` thêm `size-limit` với ngưỡng initial JS ≤ 250 KB gzip, route chunk ≤ 150 KB (Vision §6.3); job CI fail khi vượt.
- **k6 hằng đêm** (`.github/workflows/perf-nightly.yml`): dựng server + Postgres + Redis, seed dataset sinh (`server/cmd/seed --orgs 50 --users 5000 --tasks 1000000`), chạy `perf/k6/{smoke,read-500,read-5000,write-mixed}.js`; ngưỡng: p95 đọc ≤ 200 ms, ghi ≤ 400 ms, lỗi < 0,1%; artifact JSON lưu 90 ngày; fail → issue tự động, không chặn merge. Smoke k6 (50 VU, 1 phút) chạy trong PR khi nhãn `perf`.
- Ghi chú trung thực: số đo trong CI runner có RTT ≈ 0; ngưỡng production đo thêm từ synthetic probe ngoài (giai đoạn C).

## 7. Feature flag theo organization

### 7.1 Mở rộng `pkg/featureflag`

- `EvalContext` thêm `OrganizationID string`; middleware auth điền cả ba id khi có.
- `DBProvider` (`pkg/featureflag/db_provider.go`): đọc `feature_flag_overrides` qua interface `OverrideStore` (sqlc ở `internal`), cache TTL 30 s, thứ tự ưu tiên: `user` → `organization` → `global` → provider kế tiếp. Hết hạn (`expires_at`) bị bỏ qua.
- Chain: `DBProvider → StaticProvider (YAML) → EnvProvider`. Thiếu DB → chain bỏ qua DB, log warn một lần.

### 7.2 Catalogue `internal/featureflags/keys.go`

Khai báo flag đầu tiên (mỗi key: mô tả, default, public, owner, ngày review):

| Key | Default | Public | Dùng cho |
|---|---|---|---|
| `agents_assignee` | off | yes | Hiện agent trong picker assignee (spec tasks‑complete #8) |
| `admin_quota` | off | no | Màn hình quota khi spec subscription chưa ship |
| `rum_sampling` | on | yes | Cho phép web gửi web‑vitals |
| `meeting_ai_summary` | off | yes | Bật tóm tắt họp theo org (pilot) |
| `debug_trace_full_sampling` | off | no | 100% sampling cho org đang điều tra |

`GET /api/v1/config` (public) trả `flags` từ `EvaluateFrontendPublicFlags` với context user/org hiện tại; FE `packages/core/feature-flags` (đang chưa wire) đọc từ đây — **đây là việc wire module trước hạn 2026‑09‑30** trong CLAUDE.md.

### 7.3 Quy tắc

- Flag có `review_at`; test governance fail khi quá hạn 90 ngày mà chưa xóa/gia hạn (tránh flag vĩnh viễn).
- Flag không thay đổi **quyền**; chỉ ẩn/hiện năng lực. Kiểm quyền vẫn ở service.

## 8. Cấu hình (`.env.example` phải liệt kê đủ)

```
METRICS_ADDR=127.0.0.1:9090          # đã có
OTEL_EXPORTER_OTLP_ENDPOINT=         # trống = no-op
OTEL_SERVICE_NAME=uniwork-api
OTEL_TRACES_SAMPLER_ARG=0.1
LOG_FORMAT=json|text
LOG_LEVEL=info
FEATURE_FLAGS_FILE=deploy/flags.yaml # đã có dạng static
RUM_SAMPLE_RATE=0.2
ADMIN_RATE_LIMIT_PER_MIN=60
```
Docker compose prod thêm profile `observability`: otel‑collector, prometheus, grafana, loki (tùy chọn). On‑prem nhỏ có thể tắt hoàn toàn.

## 9. Kiểm thử

| Loại | Case |
|---|---|
| Go handler | `/admin/*` không platform_role → 404; `support` gọi POST → 403; `reason` thiếu → 400 |
| Go service | suspend → org.status, admin_actions + audit_events cùng tx; unsuspend; đổi plan ghi before/after |
| Go middleware | org suspended → 403 `ORGANIZATION_SUSPENDED` cho mọi route workspace; readiness 503 khi DB đóng |
| Go telemetry | request có `traceparent` → span cùng trace; không có → tạo mới; header `X-Trace-Id` trả về; attribute org/ws/actor đúng; sampler 100% khi debug header từ admin |
| Go featureflag | DBProvider thứ tự user > org > global; expires bỏ qua; cache invalidate theo event; nil DB không panic |
| Go log | không PII (script grep); JSON có trace_id |
| FE | admin views: guard 404 redirect; dialog bắt reason; flags toggle optimistic **không** (chờ server); malformed‑response test mỗi endpoint admin; RUM gửi đúng payload và tôn trọng flag |
| E2E | platform admin (seed qua CLI trong test) vào `/admin`, suspend org, user của org thấy trang “Tổ chức tạm ngưng”, unsuspend, vào lại bình thường |
| Governance | alert ↔ runbook; flag review_at; `.env.example` đủ biến (`scripts/env-example.test.mjs` nếu chưa có) |
| Perf | k6 smoke trong PR nhãn `perf`; nightly đầy đủ |

## 10. Definition of Done

- [ ] Platform role qua CLI; `/admin/*` guard; 6 màn hình; mọi thao tác có `reason`, `admin_actions`, `audit_events`.
- [ ] OTel tracing với attribute chuẩn; `X-Trace-Id`; log JSON có trace_id; audit/outbox lưu `correlation_id`.
- [ ] `/readyz` thật; `/healthz` liveness.
- [ ] Metric mới + dashboard JSON + 8 alert + 8 runbook; governance test giữ.
- [ ] RUM endpoint + FE gửi web‑vitals theo flag.
- [ ] DBProvider + override API/UI + catalogue 5 flag + `GET /config` + wire `packages/core/feature-flags`.
- [ ] size‑limit trong CI; k6 nightly có artifact; seed tool.
- [ ] `.env.example` đủ; `docs/runbooks/README.md`; `docs/ops/OBSERVABILITY.md` mô tả cách tra sự cố 10 phút.
- [ ] Coverage không giảm; knip sạch; vi/en.

## 11. Kế thừa từ bản cũ / bỏ

| Bản cũ | Xử lý |
|---|---|
| `_set_correlation_context` + `/api/admin/trace/$correlationId` | Kế thừa ý tưởng; correlation_id = OTel trace_id; UI trace tối giản |
| 16 tab admin (users, accounts, rules, plans, knowledge, leads, quota, ai‑context, ai‑actions, webhooks, economics, cohorts, pilots, proof, backup) | Chỉ giữ Organizations/Flags/Trace/Quota/System. Plans → spec subscription; AI → spec AI; knowledge/leads/proof/cohorts/economics: không port ở F |
| `OBSERVABILITY_GAPS.md` (10 signal) | Đóng 9/10 trong spec này; “load‑test result store” = artifact k6 nightly |
| `error-capture.ts` client | Thay bằng `packages/core/analytics` (đang chưa wire) gửi lỗi FE kèm `trace_id` lấy từ header response gần nhất |

## 12. Lộ trình plan

1. **Plan O1 — Telemetry nền:** OTel tracer, attribute middleware, log JSON + trace_id, `/readyz`, `X-Trace-Id`, `.env.example`.
2. **Plan O2 — Metric/alert:** metric mới, dashboards, alerts + runbooks, governance test, compose profile observability.
3. **Plan A1 — Platform admin:** schema, CLI, middleware, API, 4 màn hình (Organizations, detail, Trace, System).
4. **Plan F1 — Flags:** DBProvider, catalogue, `/config`, wire `packages/core/feature-flags`, màn hình Flags + override trong org detail.
5. **Plan P1 — Perf CI:** size‑limit, seed tool, k6 smoke + nightly, RUM.

## 13. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Cardinality metric theo `organization_id` | Chỉ ở metric AI, có ngưỡng 1.000 org; usage chi tiết đọc từ bảng |
| OTel làm tăng latency | Sampling 10%, exporter batch, benchmark trong O1 (p95 tăng ≤ 2 ms) |
| Admin console thành “bãi tính năng” như bản cũ | Giới hạn 6 màn hình trong spec; thêm màn hình = ADR |
| Runbook viết cho có | Governance test kiểm 4 mục; review runbook trong post‑mortem |
| k6 nightly đỏ mãi không ai nhìn | Issue tự động gán owner; báo cáo tuần |

## 14. Câu hỏi mở (chủ sở hữu sản phẩm / hạ tầng quyết)

1. Backend observability: **self‑host** (otel‑collector + Prometheus + Grafana + Loki trong compose, phù hợp on‑prem) hay Grafana Cloud cho SaaS? Đề xuất: self‑host cùng stack cho cả SaaS và on‑prem để một cấu hình.
2. Có cần **impersonation** (đăng nhập thay người dùng để hỗ trợ) ở giai đoạn F không? Đề xuất: không; dùng trace + audit; nếu cần, làm ở C với consent của user và audit riêng.
3. `support` role có được xem danh sách member (email) của organization không? Đề xuất: chỉ số lượng và owner email, không danh sách đầy đủ.
4. Sampling trace production 10% có đủ cho pilot ≤ 5 tenant không, hay bật 100% đến khi >1.000 người dùng? Đề xuất: 100% ở F/C, hạ xuống khi có tải.
5. Ngưỡng k6 5.000 VU trên dataset 1 triệu task (Vision §6.3) áp dụng từ cuối F hay cuối C? Đề xuất: cuối F chạy 500 VU bắt buộc, 5.000 VU báo cáo không chặn; cuối C bắt buộc.
