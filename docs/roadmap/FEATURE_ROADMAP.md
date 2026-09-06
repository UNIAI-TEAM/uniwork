# UniWork — Feature Roadmap (bản đồ tính năng để phát triển bám theo)

> **Trạng thái:** in-progress · **Cập nhật:** 2026-09-04 · **Nguồn định hướng:** `docs/vision/PROJECT_VISION.md`

Đây là **danh sách duy nhất** các tính năng cần xây lại từ bản Lovable (`unidigiwork`)
sang UniWork. Mỗi tính năng có: trạng thái thật trong repo này, việc còn phải làm,
spec để bám theo, và chỗ nhìn hành vi cũ. Không tính năng nào được bắt đầu code khi
chưa có spec **Đã duyệt** và plan trong `docs/superpowers/plans/` (xem
`docs/engineering/FEATURE_WORKFLOW.md`).

## Cách đọc

| Cột | Ý nghĩa |
| --- | --- |
| Trạng thái | `CÓ` đã chạy trong repo · `MỘT PHẦN` có nền nhưng thiếu DoD · `CHƯA` chưa có gì |
| Spec | file trong `docs/superpowers/specs/`; 8 spec ngày 2026-09-04 đã duyệt (UNI-421); `(cần viết)` = chưa có |
| Hành vi cũ | chỗ xem bản Lovable làm gì, chi tiết ở `docs/roadmap/LEGACY_REFERENCE_MAP.md` |
| DoD | tính năng chỉ được đánh dấu xong khi qua `docs/engineering/DEFINITION_OF_DONE.md` |

Ưu tiên trong một giai đoạn: P0 chặn tiêu chí thoát · P1 cần cho giai đoạn · P2 làm nếu còn thời gian.

## Hiện trạng repo ngày 2026-09-04

Đã chạy: đăng nhập/đăng ký/xác minh email/Google OAuth/quên mật khẩu; onboarding 4 bước;
organization + workspace + thành viên + lời mời + ma trận quyền; settings; task CRUD +
board + comment; meeting đầy đủ vòng đời (lịch, phòng LiveKit, lobby, khách, link mời,
chat trong phòng, transcript client, tóm tắt AI Claude, ghi hình Egress, ICS, auto-end);
chat (DM, nhóm, reaction, chặn, gọi thoại); email giao dịch có outbox; tìm kiếm topbar;
brand identity; Prometheus metrics; feature flags cơ bản; CI đầy đủ (lint, test, Go
-race, Playwright, gitleaks, govulncheck).

Chưa có: gói/entitlement/quota/billing, hồ sơ người dùng và danh bạ, notification,
audit + outbox toàn hệ thống, AI gateway dùng chung, agent là actor, platform admin,
OpenTelemetry, documents, calendar, workflow, knowledge/search toàn cục, insights.

---

## Giai đoạn F — Foundation (tháng 1–3) · "Dùng nội bộ hằng ngày"

