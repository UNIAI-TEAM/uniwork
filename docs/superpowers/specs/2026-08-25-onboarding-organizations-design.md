# UniWork — Onboarding chuẩn usf + tầng Tổ chức

**Ngày:** 2026-08-25
**Trạng thái:** Đã duyệt thiết kế trong chat (brainstorming với chủ dự án), chờ duyệt spec
**Spec nền:** `2026-08-24-uniwork-platform-design.md` (đợt 1 — đã hoàn thành)

## 1. Mục tiêu

Đưa màn onboarding của uniwork lên cùng đẳng cấp với usf (`../usf/packages/views/onboarding`) — từ giao diện (welcome hero, rail bước tối có dot-sphere, cột nội dung 28rem, animation, toast, dark mode) tới tính năng (trạng thái onboarding trên user, questionnaire, tạo workspace với slug/409, guard hai chiều, resume khi bỏ dở, landing 🎉 + seed task hướng dẫn).

Khác biệt duy nhất so với usf, đã chốt: **cấp trên của workspace là Tổ chức (organization)**. Org có slug, URL `/{orgSlug}/{workspaceSlug}/…`, workspace slug unique trong org. Bước 3 của usf ("Meet Mika" — kết nối runtime AI) không áp dụng; thay bằng bước **Mời đồng nghiệp**.

**Ngoài phạm vi:** Google/OTP login, cloud waitlist, source-backfill modal, agent/Mika, billing/domain cho org, trang cài đặt org, quản lý vai trò org (chỉ có dữ liệu, chưa có UI đổi vai trò).

## 2. Nguyên tắc

1. Port cấu trúc và chi tiết chất lượng của usf; khi phân vân mở `../usf` và làm giống. Copy ý tưởng và cấu trúc, viết lại theo convention uniwork (`@uniwork/*`, token `--uw-*`, i18n key phẳng namespace mặc định, tiếng Việt là locale chính).
2. `onboarded_at` trên user là **nguồn sự thật duy nhất** cho "được vào `/{org}/{ws}/*`" — không suy từ số workspace.
3. Bước đang đứng **không** persist; mỗi lần vào `/onboarding` bắt đầu từ Welcome (như usf).
4. Không phá đợt 1: migration có grandfather cho user/workspace hiện có; tasks/meetings không đổi schema (trừ cột `kind` cho seed task).

## 3. Dữ liệu

### 3.1 Migration `004_organizations`

```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

ALTER TABLE workspaces ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;
-- grandfather: mỗi workspace hiện có → 1 org cùng id-prefix? KHÔNG — org.id = 'ORG' || substr(ws.id, 4)
--   (vẫn 26 ký tự, không đụng ULID mới), slug/name/created_by copy từ workspace;
--   mọi workspace_members → organization_members cùng role.
INSERT INTO organizations (id, slug, name, created_by)
  SELECT 'ORG' || substr(id, 4), slug, name, created_by FROM workspaces;
INSERT INTO organization_members (organization_id, user_id, role)
  SELECT 'ORG' || substr(workspace_id, 4), user_id, role FROM workspace_members;
UPDATE workspaces SET organization_id = 'ORG' || substr(id, 4);
ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE workspaces DROP CONSTRAINT workspaces_slug_key;
CREATE UNIQUE INDEX idx_workspaces_org_slug ON workspaces(organization_id, slug);

ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN onboarding_questionnaire JSONB NOT NULL DEFAULT '{}'::jsonb;
-- grandfather: user đã có workspace_members → onboarded_at = created_at
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','welcome'));
CREATE UNIQUE INDEX idx_tasks_welcome_once ON tasks(workspace_id, created_by) WHERE kind = 'welcome';
```

`invitations` giữ nguyên (`workspace_id NOT NULL`): mọi lời mời đều gắn vào 1 workspace; chấp nhận = vào org (role `member` nếu chưa có) **và** vào workspace với role trong lời mời. Org-level invite không có trong đợt này.

