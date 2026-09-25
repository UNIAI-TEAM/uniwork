# UniWork — Feature Roadmap (bản đồ tính năng để phát triển bám theo)

> **Trạng thái:** in-progress · **Cập nhật:** 2026-09-25 · **Nguồn định hướng:** `docs/vision/PROJECT_VISION.md` · **Thứ tự làm và phụ thuộc:** `docs/DEVELOPMENT_PLAN.md` · **Đối chiếu bản nháp:** `docs/DRAFT_MAPPING.md`

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
| F-01 | Identity: MFA TOTP, OIDC Microsoft, quản lý phiên/thiết bị, xóa tài khoản | Identity & Access | CÓ (2026-09-07, UNI-432; OIDC Microsoft cố ý bỏ theo quyết định 2026-09-07, làm cùng A-06/E-02 bằng adapter OIDC chung) | MFA TOTP + mã khôi phục, bắt buộc cho `platform_role` tại cổng admin; phiên/thiết bị trên `refresh_tokens.session_id`, thu hồi từng/mọi phiên, mail `new_login`; xóa tài khoản ẩn danh hóa giữ audit | `2026-09-07-identity-hardening-design.md` | P1 |
| F-02 | Gói, subscription, entitlement, quota | Tenant & Subscription | CÓ (2026-09-06, UNI-425; billing thật ở C-04, cảnh báo ngưỡng ở C-05) | Toàn bộ theo spec; `entitlements.can(feature)` ở Go, không hard-code tên gói | `2026-09-04-tenant-subscription-entitlement-design.md` | P0 |
| F-03 | Hồ sơ người dùng, phòng ban, danh bạ /people, quản trị thành viên org, transfer ownership | Organization & People | CÓ (2026-09-07, UNI-431; SCIM/đồng bộ thư mục ở giai đoạn E, kéo thả sắp xếp phòng ban dùng nút thứ tự thay vì dnd) | Toàn bộ theo spec; hồ sơ, phòng ban 2 cấp, danh bạ + CSV, mời cấp tổ chức, vô hiệu hóa, transfer ownership | `2026-09-04-organization-people-directory-design.md` | P1 |
| F-04 | Workspace: nhãn/tags, lưu trữ, transfer ownership, xóa workspace | Workspace | MỘT PHẦN | Các mục "ngoài phạm vi" của spec quyền 2026-08-27 | `2026-08-27-workspace-permissions-design.md` + follow-up `(cần viết)` | P2 |
| F-05 | Tasks Work Management parity: Tasks, My Tasks, Projects, năm views, collaboration, web/desktop/mobile và integration stubs | Project & Task | MỘT PHẦN | Slice 1/UNI-495 foundation + Slice 2/UNI-497 API+client core + Slice 3/UNI-500 collection surfaces + Slice 4/UNI-502 Projects suite + Slice 5/UNI-505 Task detail & collaboration + Slice 6/UNI-519 agent/integration stubs (server + Unavailable caps) + Slice 8/UNI-521 web cutover shipped (suite always on; flag+MVP+user-facing agent chrome removed). Lát 7 hosts deferred; residual optional `project_id` on create-from-project. Lát A/human-parity (reaction, nhánh lỗi, error boundary, activity) shipped 2026-09-13. Lát B/human-parity (trả lời bình luận theo luồng, nháp bền qua lỗi gửi, gấp luồng đã giải quyết, composer dính đáy, điều hướng luồng) shipped 2026-09-13. Lát C/human-parity (một bộ picker trạng thái, độ ưu tiên, người phụ trách, nhãn dùng chung cho bảng, sidebar chi tiết và thanh hàng loạt; đặt ngày hạn hàng loạt; menu hành động trên hàng và menu chuột phải cho list và board) shipped 2026-09-13. Lát D1/human-parity (một bộ điều phối phím tắt toàn cục và tab đổi phím tắt trong Settings, phím gửi bình luận, tìm trong trang chi tiết task, task xem gần đây trong palette tìm, nhớ luồng đã giải quyết đang mở và sub-task đang gấp) shipped 2026-09-14. Lát D2/human-parity (truy vấn vô hạn list/My Tasks; board workspace tải theo cột qua API bảng; Gantt/swimlane nút tải thêm; kéo thả lạc quan trên cache bảng) shipped 2026-09-14. Lát E/human-parity (vá cache task từ frame realtime: `task.updated` mang tiêu đề, trạng thái, độ ưu tiên, ngày hạn theo cột `Patch` của catalogue, guard hai revision, ADR 0015) shipped 2026-09-14. Spec ô Task human-parity (`2026-09-12-tasks-human-parity-design.md`) shipped 2026-09-14 | `2026-09-07-tasks-work-management-parity-design.md` | P0 |
| F-06 | Meeting đạt DoD: egress thật trên staging, metrics, E2E, kiểm chứng runtime | Meeting | CÓ | Chạy bằng chứng thật (ghi hình, transcript, summary) trên staging; đóng mục "cố ý để lại" nếu cần | `2026-08-29-meeting-world-class-design.md` | P1 |
| F-07 | Notification: inbox, đã đọc, tùy chọn, web push, email digest, badge realtime | Notification | CÓ (2026-09-06, UNI-427; `meeting_summary_ready` và mention trong chat chờ topic lên outbox; rate limit push chưa làm) | Toàn bộ; sinh từ outbox consumer, không từ handler | `2026-09-04-notifications-design.md` | P0 |
| F-08 | Audit bất biến + outbox + catalogue sự kiện toàn hệ thống + correlation id + màn hình Security & Audit | Audit & Compliance | CÓ (2026-09-04) | `audit_events` append-only; `outbox_events` dùng chung với `outbox.Dispatcher`; catalogue ba nơi; export + retention; tab Bảo mật & Nhật ký | `2026-09-04-audit-domain-events-design.md` | P0 |
| F-09 | AI Gateway dùng chung: provider registry, model router, prompt registry, tool authorization, metering, Ask UNI có quyền | AI Platform | CÓ (2026-09-06, UNI-428; quota = entitlement `ai.tokens`, không bảng `ai_quotas`; tool-calling do model chọn và embedding chờ đợt A) | Tách gateway khỏi meeting; metering theo org/actor/model; Ask UNI chỉ đọc | `2026-09-04-ai-platform-gateway-design.md` | P0 |
| F-10 | Agent là actor hạng nhất: bảng agents, `actor_kind` trên mọi bản ghi, agent là thành viên, có thể assign | AI Platform | CÓ (2026-09-06, UNI-424; Settings → Agents UI ở UNI-471) | Phần schema + attribution làm ở F; runtime thực thi ở giai đoạn A | `2026-09-04-agent-actor-model-design.md` | P0 |
| F-11 | Platform admin tối thiểu, OpenTelemetry, feature flag theo org, k6 hằng đêm, RUM | Platform Admin / Ops | CÓ (2026-09-07) | Theo spec; alert phải có runbook | `2026-09-04-platform-admin-observability-design.md` | P0 |
| F-12 | Chat đạt DoD (đã có tính năng) | Chat & Collaboration | CÓ | Rà DoD: audit, quyền, test tải realtime, i18n parity — đóng cùng lát cuối của C-13 | `(cần viết)` chat-dod-audit — checklist, không phải spec mới | P1 |
| F-13 | Triển khai SaaS staging + production, zero-downtime, backup PITR, runbook 10 kịch bản | Ops | MỘT PHẦN (docker-compose.prod) | Hạ tầng thật, backup có kiểm tra khôi phục, runbook | nằm trong spec F-11 + `(cần viết)` ops-runbooks | P0 |
| F-14 | i18n vi/en parity gate trong CI, ngôn ngữ my/km/lo gắn beta | Cross-cutting | MỘT PHẦN | Test thiếu khóa; badge beta | `docs/conventions.md` §2 | P2 |

