# Audit bất biến, outbox tổng quát và catalogue sự kiện — Plan triển khai

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi command đổi trạng thái nghiệp vụ ghi `audit_events` (bất biến) và `outbox_events` trong **cùng một transaction**; một `outbox.Dispatcher` chung phát cho realtime / notification / webhook; `correlation_id` xuyên HTTP → DB → sự kiện → log; org owner/admin có màn hình Bảo mật & Nhật ký với lọc, chi tiết, export và retention.

**Architecture:** `audit.Recorder.Record(ctx, q, Entry, emit...)` là **cửa duy nhất** ghi hai bảng đó — service gọi nó bên trong `pgx.Tx` của chính mình. Worker `outbox.Dispatcher` claim/lease/retry (logic lấy nguyên từ `MeetingService.ProcessOutbox`) rồi fan-out cho các `Consumer` đăng ký theo topic: `MeetingProviderConsumer` (`provider.*`), `RealtimeConsumer` (mọi sự kiện domain trong catalogue), `ExportConsumer` (`audit.export_requested`), `WebhookConsumer` (stub). `EventPublisher.Publish` trực tiếp chỉ còn cho sự kiện phù du.

**Tech Stack:** Go 1.27, chi, pgx/v5, sqlc, Prometheus; Next.js + `@uniwork/core|views|ui`, TanStack Query, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-audit-domain-events-design.md` (Đã duyệt)
**ADR liên quan:** 0007 (actor_kind), 0009 (audit + outbox cùng transaction) — đợt này thêm ADR 0012 cho bất biến bằng quyền DB + trigger.

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; đầy đủ: `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Migration: không `REFERENCES`/`FOREIGN KEY`; `CREATE INDEX CONCURRENTLY` **một mình một file**; mọi migration có `.up.sql` + `.down.sql` (`server/migrations/lint_test.go`).
- Ids ULID `TEXT` qua `util.NewID()`.
- `actor_kind ∈ {human, agent, system}` — theo ADR 0007 và OPEN_QUESTIONS X1. Đoạn Go trong spec §4.1 viết `ActorUser = "user"` là **lỗi soạn thảo của spec**; giá trị chốt là `human`.
- Không thêm dependency Go hay npm.
- Không chữ "multica"/"UniAI" ở bất kỳ file nào (`scripts/no-usf-leak.test.mjs`).
- Copy: `vi.json` trước, `en.json` cùng key (`packages/core/i18n/parity.test.ts`).
- Lỗi service mới khai ở `service/errors.go` và map ở `mapServiceError`.
- Test Go chạm DB dùng `testutil.DB(t)`; bảng mới thêm vào TRUNCATE của `testutil/db.go`.
- Commit sau mỗi task, message tiếng Anh ngắn: `feat(audit): …`, `refactor(outbox): …`.

## Quyết định lúc implement (chốt các chỗ spec để ngỏ)

| # | Chỗ spec để ngỏ | Chốt |
|---|---|---|
| 1 | Số migration `058`–`064` là giữ chỗ | Migration mới nhất trên `develop` là `057_matrix_ids` → dùng đúng `058`–`063` (xem File map) |
| 2 | `lint_test.go` có cấm `CREATE FUNCTION`/`TRIGGER`? | **Không** — lint chỉ cấm FK và index không `CONCURRENTLY`. Không cần ngoại lệ, không cần sửa lint |
| 3 | Index outbox mới (spec `063`) | **Bỏ.** `021_outbox_events_pending_idx` (`status, available_at`) đã phục vụ đúng câu `ClaimPendingOutbox`; cột `status` giữ nguyên đợt này nên index cũ vẫn đúng mục đích |
| 4 | Auth audit thuộc org nào | `organization_id = ''` (sentinel), theo A1; org admin không thấy, chỉ `member.*` |
| 5 | `ip_address` | Chỉ org **owner** thấy; admin nhận `null` (A2) |
| 6 | Retention mặc định | 90 ngày; giá trị hợp lệ 30–730; entitlement chưa có nên chưa gate theo gói (A3) |
| 7 | Chat | Chỉ `chat.room.*` và `chat.message.deleted`; không audit tạo/sửa tin nhắn (A4) |
| 8 | Realtime qua outbox | Có, đơn tuyến, không double-publish (A5) |

