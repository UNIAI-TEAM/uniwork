# Câu hỏi mở cần chủ sở hữu sản phẩm quyết

> **Trạng thái:** shipped · **Cập nhật:** 2026-09-04 · **Đã chốt:** 40/40 câu, quangpd (chủ sở hữu sản phẩm) quyết ngày 2026-09-04 trong phiên Giai đoạn 0 (UNI-419). Mọi câu chốt theo đề xuất mặc định; spec giữ nguyên nội dung tương ứng.

Cách dùng: trả lời ngay trong bảng (cột Quyết định), rồi người viết spec cập nhật spec
tương ứng và đổi trạng thái sang **Đã duyệt**.

## Xuyên suốt

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| X1 | `actor_kind` dùng `human` / `agent` / `system` (đã chuẩn hóa trong 8 spec và ADR 0007) — xác nhận? | `human` | **Chốt:** theo đề xuất |
| X2 | Platform admin: cột `users.platform_role` (admin/support) hay bảng riêng? Spec people và admin cùng đề xuất cột trên `users`. | Cột `users.platform_role` | **Chốt:** theo đề xuất |
| X3 | Migration số thật cấp theo thứ tự: audit/outbox → entitlement → tasks → notifications → people → AI → admin. Đồng ý thứ tự? | Đồng ý | **Chốt:** theo đề xuất |
| X4 | Self-host otel/Prometheus/Grafana/Loki cho cả SaaS và on-prem, hay Grafana Cloud cho SaaS? | Self-host (một stack cho ba tier) | **Chốt:** theo đề xuất |
| X5 | Ngưỡng k6 5.000 VU bắt buộc cuối F hay cuối C? | Cuối F với dataset sinh; cuối C với dữ liệu pilot | **Chốt:** theo đề xuất |

## F-02 Gói / entitlement / billing

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| B1 | Bộ gói và `quota_limit` từng gói? | Seed `starter` không giới hạn tạm thời; chốt trước tháng 3 (Vision §4.2) | **Chốt:** theo đề xuất |
| B2 | Cổng nội địa thứ hai: VNPay, MoMo hay PayOS? | PayOS (API đơn giản, hóa đơn) | **Chốt:** theo đề xuất |
| B3 | `past_due`: khóa ngay hay grace 7 ngày? | Grace 7 ngày, chỉ chặn tạo mới | **Chốt:** theo đề xuất |
| B4 | Cho tự downgrade khi usage đã vượt gói đích? | Không; yêu cầu giảm usage trước | **Chốt:** theo đề xuất |

## F-03 People / tổ chức

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| P1 | Vô hiệu hóa thành viên có trả ghế `members.max` không? | Có | **Chốt:** theo đề xuất |
| P2 | Transfer ownership cần OTP/mật khẩu hay chỉ gõ tên org? | Gõ tên org + mật khẩu hiện tại | **Chốt:** theo đề xuất |
| P3 | Member thường có thấy phone/email người khác (PII, NĐ13)? | Email: có trong cùng org; phone: chỉ khi người đó bật | **Chốt:** theo đề xuất |
| P4 | Phòng ban 2 cấp có đủ? | Đủ cho F | **Chốt:** theo đề xuất |
| P5 | Một người nhiều phòng ban? | Không ở F | **Chốt:** theo đề xuất |
| P6 | Admin có được vô hiệu hóa admin khác? | Không, chỉ owner | **Chốt:** theo đề xuất |

## F-05 Tasks

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| T1 | My Work ở cấp organization hay workspace? | Organization; là trang mặc định sau đăng nhập | **Chốt:** theo đề xuất |
| T2 | Xóa task: cứng + audit snapshot hay soft delete 30 ngày? | Soft delete 30 ngày | **Chốt:** theo đề xuất |
| T3 | Label do admin hay mọi member tạo? | Mọi member; admin sửa/xóa | **Chốt:** theo đề xuất |
| T4 | `in_review` / `blocked` là status hay cờ? | Status (bảng status cố định 7 giá trị) | **Chốt:** theo đề xuất |
| T5 | Giới hạn attachment theo gói ở F hay C? | Gate ở F (đã có entitlement), giá trị rộng | **Chốt:** theo đề xuất |