| ID | Tính năng | Bounded context | Trạng thái | Việc còn phải làm | Spec | Ưu tiên |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Identity: MFA TOTP, OIDC Microsoft, quản lý phiên/thiết bị, xóa tài khoản | Identity & Access | MỘT PHẦN | Thêm MFA, provider OIDC thứ hai, danh sách phiên + thu hồi, luồng xóa tài khoản | `(cần viết)` identity-hardening | P1 |
| F-02 | Gói, subscription, entitlement, quota | Tenant & Subscription | CÓ (2026-09-06, UNI-425; billing thật ở C-04, cảnh báo ngưỡng ở C-05) | Toàn bộ theo spec; `entitlements.can(feature)` ở Go, không hard-code tên gói | `2026-09-04-tenant-subscription-entitlement-design.md` | P0 |
| F-03 | Hồ sơ người dùng, phòng ban, danh bạ /people, quản trị thành viên org, transfer ownership | Organization & People | MỘT PHẦN | Hồ sơ đầy đủ, phòng ban, danh bạ + CSV, transfer/deactivate | `2026-09-04-organization-people-directory-design.md` | P1 |
| F-04 | Workspace: nhãn/tags, lưu trữ, transfer ownership, xóa workspace | Workspace | MỘT PHẦN | Các mục "ngoài phạm vi" của spec quyền 2026-08-27 | `2026-08-27-workspace-permissions-design.md` + follow-up `(cần viết)` | P2 |
| F-05 | Task hoàn chỉnh: project, label, attachment, subtask, activity, saved view, My Work, row_version, idempotency | Project & Task | MỘT PHẦN | Theo spec; đây là lát cắt dọc chuẩn cho mọi feature khác | `2026-09-04-tasks-complete-design.md` | P0 |
| F-06 | Meeting đạt DoD: egress thật trên staging, metrics, E2E, kiểm chứng runtime | Meeting | CÓ | Chạy bằng chứng thật (ghi hình, transcript, summary) trên staging; đóng mục "cố ý để lại" nếu cần | `2026-08-29-meeting-world-class-design.md` | P1 |
| F-07 | Notification: inbox, đã đọc, tùy chọn, web push, email digest, badge realtime | Notification | CÓ (2026-09-06, UNI-427; `meeting_summary_ready` và mention trong chat chờ topic lên outbox; rate limit push chưa làm) | Toàn bộ; sinh từ outbox consumer, không từ handler | `2026-09-04-notifications-design.md` | P0 |
| F-08 | Audit bất biến + outbox + catalogue sự kiện toàn hệ thống + correlation id + màn hình Security & Audit | Audit & Compliance | CÓ (2026-09-04) | `audit_events` append-only; `outbox_events` dùng chung với `outbox.Dispatcher`; catalogue ba nơi; export + retention; tab Bảo mật & Nhật ký | `2026-09-04-audit-domain-events-design.md` | P0 |
| F-09 | AI Gateway dùng chung: provider registry, model router, prompt registry, tool authorization, metering, Ask UNI có quyền | AI Platform | CÓ (2026-09-06, UNI-428; quota = entitlement `ai.tokens`, không bảng `ai_quotas`; tool-calling do model chọn và embedding chờ đợt A) | Tách gateway khỏi meeting; metering theo org/actor/model; Ask UNI chỉ đọc | `2026-09-04-ai-platform-gateway-design.md` | P0 |
| F-10 | Agent là actor hạng nhất: bảng agents, `actor_kind` trên mọi bản ghi, agent là thành viên, có thể assign | AI Platform | CÓ (2026-09-06, UNI-424; Settings → Agents UI ở UNI-471) | Phần schema + attribution làm ở F; runtime thực thi ở giai đoạn A | `2026-09-04-agent-actor-model-design.md` | P0 |
| F-11 | Platform admin tối thiểu, OpenTelemetry, feature flag theo org, k6 hằng đêm, RUM | Platform Admin / Ops | CÓ (2026-09-07) | Theo spec; alert phải có runbook | `2026-09-04-platform-admin-observability-design.md` | P0 |
| F-12 | Chat đạt DoD (đã có tính năng) | Chat & Collaboration | CÓ | Rà DoD: audit, quyền, test tải realtime, i18n parity | `(cần viết)` chat-dod-audit — checklist, không phải spec mới | P1 |
| F-13 | Triển khai SaaS staging + production, zero-downtime, backup PITR, runbook 10 kịch bản | Ops | MỘT PHẦN (docker-compose.prod) | Hạ tầng thật, backup có kiểm tra khôi phục, runbook | nằm trong spec F-11 + `(cần viết)` ops-runbooks | P0 |
| F-14 | i18n vi/en parity gate trong CI, ngôn ngữ my/km/lo gắn beta | Cross-cutting | MỘT PHẦN | Test thiếu khóa; badge beta | `docs/conventions.md` §2 | P2 |

**Tiêu chí thoát giai đoạn F** (từ Vision §8): đội UNICOM dùng thật ≥ 4 tuần; thanh
6.1/6.4/6.5 có gate trong CI; k6 5.000 VU đạt ngưỡng; 0 màn hình dữ liệu giả, 0 nút
"coming soon".

---

## Giai đoạn C — Collaboration (tháng 4–6) · "Pilot khách hàng có kiểm soát"