**Tiêu chí thoát giai đoạn F** (từ Vision §8): đội UNICOM dùng thật ≥ 4 tuần; thanh
6.1/6.4/6.5 có gate trong CI; k6 5.000 VU đạt ngưỡng; 0 màn hình dữ liệu giả, 0 nút
"coming soon".

---

## Giai đoạn C — Collaboration (tháng 4–6) · "Pilot khách hàng có kiểm soát"

| ID | Tính năng | Bounded context | Trạng thái | Spec | Ưu tiên |
| --- | --- | --- | --- | --- | --- |
| C-01 | Documents: soạn thảo cộng tác, phiên bản, chia sẻ, nhật ký truy cập, object storage | Document | CHƯA | `2026-09-08-documents-design.md` (đã duyệt 2026-09-08, UNI-437). **Đã bổ sung §13 (2026-09-16, ADR 0016):** tài liệu thuộc sở hữu của một Kết quả công việc — không đứng trong cây workspace, không chia sẻ riêng, quyền ủy quyền sang Work Product. Thuộc lát cắt 1; điều kiện để C-14 khởi động. **FileService (2026-09-22, UNI-726):** [spec](../superpowers/specs/2026-09-22-shared-file-service-design.md) và [plan](../superpowers/plans/2026-09-22-shared-file-service.md), đang lập kế hoạch, chưa có runtime. Bảng files lưu metadata và tenant organization_id; avatar tài khoản có ngoại lệ NULL qua identity scope (T1-Q10). Nền tảng và task/editor/avatar/chat/recording/audit export triển khai trước (UNI-739..747, UNI-749). **Cập nhật 2026-09-24:** hợp đồng [FS-C1](../superpowers/specs/2026-09-24-file-service-contract.md) giao trước (Gate A0), các module và Documents/Office G1-G2 code theo hợp đồng + fake, nghiệm thu trên FileService thật sau Gate C; UNI-748 chỉ còn sửa DOC-004/harness G0. Không chặn editor/fidelity G0, không bật GC cho dữ liệu G0/legacy chưa chuyển | P0 |
| C-02 | Calendar: lịch nhóm workspace (+ filter Của tôi), ICS, gộp meeting + task due | Calendar | CHƯA | `2026-09-22-calendar-design.md` (đề xuất — chờ duyệt) | P1 |
| C-03 | Meeting intelligence nâng cao: STT server-side (LiveKit Agents), họp → task có người duyệt qua proposal | Meeting + AI | MỘT PHẦN | mở rộng `2026-08-29-meeting-world-class-design.md` | P0 |
| C-04 | Billing thật: cổng nội địa + Stripe, hóa đơn, webhook | Tenant & Subscription | CHƯA | phần Billing của spec F-02 | P0 |
| C-05 | Quota UI cho org admin, cảnh báo ngưỡng | Tenant & Subscription | CHƯA | spec F-02 | P1 |
| C-06 | Tenant export / delete (Nghị định 13/2023) | Audit & Compliance | CHƯA | phần retention/export của spec F-08 | P0 |
| C-07 | Trang status + changelog công khai | Ops | CHƯA | `(cần viết)` | P1 |
| C-08 | Ứng dụng mobile iOS (Expo + React Native) theo kiến trúc `usf`: app độc lập `apps/mobile`, chỉ dùng type + pure function từ `packages/core`, parity ngữ nghĩa với web, CI riêng, phát hành EAS; 5 tab Home · Chat · Work · Meet · More | Mobile | CHƯA | `2026-09-04-mobile-app-design.md` (đề xuất); ADR 0011 | P1 |
| C-09 | Tài liệu người dùng + onboarding trong app | Cross-cutting | CHƯA | `(cần viết)` | P1 |
| C-10 | Pentest bên thứ ba, đóng High/Critical | Security | CHƯA | checklist ASVS L2 | P0 |
| C-11 | Work Graph foundation: bảng quan hệ giữa đối tượng công việc, từ vựng quan hệ có kiểm soát, nguồn gốc (người / AI suy ra), API đọc lân cận depth-1 | Work Graph | CHƯA | `(cần viết)` work-graph-design; kế thừa work_nodes/work_edges bản cũ. **ADR 0019 (2026-09-16):** đồ thị là projection qua outbox, projector idempotent, khóa duy nhất `(từ, loại, tới)`, **cấm suy diễn quan hệ**; đợt này **không** có node cho lượt thực thi (để A-01) và **không** có chia sẻ bằng liên kết ngoài. Sub P2: bàn gắn nhanh tài liệu ↔ việc | P1 |
| C-12 | Decision record: thực thể quyết định hạng nhất sinh từ tóm tắt họp (`meeting_summaries.decisions`) và từ task, gắn Work Graph, có người xác nhận | Knowledge & Memory | CHƯA | `(cần viết)` decision-records-design | P1 |
| C-13 | Chat đẳng cấp ClickUp: kênh gắn Project, thread hạng nhất, tin nhắn ↔ task, đính kèm tệp, Posts, FollowUps, AI CatchUp / Ask UNI trong kênh, tìm kiếm toàn cục | Chat & Collaboration | CHƯA (chat messenger đã có; thiếu lớp gắn công việc) | `2026-09-09-chat-work-hub-design.md` (lát 1–3, chờ duyệt), các lát sau có spec riêng; epic UNI-506, 10 lát cắt = UNI-507…516 theo thứ tự | P1 |
| C-14 | **Kết quả công việc (Work Product)**: deliverable nghiệp vụ — loại nghiệp vụ tách khỏi định dạng, phiên bản có ảnh chụp nguồn gốc, bình luận, xem xét/duyệt, AI có bảng chọn nguồn ngữ cảnh tường minh | Work Product | CHƯA | `2026-09-16-work-products-design.md` (bản 2 sau review kiến trúc; Đề xuất — chờ duyệt, 5 câu hỏi mở §12). Thêm 2026-09-16 từ bản nháp; ADR 0016. Phụ thuộc **C-01 §13** (lát 1a) và **C-11** (lát 1b, 4). 6 lát: 1a dữ liệu+quyền+API · 1b projector Work Graph · danh sách+chi tiết+soạn native · phiên bản+xem xét/duyệt+người theo dõi · AI+nguồn ngữ cảnh · tích hợp. **Câu hỏi mở §12.1 (bình luận) nếu chốt hoãn thì dòng này và UNI-641 phải sửa theo** | P0 |
| C-15 | **Nhập đa định dạng và AI sửa có người duyệt**: kiểm kê/nhập nội dung trong sáu định dạng lõi DOCX/XLSX/PPTX/PDF/Markdown/HTML; AI đề xuất theo năng lực từng engine, người dùng duyệt trước khi áp dụng; editor trên web và desktop theo ma trận Q1-B | Work Product + Document | CHƯA | `(cần viết)` documents-import-design; yêu cầu G0 Q1-B. Phạm vi/engine theo từng thao tác phải được xác minh; đây là mục tiêu roadmap, chưa phải tính năng đã ship | **Cập nhật 2026-09-25:** ADR 0021 đã được chấp nhận và chốt runtime theo từng thao tác (bảng DOC-004, `docs/office/g0/module-runtime-map.json`): editor ở trang host + adapter tiêm, phần chạy ngoài trang ở service nội bộ; thao tác chưa chứng minh giữ blocker + tên test, không hứa trước | P1 |
| C-16 | **Hợp đồng UniWork Office đa định dạng**: editor cho DOCX/XLSX/PPTX/PDF/Markdown/HTML trên web và desktop theo Q1-B; phiên bản, change feed, tombstone và đồng bộ theo Q5-A/Q7-B. `document_version_conflict` 409 là mã Office đề xuất trong DOC-005, dùng cùng `errorClass = conflict` với `revision_conflict` 422 của trang; chỉ chấp nhận sau khi hợp đồng được duyệt | Document | CHƯA | `(cần viết)` documents-office-design; yêu cầu G0 (quyết định G0 = GO ngày 2026-09-25); hợp đồng DOC-005 đã nghiệm thu ở mức G0 (model tham chiếu, `docs/office/g0/login-sync-contract.md` §8.6). Không chọn runtime hay tuyên bố tích hợp/ship; G4 sở hữu desktop | **Cập nhật 2026-09-25:** ADR 0021 đã chốt runtime cho sáu chu trình editor và DOC-004 đã nghiệm thu (87/87 thao tác có runtime + hành vi khi chưa chứng minh; G0 = GO). Đây vẫn là hợp đồng ở mức thiết kế: chưa có tích hợp sản phẩm, G4 sở hữu desktop | P1 |

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
| A-05 | Insights: home brief, dashboard inline, kéo thả + chỉnh kích thước card, **lịch sử bố cục có khôi phục**, work economics (rate có phiên bản, cohort) | Reporting | Lát 1 Trang chủ: `2026-09-14-home-trang-chu-design.md` (đề xuất, chờ duyệt; UNI-451; flag `home_page` đã bỏ 2026-09-25 — Trang chủ luôn bật; tóm tắt suy ra từ dữ liệu, chưa dùng LLM). Dashboard inline và work economics `(cần viết)`; kế thừa WE-1/2/3 bản cũ. **2026-09-16:** thu hẹp — bảng điều hành cấp tổ chức tách sang A-11; bổ sung lịch sử bố cục từ bản nháp | P1 |
| A-06 | SSO SAML, SCIM chuẩn bị | Identity | `(cần viết)` | P1 |
| A-07 | Webhook ký HMAC + SDK TypeScript sinh từ OpenAPI | API | `(cần viết)` | P1 |
| A-08 | Self-serve: đăng ký, chọn gói, thanh toán, nâng cấp | Tenant & Subscription | spec F-02 | P0 |
| A-09 | **Bán công việc** (đổi tên 2026-09-16 từ "Work Products") — chỉ khi cohort PROVEN; lớp mỏng trên `work_contracts` đã có từ A-01 | AI Platform | `(cần viết)`; kế thừa SWP-1 bản cũ. Đổi tên để trả thuật ngữ "Work Product" cho deliverable nghiệp vụ ở C-14 (ADR 0016) | P2 |
| A-10 | Email integration: Gmail / Microsoft Graph đọc + gửi, thread gắn Work Graph, không lưu hộp thư riêng | Email integration | `(cần viết)` email-integration-design; phụ thuộc C-11 | P1 |
| A-11 | **CEO Command Center**: tổng quan theo kỳ có so kỳ trước và drill-down, chuyển dịch Người↔AI, bảng nhân sự người và AI đứng chung, chất lượng kết quả, theo bộ phận, vấn đề tự phát hiện; giao ban thực tế; lịch sử KPI và theo dõi đề xuất/việc; báo cáo bộ phận + xuất tệp + job nền | Reporting | `(cần viết)` ceo-command-center-design. Thêm 2026-09-16 từ bản nháp. Phụ thuộc A-01 (số người↔AI đối xứng) + A-05. **Chỉ hiện số đo thật**; quy đổi giờ/tiền người là đơn giá tổ chức tự đặt, hiện kèm công thức; không dựng doanh thu | P1 |
| A-12 | **Bộ não AI**: một bề mặt điều hành AI — đề xuất chờ duyệt, hồ sơ nhân sự AI, nhật ký, bật/tắt kỹ năng theo mức rủi ro (rủi ro cao khóa "bắt buộc người duyệt"), theo dõi đề xuất đã giao | AI Platform | `(cần viết)` ai-brain-design. Thêm 2026-09-16 từ bản nháp. **Là bề mặt hợp nhất, không phải năng lực mới** — phụ thuộc A-01 và A-02. Job AI tự đào tạo lại **không** thuộc task này | P1 |

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
C-08); microservice trước khi có nhu cầu đo được.

