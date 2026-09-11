# Definition of Done — một PR của UniWork

> **Trạng thái:** shipped · **Nguồn:** `docs/vision/PROJECT_VISION.md` §6.9, rút xuống những ô một reviewer kiểm được thật trong 15 phút. Mức áp dụng theo `GATE_LEVEL`.

Hai tầng. Tầng một máy giữ, reviewer không tick. Tầng hai là mười ô trong mẫu PR;
mỗi ô có cách kiểm, và ô "không áp dụng" ghi lý do một dòng. Thiếu là chặn merge.
`scripts/governance.test.mjs` bắt mẫu PR và trang này liệt kê cùng một bộ ô.

## Tầng 1 — máy đã giữ, đừng tick lại

Đỏ ở CI hoặc `make check` thì PR chưa xong; xanh thì reviewer không cần đọc lại:

| Luật | Giữ bởi |
| --- | --- |
| PR có mã `UNI-nnn` | `.github/workflows/uniai-link.yml` |
| Commit theo prefix, `Refs:` trailer | `.githooks/commit-msg`, `prepare-commit-msg` |
| Migration: không FK/cascade, index `CONCURRENTLY` riêng file, có `.down.sql`, bảng mới có `organization_id NOT NULL` | `server/migrations/lint_test.go` |
| Handler → service → db, membership chỉ qua `RequireMember`, chỉ `internal/audit` ghi audit/outbox | `server/internal/arch_test.go` |
| Command đổi trạng thái có audit; không có action mồ côi | `server/internal/service/audit_coverage_test.go` |
| Sự kiện `<entity>.<verb>` khớp ở ba nơi | `scripts/events-catalogue.test.mjs` |
| Endpoint có SDI/SDO và lên Swagger | `server/internal/handler/swagger_test.go` |
| Route có builder và ngược lại; slug gốc reserved | `packages/core/paths/consistency.test.ts`, CI diff `reserved-slugs.ts` |
| vi/en đủ khoá; JSX qua `t()` | `i18n/parity.test.ts`, `i18next/no-literal-string` |
| Token khai ở `:root` và `.dark`; tương phản đo trên trang | `packages/ui/styles/tokens.test.ts`, `e2e/onboarding-contrast.spec.ts` |
| Coverage không giảm | vitest `thresholds`, `server/coverage.floor` |
| Realtime chỉ invalidate, không ghi payload | `use-realtime-sync.test.tsx` |
| Unused export/file/dep, file ≤ 500 dòng, boundary package | `pnpm knip`, `pnpm lint` |

## Tầng 2 — mười ô reviewer tick

Cách kiểm đứng cạnh từng ô. Không có cách kiểm thì ô đó không thuộc DoD. Ô đánh dấu
`[fast]` áp dụng ở mọi mức `GATE_LEVEL`; các ô còn lại từ `standard` trở lên
(`docs/engineering/GATE_LEVELS.md`). Ở `strict`, thêm một review từ CODEOWNERS.

1. **Issue và phạm vi** `[fast]` — issue `UNI-nnn` ở `in_review`; mô tả PR nói *tại sao*, và
   mục "Đã cố ý bỏ ra ngoài" có nội dung hoặc ghi "không có". *Kiểm:* mở issue, đọc
   mô tả; phạm vi PR không rộng hơn issue.
2. **Kiểm chứng thật** `[fast]` — mục Kiểm chứng ghi lệnh đã chạy và kết quả; bước bỏ qua nêu
   tên và lý do. *Kiểm:* lệnh nêu ra tồn tại trong `make help` / `package.json`; CI
   xanh trước khi merge; không tuyên bố "make check xanh" khi CI đỏ.
3. **Test đi trước hành vi** `[fast]` — thay đổi hành vi có test ở đúng package (bảng trong
   `CLAUDE.md` § Testing): service/handler Go, endpoint có schema + case
   malformed-response, view có test trạng thái rỗng/lỗi/có dữ liệu, E2E cho luồng vàng
   nếu có UI. *Kiểm:* diff có file test cạnh file đổi; test đó fail nếu revert code.