---

## File map

**Backend — tạo mới**
- `server/migrations/058_audit_events.{up,down}.sql` — bảng + `REVOKE` + trigger bất biến
- `server/migrations/059_audit_events_org_time_idx.{up,down}.sql`
- `server/migrations/060_audit_events_resource_idx.{up,down}.sql`
- `server/migrations/061_audit_events_correlation_idx.{up,down}.sql`
- `server/migrations/062_outbox_events_generic.{up,down}.sql`
- `server/migrations/063_audit_retention_policies.{up,down}.sql`
- `server/pkg/db/queries/audit.sql`, `server/pkg/db/queries/outbox.sql`
- `server/internal/audit/audit.go` (Actor, Entry, Change, Event, Recorder), `context.go`, `diff.go`, `actions.go`
- `server/internal/audit/audit_test.go`, `diff_test.go`
- `server/internal/outbox/outbox.go` (Row, Consumer, Dispatcher), `catalogue.go`, `realtime_consumer.go`, `webhook_consumer.go`
- `server/internal/outbox/dispatcher_test.go`, `catalogue_test.go`
- `server/internal/middleware/correlation.go`, `correlation_test.go`
- `server/internal/service/audit_service.go`, `audit_service_test.go`, `audit_coverage_test.go`, `audit_immutable_test.go`
- `server/internal/service/audit_export.go`
- `server/internal/handler/audit.go`
- `server/internal/handler/router/audit.go`
- `server/internal/handler/dto/sdi/audit.go`, `dto/sdo/audit.go`
- `server/internal/metrics/audit.go`
- `docs/events/CATALOGUE.md`
- `docs/adr/0012-audit-bat-bien-bang-quyen-db-va-trigger.md`
- `docs/ops/RUNBOOK_OUTBOX.md`
- `scripts/events-catalogue.test.mjs`

**Backend — sửa**
- `server/internal/service/meeting.go` (`enqueue` qua `audit.Recorder`), `meeting_queries.go` (`ProcessOutbox`/`applyOutbox` → `MeetingProviderConsumer`), `meeting_lifecycle.go`, `meeting_participants.go`, `meeting_admission.go`, `meeting_links.go` (ghi song song `audit.Record`)
- `server/internal/service/task.go` (transaction + audit + bỏ `Publish` trực tiếp)
- `server/internal/service/workspace.go`, `organization.go`, `auth.go`, `password_reset.go`, `chat_rooms.go`, `chat.go`
- `server/internal/service/events.go` (ghi rõ tiêu chí sự kiện phù du)
- `server/internal/arch_test.go` (luật mới: chỉ `internal/audit` gọi `InsertAuditEvent`/`InsertOutboxEvent`)
- `server/internal/handler/router/router.go` (middleware `Correlation`, đăng ký route audit), `router/routes.go`, `router/openapi.go` (`pathParamSDI` cho `{orgID}`, `{orgID,eventID}`, `{orgID,exportID}`, `{workspaceID,resourceType,resourceID}`)
- `server/internal/handler/router.go` (map handler mới)
- `server/internal/middleware/request_logger.go` (attr `correlation_id`)
- `server/internal/metrics/registry.go`, `server/internal/testutil/db.go`
- `server/cmd/server/main.go` (dựng `audit.Recorder`, `outbox.Dispatcher`, đăng ký consumer, đưa vào chuỗi shutdown)
- `server/coverage.floor` (nếu tăng)

**Frontend — tạo mới**
- `packages/core/api/endpoints/audit.ts` + `audit.test.ts`
- `packages/core/audit/hooks.ts`, `packages/core/audit/index.ts`
- `packages/views/settings/components/audit-tab.tsx` + `audit-tab.test.tsx`
- `packages/views/settings/components/audit-detail-sheet.tsx`
- `packages/views/tasks/task-activity.tsx` + `task-activity.test.tsx`
- `e2e/audit.spec.ts`

**Frontend — sửa**
- `packages/core/api/http.ts` (gửi `X-Correlation-ID`), `packages/core/logger.ts`
- `packages/core/types/events.ts` (catalogue khớp Go)
- `packages/core/realtime/use-realtime-sync.ts` (+ `task.comment_added` và alias `comment.created`) + test
- `packages/views/settings/components/settings-page.tsx`, `index.ts`
- `packages/core/i18n/locales/vi.json`, `en.json`
- `CLAUDE.md`, `docs/conventions.md`, `docs/roadmap/FEATURE_ROADMAP.md`, `docs/adr/README.md`