`.down.sql` đảo ngược đầy đủ (xoá cột/bảng, khôi phục `slug UNIQUE` toàn cục — chỉ an toàn khi không còn trùng slug giữa các org; ghi chú trong file).

### 3.2 Questionnaire (JSONB trên user)

```ts
type Role = "engineer" | "manager" | "product" | "ops" | "sales" | "hr" | "student" | "other";
type UseCase = "team_tasks" | "meetings" | "personal_tasks" | "project_tracking" | "other";
interface QuestionnaireAnswers {
  version: 1;
  role: Role | null; role_other: string; role_skipped: boolean;
  use_case: UseCase[]; use_case_other: string; use_case_skipped: boolean;
}
```
Server chỉ validate shape (json object ≤ 16 KiB, enum hợp lệ, chuỗi ≤ 80 ký tự) rồi lưu nguyên; `{}` là hợp lệ.

### 3.3 Quy tắc quyền (một dòng)

Truy cập workspace = có dòng `workspace_members` **hoặc** là `owner`/`admin` của org chứa workspace. `WorkspaceService.RequireMember` thực hiện quy tắc này và trả về role hiệu lực (org owner/admin → `admin` trên workspace nếu không có dòng riêng). Mọi service tasks/meetings đã gọi `RequireMember` nên tự hưởng quy tắc mới.

Org: `RequireOrgMember(orgID, userID)`; tạo workspace trong org cần role org bất kỳ; mời thành viên cần workspace role owner/admin (như cũ).

### 3.4 Reserved slugs

`server/internal/handler/reserved_slugs.json` (`login, register, onboarding, workspaces, invitations, invite, api, me, orgs, auth, healthz, ws, tasks, meetings, members, settings, new, admin, static, _next`) → sinh `packages/core/paths/reserved-slugs.ts` bằng script `pnpm generate:reserved-slugs` (như usf). Áp dụng cho cả org slug và workspace slug. Regex slug dùng chung: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–40 ký tự.

## 4. API (`/api/v1`, tất cả sau `RequireAuth`)

| Method & path | Body → Response | Ghi chú |
|---|---|---|
| `GET /me` | → `{user}` | `user` thêm `onboarded_at: string\|null`, `onboarding_questionnaire: object` (cả trong response login/register/refresh) |
| `PATCH /me/onboarding` | `{questionnaire}` → `{user}` | `COALESCE(narg, cũ)`; body ≤ 16 KiB |
| `POST /me/onboarding/complete` | `{completion_path?, workspace_id?}` → `{user}` | `onboarded_at = COALESCE(onboarded_at, now())`; `completion_path ∈ full \| invite_skipped \| skip_existing \| invite_accept`; `workspace_id` chỉ validate, log |
| `GET /me/invitations` | → `{invitations:[{id, role, workspace:{id,slug,name}, organization:{id,slug,name}, invited_by:{display_name}, expires_at, token}]}` | theo email user, chưa accept, chưa hết hạn |
| `GET /orgs` | → `{organizations:[{id,slug,name,role}]}` | org user là thành viên |
| `POST /orgs` | `{name, slug}` → 201 `{organization}` | creator = owner; 409 trùng slug; 400 slug reserved/sai format |
| `GET /orgs/{orgSlug}` | → `{organization}` | 404 nếu không phải thành viên |
| `GET /orgs/{orgID}/workspaces` | → `{workspaces}` | member thường: workspace mình thuộc; owner/admin: tất cả |
| `POST /orgs/{orgID}/workspaces` | `{name, slug}` → 201 `{workspace}` | creator = workspace owner; 409 trùng slug trong org; **không** đánh dấu onboarded |
| `GET /workspaces` | → `{workspaces}` | giữ; mỗi workspace thêm `organization_id`, `organization_slug`, `organization_name` |
| `GET /orgs/{orgSlug}/workspaces/{wsSlug}` | → `{workspace}` | thay `GET /workspaces/{slug}` (xoá route cũ) |
| `POST /workspaces/{id}/invitations` | `{emails: string[], role}` (vẫn nhận `email` đơn) → `{invitations:[{id,email,role,token}]}` | bulk, tối đa 50 email, dedupe + lowercase; email đã là thành viên bị bỏ qua và trả trong `skipped: string[]` |
| `POST /invitations/{token}/accept` | → `{workspace}` | trong **một transaction**: add org member (nếu chưa), add workspace member, mark accepted, `MarkUserOnboarded` |
| `POST /workspaces/{id}/welcome-task` | → 201 `{task}` hoặc 200 `{task}` nếu đã có | tạo task `kind='welcome'`, title/description tiếng Việt từ template server, `status=in_progress`, `priority=high`, `assignee_id=caller`; idempotent nhờ unique index |

