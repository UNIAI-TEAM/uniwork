# UniWork Base Port — Pha 4 (Tầng 2 core: viết lại theo domain uniwork)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa `packages/core` lên khuôn usf ở những chỗ mã hoá domain — API endpoints qua `parseWithFallback`, types tách theo domain, paths có test nhất quán, permissions hai tầng org/workspace, auth store Zustand, realtime provider trên `ws-client.ts`, và `NavigationAdapter` để guard workspace rời `next/navigation` — **mà màn hình hiện tại vẫn chạy nguyên** (13/13 e2e là cổng của mọi task).

**Architecture:** Mỗi task giữ API công khai mà views đang gọi (`useSession`, `useTasks`, `useWorkspaceEvents`…) và thay lõi bên dưới. Không dựng lại màn hình nào — đó là Pha 5. Task cuối gỡ đường WS tạm `?token=` ở server vì FE đã nói protocol usf.

**Tech Stack:** React 19 · TanStack Query 5 · Zustand 5 · zod 4 · Vitest 4 · Next 16 (chỉ trong `apps/web/platform`).

**Spec:** `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md` §7
**Plan trước:** `…-phase-3.md` (WS server nhận cả `?token=` lẫn frame `auth`; `SlugResolver` đang `nil`).

## Global Constraints

- Ranh giới là lỗi lint: `core` không `react-dom`/`localStorage`/`process.env`; `views` không `next/*`; `ui` không `@uniwork/core`.
- **Mọi response API đi qua `parseWithFallback`** với zod schema *lenient* (enum để `z.string()`), và mỗi endpoint có **malformed-response test**.
- Query key workspace-scoped phải chứa `wsId`. Hook cần workspace nhận `wsId` qua tham số.
- WS chỉ invalidate/patch Query cache; **không** mirror payload server vào Zustand.
- `vi` là locale gốc; `parity.test.ts` giữ.
- Comment code tiếng Anh. Sau mỗi task: `pnpm typecheck && pnpm test && pnpm lint`; task chạm runtime: **13/13 e2e**.

## Khảo sát (2026-08-25) — điều plan dựa vào

- `paths.workspace(orgSlug, wsSlug)` **đã hai tầng**; thiếu `isGlobalPath` + `consistency.test.ts`.
- `auth`: token trong memory + refresh cookie httpOnly (XSS-safe hơn usf) — **giữ mô hình**, chỉ thay `cachedUser`+listener tự chế bằng Zustand store; `useSession()` giữ chữ ký.
- `api/client.ts` 117 dòng: transport + 4 hàm auth; hooks gọi `api.request(path, {schema})` với `schema.parse` — **ném lỗi khi drift** (trắng màn) — đây là thứ `parseWithFallback` sửa.
- `useWorkspaceEvents` tự mở `WebSocket` với `?workspace=&token=`; dùng ở 2 view. `ws-client.ts` (đã port) gửi `workspace_slug` + frame `auth`.
- Guard workspace nằm trong `apps/web/app/[orgSlug]/[workspaceSlug]/layout.tsx` với `useRouter/usePathname/useParams` — 14 chỗ `useRouter` toàn `apps/web`, views sạch.
- `views` chưa kiểm quyền ở đâu (chỉ hiển thị `m.role`) → consumer đầu tiên của permissions: nút mời thành viên và xoá task/meeting.
- Slug workspace chỉ duy nhất **trong org** → WS resolver nhận composite `"{orgSlug}/{wsSlug}"`.

## Bản kê file

