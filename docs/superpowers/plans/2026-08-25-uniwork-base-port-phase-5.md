# UniWork Base Port — Pha 5 (Dựng lại FE theo 5 lát dọc)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa `packages/views` + `apps/web` lên đúng khuôn usf trên base đã port: shell dùng primitive `sidebar` + `NavigationAdapter`, mọi màn hình dùng slot token ngữ nghĩa, không còn `useRouter` trong page, không còn `window.location`, và cuối cùng **xoá lớp `--uw-*`**. 13/13 e2e là cổng của mọi task; 5 spec onboarding là hợp đồng hồi quy (sửa component, không sửa spec).

**Architecture:** Lát 1 dựng shell + adapter (phát hiện lỗi thiết kế sớm nhất). Lát 2–5 đi từng domain: thay chrome bằng `PageHeader`/`BreadcrumbHeader`/`CollectionPageHeader`, thay class `--uw` bằng slot, thay `<a>`/`router` bằng `AppLink`/`useNavigation`. Task cuối xoá alias khi grep = 0.

**Tech Stack:** React 19 · Base UI primitives đã port (`sidebar`, `dropdown-menu`, `table`, `toggle-group`, `empty`, `breadcrumb`) · Tailwind 4 slot tokens · Playwright.

**Spec:** §7.3, §7.5, §5.4 (xoá `--uw-*` "cuối pha 5") của `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`

## Global Constraints

- Không đổi copy/role mà 6 spec e2e bám vào (`getByRole("button", {name: "Việc mới"})`, "Tạo cuộc họp", "Đã hiểu", "Bỏ qua, mời sau", heading h1 onboarding, label "Tên tổ chức"/"Đường dẫn"…). Đổi copy = đổi spec = **không** trong phạm vi.
- `views` không `next/*` (lint), không `window.location` (thêm luật lint `no-restricted-globals: location` cho views ở Task 1).
- Token: chỉ slot ngữ nghĩa (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `bg-brand`…) và thang `--text-*`. Cấm `text-[12px]`, `text-sm`, `text-xs`.
- Mọi task: `pnpm typecheck && pnpm test && pnpm lint` + **13/13 e2e** (chạy hai lần nếu vừa đổi provider/layout gốc).
- Không thêm nav group cho tính năng chưa có (Knowledge/Automation/Insights): PRODUCT.md cấm mock; nav chỉ có Việc / Cuộc họp / Thành viên, nhóm sẵn để mở rộng.

## Khảo sát (2026-08-25)

- 15 page; 13 dùng `useRouter`/`usePathname`; `useCurrentWorkspace` context sống trong web layout (3 page dùng).
- `sidebar.tsx` + `workspace-switcher.tsx`: `<a href>`, `window.location.assign`, Base UI `Menu` thô — 33 class cũ. `WorkspaceSwitcher` chuyển workspace bằng reload toàn trang.
- 38 view, ~270 class cũ; nhiều nhất: workspace-switcher 19, task-detail 17, meetings-page 16, meeting-detail 15, sidebar 14, welcome-illustration 13.
- Onboarding (7 file, ~1.400 dòng) đã "chuẩn usf" từ đợt trước và có 5 spec đo — **không dựng lại**, chỉ migrate token + thay `router` ở page.
- usf shell: `dashboard-layout` (SidebarProvider + SidebarInset + NavigationProgress), `page-header` (48px, trigger mobile), `breadcrumb-header`, `collection-page` (header + empty state), `app-sidebar` (893 dòng — chỉ lấy idiom `SidebarMenuButton render={<AppLink/>}`).
- `views/test/setup.ts` mock transport; test view dùng `wrap()` QueryClient. Test có `NavigationProvider`? Chưa — Task 1 thêm `wrapWithNav()` helper.

## Bản kê