| ID | Tính năng | Bounded context | Trạng thái | Spec | Ưu tiên |
| --- | --- | --- | --- | --- | --- |
| C-01 | Documents: soạn thảo cộng tác, phiên bản, chia sẻ, nhật ký truy cập, object storage | Document | CHƯA | `(cần viết)` documents-design | P0 |
| C-02 | Calendar: lịch cá nhân, lịch nhóm, ICS, gộp meeting + task due | Calendar | CHƯA | `(cần viết)` calendar-design | P1 |
| C-03 | Meeting intelligence nâng cao: STT server-side (LiveKit Agents), họp → task có người duyệt qua proposal | Meeting + AI | MỘT PHẦN | mở rộng `2026-08-29-meeting-world-class-design.md` | P0 |
| C-04 | Billing thật: cổng nội địa + Stripe, hóa đơn, webhook | Tenant & Subscription | CHƯA | phần Billing của spec F-02 | P0 |
| C-05 | Quota UI cho org admin, cảnh báo ngưỡng | Tenant & Subscription | CHƯA | spec F-02 | P1 |
| C-06 | Tenant export / delete (Nghị định 13/2023) | Audit & Compliance | CHƯA | phần retention/export của spec F-08 | P0 |
| C-07 | Trang status + changelog công khai | Ops | CHƯA | `(cần viết)` | P1 |
| C-08 | Ứng dụng mobile iOS (Expo + React Native) theo kiến trúc `usf`: app độc lập `apps/mobile`, chỉ dùng type + pure function từ `packages/core`, parity ngữ nghĩa với web, CI riêng, phát hành EAS; 5 tab Home · Chat · Work · Meet · More | Mobile | CHƯA | `2026-09-04-mobile-app-design.md` (đề xuất); ADR 0011 | P1 |
| C-09 | Tài liệu người dùng + onboarding trong app | Cross-cutting | CHƯA | `(cần viết)` | P1 |
| C-10 | Pentest bên thứ ba, đóng High/Critical | Security | CHƯA | checklist ASVS L2 | P0 |
| C-11 | Work Graph foundation: bảng quan hệ giữa đối tượng công việc, từ vựng quan hệ có kiểm soát, nguồn gốc (người / AI suy ra), API đọc lân cận depth-1 | Work Graph | CHƯA | `(cần viết)` work-graph-design; kế thừa work_nodes/work_edges bản cũ | P1 |
| C-12 | Decision record: thực thể quyết định hạng nhất sinh từ tóm tắt họp (`meeting_summaries.decisions`) và từ task, gắn Work Graph, có người xác nhận | Knowledge & Memory | CHƯA | `(cần viết)` decision-records-design | P1 |

**Tiêu chí thoát**: 5 tenant pilot ≥ 30 ngày, ≥ 3 tiếp tục; 1 hóa đơn thật; ≥ 20 cuộc họp
có transcript + tóm tắt thật; pentest 0 High/Critical mở; availability ≥ 99,9% trong 60 ngày.

---

## Giai đoạn A — Agent (tháng 7–9) · "Phát hành thương mại SaaS"

| ID | Tính năng | Bounded context | Spec | Ưu tiên |
| --- | --- | --- | --- | --- |
| A-01 | Agent runtime: nhận task → run → deliverable + evidence → proposal → người duyệt; hoàn tác | AI Platform | `2026-09-04-agent-actor-model-design.md` (phần runtime) | P0 |
| A-02 | Tool registry + policy rủi ro; hành động tự động chỉ ở mức thấp | AI Platform | spec F-09 | P0 |
| A-03 | Workflow & Automation: trigger, step, run, agent step | Workflow | `(cần viết)` | P1 |
| A-04 | Knowledge (wiki) + Search toàn cục + RAG có quyền, đọc Work Graph và Decision record | Knowledge & Memory | `(cần viết)`; tham chiếu Universal Search V2 bản cũ; phụ thuộc C-11, C-12 | P1 |
| A-05 | Insights: home brief, dashboard inline, work economics (rate có phiên bản, cohort) | Reporting | `(cần viết)`; kế thừa WE-1/2/3 bản cũ | P1 |
| A-06 | SSO SAML, SCIM chuẩn bị | Identity | `(cần viết)` | P1 |
| A-07 | Webhook ký HMAC + SDK TypeScript sinh từ OpenAPI | API | `(cần viết)` | P1 |
| A-08 | Self-serve: đăng ký, chọn gói, thanh toán, nâng cấp | Tenant & Subscription | spec F-02 | P0 |
| A-09 | Work Products (bán công việc hoàn thành) — chỉ khi cohort PROVEN; lớp mỏng trên `work_contracts` đã có từ A-01 | AI Platform | `(cần viết)`; kế thừa SWP-1 bản cũ | P2 |
| A-10 | Email integration: Gmail / Microsoft Graph đọc + gửi, thread gắn Work Graph, không lưu hộp thư riêng | Email integration | `(cần viết)` email-integration-design; phụ thuộc C-11 | P1 |

