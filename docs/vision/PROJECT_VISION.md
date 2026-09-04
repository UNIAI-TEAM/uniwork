# UNIWORK — PROJECT VISION DOCUMENT

**Phiên bản:** 1.0 · **Ngày:** 2026-09-04 · **Chủ sở hữu:** quangpd (UNICOM) · **Trạng thái:** Draft để phê duyệt

> Bản này là bản chính thức cho repo `uniwork`. Bản khảo sát gốc nằm ở `../unidigiwork/docs/vision/PROJECT_VISION_DOCUMENT.md`. Tính năng cụ thể xem `docs/roadmap/FEATURE_ROADMAP.md`.

**Mục đích của tài liệu:** Là văn bản định hướng cao nhất cho việc xây lại UNIWORK từ mức demo (bản Lovable tại `unidigiwork`) thành một sản phẩm Work OS đạt chuẩn thế giới. Mọi quyết định về phạm vi, kiến trúc, chất lượng và lộ trình phải trích dẫn được về tài liệu này. Tài liệu không thay thế Blueprint kỹ thuật hay PRD từng module; nó quyết định *tại sao*, *cho ai*, *đến đâu* và *đo bằng gì*.

---

## 0. Tóm tắt điều hành

UNIWORK là nền tảng Work OS AI-native cho đội nhóm 10 đến 1.000 người tại Việt Nam và Đông Nam Á, nơi con người và AI agent cùng sở hữu công việc: cùng nhận task, cùng họp, cùng soạn tài liệu, cùng chạy quy trình.

Bản hiện tại (`unidigiwork`, sinh bằng Lovable trên TanStack Start + Supabase) đã chứng minh được ba điều có giá trị: (1) mô hình nghiệp vụ và kiến trúc dữ liệu đa tenant nghiêm túc, (2) lớp quản trị AI "đề xuất, người duyệt, rồi mới thực thi", và (3) một bộ tài liệu kiến trúc, audit và kiểm thử rất đầy đủ. Nhưng chính các audit nội bộ của dự án kết luận: **chưa sẵn sàng thương mại**. Vòng đời cốt lõi "AI nhận việc, giao kết quả, người duyệt, tính tiền" chưa chạy đầu-cuối lần nào, nhiều màn hình còn số liệu giả, hiệu năng gãy ở 1.000 người dùng đồng thời, mã nguồn phình thành các file 2.000 đến 4.000 dòng, và toàn bộ runtime khóa vào Lovable Cloud.

Quyết định đề xuất: **xây lại có chủ đích** trên nền tảng đã khởi động tại repo `uniwork` (Go + PostgreSQL + Redis + Next.js + LiveKit, monorepo pnpm/turbo), theo ba nguyên tắc:

1. **Giữ tri thức, bỏ mã.** Giữ mô hình domain, quy tắc kiến trúc, quy tắc quản trị AI, IA điều hướng, hệ thống kiểm thử cách ly tenant. Không port mã Lovable.
2. **Chuẩn thế giới là tiêu chí đo được**, không phải khẩu hiệu. Mục 6 định nghĩa từng thanh chất lượng bằng con số và cơ chế ép buộc trong CI.
3. **Thu hẹp để đi sâu.** Phát hành theo lát cắt dọc hoàn chỉnh (task, meeting, doc, agent) thay vì 32 tính năng ở mức 60%.

Mốc quan trọng: bản Foundation dùng nội bộ sau 3 tháng, pilot khách hàng có kiểm soát sau 6 tháng, phát hành thương mại SaaS sau 9 tháng, sẵn sàng on-premise sau 12 tháng.

---

## 1. Bối cảnh: hiện trạng dự án và lý do xây lại

### 1.1 Hiện trạng đo được

Khảo sát repo `unidigiwork` ngày 2026-09-04, đối chiếu với các audit nội bộ trong `docs/audit`, `docs/performance`, `docs/investor-tech-dd`.

| Hạng mục | Số liệu |
|---|---|
| Mã nguồn ứng dụng | ~128.900 dòng TypeScript/TSX, 431 file |
| Route sản phẩm | 104 file route (web, mobile PWA `/m/*`, admin, public) |
| Module API phía server | 94 file `src/lib/api/*` (server function + RPC wrapper) |
| Bảng dữ liệu public | 114 bảng, 114/114 bật RLS, 212 policy, 312 hàm/RPC |
| Migration | 204 file, một thư mục phẳng |
| Kiểm thử tự động | 29 file test, ~220 test; 13 bộ SQL integration; 2 kịch bản E2E Python |
| Lịch sử | 4.013 commit từ 2025-01 đến 2026-08-28, phần lớn tiêu đề "Changes" |
| Ngôn ngữ giao diện | vi, en, my, km, lo trong một file `i18n.tsx` 3.351 dòng |
| Runtime | Lovable Cloud (Supabase quản lý), AI Gateway qua `LOVABLE_API_KEY`, LiveKit Cloud |

### 1.2 Phán quyết của chính dự án

Các audit do đội dự án thực hiện đã tự kết luận, và tài liệu này lấy đó làm điểm xuất phát:

- `UNIWORK_MVP1_DECISION.md`: **NOT READY cho MVP1 thương mại.** READY cho pilot nội bộ.
- `UNIWORK_FINAL_STABILITY_AUDIT.md`: INTERNAL_PILOT_READY = YES (có cảnh báo), CUSTOMER_PILOT_READY = NO, COMMERCIAL_READY = NO.
- `UNIWORK_SELL_WORK_READINESS.md`: **CHƯA sẵn sàng bán công việc do AI thực hiện.**
- `PERFORMANCE_READINESS_REPORT.md`: an toàn ở ~250 người dùng đồng thời; **FAIL ở 1.000 VU** (p95 28,4 giây) do nghẽn tầng API gateway của Lovable Cloud, không phải Postgres.

### 1.3 Vì sao không thể "sửa tiếp" bản hiện tại

