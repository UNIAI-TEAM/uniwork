# Bản đồ tham chiếu bản cũ (`unidigiwork`)

> **Trạng thái:** in-progress · **Repo cũ:** `../unidigiwork` (Lovable, TanStack Start + Supabase). **Chỉ dùng để xem hành vi và tri thức. Không port mã.**

Luật khi tham chiếu:

1. Đọc để hiểu *người dùng đã được hứa gì* và *quy tắc nghiệp vụ nào đã được nghĩ kỹ*.
2. Không copy TypeScript, không copy PL/pgSQL, không copy schema Supabase. Data model của
   UniWork tuân ADR 0001/0002 và spec mới.
3. Số liệu trong audit cũ (`docs/audit/*`) cho biết tính năng nào chưa từng chạy thật; đừng
   coi "có route" là "có tính năng".
4. `scripts/no-usf-leak.test.mjs` chặn rò tên dự án nguồn; áp dụng tinh thần đó cho
   `unidigiwork`: không để lại tên bảng/hàm Supabase trong mã mới.

## Tài liệu định hướng đáng đọc trước tiên

| Tài liệu cũ | Dùng cho |
| --- | --- |
| `docs/architecture/UNIWORK_SAAS_ARCHITECTURE_BLUEPRINT_V1.0.md` | Chương 1, 2, 5, 6, 9, 11, 12, 14, 17, 18, 19 là tri thức domain; chương 20–23 (Java) bỏ |
| `docs/architecture/PROJECT_ARCHITECTURE_RULES.md` | 20 quy tắc; nguồn cho ADR 0007–0010 |
| `docs/architecture/manifests/DOMAIN_OWNERSHIP_MANIFEST.md` | 16 bounded context và ranh giới |
| `docs/architecture/contracts/DOMAIN_EVENT_CATALOGUE.md`, `STABLE_ERROR_CATALOGUE.md` | Tên sự kiện và mã lỗi để giữ liên tục |
| `docs/product/UNIWORK_INFORMATION_ARCHITECTURE_V2.md` | Điều hướng theo hành vi, mobile 5 tab |
| `docs/audit/UNIWORK_FEATURE_INVENTORY.md`, `UNIWORK_GAP_REGISTER.md`, `UNIWORK_MVP1_DECISION.md` | Cái gì thật, cái gì chưa |
| `docs/architecture/testing/TENANT_ISOLATION_TEST_MATRIX.md` | Ma trận 173 kịch bản để viết lại test |

## Theo tính năng trong Roadmap