**Tiêu chí thoát**: ≥ 200 lượt agent thật, chấp nhận ≥ 60%, 0 sự cố agent ghi không qua
xác nhận; chi phí AI theo tenant đo được; ≥ 30 tenant trả phí, churn < 5%; SOC 2 Type I
có lịch.

---

## Giai đoạn E — Enterprise & On-premise (tháng 10–12)

| ID | Tính năng | Spec | Ưu tiên |
| --- | --- | --- | --- |
| E-01 | Docker Compose + Helm on-premise, tài liệu cài trong ≤ 2 giờ | `(cần viết)` | P0 |
| E-02 | Keycloak / OIDC bất kỳ, MinIO, local model qua gateway | `(cần viết)` | P0 |
| E-03 | Backup/restore, diễn tập DR đạt RPO 15 phút / RTO 1 giờ | `(cần viết)` ops | P0 |
| E-04 | SCIM, retention policy, dedicated cloud | `(cần viết)` | P1 |

---

## Nằm ngoài phạm vi (Vision §5.3)

Email Hub nội bộ trong DB (email thật là A-10); AI Market dạng marketplace mở; Decision Hub như
module riêng (Decision record là C-12); Blog/CMS; PWA như chiến lược mobile (mobile là app Expo,
C-08); desktop native; microservice trước khi có nhu cầu đo được.

## Thứ tự làm trong Giai đoạn F (đề xuất)

Nền trước, bề mặt sau; mỗi bước để lại gate trong CI:

1. **F-08 Audit + outbox** và **F-10 actor_kind** (schema) — mọi feature sau ghi qua đây.
2. **F-02 Entitlement/quota** (chưa cần billing) — mọi feature sau kiểm `can(feature)`.
3. **F-05 Tasks hoàn chỉnh** — lát cắt dọc mẫu, chứng minh DoD chạy được.
4. **F-07 Notifications** — consumer đầu tiên của outbox.
5. **F-09 AI Gateway + Ask UNI** — tách khỏi meeting, metering.
6. **F-11 Observability + admin + flags**, **F-13 hạ tầng** — chạy song song từ tuần 1.
7. **F-03 People**, **F-01 Identity**, **F-06/F-12 DoD audit** — điền vào các sprint còn trống.

## Ghi chú kỹ thuật chung cho 8 spec đề xuất

- Số migration trong spec là giữ chỗ; số thật cấp lúc viết plan theo thứ tự ở trên.
- `actor_kind` thống nhất `human` / `agent` / `system` (ADR 0007).
- Spec `tasks-complete` ghi nhận plan `2026-08-27-tasks-phase-0-skeleton.md` đánh dấu
  `shipped` nhưng mã vẫn ở mức 4 status; khi duyệt spec, đánh dấu plan cũ `superseded`.
- Câu hỏi mở của 8 spec đã chốt 2026-09-04 trong `docs/roadmap/OPEN_QUESTIONS.md`.

## Cập nhật tài liệu này

Khi một feature qua DoD: đổi
trạng thái thành `CÓ` và ghi ngày. Khi cắt phạm vi: ghi vào mục "Nằm ngoài phạm vi" kèm
lý do, không xóa dòng.