`POST /workspaces` (cũ, không có org) bị xoá. Lỗi giữ contract `{error:{code,message}}`.

## 5. Frontend

### 5.1 Routing (`apps/web/app`)

```
(auth)/login, (auth)/register          giữ; điều hướng sau auth qua resolvePostAuthDestination
(auth)/onboarding/page.tsx             OnboardingFlow mode="first_run" — guard: đã onboard → bounce
(auth)/workspaces/new/page.tsx         OnboardingFlow mode="new_workspace" (bắt đầu ở bước Tổ chức);
                                       onCancel chỉ khi đã có ≥1 workspace
(auth)/invitations/page.tsx            danh sách lời mời chờ, "Tham gia" từng cái / tất cả
invite/[token]/page.tsx                giữ; sau accept → /{org}/{ws}/tasks
workspaces/page.tsx                    picker nhóm theo org (card), nút "Workspace mới" → /workspaces/new
[orgSlug]/[workspaceSlug]/…            đổi từ [workspaceSlug]/…; layout resolve org + ws, context
                                       { organization, workspace, user }; mount <WelcomeAfterOnboarding/>
```

`packages/core/paths/`: `paths` builder (`paths.workspace(org, ws).tasks()`…), `resolvePostAuthDestination(workspaces, hasOnboarded)`, `useHasOnboarded()`, `isReservedSlug`, `sanitizeNextUrl`. Logic điều hướng port nguyên usf:

- chưa onboard → `/onboarding` (bất kể số workspace); login/register kiểm tra thêm: chưa onboard **và** có lời mời chờ → `/invitations` trước.
- đã onboard, có workspace → `/{org}/{ws}/tasks` (workspace đầu tiên).
- đã onboard, 0 workspace → `/workspaces/new`.

Guard gương: layout workspace đẩy user `onboarded_at == null` về `/onboarding`; trang onboarding đẩy user đã onboard ra bằng resolver, có `completingRef` latch để `replace` của guard không đè `push` của `onComplete`.

`useSession` bổ sung `setSessionUser(user)` để `saveQuestionnaire`/`completeOnboarding` cập nhật user cache ngay.

### 5.2 `packages/ui` bổ sung

- Primitives: `field` (Field/FieldGroup/FieldLabel/FieldTitle/FieldDescription/FieldError, `data-slot`), `card`, `skeleton`, `stepper`, `dot-sphere` (port canvas, tôn trọng `prefers-reduced-motion`), `sonner` (Toaster + `toast`), `tooltip`, `separator`. Hook `use-scroll-fade`.
- `tokens.css`: thêm `--uw-brand-soft` (nền chip chọn), `--uw-card` = surface; text scale vai trò `--text-micro/caption/label/body/body-lg/title-sm/title/title-lg/display-sm/display` (+ line-height) khai báo trong `@theme` để dùng `text-caption`… Không xoá `text-sm` hiện có ở views cũ (không refactor lan).
- `base.css`: keyframes `onboarding-enter` (opacity-only — **không** translate, lý do usf `base.css:55-67`), `welcome-emoji-pop`; tắt dưới `prefers-reduced-motion`.
- Font: `apps/web/app/layout.tsx` nạp `Inter` (`--font-sans`) và `Source_Serif_4` italic (`--font-serif`) qua `next/font/google`; `font-serif` chỉ dùng cho headline onboarding/welcome.
- Providers: mount `<Toaster />`.