| Vấn đề gốc | Bằng chứng | Hệ quả nếu giữ |
|---|---|---|
| **Khóa nhà cung cấp toàn phần** | DB, auth, storage, realtime, AI gateway, deploy đều qua Lovable Cloud. Blueprint dành hẳn chương 21 cho "chiến lược thoát" nhưng chưa cutover module nào. | Không thể cam kết on-premise, data residency, SLA, hay chi phí AI theo tenant. Điểm nghẽn 1.000 VU nằm ngoài tầm kiểm soát. |
| **Vòng đời bán hàng chưa chạy** | `ai_task_executions` = 0, transcript/summary họp = 0, thiếu `STRIPE_SECRET_KEY`, Email Hub là email nội bộ trong DB. | Sản phẩm không có bằng chứng giá trị để bán. |
| **Giao diện demo** | Dead control ở CTA "Tạo công việc"; số liệu mock ở Họp, Email, Storage, topbar; 14 nút `notifyComingSoon` ở /reports và /people. | Người dùng thật sẽ mất niềm tin ngay phiên đầu. |
| **Mã nguồn không bảo trì được** | `admin.trace.tsx` 4.387 dòng, `meeting.tsx` 2.272, `app-shell.tsx` 1.842; `supabase/types.ts` 10.323 dòng sinh tự động; 904 cảnh báo lint chưa dọn. | Chi phí mỗi thay đổi tăng theo cấp số, không onboard được kỹ sư mới. |
| **Domain đúng, mã sai chỗ** | Blueprint chia 16 bounded context nhưng mã là 94 module API phẳng và các route chứa cả nghiệp vụ; nghiệp vụ cốt lõi nằm trong 312 hàm PL/pgSQL SECURITY DEFINER. | Logic phân tán giữa TypeScript và SQL, không kiểm thử đơn vị được, không chuyển backend được. |
| **Quan sát hệ thống thiếu** | Không có latency middleware, không outbox lag, không RUM, không alert. | Không thể vận hành SLA. |
| **Bề rộng vượt chiều sâu** | 32 tính năng trong inventory, chỉ 8 ở mức PRODUCTION_READY, 24 ở PARTIAL/UNVERIFIED/NOT_IMPLEMENTED. | Nguồn lực bị chia mỏng, không tính năng nào "hoàn thiện đến mức đáng tin". |

### 1.4 Những gì đã làm đúng và phải kế thừa

Xây lại không có nghĩa bỏ hết. Các tài sản sau là kết quả của hơn một năm làm việc và có giá trị cao hơn mã nguồn:

1. **Mô hình domain và quy tắc kiến trúc** (`UNIWORK_SAAS_ARCHITECTURE_BLUEPRINT_V1.0.md`, `PROJECT_ARCHITECTURE_RULES.md`): tenant khác workspace, một writer mỗi bounded context, `row_version` + idempotency, audit + outbox cùng transaction, stable error code, không hard-code plan.
2. **Quản trị AI**: pipeline CONTEXT → PLAN → GENERATE → ACTION → VALIDATE → REVIEW; AI chỉ dừng ở `WAITING_REVIEW` hoặc `FAILED`, `ACCEPTED` chỉ con người ghi được; policy model tập trung; đánh dấu nội dung không tin cậy chống prompt injection.
3. **Bộ kiểm thử cách ly tenant** (173 kịch bản, 78 kịch bản tamper JWT) và các bộ SQL integration về quota, outbox, RLS. Đây là tài sản kiểm thử, cần được viết lại cho backend mới nhưng giữ nguyên ma trận.
4. **Kinh tế công việc (Work Economics / Sell Work)**: rate có phiên bản, độ tin cậy số liệu FULL / PROVISIONAL / NOT_RELIABLE, ngưỡng cohort EARLY / PROVISIONAL / PROVEN. Đây là nền cho mô hình kinh doanh.
5. **Kiến trúc thông tin V2**: điều hướng theo hành vi (Home, Work, Communication, Knowledge, Automation, Insights, Admin), mobile 5 tab.
6. **Nguyên tắc thiết kế** đã được chuẩn hóa trong `uniwork/PRODUCT.md`: tiết chế, màu là tín hiệu, không số liệu giả, agent là đồng nghiệp chứ không phải linh vật.

### 1.5 Bản xây lại đã khởi động

Repo `uniwork` (220 commit, hoạt động đến 2026-09-04, đội UNIAI-TEAM) đã chốt nền tảng: Go (chi + pgx + sqlc), PostgreSQL, Redis, Next.js App Router + Tailwind 4 + Base UI, WebSocket relay, LiveKit, monorepo pnpm/turbo, ADR có đánh số, `CLAUDE.md` là bộ luật duy nhất cho người và agent. Đã có tasks, meetings với phòng video, thành viên, lời mời, onboarding 4 bước.

Tài liệu này định hướng cho repo đó. Nó không đề xuất đổi stack.

---

## 2. Tầm nhìn và sứ mệnh

### 2.1 Tuyên bố tầm nhìn

> **Đến 2028, UNIWORK là nơi mà một đội nhóm Đông Nam Á điều phối con người và AI agent trong cùng một dòng công việc, đến mức công cụ biến mất và chỉ còn công việc được hoàn thành.**

### 2.2 Sứ mệnh

Đưa năng lực làm việc với AI của các tập đoàn công nghệ đến các doanh nghiệp vừa và nhỏ Việt Nam bằng một sản phẩm viết bằng tiếng Việt trước, an toàn dữ liệu trước, và có thể triển khai ở bất cứ đâu khách hàng yêu cầu.

### 2.3 Ba niềm tin nền tảng