---

## Tasks

### Lát 1 — Schema

- [ ] **T1.1** Viết `058`–`063` (up + down). `058` gồm `CREATE TABLE audit_events`, `REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC`, hàm + hai trigger `BEFORE UPDATE`/`BEFORE DELETE`. `062` mở rộng `outbox_events` (`organization_id`, `event_version`, `correlation_id`, `actor_kind`, `actor_id`, `done_at`, `dead_at`), backfill `organization_id` từ `workspaces`, bỏ `NOT NULL` của `workspace_id`.
  `cd server && go test ./migrations/...` xanh. Commit: `feat(audit): audit_events, generic outbox and retention schema`
- [ ] **T1.2** `testutil/db.go` TRUNCATE thêm `audit_events`, `audit_retention_policies`, `audit_exports`. Commit gộp T1.1.

### Lát 2 — Query + package `audit`

- [ ] **T2.1** `queries/audit.sql` + `queries/outbox.sql`; `make sqlc`. Commit: `feat(audit): sqlc queries for audit events and generic outbox`
- [ ] **T2.2** TDD `internal/audit`: `Diff` (chỉ trường đổi), `Record` (atomic: rollback ⇒ không dòng nào), `FromContext` (correlation/request/ip/ua). Test `TestRecordAtomic`, `TestDiffOnlyChangedFields`. Commit: `feat(audit): recorder writing audit and outbox in one transaction`
- [ ] **T2.3** `audit_immutable_test.go`: `UPDATE`/`DELETE` qua pool app → lỗi; qua superuser → vẫn lỗi (trigger). Commit: `test(audit): tamper test proves audit_events is append-only`

### Lát 3 — Package `outbox`

- [ ] **T3.1** TDD `outbox.Dispatcher`: claim/lease/retry chuyển từ `MeetingService`, `Register(Consumer)`, fan-out theo topic, backoff `min(2^n × 1s, 5m)` tối đa 10 lần rồi `dead_at`. Test `TestDispatcherFanout`, `TestDispatcherDeadLetter`. Commit: `feat(outbox): generic dispatcher with per-topic consumers`
- [ ] **T3.2** `catalogue.go`: `topic → {version, payloadKeys, scope}`; `catalogue_test.go` kiểm mỗi topic có scope hợp lệ. Commit: `feat(outbox): machine-readable event catalogue`
- [ ] **T3.3** `MeetingProviderConsumer` bọc `applyOutbox` nguyên vẹn; `meeting_outbox_test.go` chạy qua `Dispatcher` **không đổi assertion**. Commit: `refactor(outbox): meeting provider work becomes a consumer`
- [ ] **T3.4** `RealtimeConsumer` + `WebhookConsumer` (stub). Commit: `feat(outbox): realtime consumer publishes catalogue events`

### Lát 4 — Correlation id

- [ ] **T4.1** `middleware.Correlation` (nhận `X-Correlation-ID` khớp `[A-Za-z0-9_-]{8,64}`, thiếu thì sinh ULID, trả về header), gắn vào `router.New` ngay sau `RequestID`; `request_logger.go` thêm attr. Test `correlation_test.go`. Commit: `feat(api): correlation id middleware`
- [ ] **T4.2** FE: `http.ts` sinh và gửi `X-Correlation-ID`; `logger.ts` log nó khi request lỗi. Commit: `feat(core): send X-Correlation-ID on every request`

### Lát 5 — Service ghi audit

