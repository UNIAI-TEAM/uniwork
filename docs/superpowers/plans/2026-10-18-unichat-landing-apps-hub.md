# UniChat L2 — Landing UniChat và hub `/apps` — Kế hoạch triển khai

> **Trạng thái:** in-progress — issue UNI-1913.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Mục tiêu:** Hiện thực đúng bản thiết kế đã duyệt: nhánh `/apps` (hub, Office, UniChat), menu "Ứng dụng", trang UniChat mới, khối tải và thanh ứng dụng dùng chung.

**Kiến trúc:** Route marketing đổi trong `packages/core/paths` (một nguồn cho sitemap, SEO, `/vi`); chuyển hướng 308 trong `next.config.mjs`. Web thêm danh mục ứng dụng và các khối dùng chung trong `apps/web/features/landing/apps/`, trang UniChat và hub dựng lại theo canvas; Office chỉ thay khối tải và thêm thanh ứng dụng.

**Tech:** Next.js App Router, React, react-i18next, TanStack Query (`usePublicConfig`), CSS thuần theo token, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-landing-apps-hub-design.md`.

## Ràng buộc chung

- Màu chỉ từ token trong `packages/ui/styles/tokens.css`; không hex trong CSS mới.
- Mỗi file `.ts/.tsx` ≤ 500 dòng; không export thừa (knip).
- Mọi chữ qua `t("landing.…")`, đủ vi và en.
- Icon lucide tên chuẩn; logo qua `@uniwork/ui/brand` (`Logo`, `UniChatIcon`).
- Chạy vitest với `NODE_OPTIONS=--no-experimental-webstorage` ở máy này; không chạy full suite (CI chạy).

## Review Focus

1. Người xem dùng Safari/Firefox trên Mac (đoán "uncertain"): thẻ nổi bật vẫn là macOS và hiện cả hai biến thể Mac.
2. Cấu hình lệch (mảng rác, URL `javascript:`): mọi khối suy biến về "chưa phát hành", không ném lỗi.
3. Link cũ `/office#office-business`, `/vi/unichat`: chuyển hướng giữ đúng đích (hash do trình duyệt giữ).
4. `prefers-reduced-motion`: không phần tử nào bị ẩn ở trạng thái cuối.
5. Từ điển trang gọn (lean) thiếu khóa `landing.apps.*` làm header hiện khóa thô.

---

### Task 1: Route `/apps`, chuyển hướng, SEO

**Files:** `packages/core/paths/marketing.ts`, `paths.ts`, `consistency.test.ts`; `server/internal/service/reserved_slugs.json` + `packages/core/paths/reserved-slugs.ts` (sinh lại); `apps/web/app/apps/{page,office/page,unichat/page}.tsx` (xóa `app/office`, `app/unichat`); `apps/web/platform/app-redirects.mjs` + test; `apps/web/next.config.mjs`; `platform/public-page.tsx`, `marketing-dictionary.ts` (+test), `seo.ts`, `seo-copy.ts` (+`seo.test.ts`), `search-proxy.ts` (+test); `features/landing/guide-content.ts`.

**Interfaces:** `paths.apps.root() → "/apps"`, `paths.apps.office() → "/apps/office"`, `paths.apps.unichat() → "/apps/unichat"`; `APP_REDIRECTS: { source: string; destination: string; permanent: true }[]`.

- [ ] Test: consistency builders dùng `paths.apps.*`; seo test `seoMetadata("/apps/unichat","vi").alternates.canonical === "/vi/apps/unichat"`, breadcrumb của `/apps/office` có mục `/apps`; redirects test có 4 cặp `/office→/apps/office`, `/vi/office→/vi/apps/office`, `/unichat→/apps/unichat`, `/vi/unichat→/vi/apps/unichat`.
- [ ] Sửa code, sinh `pnpm generate:reserved-slugs`, chạy test core paths + web platform.
- [ ] Commit `feat(web): /apps route family with 308 redirects from /office and /unichat`.

### Task 2: Chữ vi/en

**Files:** `packages/core/i18n/locales/{vi,en}.json`.

- [ ] Thêm `landing.nav.apps`, `landing.apps.*`; viết lại `landing.unichat.*` theo §3 của spec; xóa khóa không còn dùng (`landing.unichat.points.*`, `landing.nav.office`, `landing.nav.unichatDescription` nếu không còn nơi gọi).
- [ ] Chạy `node --test scripts/i18n-landing-keys.test.mjs scripts/i18n-duplicate-keys.test.mjs` và parity của core i18n.