Thêm sau đợt đối chiếu bản nháp 2026-09-16 — lý do đầy đủ ở `docs/DRAFT_MAPPING.md`:

| Việc | Vì sao không làm |
| --- | --- |
| Kho tệp thứ hai bên cạnh Document | Work Product là lớp nghiệp vụ, không có bảng artifact riêng (ADR 0016) |
| Bảng lưu "kết quả cuối cùng" | Suy ra từ trạng thái Work Product + lần xem xét gần nhất (ADR 0017) |
| Nhập Excel nhân sự/bộ phận/lịch họp; màn quản lý lịch họp cấp tổ chức | Mời thành viên và CSV danh bạ của F-03 đã đủ; chờ pilot thật yêu cầu |
| Ngôn ngữ `id`, `ms` | Chờ nhu cầu thật ở thị trường đó |
| Chia sẻ bản đồ công việc bằng liên kết ngoài | Làm nền C-11 trước; tính lại sau |
| Engine XLSX, PPTX, PDF ngoài phạm vi đợt DOCX ban đầu | Quyết định cũ (ADR 0018, chỉ DOCX) đã bị thay bởi [ADR 0021](../adr/0021-runtime-engine-office-da-dinh-dang.md): sáu định dạng lõi nằm trong phạm vi, mỗi thao tác có runtime theo bảng DOC-004; phần chưa chứng minh ghi thành blocker + tên test, không phải "không làm" |
| Chấm công | Không dựng số giờ người bằng ước tính; xem A-11 |
| Job AI tự đào tạo lại hằng ngày | Là năng lực thật, không núp trong task về màn hình; quyết sau khi có A-01 |
| So sánh hai bộ máy Office | Công cụ nội bộ của đợt chọn engine, không phải tính năng người dùng |