1. **Agent là đồng sở hữu công việc, không phải nút bấm.** Mô hình dữ liệu và mô hình quyền được thiết kế để một agent nhận task, dự họp, chạy quy trình như một thành viên: có ghi nhận tác giả, có trạng thái thật, có hoàn tác riêng. Đây là khác biệt duy nhất được phép tuyên bố.
2. **Niềm tin là sản phẩm.** Khách hàng SME giao dữ liệu vận hành cho UNIWORK. Cách ly tenant, audit bất biến, AI không tự thực thi thay đổi nghiệp vụ, và khả năng on-premise không phải tính năng, chúng là điều kiện tồn tại.
3. **Tiếng Việt là ngôn ngữ thứ nhất.** Copy viết bằng tiếng Việt bản ngữ; tiếng Anh ngang hàng; Myanmar, Khmer, Lào là lộ trình và luôn gắn nhãn beta.

---

## 3. Khách hàng, vấn đề và thị trường

### 3.1 Khách hàng mục tiêu

| Phân khúc | Quy mô | Đặc điểm | Người mua / Người dùng |
|---|---|---|---|
| **SME vận hành số** (ưu tiên 1) | 10 đến 200 người | Agency, phần mềm, thương mại, dịch vụ; đang dùng 4 đến 6 công cụ rời (Zalo, Google Workspace, Trello/Base, Zoom). | Giám đốc vận hành, trưởng nhóm / toàn bộ nhân viên |
| **Doanh nghiệp tầm trung** (ưu tiên 2) | 200 đến 1.000 người | Có phòng IT, yêu cầu SSO, phân quyền, audit, có thể yêu cầu dedicated cloud. | CIO, trưởng phòng CNTT / phòng ban |
| **Tổ chức có yêu cầu dữ liệu tại chỗ** (ưu tiên 3, năm 2) | Không giới hạn | Ngân hàng, cơ quan, tập đoàn; bắt buộc on-premise, tích hợp Keycloak/AD. | Ban dự án CNTT / phòng ban |

### 3.2 Persona chính

- **Lan, trưởng nhóm dự án agency (35 người):** mỗi sáng mở 5 ứng dụng để biết việc gì đang trễ; họp xong không ai ghi biên bản; muốn giao việc chuẩn bị báo cáo tuần cho AI nhưng phải kiểm được trước khi gửi khách.
- **Minh, giám đốc vận hành công ty phần mềm (150 người):** cần biết chi phí AI theo từng dự án, cần audit ai đã sửa gì, cần SSO với Google Workspace, sợ dữ liệu khách hàng rò rỉ qua công cụ AI công cộng.
- **Hà, quản trị CNTT tổ chức lớn:** chỉ chấp nhận triển khai trong hạ tầng của tổ chức, tích hợp Keycloak, có bản vá bảo mật định kỳ và tài liệu vận hành.

### 3.3 Vấn đề cần giải

1. Công việc bị phân mảnh giữa chat, họp, email, tài liệu, bảng việc; ngữ cảnh mất đi giữa các bước.
2. AI hiện có trên thị trường là "trợ lý cạnh công việc": tóm tắt, gợi ý, chat; không nhận trách nhiệm một phần việc, không có trạng thái, không kiểm được.
3. Doanh nghiệp Việt thiếu lựa chọn Work OS bản ngữ, giá theo sức mua nội địa, có thể cam kết dữ liệu ở Việt Nam theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.

### 3.4 Bối cảnh cạnh tranh

| Đối thủ | Thế mạnh | Điểm UNIWORK khác |
|---|---|---|
| Base.vn | Thị phần SME Việt, nhiều module quản trị | AI ở Base là tính năng cộng thêm; UNIWORK thiết kế agent là thành viên có quyền và có audit |
| Lark / Feishu | Chat + họp + docs liền mạch, giá tốt | Không on-premise, dữ liệu ngoài Việt Nam, AI theo lộ trình của ByteDance |
| Notion / Slack / Linear | Chất lượng sản phẩm chuẩn thế giới | Không bản ngữ, giá USD, không có mô hình "agent sở hữu task" với chấp thuận của người |
| Microsoft 365 Copilot | Hệ sinh thái, doanh nghiệp lớn | Chi phí cao, phức tạp cho SME, agent không có trạng thái công việc chung với người |

Tuyên bố khác biệt được phép: **mô hình agent đồng sở hữu công việc, có quản trị.** Mọi thứ khác (task, meeting, doc) là điều kiện tối thiểu, không phải điểm bán.

---

## 4. Định vị và mô hình kinh doanh

### 4.1 Định vị

*Cho đội nhóm Việt Nam 10 đến 1.000 người cần điều phối công việc với AI, UNIWORK là Work OS AI-native duy nhất mà agent làm việc như đồng nghiệp: nhận việc, báo cáo tiến độ, chờ người duyệt; khác với Lark hay Base gắn AI như một nút bấm cạnh công việc của con người.*

### 4.2 Mô hình kinh doanh đề xuất

Mô hình hiện tại (bảng `plans`, `entitlements`, `quota`) là đúng hướng và được kế thừa về khái niệm.

| Lớp doanh thu | Cơ chế | Ghi chú |
|---|---|---|
| **Gói theo ghế** (Free / Team / Business / Enterprise) | Tháng hoặc năm, VND, entitlement theo tính năng | Free có giới hạn để tạo kênh phân phối tự phục vụ |
| **AI usage metering** | Tín dụng AI tính theo rate có phiên bản, dư số mang sang, cảnh báo ngưỡng | Kế thừa `ai_model_cost_rates`, `usage_counters` |
| **Work Products** (giai đoạn 2) | Bán "công việc hoàn thành" theo hợp đồng có phiên bản (báo cáo tuần, họp thành việc, phục hồi dự án) | Chỉ công bố khi cohort đạt PROVEN theo ngưỡng đã định |
| **Dedicated / On-premise** | Phí triển khai + thuê bao năm + hỗ trợ | Yêu cầu Tier C trong kiến trúc |

**Quyết định mở (cần chốt trước tháng 3 của lộ trình):** giá niêm yết, mức Free, đơn vị tín dụng AI. Không đưa giá lên sản phẩm cho đến khi chốt; nguyên tắc "không quảng cáo cái chưa có" trong `PRODUCT.md` áp dụng.

