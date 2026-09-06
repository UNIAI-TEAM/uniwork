# F-11 · Platform admin tối thiểu, OpenTelemetry, feature flag theo org, k6 hằng đêm, RUM — Plan triển khai

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vận hành được theo SLA không cần SSH: một sự cố đi từ alert → dashboard → trace → log → audit trong 10 phút. Gồm (a) platform admin ngoài organization với console `/admin` 6 màn hình, (b) OpenTelemetry trace + log JSON có `trace_id`, `/readyz` thật, metric mới, 8 alert có runbook, RUM web‑vitals, size‑limit + k6 hằng đêm, (c) feature flag theo organization qua `DBProvider` và wire `packages/core/feature-flags`.

**Issue:** UNI-429 · **Spec:** `docs/superpowers/specs/2026-09-04-platform-admin-observability-design.md` · **Câu hỏi mở đã chốt:** OPEN_QUESTIONS nhóm O (O1 không impersonation, O2 support không thấy email, O3 sampling 100% đến khi > 5 tenant) · **ADR:** 0004, 0007, 0008, 0009, 0012.

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; đầy đủ `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Migration: không `REFERENCES`/`FOREIGN KEY`, index `CONCURRENTLY` một mình một file, có `.down.sql`; bảng mới có `organization_id TEXT NOT NULL` hoặc nằm trong `tenantExemptTables` với lý do (`feature_flag_overrides`, `admin_actions` là bảng hạ tầng: scope là nhiều org).
- Route `/api/v1/admin/*` không qua `RequireMember`; guard duy nhất là `middleware.RequirePlatformRole`. Không route admin nào trả nội dung (task body, tin nhắn, file) — chỉ metadata.
- Chỉ `internal/handler/admin*.go` gọi `service.AdminService`; `service/admin.go` không gọi service task/chat/meeting (arch test mới `TestAdminServiceIsolated`).
- Mọi thao tác admin ghi `admin_actions` **và** `audit_events` cùng transaction, `reason` ≥ 10 ký tự.
- Không PII (email, display_name) trong log; `scripts/no-pii-log.test.mjs` grep.
- OTel: `OTEL_EXPORTER_OTLP_ENDPOINT` rỗng → tracer no‑op, không mở kết nối. Không đổi tên metric Prometheus cũ.
- Dependency Go mới chỉ: `go.opentelemetry.io/otel`, `otel/sdk`, `otel/exporters/otlp/otlptrace/otlptracegrpc`, `contrib/instrumentation/net/http/otelhttp`, `github.com/exaring/otelpgx`, `github.com/redis/go-redis/extra/redisotel`. FE mới chỉ: `web-vitals`, `size-limit` (+ preset).
- vi.json trước, en.json cùng key. JSX trong `views` qua `t()`. Không hardcode màu.
- Commit sau mỗi task: `feat(telemetry): …`, `feat(db): …`, `feat(api): …`, `feat(admin): …`, `feat(flags): …`, `feat(core): …`, `feat(views): …`, `ci: …`, `docs: …`.

## Quyết định lúc implement (chốt các chỗ spec để ngỏ)

| # | Chỗ spec để ngỏ | Chốt |
|---|---|---|
| 1 | Số migration | Mới nhất trên `develop` là `099` → dùng `100`–`106` |
| 2 | `users.platform_role` | Đã có (081, F-02). Chỉ thêm `platform_role_granted_by`, `platform_role_granted_at` (100) |
| 3 | `organizations.plan_code` | **Bỏ**: gói đã nằm ở `subscriptions` (072). Admin đổi gói gọi `BillingService.ChangePlan` với actor platform admin đã có. Chỉ thêm `status`, `suspended_at`, `suspended_reason` (101) |
| 4 | `correlation_id` = `trace_id` | `middleware.Correlation` chạy **sau** `otelhttp`: khi span hợp lệ, id = trace id hex (32 ký tự, khớp `ValidCorrelationID`); client `X-Correlation-ID` chỉ dùng khi không có span (test, no‑op tracer). `X-Trace-Id` và `X-Correlation-ID` cùng giá trị |
| 5 | Span attribute org/ws/actor | Middleware `telemetry.Enrich` sau `RequireAuth` đặt `actor_id`, `actor_kind=human`, `client_platform`, `http.route`; `organization_id`/`workspace_id` do `RequireMember` đặt qua `telemetry.SetTenant(ctx, org, ws)` (một chỗ, không sửa từng handler) |
| 6 | Sampling | `OTEL_TRACES_SAMPLER_ARG` rỗng → **1.0** (O3); `X-Debug-Trace: 1` từ user có `platform_role` → luôn sample |
| 7 | Log JSON | `LOG_FORMAT=json` → `slog.JSONHandler`; wrapper `telemetry.LogHandler` thêm `trace_id`, `span_id`, `organization_id`, `workspace_id`, `actor_id` từ ctx cho `*Context` calls. `RequestLogger` dùng `slog.InfoContext` |
| 8 | `/readyz` | Check DB `SELECT 1` (500 ms), Redis PING nếu có, `schema_migrations` == embedded latest. Không kiểm S3 (không có bucket HEAD rẻ; ghi vào runbook). `IsHealthProbePath` bỏ qua cả hai |
| 9 | `GET /admin/trace/{id}` | Chỉ audit + outbox + admin_actions (không proxy Loki ở F); `ponytail:` proxy Loki khi có backend log |
| 10 | Admin org list `last_activity_at` | `MAX(audit_events.created_at)` của org (đã có index theo org) |
| 11 | Quota screen | Ẩn sau flag `admin_quota`; dữ liệu từ `EntitlementService` đã có (F-02) |
| 12 | `DBProvider` cache | `sync.Map` + TTL 30 s theo `(key, scope_type, scope_id)`; invalidate toàn bộ khi nhận outbox event `flag.updated` (consumer nhỏ trong `featureflags`) |
| 13 | Public config | `GET /api/v1/config` (OptionalAuth) trả `{flags, rum_sample_rate}`; FE `apps/web/platform/feature-flags.tsx` fetch một lần, mount `FeatureFlagsProvider` với `StaticProvider` từ payload → module `feature-flags` wired |
| 14 | RUM | `POST /api/v1/rum` body ≤ 1 KB, rate‑limit 60/phút/IP, sample theo `rum_sample_rate` từ `/config`; FE `apps/web/platform/rum.ts` dùng `web-vitals` `onLCP/onINP/onCLS/onTTFB`, route pattern lấy từ `usePathname` thay id bằng `:id` |
| 15 | k6 dataset | `server/cmd/seed` sinh org/user/task bằng `COPY`; nightly 500 VU bắt buộc (O5), 5.000 VU báo cáo không chặn |
| 16 | Dashboard | 6 file JSON Grafana tối giản (mỗi panel một query), `deploy/grafana/provisioning` để compose profile `observability` nạp tự động |
| 17 | Vị trí k6 | `scripts/load/*.k6.js` (đã có `meeting-*.k6.js` và knip entry) thay vì `perf/k6/`; `perf-lib.js` dùng chung |
| 18 | Tracer khi không có exporter | Vẫn tạo span (SDK provider, không exporter) để mọi response có `X-Trace-Id` và `correlation_id` = trace id ngay cả khi chưa có collector; "no-op" của spec hiểu là không mở kết nối |
| 19 | `db_query_duration_seconds` | `metrics.DBQueryTracer` bọc `otelpgx` trên `ConnConfig.Tracer`, label `query_name` từ header `-- name:` của sqlc |
| 20 | Trang "tổ chức tạm ngưng" | `GET /orgs` trả `status` trên từng org; mọi route org/ws trả 403 `organization_suspended` từ `RequireMember` (không thêm middleware riêng) |
| 21 | `ADMIN_RATE_LIMIT_PER_MIN`, `RUM_SAMPLE_RATE` | Đọc ở `config.Load`, mặc định 60 và 0.2 |

## File map

**Go**
- `server/internal/telemetry/{tracer.go,middleware.go,log.go,tenant.go}` — provider, enrich, log handler, tenant ctx.
- `server/internal/handler/{health.go,admin_org.go,admin_flags.go,admin_trace.go,admin_system.go,rum.go,config.go}`; `router/{admin.go,meta.go,config.go}`; `dto/sdi/admin.go`, `dto/sdo/{admin.go,config.go}`.
- `server/internal/middleware/{platform_role.go,org_status.go}`.
- `server/internal/service/{admin.go,admin_test.go,readiness.go}`.
- `server/internal/featureflags/{keys.go,db_provider.go,invalidate.go}`; `server/pkg/featureflag/eval_context.go` (+OrganizationID).
- `server/internal/metrics/{outbox_gauge.go,web_vitals.go,build.go}`.
- `server/cmd/{uniwork-admin,seed}/main.go`.
- `server/pkg/db/queries/{admin.sql,feature_flags.sql}`; migrations `100`–`106`.
- `server/internal/arch_test.go` (+2 luật).

**Web**
- `packages/core/api/endpoints/{admin.ts,config.ts,rum.ts}` (+tests), `packages/core/admin/{hooks.ts,keys.ts}`, `packages/core/paths/admin.ts`.
- `packages/views/admin/{organizations.tsx,organization-detail.tsx,flags.tsx,trace.tsx,quota.tsx,system.tsx,reason-dialog.tsx,layout.tsx}`.
- `apps/web/app/admin/{layout.tsx,page.tsx,organizations/[id]/page.tsx,flags/page.tsx,trace/page.tsx,quota/page.tsx,system/page.tsx}`; `apps/web/platform/{feature-flags.tsx,rum.ts}`.
- `apps/web/.size-limit.json`.

**Ops / docs**
- `deploy/{alerts.yml,flags.yaml,otel-collector.yaml,prometheus.yml,grafana/dashboards/*.json,grafana/provisioning/**}`, `docker-compose.observability.yml`.
- `docs/runbooks/{README.md,<8 alert>.md}`, `docs/ops/OBSERVABILITY.md`.
- `scripts/load/{smoke,read-500,read-5000,write-mixed}.k6.js` + `perf-lib.js`, `.github/workflows/perf-nightly.yml`.
- `scripts/{no-pii-log.test.mjs,alerts-runbooks.test.mjs,env-example.test.mjs}`.

---

## Plan O1 — Telemetry nền (sub-issue)

- [x] **O1.1** `internal/telemetry`: `Init(ctx, Config) (shutdown, error)`; no‑op khi endpoint rỗng; `otelhttp` middleware đầu chuỗi router với `http.route` từ chi pattern; `X-Trace-Id` response header. Test: có `traceparent` → cùng trace; không có → trace mới; header trả về.
  `feat(telemetry): otel tracer provider, http instrumentation, X-Trace-Id`
- [x] **O1.2** `Correlation` lấy trace id làm `correlation_id`; `telemetry.Enrich` sau auth; `SetTenant` trong `RequireMember`; `otelpgx`, `redisotel`. Test attribute org/ws/actor.
  `feat(telemetry): correlation = trace id, tenant and actor span attributes`
- [x] **O1.3** `LOG_FORMAT=json`, `telemetry.LogHandler` thêm trace/tenant fields; `RequestLogger` dùng `*Context`; redact `token=`/`code=` query. `scripts/no-pii-log.test.mjs`.
  `feat(telemetry): json logs with trace_id, no-pii guard`
- [x] **O1.4** `/readyz` (DB, Redis, migration version) + `/healthz` liveness; `IsHealthProbePath` cả hai; test 503 khi DB đóng. `.env.example` thêm biến §8 + `scripts/env-example.test.mjs`.
  `feat(api): readiness endpoint, env example guard`

## Plan A1 — Platform admin (sub-issue)

- [x] **A1.1** Migrations 100–104: users granted_by/at; organizations status/suspended; `feature_flag_overrides`; `admin_actions`; index files. `queries/admin.sql`, `make sqlc`.
  `feat(db): organization status, admin_actions, feature_flag_overrides`
- [x] **A1.2** `middleware.RequirePlatformRole` (404 / 403 `platform_role_insufficient`), `middleware.OrganizationStatus` → 403 `organization_suspended` cho route org/ws. `service.AdminService`: list/get org, suspend/unsuspend (audit + admin_actions cùng tx, event `organization.suspended`), trace lookup, system. Audit coverage.
  `feat(admin): platform role guard, organization suspend, admin service`
- [x] **A1.3** Handler + router `/api/v1/admin/*` (me, organizations, suspend, unsuspend, plan, trace, system), SDI/SDO, rate‑limit riêng; tests 404/403/400.
  `feat(api): admin routes`
- [x] **A1.4** CLI `server/cmd/uniwork-admin` grant/revoke/list; ghi `admin_actions` actor `cli` + audit.
  `feat(admin): uniwork-admin cli`
- [ ] **A1.5** FE: endpoints + malformed tests, hooks, `paths.admin*`, layout guard (`/admin/me` 404 → `/`), màn Organizations, Organization detail (tabs, dialog reason), Trace, System; i18n `admin.*`; trang "Tổ chức tạm ngưng" cho user org bị suspend.
  `feat(views): admin console organizations, trace, system`

## Plan F1 — Feature flags theo org (sub-issue)

- [x] **F1.1** `EvalContext.OrganizationID`; `featureflags.DBProvider` (user > org > global, expires bỏ qua, cache 30 s, invalidate qua `flag.updated`); chain DB → static → env; catalogue 5 flag có `review_at`; governance test flag quá hạn.
  `feat(flags): db provider, catalogue with review_at`
- [x] **F1.2** `GET /api/v1/config`; admin `GET /flags`, `GET/PUT/DELETE /flags/{key}/overrides`; audit + admin_actions; event `flag.updated` ba nơi.
  `feat(api): public config, flag overrides`
- [ ] **F1.3** FE: `apps/web/platform/feature-flags.tsx` wire `FeatureFlagsProvider` từ `/config`; màn Flags; tab Flags trong org detail; bỏ module khỏi danh sách unwired trong CLAUDE.md.
  `feat(core): wire feature-flags from /config`

## Plan O2 — Metric, dashboard, alert (sub-issue)

- [x] **O2.1** Metric: `outbox_pending_age_seconds`, `outbox_pending_total`, `outbox_dead_letter_total` (tick 15 s), `realtime_publish_latency_seconds`, `web_vitals_seconds`, `build_info`; AI counter thêm label `organization_id` khi ≤ 1.000 org.
  `feat(metrics): outbox lag, realtime latency, web vitals, build info`
- [x] **O2.2** `deploy/alerts.yml` 8 rule + `docs/runbooks/*.md` 8 file (Triệu chứng / Kiểm tra / Khắc phục / Leo thang) + README; `scripts/alerts-runbooks.test.mjs`.
  `docs: alert rules and runbooks`
- [x] **O2.3** 6 dashboard JSON, `docker-compose.observability.yml` (otel‑collector, prometheus, grafana, loki), `docs/ops/OBSERVABILITY.md`.
  `feat(ops): observability compose profile and dashboards`

## Plan P1 — Perf CI + RUM (sub-issue)

- [x] **P1.1** `POST /api/v1/rum` → histogram; FE `platform/rum.ts` (web‑vitals, flag `rum_sampling`, sample rate).
  `feat(api): rum endpoint and web-vitals reporter`
- [ ] **P1.2** `size-limit` trong `apps/web` + job CI.
  `ci: bundle size budget`
- [x] **P1.3** `server/cmd/seed`, `perf/k6/*.js`, `.github/workflows/perf-nightly.yml` (artifact 90 ngày, issue tự động), smoke k6 khi nhãn `perf`.
  `ci: k6 nightly and seed tool`

## Đóng vòng

- [ ] Spec → **Đã triển khai**; plan → `shipped`; roadmap F-11 `CÓ` + ngày; CLAUDE.md: bỏ `feature-flags` khỏi danh sách unwired, thêm luật admin/telemetry + tên test.
