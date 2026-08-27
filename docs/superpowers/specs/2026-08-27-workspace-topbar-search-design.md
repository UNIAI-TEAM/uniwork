# UniWork — Workspace TopBar + Global Search (nền tảng)

**Ngày:** 2026-08-27  
**Trạng thái:** Chờ duyệt spec (brainstorming 2026-08-27)  
**Spec liên quan:** `2026-08-27-settings-design.md`, `2026-08-24-uniwork-platform-design.md`  
**Tham chiếu UI:** Multica `packages/views/search/` (command palette) — không port full search API

## 1. Mục tiêu

Thêm **header tổng (WorkspaceTopBar)** trên mọi trang workspace và **command palette** mở từ ô tìm kiếm / phím tắt. v1 chỉ tích hợp nền tảng điều hướng + vài quick action; tìm Tasks/Meetings/Members qua API bổ sung sau.

## 2. Quyết định đã chốt (brainstorming)

| # | Quyết định |
|---|------------|
| 1 | Phạm vi v1: **nền tảng** — palette Pages + Commands; chưa API search entity |
| 2 | Layout header: **C — Compact toolbar** |
| 3 | Vị trí: hàng chrome cố định trong `DashboardLayout` / `SidebarInset` (cách 1) |
| 4 | Trái: **collapse sidebar** (`SidebarTrigger`) + **search pill** |
| 5 | Phải: **Tạo việc** + **Theme** + **Ngôn ngữ** |
| 6 | Mở palette: click pill + `⌘K` / `Ctrl+K` |
| 7 | Theme/ngôn ngữ: tái dùng `ThemeProvider` + `LocaleAdapter` (không full reload) |
| 8 | Search store: Zustand trong **`packages/core/search/`** (đúng rule stores-in-core) |

## 3. Ngoài phạm vi v1

- `GET …/search` cho tasks / meetings / members / projects  
- Nhóm Recent, Cancelled-rank, highlight snippet kiểu Multica  
- Invite / avatar trên TopBar  
- Port full `search-command.tsx` Multica (~1k LOC)  
- Wire đầy đủ `packages/core/shortcuts` (có thể đăng ký keydown tối thiểu trong shell)

## 4. Shell & layout

```
Sidebar | SidebarInset
          ├─ NavigationProgress
          ├─ WorkspaceTopBar     ← mới (h-12, border-b)
          └─ page children       ← PageHeader / Settings tabs giữ nguyên
```

### 4.1 WorkspaceTopBar (trái → phải)

1. `SidebarTrigger` — thu/mở left sidebar (desktop + mobile)  
2. Search pill — mở palette; hiện hint `⌘K` / `Ctrl+K` khi phù hợp  
3. `flex-1` spacer  
4. Quick actions: Tạo việc | Theme dropdown | Language dropdown  
5. Optional prop `actions?: ReactNode` cho slot sau này  

### 4.2 Trùng trigger với PageHeader

`CollapsedNavTrigger` hiện `xl:hidden`. TopBar đã có `SidebarTrigger` luôn hiện → điều chỉnh PageHeader / CollapsedNavTrigger để **không hai nút collapse** trên cùng viewport (ví dụ: ẩn CollapsedNavTrigger khi TopBar đã mount, hoặc TopBar là nguồn trigger duy nhất và PageHeader không render trigger nữa trên workspace shell).

### 4.3 Settings

TopBar vẫn hiện (chrome toàn workspace). Settings giữ tab rail nội dung bên dưới — không nhúng search vào `settings-page`.

## 5. Search / command palette

### 5.1 Module

| Path | Vai trò |
|------|---------|
| `packages/core/search/store.ts` | Zustand: `open`, `setOpen`, `toggle` |
| `packages/core/search/index.ts` | export |
| `packages/views/search/search-command.tsx` | Dialog + cmdk (`@uniwork/ui` Command) |
| `packages/views/search/search-trigger.tsx` | Search pill (TopBar) |
| `packages/views/search/index.ts` | export |
| `packages/views/layout/workspace-top-bar.tsx` | TopBar chrome |
| Mount | `DashboardLayout`: TopBar + `<SearchCommand />` |

### 5.2 Nội dung palette v1

**Pages (điều hướng):**

- Công việc → `paths.workspace(…).tasks()`  
- Cuộc họp → `meetings()`  
- Cài đặt → `settings()` (default tab)  
- Tuỳ chọn: mục Settings tab (`?tab=profile|preferences|workspace|members|integrations`) nếu gọn và không làm ồn  

**Commands:**

- Tạo việc (mở dialog)  
- Theme: Sáng / Tối / Theo hệ thống  
- Ngôn ngữ: Tiếng Việt / English  

**Empty:** copy kiểu “Gõ để lọc trang và lệnh” — không fake kết quả entity.

### 5.3 Phím tắt

- `metaKey/ctrlKey + k` → `toggle` palette (ignore khi focus input/textarea/contenteditable trừ khi đã mở palette)  
- `Escape` → đóng (cmdk/Dialog mặc định)

## 6. Quick actions & data flow

| Action | Hành vi |
|--------|---------|
| Tạo việc | Mở `NewTaskDialog` (đã có); state mở: `useState` trong TopBar/shell v1 |
| Theme | `useTheme().setTheme('light'\|'dark'\|'system')` + toast ngắn |
| Ngôn ngữ | `useLocaleAdapter().persist` + `i18n.changeLanguage` + `document.documentElement.lang` + toast — cùng path Preferences |

Không ghi WebSocket / không endpoint mới.

## 7. i18n

Thêm keys vi/en (parity):

- `topbar.searchPlaceholder`, `topbar.createTask`, `topbar.theme`, `topbar.language`, `topbar.collapseSidebar` (aria)  
- `search.title`, `search.placeholder`, `search.groups.pages`, `search.groups.commands`, `search.empty`, `search.commands.*`

## 8. Testing

| Khu vực | Kiểm tra |
|---------|----------|
| TopBar | Render trong shell; SidebarTrigger thu/mở sidebar |
| Palette | Click pill + ⌘K mở/đóng; lọc Pages/Commands |
| Actions | Theme đổi class `dark`; language đổi chuỗi UI; Tạo việc mở dialog |
| Regression | Không hai collapse trigger; Settings/Tasks/Meetings vẫn dùng được |

## 9. Thứ tự triển khai (gợi ý plan)

1. `core/search` store + tests  
2. `SearchCommand` + `SearchTrigger` (Pages + Commands tối thiểu)  
3. `WorkspaceTopBar` + mount `DashboardLayout`  
4. Xử lý trùng `CollapsedNavTrigger`  
5. Quick actions (create / theme / language) + i18n  
6. Shortcut ⌘K + tests views  

## 10. Tiêu chí xong v1

- Mọi trang workspace có TopBar layout C  
- Palette mở bằng pill và ⌘K, chỉ Pages + Commands  
- Collapse sidebar, Tạo việc, Theme, Ngôn ngữ hoạt động  
- Không API search; sẵn slot/`actions` và nhóm empty để mở rộng sau  