4. **Cách ly tenant** `[fast]` — query mới nhận `organization_id`/`workspace_id` từ
   `RequireMember`, không từ body; có test actor org B nhận 403/404 (đến khi ma trận
   cách ly ADR 0008 có, đây là kiểm tay). *Kiểm:* đọc `WHERE` của query mới trong
   `server/pkg/db/queries/`; tìm test tên có "forbidden"/"other org".
5. **Quyền hai phía** — rule quyền mới có ở Go và mirror trong
   `packages/core/permissions/rules.ts`, mỗi rule cite gate Go nó mirror. *Kiểm:* grep
   tên rule ở cả hai nơi.
6. **Giao diện dùng được** — sáng và tối xem bằng mắt; đi hết luồng bằng bàn phím;
   không dữ liệu giả, không "coming soon"; empty state nói bước tiếp theo; copy tiếng
   Việt theo `docs/conventions.md` §3. *Kiểm:* chạy nhánh, bật `.dark`, Tab qua luồng.
7. **Agent là actor** — nếu agent tạo hoặc sửa dữ liệu: có attribution nhìn thấy, ghi
   `created_by_kind = agent`, và đi qua đề xuất → xác nhận (ADR 0007, 0010). *Kiểm:*
   tìm chỗ ghi `Actor{Kind}`; UI có badge.
8. **Luật mới có ADR** — PR đưa vào một "không bao giờ" / "chỉ được" mới thì có ADR
   `accepted`, dòng luật trong `CLAUDE.md`, và tên test giữ luật (hoặc vào mục
   "Awaiting Enforcement" với guard dự kiến). *Kiểm:* diff chạm `docs/adr/` và `CLAUDE.md`.
9. **Nền có runbook** — worker, cron, tích hợp ngoài mới thì có trang trong `docs/ops/`
   và được đưa vào chuỗi shutdown của `main.go`. *Kiểm:* diff chạm `docs/ops/`; grep tên
   worker trong `server/cmd/server/main.go`.
10. **Tài liệu đóng vòng** — spec liên quan chuyển **Đã triển khai**, plan
    `> **Trạng thái:** shipped`, dòng roadmap `CÓ` + ngày, trong cùng PR hoặc PR docs
    ngay sau và được nêu tên. *Kiểm:* diff chạm `docs/superpowers/` và
    `docs/roadmap/FEATURE_ROADMAP.md`, hoặc mô tả PR nêu PR docs tiếp theo.

## Không còn trong DoD, và vì sao

Các ô dưới đây từng có mặt nhưng chưa có cơ chế nào trong repo để kiểm; giữ chúng chỉ
dạy mọi người rằng checklist là trang trí. Chúng quay lại khi có cơ chế, kèm tên test.

| Ô cũ | Lý do rút | Quay lại khi |
| --- | --- | --- |
| `row_version`, `Idempotency-Key` | không có cột hay middleware nào trong repo | spec F đưa cột và middleware vào, có test |
| Danh sách > 200 dòng ảo hoá | chưa có primitive ảo hoá trong `packages/ui` | primitive tồn tại; lint hoặc test bắt danh sách dài |
| `useReducedMotion` | không có chỗ nào dùng, không có lint | hook có trong `packages/ui` và lint bắt animation không bọc |
| Log không PII, có `trace_id`/`actor_kind` | không có schema log hay test | logger có struct schema và test |
| Metric + alert + runbook cho mỗi đường lệnh | không có danh sách đường lệnh nào là "quan trọng" | catalogue metric và test đối chiếu |
| Dòng changelog | chưa có changelog | file changelog và bước release tạo ra |
| Feature flag theo org, bật staging 48 giờ | có `featureflags/keys.go` nhưng chưa có bật theo org | F-xx cho flag theo org, lúc đó là ô "Nền" |
| Mã lỗi ổn định qua `service/errors.go` | `mapServiceError` đã ép tại một chỗ | không cần quay lại |

## Không được coi là "xong"

- Có UI nhưng backend trả dữ liệu cứng.
- Test bị skip hoặc `--no-verify` để qua hook.
- "Sẽ thêm test ở PR sau".
