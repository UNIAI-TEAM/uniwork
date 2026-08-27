# UniWork — Settings dùng chung (port shell Multica)

**Ngày:** 2026-08-27  
**Trạng thái:** Đã duyệt spec (brainstorming 2026-08-27)  
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md`, `2026-08-26-brand-identity-design.md`

## 1. Mục tiêu

Xây module **Settings** trong `packages/views/settings/` — tái sử dụng shell và layout primitives
từ Multica (`multica/packages/views/settings/`), gom cấu hình tài khoản, workspace và thành viên
vào một surface thống nhất. **Bỏ mục Members khỏi sidebar**; Tasks và Meetings giữ nguyên.

**Ngoài phạm vi v1:** leave/delete workspace, billing, labels/issue config, MCP/plugins/labs,
GitHub/repositories, tokens, chat/notifications/shortcuts tabs, port integration cụ thể (Slack, Lark…),
avatar crop/emoji picker Multica.

## 2. Quyết định đã chốt (brainstorming)

| # | Quyết định |
|---|------------|
| 1 | Hướng **port shell + tab tối thiểu** — không port full ~20 tab Multica |
| 2 | Sidebar nav: **Tasks \| Meetings** only; Members → Settings tab |
| 3 | Entry Settings: mục **Cài đặt** trong user dropdown (sidebar footer) |
| 4 | Route: `/{orgSlug}/{workspaceSlug}/settings?tab=…` |
| 5 | Legacy: `/{org}/{ws}/members` → redirect `settings?tab=members` |
| 6 | Tab **Tích hợp**: empty state trung thực (PRODUCT.md — không mock data) |
| 7 | Ngôn ngữ v1: client-only qua `browser-cookie-adapter`; không sync server |

## 3. Information architecture

### 3.1 Nhóm tab

**Tài khoản** (`settings.page.my_account`)

| Tab | `?tab=` | Icon | Nội dung v1 |
|-----|---------|------|-------------|
| Hồ sơ | `profile` | User | `display_name`, upload avatar |
| Tùy chọn | `preferences` | SlidersHorizontal | Theme (light/dark/system), ngôn ngữ (vi/en) |

**Workspace** (header = tên workspace hiện tại)

| Tab | `?tab=` | Icon | Nội dung v1 |
|-----|---------|------|-------------|
| Chung | `workspace` | Settings | Đổi tên workspace (admin/owner) |
| Thành viên | `members` | Users | Invite + danh sách (logic `MembersView`) |
| Tích hợp | `integrations` | Plug | Empty state — chưa có tích hợp |

`DEFAULT_TAB = "profile"`. Whitelist tab values; unknown `?tab=` → fallback default (pattern Multica).

### 3.2 Navigation

```
Sidebar (AppSidebar):
  Header: WorkspaceSwitcher
  Nav:    Tasks | Meetings
  Footer: [User avatar ▼] → Cài đặt | Đăng xuất

Settings page:
  Left:   CollapsedNavTrigger + tab list (vertical md+, horizontal mobile)
  Right:  TabsContent (max-w-3xl, rộng hơn nếu cần sau)
```

### 3.3 Paths

Thêm vào `packages/core/paths/paths.ts`:

```ts
settings: () => `${base}/settings`,
```

Giữ `members()` cho redirect page. Cập nhật `consistency.test.ts` builder list.

## 4. Tái sử dụng từ Multica

| File Multica | UniWork | Ghi chú |
|--------------|---------|---------|
| `settings-layout.tsx` | Port | Đổi token: `divide-border`, bỏ `divide-surface-border` |
| `use-auto-save.ts` + test | Port | Giữ nguyên logic serialize/debounce |
| `settings-page.tsx` | Port, rút tab | 2 nhóm, 5 tab; bỏ feature-flag tabs |
| `account-tab.tsx` | Pattern only | Không `profile_description`; field `display_name` |
| `preferences-tab.tsx` | Pattern only | vi/en; bỏ timezone, chat composer prefs |
| `workspace-tab.tsx` | Pattern only | Chỉ `name`; bỏ description/context/avatar/leave/delete v1 |
| `members-tab.tsx` | Không port | Multica ~1000 LOC + billing seats — dùng `MembersView` |
| `integrations-tab.tsx` | Không port | Empty state đơn giản |
| `AvatarUploadControl` | Không port v1 | File input + `POST /me/avatar` |

## 5. Kiến trúc module

```
packages/views/settings/
  components/
    settings-layout.tsx
    settings-page.tsx
    settings-page.test.tsx
    account-tab.tsx
    account-tab.test.tsx
    preferences-tab.tsx
    preferences-tab.test.tsx
    workspace-tab.tsx
    workspace-tab.test.tsx
    members-tab.tsx          # bọc MembersView + SettingsTab chrome
    integrations-tab.tsx
    use-auto-save.ts
    use-auto-save.test.tsx
    index.ts