### 5.3 `packages/core/onboarding`

`types.ts` (Role/UseCase/QuestionnaireAnswers/OnboardingStep/OnboardingCompletionPath), `step-order.ts` (`["about_you","organization","workspace","invite"]` — welcome không tính), `store.ts` (`saveQuestionnaire`, `completeOnboarding`, cả hai gọi API rồi `setSessionUser`), `welcome-store.ts` (store transient theo mẫu `api/session.ts`: `{signal:{workspaceId}|null, dismissed}` + subscribe), `hooks.ts` (`useMyInvitations`, `useSeedWelcomeTask`). `packages/core/organizations/hooks.ts`: `useOrganizations`, `useCreateOrganization`, `useOrgWorkspaces`, `useCreateWorkspaceInOrg` (onSuccess seed cache `["workspaces"]` trước khi caller navigate). `useWorkspace(orgSlug, wsSlug)` thay bản cũ. `useInvite` nhận `emails[]`.

### 5.4 `packages/views/onboarding`

```
onboarding-flow.tsx                    orchestrator: state answers/org/workspace/step, guard stranger, back semantics
components/step-shell.tsx              StepShell (hoisted, rail không remount) + StepHeading (aria-live) + StepFooter (mt-auto);
                                       STEP_COLUMN = "mx-auto flex min-h-full w-full max-w-[28rem] flex-col"
components/step-sidebar.tsx            StepSidebar (panel .dark scoped, DotSphere, stepper dọc, chỉ quay lui, aria-current)
                                       + StepProgressBar (md:hidden, thanh đoạn)
components/option-card.tsx, icon-option-card.tsx   chip radio/checkbox + "Khác" có input inline (autoFocus, maxLength 80, Enter)
components/onboarding-logout-button.tsx
components/email-chips-input.tsx       ô nhập nhiều email (Enter/dấu phẩy/dấu cách/paste), chip có xoá, báo email sai
steps/step-welcome.tsx, step-about-you.tsx, step-organization.tsx, step-workspace.tsx, step-invite.tsx
welcome-illustration.tsx               5 card nghiêng: task card, comment, meeting sắp diễn ra, task done, mention
templates/welcome-task.ts              tiêu đề/mô tả task hướng dẫn (mirror server template, dùng cho tooltip/preview)
```
`packages/views/workspace/slug.ts`: `nameToSlug` (dùng `slugify` sẵn có), `SLUG_REGEX`, `randomWorkspaceIdentity(locale)` (tên thiên thể tiếng Việt + slugBase EN + hậu tố 4 ký tự), `isSlugConflict(err)` = `ApiError.status === 409`. `packages/views/workspace/welcome-after-onboarding.tsx`.

### 5.5 Các bước

**0 · Welcome** (không tính vào rail). Hero 2 cột từ `lg`: trái — lockup UniWork (`font-serif text-title-lg`), `h1 font-serif text-5xl sm:text-6xl leading-[1.04]` "Công việc và cuộc họp của cả đội, *trong một không gian.*" (`em italic text-brand`), lede + lede phụ, CTA `size="lg"` "Bắt đầu" + `ArrowRight`; ghost "Tôi đã dùng rồi" chỉ khi đã có workspace → `completeOnboarding("skip_existing", ws.id)` → `onComplete(ws)`. Per-button spinner với `pending: "next"|"skip"|null`. Phải — `hidden lg:flex border-l bg-subtle/40`, caption serif italic, `WelcomeIllustration`. Nút Đăng xuất ghim `fixed right-8 top-8`.

