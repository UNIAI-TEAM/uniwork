# UniWork — Ứng dụng mobile (Expo / React Native) theo kiến trúc `usf`

**Ngày:** 2026-09-04
**Trạng thái:** Đề xuất — chờ duyệt (điểm xuất phát cho C-08; chi tiết màn hình chốt khi Giai đoạn F qua nửa đường)
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md`, `2026-09-07-tasks-work-management-parity-design.md`, `2026-09-04-notifications-design.md`, `2026-08-29-meeting-world-class-design.md`, `2026-09-04-agent-actor-model-design.md`
**Tham chiếu:** ADR 0011; `../usf/apps/mobile/CLAUDE.md`, `../usf/apps/mobile/README.md`, `../usf/.github/workflows/mobile-verify.yml` (kiến trúc nguồn); IA V2 bản cũ (5 tab) chỉ để tham chiếu điều hướng

> **Ghi chú số migration:** spec này không có migration; mobile dùng API và sự kiện đã có.

## 1. Mục tiêu

Một ứng dụng iOS (Android sau) để thành viên làm được **luồng cốt lõi** khi rời bàn làm
việc: xem và cập nhật task của mình, đọc và trả lời chat, nhận thông báo, vào họp, duyệt
đề xuất của agent. Không phải bản sao web thu nhỏ; là ứng dụng native, giữ đúng ngữ nghĩa
sản phẩm của web.

**Ngoài phạm vi đợt đầu:** soạn thảo tài liệu, quản trị org/workspace, billing, admin,
workflow builder, Android (đợt sau), tablet layout.

## 2. Quyết định đã chốt

| # | Quyết định | Nguồn |
|---|---|---|
| 1 | `apps/mobile/` là app Expo độc lập; chỉ import type + pure function từ `@uniwork/core` | ADR 0011 |
| 2 | Không tái dùng `packages/views` và `packages/ui`; mobile tự sở hữu UI bằng react-native-reusables + NativeWind 4 | ADR 0011, `usf` §Tech-stack |
| 3 | Bốn điều phải khớp web: số đếm/hiển thị, quyền, enum/transition, danh tính dữ liệu | `usf` §Behavioral parity |
| 4 | Realtime 3 tầng riêng; patch trước, invalidate sau; reconnect chỉ invalidate key của hook | `usf` §Realtime |
| 5 | CI riêng `mobile-verify`, không chặn PR web; phát hành `mobile-v*` qua EAS | `usf` §Build & release |
| 6 | iOS trước; Android khi iOS qua DoD | chủ sở hữu sản phẩm |
| 7 | 5 tab: Home (My Work) · Chat · Work · Meet · More; Inbox ("Hộp việc") nằm trong Home | IA V2 bản cũ |

## 3. Cấu trúc thư mục (mirror `usf`)

```text
apps/mobile/
  app/                    # Expo Router: (auth)/, (app)/[org]/[ws]/{home,chat,work,meet,more}
  components/{ui,nav,task,chat,meeting,inbox,agent,brand}/
  data/
    api.ts                # ApiClient: fetchValidated / fetchValidatedWith (parseWithFallback)
    schemas.ts            # Zod lenient + EMPTY_* fallback (mirror packages/core/api/endpoints)
    queries/ mutations/   # key factory riêng: taskKeys, chatKeys, meetingKeys, inboxKeys
    realtime/             # ws-client.ts, realtime-provider.tsx, use-<feature>-realtime.ts, <feature>-ws-updaters.ts
    auth-store.ts workspace-store.ts secure-storage.ts query-client.ts
  lib/                    # pure helpers + *.test.ts (vitest, Node env): *-display.ts mirror web
  docs/                   # rnr-migration.md, ADR riêng của mobile nếu có
  CLAUDE.md               # luật mobile (copy cấu trúc usf, đổi tên gói)
  app.config.ts .env.example .env.staging