---

## 5. Phạm vi sản phẩm

### 5.1 Nguyên tắc phạm vi

- **Lát cắt dọc hoàn chỉnh trước, bề rộng sau.** Một tính năng chỉ được đưa vào phát hành khi đạt Definition of Done (mục 6.9). Không có trạng thái "có UI nhưng backend mock".
- **Mọi bề mặt đều là bề mặt của agent.** Task, meeting, doc, workflow phải hỗ trợ agent là actor từ ngày đầu, không thêm sau.
- **Cắt những gì không tạo khác biệt và không phải điều kiện tối thiểu.**

### 5.2 Bounded context và mức ưu tiên

| # | Bounded context | Giai đoạn | Ghi chú kế thừa |
|---|---|---|---|
| 1 | Identity & Access (auth, session, SSO OIDC, SCIM sau) | F | Kế thừa mô hình role, thêm OIDC ngay từ đầu |
| 2 | Tenant & Subscription (org, plan, entitlement, quota, billing) | F | Kế thừa thiết kế entitlement/quota; billing thật qua cổng thanh toán nội địa + Stripe |
| 3 | Organization & People (thành viên, hồ sơ, phòng ban, lời mời) | F | Thay `/people` hiện tại có 6 nút chết |
| 4 | Workspace (không gian, thẻ, cài đặt) | F | Tenant khác Workspace, giữ nguyên |
| 5 | Project & Task (board, list, comment, attachment, view cá nhân) | F | Đã có trong `uniwork` |
| 6 | Meeting (lịch, phòng LiveKit, ghi hình, transcript, tóm tắt, biến họp thành việc) | F + C | Đã có phòng video; intelligence là giai đoạn C |
| 7 | Document (soạn thảo cộng tác, phiên bản, chia sẻ, nhật ký truy cập) | C | Bỏ "Email Hub" nội bộ; email thật là tích hợp, xem mục 18 |
| 8 | Chat & Collaboration (kênh, DM, mention, thread) | C | Realtime qua relay đã có |
| 9 | Notification (in-app, push, email digest, tùy chọn) | F | Foundation vì mọi context khác phát sự kiện vào đây |
| 10 | Calendar (lịch cá nhân, lịch nhóm, ICS) | C | |
| 11 | AI Platform (gateway, model router, policy, tool registry, usage metering, agent runtime) | F + A | Trái tim của định vị. Gateway ở F; agent nhận task ở A |
| 12 | Workflow & Automation (trigger, step, run, agent step) | A | |
| 13 | Knowledge & Memory (wiki, Decision record, tìm kiếm toàn cục, RAG có quyền, lịch sử thực thi) | C + A | "Organizational Memory" của key points: tri thức, quyết định, lịch sử không phụ thuộc trí nhớ cá nhân. Decision record sinh từ tóm tắt họp và task, gắn vào Work Graph; Search V2 kế thừa khái niệm |
| 14 | Reporting & Insights (home brief, dashboard, work economics) | A | Không hero KPI; số liệu inline |
| 15 | Audit & Compliance (audit bất biến, export, retention, trace) | F | Kế thừa correlation id, audit trigger |
| 16 | Platform Admin (console, tenant ops, backup, feature flag) | F (tối thiểu) | Không xây admin trace 4.387 dòng lần nữa |
| 17 | Work Graph (quan hệ giữa Task, Meeting, Document, Decision, People, Chat với bộ từ vựng quan hệ có kiểm soát và nguồn gốc quan hệ) | C | Xuyên suốt: là nguồn cấp context cho AI Context Engine và là nền của Organizational Memory. Bảng quan hệ dùng chung, không nằm trong module nào |
| 18 | Email integration (Gmail, Microsoft Graph: đọc, gửi, thread gắn vào Work Graph) | A | Thay cho Email Hub nội bộ; không lưu hộp thư riêng |

F = Foundation, C = Collaboration, A = Agent (xem lộ trình mục 8). Đối chiếu với 11 key point của sản phẩm: `docs/vision/KEY_POINTS.md`.

### 5.3 Ngoài phạm vi (cho đến khi có quyết định mới)

- Email Hub dạng "email nội bộ trong DB". Email thật là tích hợp với Gmail / Microsoft Graph (mục 18 trong §5.2), không phải hộp thư riêng.
- AI Market / chợ tuyển dụng agent theo hình thức marketplace mở. Giữ khái niệm "catalog agent" nội bộ.
- Decision Hub như một module riêng. Quyết định vẫn là thực thể Decision record hạng nhất trong Knowledge & Memory (mục 13), không phải hub.
- Blog/CMS công khai, ứng dụng desktop native. Các adapter cho host thứ hai được giữ trong kiến trúc.
- Bất kỳ microservice nào trước khi có nhu cầu vận hành đo được (kế thừa Blueprint §25.16).

---

## 6. Định nghĩa "chuẩn thế giới": các thanh chất lượng bắt buộc

Đây là phần quan trọng nhất của tài liệu. Mỗi thanh có ngưỡng đo được và cơ chế ép buộc. Thanh nào chưa có cơ chế ép buộc thì chưa được coi là đạt.

### 6.1 Bảo mật và niềm tin

