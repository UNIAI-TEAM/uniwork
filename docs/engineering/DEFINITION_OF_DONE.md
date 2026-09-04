# Definition of Done — một tính năng của UniWork

> **Trạng thái:** in-progress · **Nguồn:** `docs/vision/PROJECT_VISION.md` §6.9, diễn giải thành lệnh và test có thật trong repo này.

Một tính năng chỉ được ghi `CÓ` trong `docs/roadmap/FEATURE_ROADMAP.md` khi **mọi ô
áp dụng** dưới đây được tick trong PR cuối cùng. Ô nào "không áp dụng" phải ghi lý do
một dòng. Reviewer chặn merge nếu thiếu; không có ngoại lệ "làm sau".

Chép checklist này vào phần mô tả PR.

## 1. Hợp đồng và dữ liệu

- [ ] Endpoint mới có SDI/SDO, `apiOp`, và xuất hiện trong Swagger (`docs/api-sdi-sdo.md`; `server/internal/handler/swagger_test.go` xanh).
- [ ] Mã lỗi ổn định, không lộ chi tiết nội bộ; `service/errors.go` là nơi khai báo.
- [ ] Migration tuân `server/migrations/lint_test.go`: không FK, không cascade, index `CONCURRENTLY` riêng file, id ULID `TEXT`; có `.down.sql` và rollback thử được.
- [ ] Bảng tenant-scoped có `organization_id` và/hoặc `workspace_id`, `created_at`, `updated_at`, `created_by`, `created_by_kind` (ADR 0007).
- [ ] Aggregate có mutate dùng `row_version` (optimistic concurrency); command có thể retry nhận `Idempotency-Key`.

## 2. Quyền và cách ly

- [ ] Mọi truy vấn lọc theo `workspace_id` / `organization_id`; membership chỉ qua `WorkspaceService.RequireMember` (`server/internal/arch_test.go` xanh).
- [ ] Rule quyền có ở Go và mirror trong `packages/core/permissions/rules.ts`, có test cả hai phía.
- [ ] Có test cách ly: actor tenant B không đọc/ghi được dữ liệu tenant A (Go test + E2E nếu có UI).
- [ ] Không lộ id tồn tại cho người ngoài workspace (`ErrForbidden`/`ErrNotFound`).

## 3. Audit, sự kiện, realtime

- [ ] Command làm thay đổi trạng thái nghiệp vụ ghi `audit_events` + `outbox_events` **trong cùng transaction** với thay đổi.
- [ ] Sự kiện đặt tên `<entity>.<verb>`, có trong catalogue của spec audit; payload id-only.
- [ ] Client nhận sự kiện qua `use-realtime-sync.ts` và invalidate query key; không ghi payload vào store.

## 4. Giao diện

- [ ] Vi và en đủ khóa (`i18next/no-literal-string`; test parity); copy tiếng Việt theo `docs/conventions.md` §3.
- [ ] Sáng và tối đều kiểm bằng mắt; WCAG AA; điều hướng bàn phím; `useReducedMotion` cho motion.
- [ ] Không dữ liệu giả, không nút "coming soon"; empty state nói bước tiếp theo.
- [ ] Danh sách có thể vượt 200 dòng được ảo hóa.
- [ ] Nếu actor là agent: có attribution (badge), trạng thái thật, hoàn tác theo `PRODUCT.md` § Agent Principles.
- [ ] Route có builder trong `packages/core/paths/paths.ts` (`consistency.test.ts` xanh); slug gốc mới vào `reserved_slugs.json`.

## 5. Khả năng quan sát

- [ ] Log có cấu trúc, không PII; có `trace_id`, `organization_id`, `workspace_id`, `actor_id`, `actor_kind`.
- [ ] Metric cho đường lệnh quan trọng (`server/internal/metrics`); alert mới đi kèm runbook.

## 6. Kiểm thử

- [ ] Go: service test + handler test, `make test-go` xanh, `server/coverage.floor` không giảm (tăng nếu xứng đáng).
- [ ] `packages/core`: endpoint có schema `parseWithFallback` + malformed-response test.
- [ ] `packages/views`: component test cho trạng thái chính (rỗng, lỗi, có dữ liệu).
- [ ] E2E Playwright cho luồng vàng của tính năng (`e2e/`).
- [ ] `make check` xanh cục bộ trước khi mở PR; CI xanh trước khi merge.

## 7. Tài liệu và quản trị

- [ ] Spec trong `docs/superpowers/specs/` ở trạng thái **Đã duyệt**; plan trong `docs/superpowers/plans/` có dòng `> **Trạng thái:**` cập nhật thành `shipped`.
- [ ] Mọi "không bao giờ" / "chỉ được" mới có ADR trong `docs/adr/` và dòng luật trong `CLAUDE.md` kèm tên test giữ luật.
- [ ] `docs/roadmap/FEATURE_ROADMAP.md` cập nhật trạng thái.
- [ ] Nếu có thành phần nền (worker, cron, tích hợp ngoài): runbook trong `docs/ops/`.
- [ ] Commit theo Conventional Commits; PR nhỏ, một mục đích.

## Không được coi là "xong"

- Có UI nhưng backend trả dữ liệu cứng.
- Test bị skip hoặc `--no-verify` để qua hook.
- Feature flag bật cho mọi org mà chưa qua staging.
- "Sẽ thêm test ở PR sau".
