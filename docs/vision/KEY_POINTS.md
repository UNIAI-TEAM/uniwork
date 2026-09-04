# UniWork — Key Points & Core Technology

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-04 · Bản chốt của 11 key point sản phẩm, kèm đối chiếu với Vision, Roadmap và spec để không có key point nào "chỉ nằm trong slide".

UniWork là một **AI Work Operating System** hợp nhất công việc, ngữ cảnh, tri thức và AI
vào cùng một hệ thống vận hành. Thay vì chỉ cung cấp thêm phần mềm để con người thao tác,
UniWork giúp con người và AI cùng thực hiện công việc, tạo deliverable và tiến tới outcome
có thể kiểm chứng.

## 11 key point và nơi hiện thực

| # | Key point | Nội dung | Hiện thực trong tài liệu | Roadmap |
| --- | --- | --- | --- | --- |
| 1 | **One Workspace for Work** | Project, Task, Meeting, Document, Chat, Email, People, Knowledge, Decision trong một workspace | Vision §5.2 (18 bounded context); Email là tích hợp Gmail/Microsoft, không phải hộp thư riêng; Decision là Decision record, không phải hub | F-05, F-06, F-12, F-03, C-01, C-12, A-04, A-10 |
| 2 | **Work Graph** | Đồ thị quan hệ giữa các đối tượng công việc, hệ thống hiểu "cái gì liên quan đến cái gì" | Vision §5.2 mục 17; bảng quan hệ dùng chung, từ vựng quan hệ có kiểm soát, nguồn gốc quan hệ (người tạo / AI suy ra) | C-11 |
| 3 | **Organizational Memory** | Context, quyết định, tài liệu, cuộc họp, lịch sử thực thi không phụ thuộc trí nhớ cá nhân | Vision §5.2 mục 13 Knowledge & Memory = wiki + Decision record + Work Graph + audit/activity + meeting summary | F-08, C-12, A-04 |
| 4 | **AI Context Engine** | AI nhận context có kiểm soát từ Work Graph, Search và dữ liệu người dùng được quyền xem | Spec `ai-platform-gateway`: context builder chạy bằng quyền actor, budget cứng, `<untrusted>`, citation validator; nguồn Work Graph nối khi C-11 xong | F-09, C-11 |
| 5 | **Work Execution Orchestrator** | CONTEXT → PLAN → GENERATE → ACTION → VALIDATE → REVIEW | Spec `agent-actor-model` §5, §9: PLAN → GENERATE → EVALUATE; ACTION là `action_intent`; REVIEW là `waiting_review`; vòng sửa §5.2b | F-10, A-01 |
| 6 | **AI Workforce** | AI Worker có role, skills, allowed tools, permission scope, execution policy | `agents.skills`, `allowed_tools`, `autonomy_policy`, phạm vi run; agent là thành viên workspace (ADR 0007) | F-10, A-01, A-02 |
| 7 | **Human + AI Governance** | AI đề xuất, không vượt quyền; hành động quan trọng qua approval và trusted command | ADR 0010; proposal → confirm → execute; risk level; auto chỉ `low` sau 200 run thật | A-01, A-02 |
| 8 | **Quality & Evidence** | Deliverable có citation, evidence, quality evaluation, revision, human review | `agent_deliverables` + citations, EVALUATE với `quality_threshold`, vòng sửa §5.2b, `accepted` chỉ người ghi | A-01 |
| 9 | **Work Product / Sell Work Foundation** | Mỗi loại công việc có contract: input, context, executor, action, deliverable, acceptance, quality, review, SLA | `work_contracts` (spec agent §4.3) có từ A-01; A-09 chỉ thêm cohort, định giá, catalog | A-01, A-09 |
| 10 | **Multi-tenant Enterprise Architecture** | Tenant isolation, audit, outbox, idempotency, permission boundaries từ nền tảng | ADR 0008 (cách ly ở tầng service, `organization_id` mọi bảng; RLS là lớp phòng thủ thứ hai cho on-prem, không phải hàng rào chính), ADR 0009, DoD §1–§2 | F-02, F-08, F-10, E-02 |
| 11 | **From Software to Work** | Không chỉ bán seat mà tiến tới Work-as-a-Service, khách mua kết quả công việc | Vision §4.2 lớp doanh thu Work Products; chỉ công bố khi cohort PROVEN | A-09 |

## Câu chữ đã điều chỉnh so với bản gốc

- Key point 10: "tenant isolation, RLS, audit, outbox, idempotency" → "tenant isolation ở
  tầng service, audit, outbox, idempotency". Lý do: ADR 0008 chốt RLS không là hàng rào
  chính; giữ chữ RLS trong slide sẽ mâu thuẫn với kiến trúc thật.
- Key point 1: "Email" nghĩa là tích hợp email thật (A-10); "Decision" nghĩa là Decision
  record (C-12). Vision §5.3 loại "Email Hub nội bộ" và "Decision Hub" như module riêng.

## Dùng tài liệu này ở đâu

Slide, pitch, website: dùng cột "Nội dung". Đội phát triển: dùng cột "Hiện thực" và
"Roadmap". Khi một key point đổi, sửa ở đây trước, rồi Vision và Roadmap.