| Yêu cầu | Ngưỡng | Ép buộc |
|---|---|---|
| Cách ly tenant | 100% truy vấn tenant-scoped qua tầng service có `tenant_id`; 0 rò rỉ trong ma trận cross-tenant | Test cách ly tenant (kế thừa 173 kịch bản) chạy trong CI với 2 tenant fixture; arch test chặn truy cập DB ngoài tầng service |
| Xác thực | OIDC (Google, Microsoft), email + mật khẩu có kiểm tra rò rỉ, MFA TOTP; SAML/SCIM ở Enterprise | Test đăng nhập, luồng hết hạn/giả chữ ký (kế thừa 13 case JWT) |
| Phân quyền | RBAC theo tenant và workspace, kiểm ở server; frontend không tự quyết quyền | Permission matrix test theo từng endpoint |
| Bí mật | Không secret trong repo; secrets manager; xoay vòng có lịch | Gitleaks trong CI pre-commit và pipeline |
| Chuẩn tham chiếu | OWASP ASVS Level 2; sẵn sàng SOC 2 Type I ở tháng 12 | Checklist ASVS trong DoD; pentest bên thứ ba trước phát hành thương mại |
| Dữ liệu cá nhân | Tuân thủ Nghị định 13/2023/NĐ-CP: đồng ý, quyền xóa, xuất dữ liệu, data residency Việt Nam cho gói Business trở lên | Tính năng export/delete tenant; vùng hạ tầng VN |
| Audit | Audit bất biến (không UPDATE/DELETE), có correlation id xuyên request → DB → sự kiện | Trigger + test tamper |
| AI an toàn | AI không có service role; mọi tool call qua policy fail-closed; nội dung người dùng đánh dấu không tin cậy; hành động ghi cần người xác nhận | Test policy trong CI (kế thừa `ai-task-execution.test.ts`) |

### 6.2 Độ tin cậy và vận hành

| Yêu cầu | Ngưỡng |
|---|---|
| Availability SaaS | 99,9% tháng (≤ 43 phút downtime), đo bằng synthetic probe ngoài |
| RPO / RTO | RPO 15 phút, RTO 1 giờ; diễn tập khôi phục mỗi quý và ghi biên bản |
| Sao lưu | PITR bật; backup mã hóa, lưu khác vùng; kiểm tra khôi phục tự động hằng tuần |
| Triển khai | Zero-downtime, rollback dưới 5 phút, migration tương thích ngược (expand/contract) |
| Sự cố | Runbook cho 10 kịch bản đầu; on-call luân phiên; post-mortem không đổ lỗi trong 5 ngày làm việc |
| Trạng thái công khai | Trang status và changelog từ ngày phát hành pilot |

### 6.3 Hiệu năng

| Chỉ số | Ngưỡng | Cách đo |
|---|---|---|
| API p95 | ≤ 200 ms cho đọc, ≤ 400 ms cho lệnh ghi, ở 5.000 người dùng đồng thời với dataset 1 triệu task | k6 trong CI hằng đêm, dữ liệu sinh theo tỉ lệ thật |
| Realtime | Sự kiện đến client ≤ 1 giây p95; outbox lag ≤ 5 giây p95 | Metric outbox và relay |
| Web vitals | LCP ≤ 2,5 s trên 4G, INP ≤ 200 ms, CLS ≤ 0,1 | RUM gửi về từ client thật |
| Bundle | JS khởi tạo ≤ 250 KB gzip; route chunk ≤ 150 KB | Size-limit trong CI |
| Danh sách dài | Ảo hóa mọi danh sách có thể vượt 200 dòng | Review checklist |

### 6.4 Khả năng quan sát

- OpenTelemetry cho trace, metric, log từ ngày đầu; mỗi request có `trace_id`, `tenant_id`, `actor_id`, `actor_kind` (human / agent).
- Dashboard bắt buộc: latency theo endpoint, error rate, outbox lag, realtime connection, chi phí AI theo tenant và model, quota.
- Alert có ngưỡng và có chủ sở hữu; alert không có runbook thì không được tạo.
- Log có cấu trúc, không PII trong log.

### 6.5 Chất lượng mã và kiểm thử

| Yêu cầu | Ngưỡng / Cơ chế |
|---|---|
| Kim tự tháp kiểm thử | Unit cho service và domain; contract test cho API (OpenAPI là hợp đồng); integration với Postgres thật; E2E Playwright cho luồng vàng |
| Coverage | Sàn coverage tăng dần và không được giảm (`coverage.floor` đã có trong `uniwork/server`) |
| Kiến trúc | Arch test chặn import sai tầng (đã có `arch_test.go`), lint chặn chéo package (đã có), knip chặn mã chết |
| Kích thước file | Không file nguồn quá 400 dòng, không hàm quá 60 dòng; lint cảnh báo, review chặn |
| Nợ kỹ thuật | Mọi ngoại lệ phải có ADR hoặc ngày hết hạn trong governance test (mô hình `scripts/governance.test.mjs`) |
| Định dạng | Prettier / gofmt bắt buộc, lint sạch 100% từ ngày đầu; không có "baseline nợ lint" |
| Lịch sử | Commit theo Conventional Commits, PR nhỏ, trunk-based với feature flag; không còn commit tên "Changes" |

### 6.6 Tính di động của hạ tầng

- Một codebase cho ba tier: Shared SaaS, Dedicated Cloud, On-premise (Docker Compose cho triển khai nhỏ, Helm cho Kubernetes).
- Không phụ thuộc dịch vụ quản lý độc quyền cho DB, auth, storage, realtime. Cho phép: PostgreSQL, Redis, MinIO / S3, Keycloak / OIDC bất kỳ, LiveKit.
- AI provider qua gateway; đổi nhà cung cấp (cloud hoặc local model) bằng cấu hình, không sửa mã nghiệp vụ.
- Bằng chứng: bản on-premise cài mới từ tài liệu trong dưới 2 giờ, do người không thuộc đội phát triển thực hiện.

### 6.7 Trải nghiệm và khả năng tiếp cận

- WCAG 2.2 AA, kiểm ở cả sáng và tối; điều hướng bàn phím đầy đủ; tôn trọng reduced-motion.
- Không dữ liệu giả ở bất kỳ màn hình nào; empty state nói rõ bước tiếp theo.
- Vi/En ngang hàng, kiểm tra thiếu khóa i18n trong CI; ngôn ngữ khác gắn beta.
- Tương tác điều hướng cảm nhận dưới 200 ms; spinner là trạng thái lỗi, dùng skeleton.
- Mobile PWA ngang hàng cho luồng cốt lõi; mục tiêu chạm ≥ 44 px.

### 6.8 API-first và hệ sinh thái