## F-07 Notifications

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| N1 | Consumer biết "assignee changed" bằng cờ trong payload hay đọc `audit_events.changes`? | Đọc audit theo `correlation_id` | **Chốt:** theo đề xuất |
| N2 | Digest 08:00 cố định hay giờ người dùng chọn? | 08:00 theo timezone người dùng ở F | **Chốt:** theo đề xuất |
| N3 | DM mới có tạo notification inbox? | Chỉ mention | **Chốt:** theo đề xuất |
| N4 | Push mặc định bật cho `meeting_starting`? | Bật | **Chốt:** theo đề xuất |
| N5 | Nhãn tiếng Việt cho Inbox: "Hộp việc" hay "Thông báo"? | "Hộp việc" (khớp IA V2) | **Chốt:** theo đề xuất |

## F-08 Audit / sự kiện

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| A1 | Sự kiện auth (login, reset) thuộc `organization_id` nào? | Sentinel rỗng, chỉ platform admin thấy | **Chốt:** theo đề xuất |
| A2 | Org admin (không chỉ owner) thấy `ip_address`? | Chỉ owner | **Chốt:** theo đề xuất |
| A3 | Retention mặc định Free/Team: 90 hay 180 ngày? | 90 Free, 180 Team, 365 Business | **Chốt:** theo đề xuất |
| A4 | Audit tạo/sửa chat message? | Không (chỉ xóa và quản trị phòng) | **Chốt:** theo đề xuất |
| A5 | Chấp nhận ~0,5 s trễ realtime khi đi qua outbox, hay double-publish có dedup? | Qua outbox; đo, nếu > 1 s p95 mới xét | **Chốt:** theo đề xuất |

## F-09 AI Gateway / Ask UNI

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| G1 | Ask UNI trả lời một lần hay streaming SSE? | Một lần ở V1 | **Chốt:** theo đề xuất |
| G2 | Quota token mặc định/tháng/org khi chưa có billing? | 500k token; owner không tự nâng | **Chốt:** theo đề xuất |
| G3 | Lưu hội thoại Ask UNI (xóa được) hay không lưu? | Lưu, xóa được | **Chốt:** theo đề xuất |
| G4 | Provider mặc định SaaS: Anthropic hay OpenAI-compatible? | Anthropic (đã có SDK Go trong meeting) | **Chốt:** theo đề xuất |
| G5 | Rate limit AI fail-open (như Redis hiện tại) hay fail-closed? | Fail-closed vì tốn tiền thật | **Chốt:** theo đề xuất |

## F-10 / A-01 Agent

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| AG1 | Agent là hàng trong `workspace_members` hay bảng `workspace_agent_members` riêng? | Bảng riêng | **Chốt:** theo đề xuất |
| AG2 | Ai tạo agent: org owner/admin hay cả ws admin? | Org owner/admin | **Chốt:** theo đề xuất |
| AG3 | Agent `paused` còn proposal chờ: người vẫn confirm được? | Có | **Chốt:** theo đề xuất |
| AG4 | Bật auto-execute mức `low` ngay đợt A hay sau 200 run thật? | Sau 200 run (Vision) | **Chốt:** theo đề xuất |
| AG5 | `AGENT_MIN_QUALITY` chặn thành `failed` hay luôn giao người kèm điểm? | Luôn giao người kèm điểm | **Chốt:** theo đề xuất |
| AG6 | Tạo agent mặc định "UNI" cho mọi org lúc onboarding? | Có | **Chốt:** theo đề xuất |

## F-11 Admin / observability

| # | Câu hỏi | Đề xuất mặc định | Quyết định |
| --- | --- | --- | --- |
| O1 | Impersonation ở F? | Không | **Chốt:** theo đề xuất |
| O2 | `support` thấy email member? | Không, chỉ id và tên | **Chốt:** theo đề xuất |
| O3 | Sampling trace 10% hay 100% khi ≤ 5 tenant? | 100% đến khi > 5 tenant | **Chốt:** theo đề xuất |