- [ ] **T5.1** `TaskService`: nhận `*pgxpool.Pool` + `audit.Recorder`; `Create`/`Update`/`Delete`/`AddComment` chạy trong transaction, `Record` + emit; bỏ `pub.Publish` trực tiếp. Test `TestTaskUpdateWritesAudit`. Commit: `feat(tasks): write audit and outbox in the same transaction`
- [ ] **T5.2** Workspace + Organization: `organization.created/updated`, `member.invited/joined/role_changed/removed`, `workspace.created/updated`, `workspace_member.added/role_changed/removed`. Commit: `feat(workspace): audit membership and workspace commands`
- [ ] **T5.3** Auth: `auth.login_succeeded/login_failed/password_reset_requested/password_changed/session_revoked` với `organization_id = ''`. Commit: `feat(auth): audit credential events`
- [ ] **T5.4** Chat: `chat.room.created/member_added/member_removed`, `chat.message.deleted`. Commit: `feat(chat): audit room administration`
- [ ] **T5.5** Meeting ghi song song `audit.Record` bên cạnh `writeAudit` cũ (một release). Commit: `feat(meetings): mirror meeting audit into audit_events`
- [ ] **T5.6** `audit_coverage_test.go`: bảng liệt kê mọi action §4.2, mỗi action một fixture gọi command và assert có dòng audit. Commit: `test(audit): coverage table listing every command that must audit`
- [ ] **T5.7** `arch_test.go`: chỉ `internal/audit` gọi `InsertAuditEvent`/`InsertOutboxEvent`. Commit gộp T5.6.

### Lát 6 — API

- [ ] **T6.1** `AuditService` (`RequireOrgAdmin`, `List`, `Get`, `ResourceHistory`, `Retention`, `RequestExport`, `ExportStatus`) + test cách ly `TestAuditIsolation`. Commit: `feat(audit): audit service with org admin gate`
- [ ] **T6.2** SDI/SDO + `router/audit.go` + `pathParamSDI` mới + handler; `swagger_test.go` xanh. Commit: `feat(api): audit, resource history, export and retention endpoints`
- [ ] **T6.3** `ExportConsumer` sinh CSV (UTF-8 BOM) / JSON Lines lên `storage.Storage`, phát `audit.exported`. Commit: `feat(audit): export job through the outbox`

### Lát 7 — Catalogue ba nơi

- [ ] **T7.1** `docs/events/CATALOGUE.md` + `packages/core/types/events.ts` khớp `catalogue.go`; `scripts/events-catalogue.test.mjs` so ba nơi. Commit: `test(events): catalogue must agree across docs, Go and TypeScript`
- [ ] **T7.2** `use-realtime-sync.ts` thêm `task.comment_added` (alias `comment.created` cùng key) + test. Commit: `feat(core): map task.comment_added to the comments key`

### Lát 8 — Giao diện

- [ ] **T8.1** `packages/core/api/endpoints/audit.ts` + schema lenient + malformed-response test cho mọi endpoint; hooks + `auditKeys`. Commit: `feat(core): audit endpoints and hooks`
- [ ] **T8.2** Tab "Bảo mật & Nhật ký" trong settings (bảng ảo hóa, lọc theo actor/action/resource/khoảng ngày, sheet chi tiết, nút export, ô retention); vi/en đủ; test trạng thái rỗng/lỗi/có dữ liệu. Commit: `feat(settings): security and audit log tab`
- [ ] **T8.3** Tab "Hoạt động" trong task detail dùng `/workspaces/{wsId}/resources/task/{id}/history`. Commit: `feat(tasks): activity tab backed by resource history`
- [ ] **T8.4** `e2e/audit.spec.ts`: đổi task → dòng audit hiện trong settings. Commit: `test(e2e): audit trail golden path`

### Lát 9 — Quan sát và quản trị

- [ ] **T9.1** Metric `uniwork_outbox_pending_age_seconds`, `uniwork_outbox_dead_total`, `uniwork_audit_events_total{action}`; `docs/ops/RUNBOOK_OUTBOX.md`. Commit: `feat(metrics): outbox lag and audit counters`
- [ ] **T9.2** ADR 0012 + dòng luật trong `CLAUDE.md` + `docs/conventions.md` § Go + `docs/adr/README.md`. Commit: `docs(adr): immutable audit by DB privilege and trigger`
- [ ] **T9.3** Roadmap F-08 → `CÓ`; plan → `shipped`; spec → `Đã triển khai`. Commit: `docs: F-08 shipped`

### Lát 10 — Kiểm chứng

- [ ] **T10.1** `make check` xanh. Ghi số bench outbox (throughput, lag p95) vào cuối plan này.

## Ghi chú đo đạc

_(điền khi T10.1 chạy xong)_