- Mọi tính năng có API công khai trước khi có UI; OpenAPI được sinh từ mã và kiểm tra drift trong CI.
- API có phiên bản; thay đổi phá vỡ phải qua chu kỳ deprecation 6 tháng.
- Webhook ký HMAC cho sự kiện domain; SDK TypeScript sinh từ OpenAPI.
- Agent dùng cùng API và cùng mô hình quyền như người; không có "cửa sau" cho AI.

### 6.9 Definition of Done cho một tính năng

Một tính năng chỉ được đánh dấu hoàn thành khi có đủ:

1. API contract trong OpenAPI, stable error code, domain event đã đăng ký.
2. Migration expand/contract, có rollback.
3. Quyền được kiểm ở server, có test permission matrix và test cách ly tenant.
4. Audit + event trong cùng transaction với thay đổi.
5. Idempotency cho lệnh có thể retry, `row_version` cho aggregate có mutate.
6. UI vi/en, sáng/tối, bàn phím, mobile; không mock, không "coming soon".
7. Actor có thể là agent: có attribution, trạng thái, hoàn tác.
8. Metric và log có `tenant_id`, `actor_kind`; alert nếu là đường lệnh quan trọng.
9. Unit + contract + integration + E2E luồng vàng xanh; coverage không giảm.
10. Tài liệu người dùng và runbook vận hành (nếu có thành phần nền).

---

## 7. Kiến trúc mục tiêu

Chi tiết kỹ thuật thuộc Blueprint và ADR trong `uniwork/docs/adr`. Mục này chỉ chốt các quyết định cấp tầm nhìn.

### 7.1 Hình dạng hệ thống

```text
Người dùng / Agent
      │
      ▼
Next.js (apps/web)  ──  packages/views  ──  packages/core (headless)  ──  packages/ui
      │  HTTPS + WebSocket
      ▼
Go modular monolith (server/)
  handler → service → db (sqlc)        ┐
  realtime relay (WebSocket + Redis)   │ một tiến trình, nhiều module,
  worker (outbox, jobs, AI runs)       │ ranh giới module ép bằng arch test
  AI gateway (router, policy, meter)   ┘
      │
      ▼
PostgreSQL (System of Record) · Redis · Object storage (S3/MinIO) · LiveKit (+ Egress)
      │
      ▼
OpenTelemetry → Prometheus / Grafana / Loki (hoặc dịch vụ quản lý tương đương)
```

### 7.2 Quyết định kiến trúc cấp tầm nhìn

| # | Quyết định | Lý do |
|---|---|---|
| V1 | **Go modular monolith**, không microservice cho đến khi có nhu cầu đo được | Một đội nhỏ, cần tốc độ và tính nhất quán; tách sau dễ hơn gộp lại (Blueprint §2.3) |
| V2 | **PostgreSQL là nguồn sự thật duy nhất**; nghiệp vụ nằm trong Go, không trong PL/pgSQL | Kiểm thử đơn vị được, chuyển đổi được, dễ tuyển người |
| V3 | **Không RLS làm hàng rào chính**; cách ly tenant ở tầng service với `tenant_id` bắt buộc trong mọi truy vấn, có arch test và integration test | RLS trong bản cũ tạo 212 policy khó kiểm; tầng service kiểm soát được và không phụ thuộc Supabase. Có thể bật RLS như lớp phòng thủ thứ hai cho tier on-prem |
| V4 | **Sự kiện domain qua outbox** trong cùng transaction; realtime chỉ phát id để client refetch | Không mất sự kiện, cache là nguồn thật, kế thừa mô hình đã đo tải |
| V5 | **AI là bounded context có gateway**: provider registry, model router, prompt registry, tool authorization, usage metering, audit | Đổi nhà cung cấp bằng cấu hình; chi phí đo được theo tenant; on-prem dùng local model |
| V6 | **Agent là actor hạng nhất**: bảng actor phân biệt human / agent, mọi bản ghi có `actor_id` + `actor_kind`, mọi hành động ghi của agent qua đề xuất → xác nhận → thực thi trừ khi policy cho phép tự động ở mức rủi ro thấp | Trực tiếp hiện thực định vị sản phẩm |
| V7 | **Frontend headless**: `core` không biết Next.js; `views` tái sử dụng cho host thứ hai | Đã có trong `uniwork`, giữ |
| V8 | **Một codebase, ba tier triển khai**; cấu hình bằng biến môi trường và adapter, không nhánh mã | Điều kiện của phân khúc 2 và 3 |
| V9 | **OpenAPI là hợp đồng**; SDK và test contract sinh từ đó | API-first, chống drift |
| V10 | **Feature flag** phía server theo tenant | Trunk-based, phát hành dần, pilot có kiểm soát |

### 7.3 Dữ liệu từ bản cũ

Dữ liệu trong `unidigiwork` chủ yếu là dữ liệu kiểm thử và demo (81 tenant, 184 tài khoản, phần lớn từ audit tự động). Quyết định: **không migrate dữ liệu vận hành**. Chỉ xây công cụ import CSV/JSON cho task, thành viên, tài liệu để phục vụ khách hàng pilot muốn chuyển từ bản cũ hoặc từ công cụ khác. Bản cũ được giữ ở chế độ đọc trong 90 ngày sau khi bản mới vào pilot, rồi tắt.

---

## 8. Lộ trình và tiêu chí thoát giai đoạn

Thời lượng tính từ ngày phê duyệt tài liệu. Mỗi giai đoạn chỉ kết thúc khi đủ tiêu chí thoát, không theo lịch.

### Giai đoạn F — Foundation (tháng 1 đến 3): "Dùng nội bộ hằng ngày"

Phạm vi: Identity (OIDC + mật khẩu + MFA), Tenant/Workspace/People, Task đầy đủ (board, list, comment, attachment, view), Meeting với LiveKit + ghi hình, Notification, Audit, AI gateway với Ask UNI có ngữ cảnh và có quyền, Platform admin tối thiểu, OpenTelemetry, CI đầy đủ, triển khai SaaS staging + production.