| Task | Tạo/sửa |
| --- | --- |
| 1 | `core/types/{user,organization,workspace,invitation,task,meeting,events,index}.ts` |
| 2 | `core/api/http.ts` (từ `client.ts`), `core/api/endpoints/{auth,organizations,workspaces,invitations,tasks,meetings,onboarding}.ts`, `core/api/endpoints/*.test.ts`, `core/api/index.ts`; hooks trỏ sang endpoints |
| 3 | `core/paths/{paths.ts (+isGlobalPath), consistency.test.ts}`; `server/internal/service/reserved_slugs.json` nếu thiếu slug |
| 4 | `core/permissions/{types,rules,rules.test,use-current-member,use-resource-permissions,index}.ts`; consumer ở `views/workspace/members-view.tsx`, `views/tasks/task-detail-view.tsx` |
| 5 | `core/auth/{store,store.test,hooks}.ts`; `core/navigation/store.ts`, `core/modals/store.ts` (copy usf) |
| 6 | `views/navigation/{types,context,app-link,click-intent,index}.ts(x)`; `apps/web/platform/navigation.tsx`; `views/layout/{use-dashboard-guard,dashboard-guard}.ts(x)`; web layout dùng guard |
| 7 | `core/realtime/{provider,hooks,use-realtime-sync,use-realtime-sync.test,index}.ts(x)`; `server/internal/handler/ws.go` (resolver composite, gỡ `?token=`) |
| 8 | `core/platform/core-provider.tsx`; `apps/web/app/providers.tsx` |

---

## Task 1: Tách `types/index.ts` theo domain + thu hẹp `WSEventType`

- [ ] **Step 1 (đỏ):** Test `types/index.test.ts` đã có — thêm case: `import { TaskSchema } from "./task"` và `WorkspaceEventSchema.parse({type:"task.created", payload:{}})` xanh nhưng `type: 42` đỏ. Chạy → FAIL vì file chưa tồn tại.
- [ ] **Step 2:** Tách: `user.ts` (User, SessionResponse), `organization.ts`, `workspace.ts` (Workspace, Member, PendingInvitation), `task.ts` (TaskKind/Status/Priority/Task/TaskComment — enum giữ `z.enum` cho **request**, nhưng response dùng `z.string()` lenient theo luật API Compatibility), `meeting.ts`, `events.ts`:
```ts
export const WS_EVENT_TYPES = ["task.created","task.updated","task.deleted","comment.created","meeting.created","meeting.updated","meeting.deleted"] as const;
export type WSEventType = (typeof WS_EVENT_TYPES)[number];
export const WorkspaceEventSchema = z.object({ type: z.string(), payload: z.record(z.string(), z.string()).optional() });
```
`index.ts` chỉ re-export. `package.json` exports thêm `"./types/*": "./types/*.ts"`.
- [ ] **Step 3:** `pnpm typecheck && pnpm test` xanh. Commit `refactor(core): split types by domain`.

---

## Task 2: `api/http.ts` + `api/endpoints/` + `parseWithFallback` + malformed tests

**Interfaces:** `request<T>(path, {method, body, schema, fallback, endpoint})` → luôn trả `T` (fallback khi drift); `ApiError` giữ; `refreshSession/login/registerUser/logout` chuyển sang `endpoints/auth.ts`.

- [ ] **Step 1 (đỏ):** `endpoints/tasks.test.ts`: mock `fetch` trả `{ tasks: [{ id: 1 }] }` (sai kiểu) → `listTasks(wsId)` phải trả `[]` **và không ném**; và trả `{tasks:[{…hợp lệ, status:"archived"}]}` → status lạ vẫn qua (lenient). FAIL vì module chưa có.
- [ ] **Step 2:** `git mv api/client.ts api/http.ts`; trong `request`, thay `schema.parse(data)` bằng `parseWithFallback(data, schema, fallback, {endpoint})`; `schema`+`fallback` bắt buộc đi cặp (kiểu TS ép). Set `setSchemaLogger(createLogger("api"))` ở `core-provider` (Task 8) — mặc định noop cho test.
- [ ] **Step 3:** Viết `endpoints/{auth,organizations,workspaces,invitations,tasks,meetings,onboarding}.ts` — mỗi hàm = path + method + schema + fallback + `endpoint: "GET /api/v1/…"`. Response schema đặt **cạnh endpoint** (không trong hooks). `api/index.ts` re-export `ApiError`, `errorCode`, `parseWithFallback`, `WSClient`, và `* as endpoints`.
- [ ] **Step 4:** Hooks (`auth/tasks/meetings/workspaces/organizations/onboarding`) gọi endpoints; **không đổi chữ ký hook**. Xoá schema response khỏi hooks.
- [ ] **Step 5:** Malformed-response test cho **mọi** endpoint (một file test/domain, mỗi hàm ≥1 case rác). `client.test.ts` cũ (refresh 401 single-flight) đổi tên `http.test.ts`, giữ nguyên case.
- [ ] **Step 6:** `pnpm typecheck && pnpm test && pnpm lint`; e2e 13/13. Commit `feat(core): endpoints behind parseWithFallback; UI survives API drift`.