| ID | Tính năng | Route / UI cũ | Server cũ | Tài liệu cũ | Ghi chú kế thừa |
| --- | --- | --- | --- | --- | --- |
| F-01 | Identity | `src/routes/auth.tsx`, `invite.$token.tsx` | Supabase Auth; `src/platform/identity.ts` | Blueprint §13 | Chỉ kế thừa yêu cầu (HIBP, JWT tamper cases trong `tests/runtime`) |
| F-02 | Gói / entitlement / quota / billing | `_authenticated/billing.tsx`, `admin.plans.tsx`, `admin.quota.tsx`, `pricing.tsx` | `src/lib/api/billing.functions.ts`, `admin-plans.functions.ts`, `quota-export-processor.server.ts`, `src/features/billing`, `src/contracts/billing` | Blueprint §18; `tests/integration/02_quota_gate.sql`, `04_quota_meter_matrix.sql`, `05_quota_exceeded_per_rpc.sql`, `08_change_subscription_entitlements.sql` | Mô hình entitlement + quota fail-closed và bộ test SQL là tài sản; Stripe chưa từng chạy |
| F-03 | People / hồ sơ / phòng ban | `_authenticated/people.tsx`, `people_.$id.tsx`, `workspace.members.tsx`, `workspace.invite.tsx` | `people.functions.ts`, `tenants.functions.ts`, `workspace-invites.functions.ts` | `docs/audit/UNIWORK_UI_CONTROL_MATRIX.md` (6 nút chết ở /people) | Xuất CSV, tìm kiếm; bỏ các nút "coming soon" |
| F-04 | Workspace | `workspace.$id.tsx`, `workspace.settings.tsx`, `workspace.tags.tsx` | `src/lib/api/tenant-context.functions.ts`, `active-tenant.*` | Blueprint §5.2 (Tenant ≠ Workspace) | Tags/nhãn workspace |
| F-05 | Tasks | `routes/tasks.tsx`, `tasks_.$id.tsx`, `_authenticated/home.tsx` (My Work) | `tasks.functions.ts`, `task-views.functions.ts`, `src/lib/tasks-storage.ts`, `src/lib/home-task-kind.ts` | `docs/audit/UNIWORK_CRUD_REALITY_MATRIX.md` (TASK-* 17/17), `docs/architecture/work-execution/*` | Saved views, idempotency + row_version, home brief; comments/attachments chưa từng có dữ liệu |
| F-06 | Meetings | `routes/meeting.tsx`, `meeting_.$id.tsx`, `meeting_.history.tsx`, `src/components/meeting/*` | `livekit.server.ts`, `meeting-*.functions.ts`, `meeting-transcription.server.ts`, `recording-storage.server.ts` | `docs/architecture/adr/ADR-1E-001-livekit-conferencing.md`, `docs/meeting/MEETING_INTELLIGENCE_V1.md`, `docs/performance/LIVEKIT_CAPACITY_PLAN.md`, `ADR_MEETING_AI_PROPOSE_NOT_EXECUTE.md` | Token server-side, quyền join, capacity plan; UniWork đã vượt bản cũ về tính năng |
| F-07 | Notifications | `_authenticated/notifications.tsx`, `notifications.$id.tsx`, `src/components/push-devices-panel.tsx`, `public/sw-push.js` | `notifications.functions.ts`, `notif-prefs.functions.ts`, `push.functions.ts`, `push-dispatch.server.ts`, `webpush.server.ts`, `src/lib/notifications-data.ts` | Blueprint §12; `PERF-001/003/004` trong `docs/performance/OPTIMIZATION_FIX_LEDGER.md` (bỏ firehose realtime) | Kênh theo user, badge unread 1 RPC, VAPID push |
| F-08 | Audit + outbox + sự kiện | `workspace.audit.tsx`, `admin.trace.tsx` (4.387 dòng, không noi theo) | `outbox-processor.server.ts`, `audit.functions.ts`, `src/lib/audit-pagination.ts`, `src/contracts/events` | Blueprint §12; `tests/integration/03_outbox_idempotency.sql`; `docs/performance/OBSERVABILITY_GAPS.md` | Audit bất biến, correlation id, outbox 7×25/25 stress; UI trace phải nhỏ |
| F-09 | AI Gateway / Ask UNI | `routes/ai.tsx`, `src/components/ai/*`, command palette ⌘J | `ai-gateway.server.ts`, `ai-copilot.*`, `ai-context.*`, `ai-usage.server.ts`, `src/domain/ai-policy/model-policy.ts`, `src/domain/ai-context/*` | `docs/ai/AI_CONTEXT_ENGINE_V1.md`, `UNI_WORKSPACE_COPILOT_V1.md`, `ADR_AI_PERMISSION_AWARE_CONTEXT.md`, `tests/ai-context/*.json` | Permission-aware context, model policy allowlist, test cases relevance/security |
| F-10 / A-01 | Agent actor + runtime | `_authenticated/ai-workforce.tsx`, `ai-market.*`, `admin.ai-actions.tsx`, task detail AI panel | `ai-tasks.*`, `ai-actions.*`, `ai-governance.server.ts`, `work-execution.server.ts`, `work-quality.server.ts`, `src/domain/work-execution/plan-schema.ts`, `src/domain/ai-governance`, `src/domain/ai-actions` | `ADR_AI_ACTION_PROPOSE_CONFIRM_EXECUTE.md`, `docs/ai/AI_ACTION_GOVERNANCE_V1.md`, `WEE2_AI_WORKER_GOVERNANCE.md`, `docs/architecture/work-execution/*`, `src/lib/architecture/ai-task-execution.test.ts` | Bất biến: AI kết thúc ở WAITING_REVIEW/FAILED; ACCEPTED chỉ người; plan schema Zod; tool registry + risk |
| F-11 | Admin / observability / flags | `_authenticated/admin.*.tsx` | `admin*.functions.ts`, `admin-access.server.ts`, `cron-auth.server.ts`, `src/lib/metrics.ts`, `src/lib/error-capture.ts` | `docs/performance/*` (k6 tier 50→1000, bundle audit), `docs/architecture/ci/QUALITY_GATES.md` | Ngưỡng hiệu năng, danh sách metric còn thiếu |
| F-12 | Chat | `_authenticated/chat.tsx`, `chat_.$channelId.tsx`, `src/components/chat/*` | `chat.functions.ts`, `src/lib/chat-task-link.ts` | `docs/performance/REALTIME_SUBSCRIPTION_MAP.md` | Liên kết chat ↔ task; UniWork đã có nhiều hơn |
| C-01 | Documents | `_authenticated/documents.tsx`, `documents.$id.tsx` | `documents.*`, `src/lib/documents-storage.ts`, `src/contracts/documents`, `src/sdk/documents` | `tests/integration/10_document_access_isolation.sql`; Blueprint §15 (storage abstraction) | Phiên bản, share, access log; DB chỉ lưu `bucket` + `object_key` |
| C-02 | Calendar | `_authenticated/calendar.tsx`, `workflows_.calendar.tsx` | `calendar.functions.ts`, `src/lib/ics.ts` | — | ICS đã có trong UniWork meetings |
| C-08 | Mobile (app Expo, ADR 0011) | `_authenticated/m.tsx`, `m/*`, `public/manifest`, `src/components/mobile/*` | `push-client.ts` | `docs/product/UNIWORK_INFORMATION_ARCHITECTURE_V2.md` §3, `.lovable/plan/uniwork-mobile-pwa-*.md` | Chỉ kế thừa IA 5 tab và trang More; `/m/*`, service worker, push client **không** mang sang. Kiến trúc lấy từ `../usf/apps/mobile` |
| A-03 | Workflows | `workflows*.tsx`, `src/components/workflow/*` | `workflows.functions.ts`, `workflow-agents.functions.ts`, `src/domain/workflow-agents` | — | Trigger/step/run có dữ liệu thật (12 run) |
| A-04 | Knowledge / Search | `knowledge*.tsx`, `_authenticated/search.tsx`, `src/components/work-graph/*` | `search-universal.*`, `knowledge.functions.ts`, `work-graph.*`, `src/domain/work-graph` | `docs/search/UNIVERSAL_SEARCH_V2.md` | Work graph nodes/edges, search scope |
| A-05 | Insights / Work economics | `_authenticated/dashboard.tsx`, `reports*.tsx`, `admin.economics.tsx`, `admin.cohorts.tsx`, `admin.proof.tsx` | `home-brief.*`, `dashboard.*`, `reports*.`, `work-economics.*`, `sell-work-*.functions.ts`, `src/domain/work-economics`, `sell-work` | `docs/architecture/work-economics/*`, `SWP1_SELL_WORK_PRODUCTIZATION.md`, `tests/integration/11_we3_economics_guards.sql`, `12_harden_sellwork1_guards.sql` | Rate có phiên bản, độ tin cậy số liệu, ngưỡng cohort; home brief "không có dữ liệu" thay vì 0 |
| A-06 | SSO | — | — | Blueprint §13.2 (Keycloak) | Chỉ yêu cầu |
| E-* | On-premise | — | `src/platform/adapters/*` (identity/storage/realtime) | Blueprint §4, §15, §16, §23 | Adapter pattern đã có trong UniWork qua `packages/core/platform` |

## Cái gì tuyệt đối không mang sang

- Email Hub nội bộ (`email*.tsx`, `emails.functions.ts`, `email-draft.server.ts`).
- AI Market dạng marketplace (`ai-market.*`).
- Blog/CMS công khai (`blog*.tsx`, `blog.functions.ts`).
- 312 hàm PL/pgSQL và 212 policy RLS: nghiệp vụ viết lại trong Go service.
- `admin.trace.tsx` như một khối 4.387 dòng.
- Bất kỳ số liệu mock nào (`src/lib/coming-soon.ts`, `notifyComingSoon`).