packages/core/
  api/endpoints/auth.ts      # + patchMe, uploadAvatar
  api/endpoints/workspaces.ts # + patchWorkspace
  workspaces/hooks.ts        # + usePatchMe, usePatchWorkspace mutations
  permissions/rules.ts       # + canUpdateWorkspaceSettings
apps/web/app/[orgSlug]/[workspaceSlug]/
  settings/page.tsx
  members/page.tsx           # redirect → settings?tab=members
```

## 6. Data flow & state

### 6.1 Server state (TanStack Query)

| Dữ liệu | Query key | Mutation |
|---------|-----------|----------|
| User session | auth store (`me()` on boot) | `patchMe`, `uploadAvatar` → `setUser` |
| Workspace | `workspaceKeys.bySlugs(org, ws)` | `patchWorkspace` → invalidate list + bySlugs |
| Members | `workspaceKeys.members(wsId)` | `useInvite` (đã có) |

**Không** ghi WS payload vào store. Sau mutation workspace name: invalidate `workspaceKeys.list()` và
`bySlugs` để sidebar switcher cập nhật tên (contract tương tự e2e Multica `settings.spec.ts`).

### 6.2 Client state

| Concern | Owner |
|---------|-------|
| Theme | `next-themes` via `ThemeProvider` |
| Locale | `LocaleAdapter.persist` + full reload |
| Form draft (name fields) | Local `useState` + `useAutoSave` |
| Active tab | URL `?tab=` via `navigation.replace` (không push history) |

### 6.3 API mới (backend)

#### `PATCH /api/v1/me`

```json
{ "display_name": "string" }   // optional, trimmed, 1–100 runes
```

- Auth required.
- Response: `{ "user": UserDTO }` (cùng shape `GET /me`).
- Validation: empty sau trim → 400.

#### `POST /api/v1/me/avatar`

Đã có — thêm wrapper frontend `uploadAvatar(file: File)`.

#### `PATCH /api/v1/workspaces/{workspaceID}`

```json
{ "name": "string" }   // optional, trimmed, 1–100 runes
```

- `RequireMember` + role gate: owner hoặc admin (mirror `InviteMany`).
- Response: `{ "workspace": WorkspaceView }`.
- Không đổi slug v1 (tránh break URL).

Service: `WorkspaceService.Update(ctx, userID, workspaceID, UpdateWorkspaceInput)`.

### 6.4 Endpoint schemas (frontend)

Theo CLAUDE.md: zod lenient + `parseWithFallback` + malformed-response test trong
`auth.test.ts` / `workspaces.test.ts`.

## 7. Permissions

Thêm `canUpdateWorkspaceSettings(ctx)`:

- Gate: `RequireMember` + `isAdminLike(wsRole)`.
- Mirror: cùng điều kiện `InviteMany` (`server/internal/service/workspace.go`).
- UI: `workspace-tab` disable input + ẩn save state khi member thường; vẫn cho xem tên.

`members-tab`: tái dùng `useWorkspacePermissions().canInvite` (đã có).

Account tabs: mọi user đã đăng nhập.

## 8. UI components (chi tiết tab)

### 8.1 Account — Hồ sơ

- `SettingsTab` + `SettingsSection` + `SettingsCard` + `SettingsRow`.
- Avatar: `ActorAvatar` + hidden `<input type="file" accept="image/*">` → `uploadAvatar` → `setUser`.
- `display_name`: `Input` + `useAutoSave` (delay 650ms, pattern Multica).
- `SettingsSaveState`: idle | saving | saved | error.
- Email: read-only row (không editable v1).

### 8.2 Account — Tùy chọn

- Theme: `Select` light / dark / system (`useTheme`).
- Language: `Select` vi / en → `localeAdapter.persist` → `window.location.reload()`.
- Toast nếu persist OK nhưng reload fail (edge case hiếm).

### 8.3 Workspace — Chung

- Chỉ field **Tên workspace**; auto-save khi admin+.
- Member thường: label + giá trị read-only, không `SettingsSaveState`.

### 8.4 Workspace — Thành viên

- `MembersTab` render `SettingsTab` header + embed `MembersView` **không** duplicate h1/page padding.
- Refactor nhẹ `MembersView`: prop `embedded?: boolean` bỏ outer `max-w-2xl p-6` + `h1` khi embedded;
  hoặc tách `MembersPanel` shared.

### 8.5 Workspace — Tích hợp

- `SettingsTab` title + mô tả ngắn.
- `CollectionPageState`-style empty (hoặc inline): icon Plug, title, body giải thích roadmap.
- **Không** liệt kê Slack/Lark mock.

## 9. i18n

Namespace mới `settings` trong `packages/core/i18n/locales/{vi,en}.json`:

- `settings.page.title`, `my_account`, `workspace_fallback`
- `settings.page.tabs.{profile,preferences,workspace,members,integrations}`
- `settings.profile.*`, `settings.preferences.*`, `settings.workspace.*`
- `settings.integrations.emptyTitle`, `emptyDescription`
- `settings.save.{saving,saved,error}`
- `nav.settings` (dropdown)

Parity vi/en bắt buộc (`parity.test.ts`).

## 10. Thay đổi sidebar & tests hiện có

| File | Thay đổi |
|------|----------|
| `app-sidebar.tsx` | Bỏ nav item Members; thêm DropdownMenuItem Settings → `ws.settings()` |
| `app-sidebar.test.tsx` | Cập nhật: 2 nav items; có link settings trong dropdown |
| `members/page.tsx` | `redirect()` hoặc `useNavigation().replace` → `settings?tab=members` |
| `paths/consistency.test.ts` | Thêm `settings` builder |
| `app-sidebar` active state | Settings active khi pathname ends with `/settings` |

## 11. Testing

| Lớp | File | Nội dung |
|-----|------|----------|
| Layout primitives | `settings-layout.test.tsx` | Row width tiers, SaveState a11y `role="status"` |
| Auto-save | `use-auto-save.test.tsx` | Port từ Multica |
| Shell | `settings-page.test.tsx` | Tab whitelist, `?tab=` replace, CollapsedNavTrigger compact |
| Account | `account-tab.test.tsx` | Auto-save debounce, avatar upload mock transport |
| Preferences | `preferences-tab.test.tsx` | Theme select, locale persist mock |
| Workspace | `workspace-tab.test.tsx` | Permission gate read-only vs editable |
| Members embed | `members-tab.test.tsx` | Renders invite form when canInvite |
| Integrations | `integrations-tab.test.tsx` | Empty state copy, no mock connectors |
| API | `auth.test.ts`, `workspaces.test.ts` | patchMe/patchWorkspace + malformed |
| Permissions | `rules.test.ts` | canUpdateWorkspaceSettings matrix |
| Backend | `handler/*_test.go`, `service/workspace_test.go` | PATCH handlers |
| E2E (optional v1) | `e2e/settings.spec.ts` | Đổi workspace name → sidebar switcher cập nhật |

Views tests mock `@uniwork/core/api/http`, không mock `next/*`.

## 12. Thứ tự triển khai đề xuất

1. Backend: `PATCH /me`, `PATCH /workspaces/{id}` + tests  
2. Core: endpoints, hooks, permissions  
3. `settings-layout` + `use-auto-save`  
4. `settings-page` shell (stub tabs)  
5. Tab implementations (profile → preferences → workspace → members → integrations)  
6. Route + redirect + sidebar wiring  
7. i18n + tests + `pnpm typecheck` / `pnpm test` / `make test-go`

## 13. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|-------------|
| Token class lệch Multica | Map `surface-border` → `border` khi port layout |
| MembersView double heading | `embedded` prop hoặc tách panel |
| Bookmark `/members` 404 | Giữ redirect page |
| Sidebar tên workspace stale | Invalidate query keys sau patch |
| `no-usf-leak` | Không import/copy comment nhắc Multica |

## 14. Mở rộng sau v1 (không implement)

- Workspace: leave, delete, slug, avatar, description  
- Integrations: từng connector + section trong tab  
- Sync `language` lên user row  
- Avatar crop/emoji  
- Notifications preferences tab  
- Settings link trong sidebar nav (nếu product đổi ý)