**1 · Về bạn** — heading "Cho chúng tôi biết đôi chút về bạn." Nhóm A vai trò (radio, 8 chip, icon lucide), nhóm B mục đích (checkbox, 5 chip). `canContinue = roleAnswered || useCaseAnswered`. Continue: nhóm chưa trả lời → `*_skipped=true`. Skip: cả hai skipped. Mỗi thay đổi → `saveQuestionnaire` fire-and-forget; lỗi → toast, không rollback. Vào lại: `mergeQuestionnaire` reset `*_skipped=false`.

**2 · Tổ chức** — heading "Đặt tên tổ chức của bạn." / lede "Tổ chức là công ty hoặc đội nhóm; mọi workspace nằm trong đó." Nếu user đã thuộc ≥1 org (resume/`new_workspace`): card chọn org có sẵn (avatar chữ cái, tên, `font-mono text-caption uniwork.app/slug`, RadioMark) + card "Tạo tổ chức mới" collapsible mở form; click lại card đang chọn = bỏ chọn. Form: tên (`autoFocus`, Enter submit có `isImeComposing` guard) + nút Random (`Dices`), slug pill `{host}/` auto từ tên tới khi chạm, lỗi format/reserved inline tức thì, 409 → `FieldError` "Định danh này đã có người dùng" + toast. Footer 1 nút theo state machine (chọn sẵn: "Tiếp tục với {{name}}" / đang tạo: "Đang tạo…" / đủ: "Tạo {{name}}" / trống: disabled). Tạo org xong lưu vào state flow; Back về bước 1 (org đã tạo giữ nguyên, quay lại bước 2 sẽ thấy nó ở card chọn sẵn).

**3 · Workspace** — cùng khuôn với bước 2, host pill `{host}/{orgSlug}/`; lede "Workspace là nơi công việc và cuộc họp của một đội sống. Có thể tạo thêm sau." Resume: nếu org đã có workspace mà user chưa onboard → card chọn workspace có sẵn / tạo mới. `onBusyChange` khoá Back + rail khi đang tạo. Preview: "Đường dẫn: uniwork.app/{org}/{ws}".

**4 · Mời đồng nghiệp** — heading "Mời đồng nghiệp vào {{workspace}}." `EmailChipsInput` + select vai trò (`member`/`admin`) + nút "Gửi lời mời" (disabled khi 0 email hợp lệ). Thành công → danh sách chip email kèm nút copy link (`Check` xanh 2 s), có thể gửi thêm đợt nữa. Footer: primary "Hoàn tất" (enabled sau khi gửi ≥1) + ghost "Bỏ qua". Hoàn tất → `completeOnboarding("full", ws.id)`; Bỏ qua → `completeOnboarding("invite_skipped", ws.id)`. Cả hai → `welcomeStore.set({workspaceId})` → `onComplete(ws)` → `/{org}/{ws}/tasks`. Trong `new_workspace` mode không có Back ở bước 4 (workspace đã tạo).

**Back semantics:** about_you → welcome; organization (`new_workspace`) → `onCancel`; rail chỉ click được bước đã xong; rail vô hiệu trong `new_workspace`.

**Landing — `WelcomeAfterOnboarding`** (mount 1 lần trong layout workspace): khi `signal.workspaceId === workspace.id && !dismissed` → gọi `POST /workspaces/{id}/welcome-task` → loading `FullScreenLoading` ("Đang chuẩn bị workspace…") → dialog `max-w-xl`: 🎉 `text-6xl animate-welcome-emoji-pop`, "Chào mừng đến UniWork!", 1 card preview "Bắt đầu với UniWork · Đang làm" → "Đã hiểu" → mở `/tasks/{id}`. Lỗi → dialog "Thử lại" / "Để sau". Board task hiện task này ở cột Đang làm với badge nhỏ "Hướng dẫn".

### 5.6 Ngoài onboarding