| Task | Tạo/sửa |
| --- | --- |
| 1 | `views/layout/{workspace-context,dashboard-layout,app-sidebar,page-header,breadcrumb-header,navigation-progress,workspace-switcher}.tsx` + test; `views/test/api-mock.tsx` (+`wrapWithNav`); `views/eslint.config.mjs` (+`location`); web layout + 13 page; `views/layout/{app-shell,sidebar}.tsx` xoá |
| 2 | `views/workspace/{workspace-picker-view,invitations-view,accept-invite-view,members-view,invite-row,email-chips-input,welcome-after-onboarding}.tsx` |
| 3 | `views/onboarding/**` (token only), `views/auth/*` |
| 4 | `views/tasks/{tasks-page-view,board-view,list-view,task-card,task-detail-view,new-task-dialog}.tsx`; `views/layout/collection-page.tsx` |
| 5 | `views/meetings/*` |
| 6 | `ui/styles/{tokens,base}.css`, `tokens.test.ts`, `apps/web/app/globals.css`; grep = 0 |
| 7 | `CLAUDE.md` (Web Features), plan notes |

---

## Task 1 — Lát 1: shell + adapter khắp nơi

- [ ] **Step 1 (đỏ):** `views/layout/app-sidebar.test.tsx`: render trong `NavigationProvider` giả + `WorkspaceProvider`; link "Công việc" là `<a href="/acme/team/tasks">` và click → `push` được gọi (không reload); mục đang active có `data-active`/`aria-current="page"`; nút đăng xuất gọi `logout` rồi `replace("/login")` qua adapter. FAIL vì module chưa có.
- [ ] **Step 2:** `workspace-context.tsx`: `WorkspaceProvider({workspace,user})`, `useWorkspace()`, `useWorkspaceId()` — thay `useCurrentWorkspace` của web.
- [ ] **Step 3:** Port `page-header.tsx`, `breadcrumb-header.tsx`, `navigation-progress.tsx` (đổi `@multica`→`@uniwork`, bỏ `newTabTitle`). `dashboard-layout.tsx`: `DashboardGuard` → `WorkspaceProvider` → `WSProvider` → `SidebarProvider className="h-svh bg-app-shell"` → `AppSidebar` + `SidebarInset` (`NavigationProgress` + children).
- [ ] **Step 4:** `app-sidebar.tsx` trên primitive `sidebar`: header = `WorkspaceSwitcher` (dùng `dropdown-menu` primitive, nhóm theo org, chọn = `push(paths.workspace(...).tasks())`, "Workspace mới" = `push(paths.newWorkspace())`); content = một `SidebarGroup` "Không gian làm việc" với 3 `SidebarMenuButton render={<AppLink/>}` (Việc / Cuộc họp / Thành viên), `isActive` theo `pathname`; footer = tên user + đăng xuất (`useAuthStore.logout` → `replace(paths.login())`).
- [ ] **Step 5:** Web: `[orgSlug]/[workspaceSlug]/layout.tsx` = `useParams` + `<DashboardLayout orgSlug wsSlug>`; xoá `WorkspaceContext`; 3 page dùng `useWorkspace()` từ views; **13 page** thay `useRouter/usePathname` bằng `useNavigation()` (giữ `useParams`, `useSearchParams` chỉ ở `login` — chuyển sang `useNavigation().searchParams`). `[ws]/page.tsx` redirect qua `replace`. Xoá `app-shell.tsx`, `sidebar.tsx`.
- [ ] **Step 6:** Lint: `views/eslint.config.mjs` thêm `no-restricted-globals: location, window?` — chỉ `location` (window.location) với message "use useNavigation()". `views/test/api-mock.tsx` thêm `wrapWithNav(ui, adapter?)`.
- [ ] **Step 7:** `grep -rn "useRouter\|usePathname" apps/web/app` = 0; `grep -rn "window.location" packages/views` = 0. e2e 13/13 (×2). Commit `feat(views): dashboard shell on the sidebar primitive; pages navigate through the adapter`.

## Task 2 — Lát 2: org + workspace

- [ ] Picker: `CollectionPageHeader`-style heading, card = `item`/`card` primitive với slot token; `appHost()` giữ. Invitations/accept-invite: token + `AppLink`. Members: `table` primitive + `PageHeader`; giữ hợp đồng permissions (test hiện có). `welcome-after-onboarding`: token. Test views hiện có phải xanh nguyên trạng (chúng khẳng định hành vi, không khẳng định class).
- [ ] e2e 13/13. Commit `refactor(views): workspace screens on semantic tokens and the page chrome`.

## Task 3 — Lát 3: onboarding + auth (token only)