```

## 4. Ranh giới import (lint, không phải quy ước)

| Từ | Được | Không được |
|---|---|---|
| `@uniwork/core/types/*` | `import type` | giá trị runtime |
| `@uniwork/core` pure function | `permissions/rules.ts`, `i18n` glossary/format, Zod schema trong `api/schema.ts`, catalogue sự kiện | hooks, Zustand store, `query-client`, `realtime/use-realtime-sync`, `navigation`, `paths` builder (mobile có `paths` riêng theo Expo Router) |
| `@uniwork/views`, `@uniwork/ui`, `next/*` | — | tất cả |

Cùng logic ở hai phía (dedupe inbox, coalesce timeline, sort task) ⇒ **copy thiết kế vào
`apps/mobile/lib/<x>-display.ts`**, ghi ở đầu file "mirror của `packages/core/<domain>/…`",
có test pure-function. Đây là parity hazard số một của `usf` (sự cố inbox 2026-05-09).

## 5. Màn hình đợt đầu và điểm parity

| Tab | Màn hình | Đọc từ API | Điểm phải khớp web |
|---|---|---|---|
| Home | My Work (task của tôi xuyên workspace), Hộp việc | `/me/tasks`, `/me/notifications` (F-05, F-07) | gộp notification theo `group_key` như web; đếm chưa đọc = cùng công thức |
| Work | Board/list task workspace, task detail (status, assignee kể cả agent, comment, attachment, panel UNI: trạng thái run thật, duyệt/từ chối proposal) | tasks API (F-05), agents API (F-10/A-01) | 7 status cố định, badge agent, `If-Match` 409 xử lý đúng |
| Chat | Danh sách hội thoại, phòng, DM, gọi thoại (đợt 2) | chat API | reaction, chặn, typing mirror web |
| Meet | Lịch họp hôm nay, vào phòng (LiveKit React Native SDK), lobby | meetings API | quyền vào phòng do server; token TTL + re-join |
| More | Chuyển org/workspace, hồ sơ, ngôn ngữ, giao diện sáng/tối/hệ thống, đăng xuất | me/orgs API | switching semantics giống web |

Empty state trung thực, không mock (PRODUCT.md). Vi/en ngang hàng; i18n riêng của mobile
dùng cùng glossary `docs/conventions.md` §2.

## 6. Realtime

Cùng giao thức relay (`<entity>.<verb>`, id-only) như web. Ba tầng: `ws-client.ts` (một
socket, backoff jitter, idle/active/paused theo AppState), `realtime-provider.tsx` (mount
theo auth + workspace + AppState + NetInfo), `use-<feature>-realtime.ts`. Listing-level mount
ở `app/(app)/[org]/[ws]/_layout.tsx` (inbox, my-tasks); per-record mount trong màn hình
(task detail, chat room). Payload của UniWork là id-only ⇒ mặc định **invalidate key hẹp**;
khi F-07/F-05 bổ sung payload đầy đủ cho vài sự kiện nóng (task.updated, message.created)
thì patch. Reconnect: mỗi hook tự invalidate key của mình, không sweep toàn cục.

## 7. Auth và bảo mật

- Token trong `expo-secure-store`; refresh như web qua `POST /auth/refresh` (cookie không
  dùng được trên native ⇒ server cần chấp nhận refresh token trong body cho client mobile,
  có `client_kind = mobile` trong audit). Điểm này cần một PR nhỏ phía Go, ghi vào plan.
- Không lưu dữ liệu nghiệp vụ ngoài cache TanStack (in-memory); offline chỉ đọc cache.
- Deep link `uniwork://` cho lời mời, task, meeting; universal link sau khi có domain.
- Push: APNs qua Expo Notifications, đăng ký device token vào bảng `push_subscriptions`
  của F-07 (thêm `platform = ios`), gửi qua consumer `notification.push`.

## 8. Build, CI, phát hành

- `pnpm ios:mobile*` script mirror `usf/apps/mobile/README.md` (dev / staging / prod,
  simulator / device, Debug / Release); bundle id đổi theo `APP_ENV`.
- `.github/workflows/mobile-verify.yml`: path-filter `apps/mobile/**`, `packages/core/**`;
  typecheck + lint + vitest; CI chính filter `!@uniwork/mobile`.
- `mobile-release.yml`: tag `mobile-v*.*.*` ⇒ EAS build + submit TestFlight; OTA cho sửa JS.
- `make doctor` thêm kiểm tra Xcode/CocoaPods khi có `apps/mobile`.

## 9. Kiểm thử và DoD

- Vitest Node cho mọi `lib/*-display.ts` (parity), schema fallback, ws-updaters.
- Maestro hoặc Detox cho 3 luồng vàng: đăng nhập → My Work → cập nhật status; nhận
  notification → mở task; vào phòng họp. Chạy trên simulator trong `mobile-verify` nightly.
- DoD chung áp dụng (`docs/engineering/DEFINITION_OF_DONE.md`) trừ mục web-only (route
  builder, Playwright); thêm: sáng/tối/hệ thống, VoiceOver cho tab bar và task list, mục
  tiêu chạm ≥ 44 px.

## 10. Kế thừa từ bản cũ và `usf`

| Nguồn | Xử lý |
|---|---|
| IA V2 5 tab, trang More theo nhóm | Kế thừa điều hướng |
| `/m/*`, `sw-push.js`, `push-client.ts`, manifest PWA | Không mang sang |
| `usf/apps/mobile/CLAUDE.md` | Copy cấu trúc làm `apps/mobile/CLAUDE.md`, đổi tên gói và domain (issue → task, inbox → hộp việc) |
| `usf/apps/mobile/data/{api,schemas,query-client,secure-storage}.ts`, `realtime/*` | Copy thiết kế lớp hạ tầng; domain viết mới |
| `usf/apps/mobile/docs/rnr-migration.md` | Không lặp lại: UniWork bắt đầu thẳng bằng RNR, không có giai đoạn component tự viết |

## 11. Câu hỏi mở

1. Android ở giai đoạn A hay E?
2. Gọi thoại/họp trên mobile dùng LiveKit React Native SDK ngay đợt đầu hay chỉ nhận lịch và mở web?
3. Có cho phép offline ghi (queue mutation) không, hay chỉ đọc cache?
4. Tên gói `@uniwork/mobile`, bundle id `vn.unicomhub.uniwork` — xác nhận.