- **Sidebar**: đầu sidebar thành switcher (Base UI Menu): tên org · tên workspace, mở ra nhóm theo org, "Workspace mới" → `/workspaces/new`. Link nav dùng `paths`.
- **`/workspaces` picker**: grid card nhóm theo org, empty state đẩy sang `/workspaces/new`.
- **Members**: form mời dùng `EmailChipsInput` + vai trò + danh sách link mời; hiển thị cột "Vai trò org" nếu là owner/admin org (chỉ đọc).
- **`/invitations`**: card mỗi lời mời (org › workspace, người mời, vai trò), "Tham gia" / "Tham gia tất cả"; xong → destination của workspace đầu tiên. Không có lời mời → redirect resolver.
- i18n: nhóm key `onboarding.*`, `org.*`, `invitations.*` trong `vi.json` (en.json để trống theo convention hiện tại nhưng thêm key).

## 6. Backend chi tiết

- `service/organization.go`: `Create`, `ListForUser`, `GetBySlug`, `RequireMember`, `AddMemberIfAbsent`. Validation slug (regex + reserved) dùng chung `service/slug.go`.
- `service/workspace.go`: `CreateInOrg(ctx, userID, orgID, name, slug)`; `GetBySlugs(ctx, userID, orgSlug, wsSlug)`; `RequireMember` mở rộng theo §3.3 (query `GetWorkspaceAccess` join org_members); `InviteMany`; `AcceptInvite` trong transaction (pgx.Tx + `q.WithTx`) gồm `MarkUserOnboarded`; `ListForUser` trả row join org.
- `service/onboarding.go`: `PatchQuestionnaire` (validate), `Complete(path, workspaceID)`; `SeedWelcomeTask` (template ở `service/templates/welcome_task.go`).
- Handler mới: `organization.go`, `onboarding.go`; sửa `auth.go` (`userDTO` thêm 2 trường), `workspace.go`, `router.go`.
- sqlc: `organizations.sql`, sửa `workspaces.sql`, `users.sql` (`PatchUserOnboarding`, `MarkUserOnboarded`), `tasks.sql` (`CreateWelcomeTask`, `GetWelcomeTask`), `invitations` queries (`ListInvitationsForEmail` join org/ws/user).
- Reserved slugs JSON là nguồn, `go:embed` vào handler package.

## 7. Kiểm thử

- **Go**: migration 004 up/down + grandfather (workspace cũ có org, member cũ onboarded); `organization_test` (create/409/reserved/membership); `workspace_test` (create in org, slug unique per org, org admin access rule, accept invite = org+ws+onboarded trong 1 tx, InviteMany dedupe/skip); `onboarding_test` (patch questionnaire validate/16 KiB, complete idempotent, welcome task idempotent 201→200).
- **Vitest**: `resolvePostAuthDestination`, `sanitizeNextUrl`, `slug.ts` (nameToSlug CJK → "", random identity format), `mergeQuestionnaire`, `EmailChipsInput` parse/paste, `OnboardingFlow` chuyển bước + back semantics + guard stranger (mock API), `StepWorkspace` 409 hiển thị inline + toast.
- **E2E** (`e2e/`): `onboarding-smoke.spec.ts` (đăng ký → welcome → về bạn → tổ chức → workspace → bỏ qua mời → dialog 🎉 → task hướng dẫn mở), `onboarding-shell.spec.ts` (mọi `h1`, `[data-slot=field-group]`, `[data-slot=field]` rộng đúng 28rem), cập nhật `smoke.spec.ts` theo URL `/{org}/{ws}`.

## 8. Rủi ro & quyết định

- Đổi URL phá link cũ `/{ws}/…` — chấp nhận (demo nội bộ), layout cũ xoá hẳn để không có 2 nguồn.
- Grandfather org theo workspace: user có 2 workspace cũ sẽ có 2 org — chấp nhận, có thể dọn tay.
- Org owner/admin tự động vào mọi workspace của org — đã chốt; ghi rõ trong `RequireMember` để service khác không tự kiểm tra `workspace_members` trực tiếp.
- Toast dùng `sonner` (như usf) thay vì tự viết.