### Task 3: Danh mục và khối dùng chung

**Files:** `apps/web/features/landing/apps/{catalog.ts, app-icon.tsx, visitor-device.ts, app-bar.tsx, app-download.tsx, other-apps.tsx, apps.css}` + test `app-download.test.tsx`, `app-bar.test.tsx`; sửa `app-downloads.tsx` (giữ `useAppInstallers`).

**Interfaces:**
- `APP_CATALOG: readonly AppEntry[]`, `AppEntry = { key: "web"|"office"|"unichat"; href: string; installers: InstallerCatalogue|null; stores: boolean; platforms: readonly Platform[] }`, `Platform = "web"|"macos"|"windows"|"linux"|"ios"|"android"`.
- `useVisitorDevice(): { phone: "ios"|"android"|null; desktop: DesktopOS|null; guess: DesktopPlatformGuess; ready: boolean }`.
- `<AppIcon app size />`, `<AppBar app sections cta />` (`sections: { id: string; labelKey: string }[]`), `<AppDownload app copy id />`, `<OtherApps current />`.

- [ ] Test khối tải: trạng thái A–F, thẻ nổi bật theo UA (Windows, iPhone, Android, Mac uncertain), store công khai thắng pilot, cấu hình lệch.
- [ ] Test thanh ứng dụng: breadcrumb về `/apps`, nút tải ghi theo máy, danh sách mục trên điện thoại.
- [ ] Commit `feat(web): shared app bar, download block and app catalogue`.

### Task 4: Menu "Ứng dụng" và footer

**Files:** `site-header.tsx`, `header-directory.tsx` (+css), `site-footer.tsx`, `office-header.test.tsx`.

- [ ] Test: nhóm header theo thứ tự Sản phẩm, Ứng dụng, Giải pháp, Tìm hiểu; menu Ứng dụng có link tới `/apps/unichat`, `/apps/office`, web, mục Office for Personal không bấm được, link "Tất cả ứng dụng" về `/apps`.
- [ ] Commit `feat(web): Apps menu replaces the Office menu`.

### Task 5: Trang UniChat

**Files:** `unichat-page.tsx`, `unichat/{hero.tsx, stage.tsx, story.tsx, story-stage.tsx, trust.tsx, closing.tsx}`, `unichat.css`, test `unichat-page.test.tsx`.

- [ ] Test: tiêu đề hai dòng, bong bóng; sân khấu `role=img` có nhãn; nút "Phát lại"; bốn bước đổi sân khấu khi bấm; khối tải giữ hành vi L1; hỏi đáp 4 câu; ứng dụng khác bỏ UniChat; không khóa thô.
- [ ] Commit `feat(web): redesigned UniChat page`.

### Task 6: Hub `/apps`

**Files:** `apps/apps-page.tsx`, `apps/download-matrix.tsx`, `apps/phone-downloads.tsx`, css, test `apps-page.test.tsx`.

- [ ] Test: ba thẻ, nền chung; ma trận đúng ô (bản cài từ cấu hình, "—" kèm "Không có bản", cột máy người xem tô sáng); UA iPhone ra danh sách "cho chiếc iPhone này"; hỏi đáp 4 câu.
- [ ] Commit `feat(web): /apps hub`.

### Task 7: Office trong khung mới

**Files:** `office-page.tsx`, `office-page.test.tsx`.

- [ ] Thanh ứng dụng (Tổng quan, Trình soạn thảo, Tải về, Hỏi đáp; nút "Tải dùng thử"), khối tải dùng chung, ứng dụng khác; giữ hero, tab sáu trình soạn thảo, kết nối, công việc.
- [ ] Commit `feat(web): Office page in the apps frame`.

### Task 8: Kiểm và soát

- [ ] `pnpm --filter @uniwork/web typecheck`, `pnpm --filter @uniwork/web lint`, vitest các file đã sửa, `pnpm knip`.
- [ ] Chạy web dev, soát `/apps`, `/apps/unichat`, `/apps/office` ở 1440 và 390, sáng và tối, so với canvas.
- [ ] Cập nhật `docs/office/landing-design.md` (đường dẫn mới), trạng thái spec/plan, bình luận `[agent]` vào UNI-1913.