---

## Task 3: `paths` — `isGlobalPath` + test nhất quán với route thật

- [ ] **Step 1 (đỏ):** `paths/consistency.test.ts`:
  - quét `apps/web/app/**/page.tsx` (đọc đĩa qua `process.cwd()`+`../../apps/web/app`), chuẩn hoá `[orgSlug]/[workspaceSlug]/tasks/[taskId]` → `/:org/:ws/tasks/:id`; mỗi route phải có builder trong `paths` sinh ra đúng mẫu đó (probe bằng giá trị `__org__/__ws__/__id__`), và ngược lại mỗi builder phải có route.
  - mỗi tiền tố global (`/login,/register,/onboarding,/invitations,/workspaces,/invite`) → segment đầu ∈ `RESERVED_SLUGS`.
  - `isGlobalPath("/login")===true`, `isGlobalPath("/acme/team/tasks")===false`.
- [ ] **Step 2:** Thêm `isGlobalPath` + `GLOBAL_PREFIXES` vào `paths.ts`. Nếu reserved thiếu slug → sửa `server/internal/service/reserved_slugs.json`, `pnpm generate:reserved-slugs`, commit file sinh.
- [ ] **Step 3:** Xanh; commit `test(core): paths stay in step with the app's routes`.

---

## Task 4: `permissions` hai tầng

**Interfaces:** `PermissionContext { userId: string|null; orgRole: OrgRole|null; wsRole: MemberRole|null }`; `Decision { allowed, reason, message }` (port `types.ts` usf, thêm reason `not_org_member`); rules: `canInviteMembers(ctx)`, `canManageMembers(ctx)`, `canCreateWorkspaceInOrg(ctx)`, `canDeleteTask(task, ctx)`, `canDeleteMeeting(meeting, ctx)`; hooks `useCurrentMember(wsId)`, `useOrgMembership(orgId)`, `useWorkspacePermissions(wsId)`, `useTaskPermissions(task, wsId)`.

- [ ] **Step 1 (đỏ):** `rules.test.ts` theo bảng: owner/admin ws → invite ALLOW; member → `not_admin_role`; không member → `not_member`; chưa đăng nhập → `not_authenticated`; xoá task: người tạo hoặc admin; org owner tạo workspace, org member thì `not_org_member`/`not_admin_role`.
- [ ] **Step 2:** Viết `types.ts`/`rules.ts` (thuần, không React). Đối chiếu gate Go trong `server/internal/service/workspace.go` (`InviteMany` yêu cầu gì) — rule FE phải **mirror** backend, ghi số dòng tham chiếu như usf.
- [ ] **Step 3:** Hooks trên `useCurrentMember` (từ `useMembers(wsId)` + `useSession`). Consumer: `members-view.tsx` ẩn/disable form mời theo `canInviteMembers` với tooltip `decision.message`; `task-detail-view.tsx` nút xoá theo `canDeleteTask`.
- [ ] **Step 4:** Test views cho 2 consumer (mock store theo hình dạng callable-store). e2e 13/13. Commit `feat(core): two-tier permissions with Decision reasons`.

---

## Task 5: `auth/store.ts` Zustand + `navigation`/`modals` store

- [ ] **Step 1 (đỏ):** `auth/store.test.ts`: `initialize()` gọi `refreshSession` (mock) → `user` set, `status` `authed`; refresh fail → `anon`; `logout()` xoá user và gọi `qc.clear` qua callback; `setUser` cập nhật; selector trả reference ổn định.
- [ ] **Step 2:** `createAuthStore({ api: endpoints.auth, onLogout })` + `useAuthStore`; `hooks.ts` giữ `useSession/useLogin/useRegister/useLogout/setSessionUser` như wrapper mỏng; `resolve.ts`/`use-dashboard-guard` đọc từ store. Token vẫn ở `api/session.ts` (memory).
- [ ] **Step 3:** Copy `usf core/navigation/store.ts`, `modals/store.ts` (đổi khoá persist `uniwork_navigation`, dùng `createPersistStorage` từ platform). Exports.
- [ ] **Step 4:** Xanh + e2e (onboarding-smoke phụ thuộc session). Commit `feat(core): zustand auth store behind the existing session hooks`.