Tiêu chí thoát:
- Toàn bộ đội UNICOM dùng UNIWORK cho công việc thật ít nhất 4 tuần liên tục; không quay lại công cụ cũ cho task và họp.
- Mọi thanh ở mục 6.1, 6.4, 6.5 có cơ chế ép buộc chạy trong CI.
- k6 5.000 VU trên dataset sinh đạt ngưỡng 6.3.
- 0 màn hình có dữ liệu giả; 0 nút "coming soon".

### Giai đoạn C — Collaboration (tháng 4 đến 6): "Pilot khách hàng có kiểm soát"

Phạm vi: Document cộng tác, Chat, Calendar, Meeting intelligence (transcript, tóm tắt, biến họp thành việc có người duyệt), Billing thật (cổng nội địa + Stripe), Quota, tenant export/delete, trang status, tài liệu người dùng, PWA mobile cho luồng cốt lõi.

Tiêu chí thoát:
- 5 tenant pilot bên ngoài dùng thật ≥ 30 ngày, NPS thu thập, ≥ 3 tenant tiếp tục sau pilot.
- 1 hóa đơn thật thanh toán thành công qua cổng.
- ≥ 20 cuộc họp có transcript và tóm tắt thật, ≥ 50% tóm tắt được người dùng chấp nhận không sửa lớn.
- Pentest bên thứ ba: 0 lỗi High/Critical còn mở.
- Availability đo được ≥ 99,9% trong 60 ngày.

### Giai đoạn A — Agent (tháng 7 đến 9): "Phát hành thương mại SaaS"

Phạm vi: Agent runtime nhận task với pipeline đề xuất → xác nhận → thực thi, tool registry và policy rủi ro, agent trong workflow, Knowledge + Search có quyền (RAG), Insights (home brief, work economics), SSO SAML, webhook và SDK công khai, self-serve đăng ký và thanh toán.

Tiêu chí thoát:
- ≥ 200 lượt agent thực thi task thật ở tenant bên ngoài, tỉ lệ người dùng chấp nhận kết quả ≥ 60%, 0 sự cố agent ghi dữ liệu không qua xác nhận.
- Chi phí AI theo tenant đo được và có cảnh báo ngưỡng; biên lợi nhuận gộp trên gói Team dương.
- ≥ 30 tenant trả phí; churn tháng < 5%.
- SOC 2 Type I hoàn tất hoặc có lịch audit.

### Giai đoạn E — Enterprise & On-premise (tháng 10 đến 12)

Phạm vi: Docker Compose và Helm cho on-premise, Keycloak/OIDC bất kỳ, MinIO, local model qua gateway, backup/restore tài liệu hóa, SCIM, retention policy, dedicated cloud.

Tiêu chí thoát:
- 1 khách hàng on-premise cài đặt từ tài liệu bởi đội của họ trong ≤ 2 giờ, chạy ổn định 30 ngày.
- Diễn tập khôi phục thảm họa đạt RPO/RTO.

### Sau tháng 12 (không cam kết)

Ngôn ngữ my/km/lo rời beta, marketplace agent, host desktop/mobile native, tách microservice đầu tiên nếu có nhu cầu (ứng viên: AI gateway, media processing).

---

## 9. Chỉ số thành công

| Nhóm | Chỉ số | Mục tiêu tháng 9 | Mục tiêu tháng 12 |
|---|---|---|---|
| Sản phẩm | Tenant hoạt động hằng tuần (WAT) | 30 | 100 |
| Sản phẩm | Tỉ lệ người dùng hoạt động hằng ngày / hằng tháng | ≥ 40% | ≥ 45% |
| Agent | Tỉ lệ task có agent tham gia | ≥ 15% | ≥ 30% |
| Agent | Tỉ lệ kết quả agent được chấp nhận | ≥ 60% | ≥ 75% |
| Niềm tin | Sự cố rò dữ liệu chéo tenant | 0 | 0 |
| Niềm tin | Sự cố agent ghi không qua xác nhận | 0 | 0 |
| Vận hành | Availability | ≥ 99,9% | ≥ 99,95% |
| Vận hành | API p95 đọc | ≤ 200 ms | ≤ 150 ms |
| Kỹ thuật | Thời gian CI | ≤ 10 phút | ≤ 8 phút |
| Kỹ thuật | Thời gian từ merge đến production | ≤ 1 giờ | ≤ 30 phút |
| Kinh doanh | Tenant trả phí | 30 | 100 |
| Kinh doanh | Biên gộp sau chi phí AI | > 0 | ≥ 60% |

---

## 10. Rủi ro và giả định

| Rủi ro | Xác suất | Tác động | Giảm thiểu |
|---|---|---|---|
| Lặp lại lỗi cũ: bề rộng vượt chiều sâu | Cao | Cao | DoD mục 6.9 là điều kiện merge; lộ trình theo tiêu chí thoát, không theo lịch; chủ sở hữu sản phẩm có quyền từ chối phạm vi |
| Chi phí AI ăn hết biên | Trung bình | Cao | Metering theo tenant từ ngày đầu; ngưỡng cứng theo gói; ưu tiên model rẻ cho tác vụ rẻ qua router |
| Đội nhỏ, kiến thức tập trung ở ít người | Cao | Cao | ADR và `CLAUDE.md` là bộ luật; mọi quy tắc có test; onboarding kỹ sư mới trong 1 ngày là chỉ số |
| Agent gây lỗi nghiệp vụ ở khách hàng | Trung bình | Rất cao | Đề xuất → xác nhận → thực thi; hoàn tác; policy fail-closed; giới hạn hành động tự động ở mức rủi ro thấp |
| Đối thủ lớn ra tính năng agent tương tự | Cao | Trung bình | Khác biệt nằm ở mô hình quyền và bản ngữ, khó sao chép nhanh; tốc độ phát hành |
| Yêu cầu on-premise đến sớm hơn lộ trình | Trung bình | Trung bình | Kiến trúc đã di động từ ngày đầu; có thể kéo giai đoạn E lên nếu có hợp đồng |
| Thay đổi pháp lý về dữ liệu và AI tại Việt Nam | Trung bình | Trung bình | Data residency VN, export/delete, audit sẵn; theo dõi Luật Dữ liệu và văn bản hướng dẫn |