- [ ] Thay class cũ → slot trong `onboarding/**`, `auth/*` (perl map có kiểm tay): `text-primary`→`text-foreground`, `text-text-secondary`→`text-muted-foreground`, `text-tertiary`→`text-faint-foreground` (**chỉ** cho mark phi-văn-bản; chữ đọc được phải là `text-muted-foreground`), `bg-canvas`→`bg-background`, `bg-surface`→`bg-card`/`bg-surface`, `bg-subtle`→`bg-muted`, `border-line`→`border-border`, `border-line-loud`→`border-input`, `text-inverse`→`text-primary-foreground`, `bg-primary`(cũ = chữ đậm)→`bg-primary`, `text-on-brand`→`text-brand-foreground`, `bg-danger`/`text-danger`→`bg-destructive`/`text-destructive`, `text-[12px]`→`text-caption`, `text-[13px]`→`text-label`, `text-sm`→`text-body`.
- [ ] **Cổng quyết định:** `onboarding-contrast.spec.ts` + `onboarding-focus.spec.ts` + `onboarding-mobile.spec.ts`. `text-faint-foreground` trên chữ sẽ đỏ contrast — đó là mục đích. Commit.

## Task 4 — Lát 4: tasks

- [ ] Port `collection-page.tsx` (header + `CollectionEmpty` trên primitive `empty`). Tasks page: `CollectionPageHeader icon=SquareCheckBig title count`, `toggle-group` cho Bảng/Danh sách (giữ text "Bảng"/"Danh sách"), "Việc mới" (giữ). List: `table` primitive; Board: cột dùng slot; card: `card`-like với `text-body`. Detail: `BreadcrumbHeader` (Việc › tiêu đề), `field`/`select`/`textarea` primitive, xoá theo `canDelete`. Empty state thật ("Chưa có việc nào." + CTA).
- [ ] e2e smoke + onboarding-smoke (tạo task, mở detail, "Đã hiểu" → detail). Commit.

## Task 5 — Lát 5: meetings

- [ ] Meetings page: `CollectionPageHeader icon=CalendarDays`, hai section Sắp diễn ra/Đã diễn ra với `item` primitive; detail: `BreadcrumbHeader` + notes; room-view: token only (LiveKit theme giữ). Commit.

## Task 6 — Xoá lớp `--uw-*`

- [ ] **Step 1 (đỏ):** `tokens.test.ts` thêm case "no --uw- alias remains" và "no --color-{canvas,subtle,line*,inverse,tertiary,on-brand,danger*,success-text,warning-text,brand-soft,text-secondary} alias remains"; `grep -rnE "(bg|text|border|ring)-(canvas|subtle|line|tertiary|inverse|on-brand|text-secondary)\b" packages apps` phải = 0 (script `scripts/no-legacy-tokens.test.mjs`).
- [ ] **Step 2:** `tokens.css`: chuyển giá trị hex từ `--uw-*` thẳng vào slot ở `:root` và `.dark` (giữ nguyên số đã đo WCAG, giữ comment 3:1), xoá khối `--uw-*`, xoá alias cũ trong `@theme inline`; `--uw-rail-bg` → `--rail` (+alias `--color-rail`); `--uw-radius` → `--radius`; `--uw-focus` → `--ring`. `base.css`: `--uw-canvas`→`--background`, `--uw-text-primary`→`--foreground`, `--uw-focus`→`--ring`, `--uw-select-*`→`--selection`/`--selection-foreground` (thêm slot), `--uw-line-loud`→`--input`, `--uw-brand`→`--brand`. Onboarding rail dùng `--uw-rail-bg` → đổi.
- [ ] **Step 3:** 13/13 e2e (contrast light+dark là cổng). Commit `refactor(ui): retire the --uw-* layer; semantic slots are the only tokens`.

## Task 7 — Đóng

- [ ] `CLAUDE.md`: gỡ đoạn "Known debt" ở Web Features, gỡ dòng "`--uw-*` transitional" ở UI Rules, mô tả shell (`DashboardLayout`, `PageHeader`, `BreadcrumbHeader`, `CollectionPageHeader`). `docs/conventions.md` mục Packages: bỏ ghi chú `--uw`. `make check` xanh. Ghi "Ghi chép thực thi". Commit.

## Ngoài phạm vi (ghi để không bị hiểu là quên)

Command palette + `shortcuts/definitions` cho uniwork; `Knowledge/Automation/Insights`; chuyển WorkspaceSwitcher sang store `navigation.lastPath`; mobile bottom tabs của PRODUCT.md §8.