---

## Task 6: `views/navigation` adapter + guard workspace rời `next/navigation`

- [ ] **Step 1:** Port `types.ts` (bỏ `openInNewTab` desktop, giữ `push/replace/back/pathname/searchParams/getShareableUrl/prefetch/canGoBack?`), `context.tsx`, `app-link.tsx`, `click-intent.ts`, `index.ts` từ usf. Test `app-link.test.tsx` (click thường → `push`; cmd-click → không push).
- [ ] **Step 2:** `apps/web/platform/navigation.tsx` = `WebNavigationProvider` (Suspense + `useRouter/usePathname/useSearchParams`); mount trong `apps/web/app/providers.tsx`.
- [ ] **Step 3 (đỏ):** `views/layout/use-dashboard-guard.test.ts`: anon → `replace(login?next=…)`; onboarded_at null → `/onboarding`; lỗi workspace → `/workspaces`; đủ điều kiện → trả `{user, workspace}`. Mock `useNavigation` (không mock `next/*` — luật).
- [ ] **Step 4:** Viết `use-dashboard-guard.ts` (+`DashboardGuard`) trên `useNavigation()` + `useAuthStore` + `useWorkspace(org, ws)`; web layout chỉ còn: đọc `useParams`, bọc `DashboardGuard`, render `AppShell`. `WelcomeAfterOnboarding.onOpenTask` dùng `useNavigation().push`.
- [ ] **Step 5:** `grep -c useRouter apps/web/app` giảm ≥1; lint views sạch; e2e 13/13. Commit `feat(views): navigation adapter; workspace guard no longer touches next/navigation`.

---

## Task 7: Realtime provider trên `ws-client.ts` + gỡ đường `?token=` ở server

**Interfaces:** `WSProvider({ wsUrl, authStore, workspaceSlug: "org/ws" })`; `useWSEvent(type, handler)`; `useRealtimeSync(wsId)`; `useWorkspaceEvents(wsId)` giữ tên, thành wrapper → `useRealtimeSync`.

- [ ] **Step 1 (đỏ):** `use-realtime-sync.test.ts`: giả lập frame `task.updated {task_id}` → `invalidateQueries(["tasks", wsId])` **và** `["task", id]`; `meeting.created` → `["meetings", wsId]`; frame lạ → không gì; **không** ghi vào store nào.
- [ ] **Step 2:** Viết `provider.tsx` (WSClient từ `runtimeConfig().wsUrl + "/api/v1/ws"`, `setAuth(token, "org/ws")`, reconnect khi token đổi), `hooks.ts` (`useWSEvent/useWSReconnect`), `use-realtime-sync.ts` (bảng event → keys; `onReconnect` → invalidate toàn bộ keys của ws). `index.ts`.
- [ ] **Step 3 (server):** `ws.go`: `resolveSlug` nhận `"{org}/{ws}"` → `Workspaces.GetBySlugs` (cần userID? dùng query không kiểm quyền — membership kiểm ngay sau); **xoá** nhánh `?token=` và alias `?workspace=` trong `hub.go` (đường tạm của Pha 3). Test Go: `HandleWebSocket` với `workspace_slug=org/ws` + frame auth → `auth_ack`.
- [ ] **Step 4:** `WSProvider` mount trong web workspace layout (trong `DashboardGuard`, có `workspace`). Hai view gọi `useWorkspaceEvents(wsId)` không đổi.
- [ ] **Step 5:** Restart server; e2e 13/13; kiểm tay: tạo task ở tab A, tab B cập nhật không reload. Commit `feat(realtime): WSProvider on ws-client; server drops the query-token path`.

---

## Task 8: `CoreProvider` + `AuthInitializer`

- [ ] **Step 1:** `core/platform/core-provider.tsx`: gom `QueryClientProvider` + `AuthInitializer` (gọi `useAuthStore.initialize()` một lần) + `setSchemaLogger` + `initI18n`. Không `next/*`. `apps/web/app/providers.tsx` = `runtime-config` import → `<CoreProvider><WebNavigationProvider>…`.
- [ ] **Step 2:** Test `core-provider.test.tsx`: mount → `initialize` gọi đúng 1 lần (StrictMode gọi effect 2 lần → phải idempotent).
- [ ] **Step 3:** Cổng ra đầy đủ + e2e. Cập nhật `CLAUDE.md` nháp: mục *State Rules* + *API Compatibility* (đã đúng thực tế). Commit. Ghi "Ghi chép thực thi".