Giả định: (1) đội có tối thiểu 4 kỹ sư full-stack, 1 thiết kế sản phẩm, 1 chủ sở hữu sản phẩm toàn thời gian; (2) ngân sách hạ tầng và AI cho 12 tháng được duyệt; (3) UNICOM là khách hàng số 0 và dùng sản phẩm hằng ngày.

---

## 11. Quản trị dự án

- **Tài liệu này** là nguồn sự thật cho tầm nhìn, phạm vi và thanh chất lượng. Thay đổi cần PR và phê duyệt của chủ sở hữu sản phẩm.
- **Blueprint và ADR** (`uniwork/docs/adr`) là nguồn sự thật kỹ thuật. Mọi "không bao giờ" và "chỉ được" phải có ADR; governance test kiểm tra đánh số và trạng thái.
- **`CLAUDE.md` / `AGENTS.md`** là bộ luật cho người và agent lập trình; mọi quy tắc phải có lệnh, test hoặc lint kèm theo.
- **Nhịp:** sprint 2 tuần; review lộ trình mỗi tháng theo tiêu chí thoát; retro sau mỗi giai đoạn; post-mortem cho mọi sự cố Sev 1 và 2.
- **Quyền quyết định:** chủ sở hữu sản phẩm quyết phạm vi; kiến trúc sư trưởng quyết ADR; không ai được bỏ qua DoD.
- **Tài liệu kế tiếp cần viết** từ tài liệu này: PRD cho từng bounded context giai đoạn F, Threat model, Runbook vận hành, Kế hoạch kiểm thử tải, Kế hoạch pilot.

---

## Phụ lục A. Bản đồ kế thừa từ `unidigiwork`

| Tài sản cũ | Xử lý | Đích đến |
|---|---|---|
| `docs/architecture/UNIWORK_SAAS_ARCHITECTURE_BLUEPRINT_V1.0.md` | Kế thừa các chương 1, 2, 5, 6, 9, 11, 12, 14, 17, 18, 19; viết lại chương 20 đến 23 cho Go | Blueprint v2 trong `uniwork/docs` |
| `PROJECT_ARCHITECTURE_RULES.md` (20 quy tắc) | Chuyển thành ADR có test | `uniwork/docs/adr` |
| Quy tắc quản trị AI (ADR propose/confirm/execute, permission-aware context, WEE-2 governance) | Kế thừa nguyên vẹn | AI bounded context |
| Ma trận cách ly tenant, ma trận CRUD, kịch bản tamper JWT | Viết lại cho API mới, giữ nguyên ma trận | `uniwork/e2e`, integration test Go |
| Stable error catalogue, domain event catalogue | Kế thừa và sinh từ mã | OpenAPI + event registry |
| Work economics, cohort proof, work products | Kế thừa khái niệm; triển khai ở giai đoạn A | Reporting & AI context |
| IA V2, mobile 5 tab, `navigation.ts` là SSOT | Kế thừa | `packages/core/navigation` |
| Bản dịch vi/en trong `i18n.tsx` | Rà soát và chuyển vào `packages/core/i18n/locales` theo glossary trong `conventions.md` | i18n |
| Mã TypeScript route, component, server function | **Không port.** Chỉ dùng làm tham chiếu hành vi | — |
| 312 hàm PL/pgSQL | **Không port.** Nghiệp vụ viết lại trong Go service | — |
| Dữ liệu vận hành | Không migrate; công cụ import cho pilot | — |

## Phụ lục B. Tóm tắt Gap Register cũ và cách bản mới đóng

| Gap cũ | Cách đóng trong bản mới |
|---|---|
| G1 AI Task Execution chưa từng chạy | Giai đoạn A, tiêu chí thoát ≥ 200 lượt thật |
| G2 Meeting Intelligence không có dữ liệu thật | Giai đoạn C, ≥ 20 cuộc họp có transcript |
| G3 Thanh toán không hoạt động | Giai đoạn C, 1 hóa đơn thật |
| G4 Email Hub là email nội bộ | Loại khỏi phạm vi; tích hợp email thật sau |
| G5 26 case cách ly fail-closed quá mức | Kiểm quyền ở service, có permission matrix test |
| G6 Nút "coming soon" | Cấm bởi DoD |
| G7 Ghi hình = 0 | Giai đoạn F với LiveKit Egress |
| G8 Không đo được chi phí AI | Gateway metering từ giai đoạn F |
| G9 Push/PWA chưa chứng minh | Giai đoạn C |
| G14 Không có observability | OpenTelemetry từ giai đoạn F, tiêu chí thoát |

## Phụ lục C. Thuật ngữ

- **Tenant / Tổ chức:** đơn vị khách hàng, ranh giới dữ liệu và thanh toán.
- **Workspace / Không gian làm việc:** đơn vị cộng tác bên trong tổ chức.
- **Actor:** chủ thể thực hiện hành động; `human` hoặc `agent`.
- **Agent:** nhân sự AI có danh tính, quyền, trạng thái và lịch sử hành động trong hệ thống.
- **Đề xuất → Xác nhận → Thực thi:** mọi hành động ghi của agent tạo đề xuất; người có quyền xác nhận; hệ thống thực thi và ghi audit.
- **Outbox:** bảng sự kiện ghi cùng transaction với thay đổi dữ liệu, worker phát đi sau.
- **Work Product:** hợp đồng có phiên bản mô tả một loại công việc AI có thể hoàn thành, kèm tiêu chí nghiệm thu.
- **Tier A / B / C:** Shared SaaS / Dedicated Cloud / On-premise.