Ứng dụng desktop **không còn** nằm ngoài phạm vi: UniWork Office là bản tùy biến từ
GenOffice (Apache-2.0) và C-16 là hợp đồng tích hợp với nó (ADR 0021, đã thay [ADR 0018](../adr/0018-engine-office-chay-o-sidecar-node.md)).

## Thứ tự làm trong Giai đoạn F (đề xuất)

Nền trước, bề mặt sau; mỗi bước để lại gate trong CI:

1. **F-08 Audit + outbox** và **F-10 actor_kind** (schema) — mọi feature sau ghi qua đây.
2. **F-02 Entitlement/quota** (chưa cần billing) — mọi feature sau kiểm `can(feature)`.
3. **F-05 Tasks Work Management parity** — suite Tasks, My Tasks và Projects là lát
   cắt dọc mẫu, chứng minh DoD chạy được.
4. **F-07 Notifications** — consumer đầu tiên của outbox.
5. **F-09 AI Gateway + Ask UNI** — tách khỏi meeting, metering.
6. **F-11 Observability + admin + flags**, **F-13 hạ tầng** — chạy song song từ tuần 1.
7. **F-03 People**, **F-01 Identity**, **F-06/F-12 DoD audit** — điền vào các sprint còn trống.

## Ghi chú kỹ thuật chung cho 8 spec đề xuất

- Số migration trong spec là giữ chỗ; số thật cấp lúc viết plan theo thứ tự ở trên.
- `actor_kind` thống nhất `human` / `agent` / `system` (ADR 0007).
- Spec `2026-09-07-tasks-work-management-parity-design.md` thay `tasks-complete` và
  ghi nhận plan `2026-08-27-tasks-phase-0-skeleton.md` chỉ là nền MVP đã superseded.
- Câu hỏi mở của 8 spec đã chốt 2026-09-04 trong `docs/roadmap/OPEN_QUESTIONS.md`.

## Cập nhật tài liệu này

Khi một feature qua DoD: đổi
trạng thái thành `CÓ` và ghi ngày. Khi cắt phạm vi: ghi vào mục "Nằm ngoài phạm vi" kèm
lý do, không xóa dòng.