## Cổng ra Plan 4

`pnpm typecheck && pnpm test && pnpm lint` · `go test ./...` · leak gate · **13/13 e2e** · `grep -rn "schema.parse(" packages/core/api packages/core/*/hooks.ts` = 0 · `grep -c "next/navigation" apps/web/app/[orgSlug]/[workspaceSlug]/layout.tsx` = 0 ngoại trừ `useParams`.

---

## Ghi chép thực thi (2026-08-25)

Hoàn tất trên `feat/base-port-phase-0-1`, 10 commit. Mọi cổng ra xanh: typecheck · **262 test đơn vị**
(core 210 · ui 87 · views 46, cộng dồn) · lint · Go test · **13/13 e2e** sau mỗi task · `schema.parse` trong
api/hooks = 0 · layout workspace chỉ còn `useParams` từ `next/navigation` · log server xác nhận FE bắt tay WS
bằng frame `auth` + `workspace_slug=org/ws`.

### Điều plan đoán sai hoặc phải quyết tại chỗ

**1. Hình dạng dữ liệu đổi lan ra views nhiều hơn dự kiến.** Chuyển hooks sang endpoints làm query data
thành giá trị domain (`Task[]`) thay vì phong bì `{tasks}`, và mutation trả `Entity | null`. **7 call site**
trong views đọc `d.workspace`/`d.task`/`d.organization` gãy — typecheck bắt được hết; hai test views bắt được
phần typecheck không thấy (`onSuccess` đọc `undefined.id`).

**2. Mock của views phải trỏ vào module transport, không phải bề mặt public.** `vi.mock("@uniwork/core/api")`
không chặn được `request` mà endpoints import từ `../http`. Đổi sang mock `@uniwork/core/api/http` theo
đường dẫn resolve — và **giữ schema thật trong vòng test**: fixture lệch hợp đồng làm test đỏ đúng như trang
sẽ đỏ.

**3. Gate Go permissive hơn tôi tưởng.** Xoá task/meeting chỉ cần là thành viên (`authorize()` không xem
creator); tạo workspace chỉ cần là thành viên org. Rule FE **mirror** đúng như vậy, ghi số dòng gate cạnh
từng rule — siết ở FE mà backend không siết chỉ giấu nút; nới thì lộ nút 403.

**4. `paths` đã hai tầng sẵn** — không cần đổi hình dạng. Test nhất quán route↔builder **xanh ngay lần đầu**
(mọi page đã có builder); phần đỏ chỉ là `isGlobalPath`/`GLOBAL_PREFIXES` chưa có.

**5. Auth store: giữ mô hình token-trong-memory của uniwork** (XSS-safe hơn usf localStorage). Store phải
**theo dõi token bị xoá ngầm** bởi transport khi refresh thất bại — nếu không UI giữ session cũ.

**6. Slug workspace chỉ duy nhất trong org** → WS gửi `workspace_slug=org/ws`; server có `ResolveSlugs`
**cố ý bỏ kiểm membership** vì hub kiểm ngay dòng sau. Đường `?token=` tạm của Pha 3 đã gỡ, có Go test khẳng
định query token không còn xác thực được.

**7. e2e đỏ tạm thời hai lần** ngay sau khi đổi provider gốc (`providers.tsx`) — Next HMR đang biên dịch lại;
chạy lại là 13/13. Không phải hồi quy, nhưng đáng ghi: cổng e2e sau khi đổi file gốc cần chạy lần hai.

### Việc dời sang plan sau

- Sidebar và 14 chỗ `useRouter` trong `apps/web` pages chuyển sang `AppLink`/`useNavigation` — Pha 5 (dựng lại
  màn hình).
- `shortcuts/definitions` cho uniwork (`g t`, `g m`) và command palette — Pha 5.
- `useCurrentWorkspace` context trong web layout vẫn còn (3 page dùng) — thay bằng `WorkspaceIdProvider`
  của views ở Pha 5.
