# UniWork Platform — Thiết kế đợt 1

**Ngày:** 2026-08-24
**Trạng thái:** Đã duyệt (brainstorming với chủ dự án)

## 1. Bối cảnh & mục tiêu

- **usf (UniAI/Multica)** — `../usf` — là hệ thống production full-stack: backend Go + Postgres, monorepo pnpm/turbo, apps web/desktop/mobile. Đây là **chuẩn kiến trúc** cần kế thừa.
- **unidigiwork** — `../unidigiwork` — là demo UI sinh từ Lovable (TanStack Start + Supabase). Đây **chỉ là tài liệu tham khảo tính năng và flow màn hình** — không copy code, không copy stack.
- **uniwork** (repo này) là codebase mới hoàn toàn, sao chép 100% kiến trúc usf, hiện thực các tính năng của unidigiwork để **chạy thật với dữ liệu thật**.

**Phạm vi đợt 1** (đã chốt): nền Auth + workspace/tenant, module **Tasks**, module **Meetings có video call thật qua LiveKit**. Mức độ: demo được với dữ liệu thật (đăng nhập thật, CRUD thật), chưa cần production-grade (billing, scale, monitoring).

**Ngoài phạm vi đợt 1**: reports, workflows/agents, email, blog/pricing/marketing pages, recording/AI transcript cho meeting, desktop/mobile apps, billing.

## 2. Nguyên tắc kế thừa

1. **Kiến trúc chuẩn usf ở mọi tầng** — cấu trúc thư mục, phân lớp backend (handler → service → pkg/db), monorepo packages/apps, design tokens, i18n. Khi phân vân, mở `../usf` xem cách usf làm và làm giống.
2. **unidigiwork chỉ để đối chiếu**: màn hình Tasks/Meetings cần những trường gì, flow nào — đọc để hiểu yêu cầu, rồi **viết mới** theo convention usf.
3. **YAGNI**: chỉ dựng những gì đợt 1 cần. Không dựng trước daemon/agent runtime/integrations của usf.

## 3. Cấu trúc repo & tech stack

```
uniwork/
├── server/                      # Backend Go — cấu trúc theo usf/server
│   ├── cmd/
│   │   ├── server/              # entrypoint HTTP server
│   │   └── migrate/             # chạy SQL migrations
│   ├── internal/
│   │   ├── config/              # env config
│   │   ├── logger/              # slog + tint (như usf)
│   │   ├── middleware/          # auth JWT, CORS, request logging
│   │   ├── auth/                # register/login/refresh, JWT (golang-jwt/v5)
│   │   ├── handler/             # HTTP handlers — chi router, 1 file/domain
│   │   ├── service/             # business logic, không đụng HTTP/SQL trực tiếp
│   │   ├── realtime/            # WebSocket hub (gorilla/websocket)
│   │   └── meetings/            # LiveKit token minting (livekit/protocol auth)
│   ├── pkg/db/                  # sqlc: queries/*.sql + generated/ (chuẩn usf)
│   ├── migrations/              # SQL migrations NNN_name.up.sql/.down.sql (chuẩn usf)
│   ├── sqlc.yaml
│   └── go.mod
├── packages/
│   ├── core/                    # api client, hooks, types (zod), query-client,
│   │   │                        #   realtime client, i18n — cấu trúc domain-folder như usf/packages/core
│   ├── ui/                      # design system: Base UI (@base-ui/react) + Tailwind 4
│   │                            #   + design tokens theo triết lý usf (xem §6)
│   ├── views/                   # màn hình theo domain: auth, layout, navigation,
│   │                            #   workspace, tasks, meetings — như usf/packages/views
│   ├── tsconfig/
│   └── eslint-config/
├── apps/
│   └── web/                     # Next.js App Router shell — như usf/apps/web:
│                                #   app/(auth)/..., app/[workspaceSlug]/...
├── docker-compose.yml           # postgres + redis + server + web
├── pnpm-workspace.yaml          # có catalog: pinned versions như usf
├── turbo.json
└── Makefile                     # make dev / migrate / sqlc / test
```

**Stack:**

| Tầng | Công nghệ | Ghi chú |
|---|---|---|
| Backend | Go 1.26, chi v5, pgx v5, sqlc, golang-jwt v5, gorilla/websocket | đúng bộ usf |
| DB | PostgreSQL 16 | ULID cho ID (oklog/ulid như usf) |
| Cache/pubsub | Redis | dùng cho realtime fanout; đợt 1 có thể chạy 1 node, vẫn dựng sẵn |
| Frontend | Next.js (App Router) + React 19 + Tailwind CSS 4 | như usf/apps/web |
| UI kit | @base-ui/react + design tokens riêng | như usf/packages/ui |
| Data fetching | TanStack Query + zod validation tại boundary | như usf ("API Response Compatibility") |
| Video | LiveKit Cloud, token mint server-side | livekit/server-sdk-go |
| Monorepo | pnpm workspaces + turbo | như usf |
| i18n | i18next + react-i18next, vi + en | như usf |

## 4. Data model (đợt 1)

Tất cả bảng dùng ULID text ID, `created_at`/`updated_at` timestamptz. Mọi bảng nghiệp vụ có `workspace_id` — cách ly tenant kiểm tra ở service layer (membership) như usf.

**Nền:**
- `users` — id, email (unique), password_hash, display_name, avatar_url
- `workspaces` — id, slug (unique), name, created_by
- `workspace_members` — workspace_id, user_id, role (`owner`/`admin`/`member`), PK (workspace_id, user_id)
- `invitations` — id, workspace_id, email, role, token, expires_at, accepted_at

**Tasks:**
- `tasks` — id, workspace_id, title, description (text/markdown), status (`todo`/`in_progress`/`done`/`cancelled`), priority (`low`/`medium`/`high`/`urgent`), assignee_id nullable, due_date nullable, position (float — thứ tự trong cột board), created_by
- `task_comments` — id, task_id, author_id, body

**Meetings:**
- `meetings` — id, workspace_id, title, description, starts_at, ends_at, room_name (unique, sinh từ ULID), created_by
- `meeting_attendees` — meeting_id, user_id, PK (meeting_id, user_id)
- `meeting_notes` — id, meeting_id, author_id, body

## 5. API & realtime

REST dưới `/api/v1`, JSON, lỗi trả `{error: {code, message}}` thống nhất. Auth bằng access JWT (Bearer, TTL ngắn) + refresh token (httpOnly cookie).

**Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`

**Workspaces:** `POST /workspaces`, `GET /workspaces`, `GET /workspaces/:slug`, `PATCH /workspaces/:id`, `GET|POST /workspaces/:id/members`, `POST /workspaces/:id/invitations`, `POST /invitations/:token/accept`

**Tasks:** `GET /workspaces/:id/tasks` (filter status/assignee), `POST /workspaces/:id/tasks`, `GET|PATCH|DELETE /tasks/:id` (PATCH gồm đổi status/position cho board kéo-thả), `GET|POST /tasks/:id/comments`

**Meetings:** `GET /workspaces/:id/meetings` (upcoming/past), `POST /workspaces/:id/meetings`, `GET|PATCH|DELETE /meetings/:id`, `GET|POST /meetings/:id/notes`, `POST /meetings/:id/token` → `{token, url}` — server kiểm tra membership rồi mint LiveKit access token; LiveKit API secret không bao giờ xuống FE.

**Realtime:** `GET /api/v1/ws?workspace=...` — WebSocket hub per workspace (mô hình thu gọn của usf `internal/realtime`). Sự kiện: `task.created|updated|deleted`, `comment.created`, `meeting.created|updated|deleted`. FE (packages/core/realtime) nhận event → invalidate TanStack Query cache. Fanout qua Redis pub/sub để sẵn đường chạy nhiều instance.

## 6. Design system & UI

- `packages/ui` theo mô hình usf: primitives trên **Base UI**, styled bằng **Tailwind 4 + CSS design tokens** (CSS variables), light/dark từ đầu.
- Triết lý thiết kế theo usf PRODUCT.md: **hierarchy bằng grayscale, màu chỉ là signal** (status, error, brand — tối đa 2–3 màu semantic/màn hình), tối đa 3 cấp text hierarchy, "subtraction by default". Cấm hardcode giá trị màu Tailwind trong views — mọi màu qua token.
- `packages/views` viết mới toàn bộ màn hình, cấu trúc domain-folder + i18n key như usf/packages/views:
  - `auth/` — đăng nhập, đăng ký, chấp nhận lời mời
  - `layout/`, `navigation/` — shell + sidebar (chỉ hiện Tasks, Meetings, Settings)
  - `workspace/` — tạo workspace, onboarding tối giản, members & invitations
  - `tasks/` — list view + board view (kéo-thả đổi status/position), task detail (mô tả, assignee, priority, due date, comments)
  - `meetings/` — danh sách upcoming/past, form tạo meeting, màn phòng họp
- **Phòng họp LiveKit**: dựng mới trên `@livekit/components-react` (grid người tham gia, mic/cam toggle, screen share, leave), style lại theo token uniwork. Đọc unidigiwork (`livekit-stage.tsx`, `screen-share-quality.ts`) chỉ để tham khảo hành vi cần có.
- `apps/web` là shell mỏng: route groups `(auth)` và `[workspaceSlug]` như usf, mọi UI thật nằm trong packages.
- i18n: i18next, tiếng Việt là ngôn ngữ chính, cấu trúc sẵn để thêm en.

## 7. Xử lý lỗi & bảo mật (đợt 1)

- Mọi handler trả error contract thống nhất; service trả typed errors, handler map sang HTTP status.
- Middleware auth verify JWT; mọi truy vấn nghiệp vụ đi qua service kiểm tra workspace membership trước khi chạm pkg/db (không tin `workspace_id` từ client).
- Password: bcrypt. Refresh token: lưu hash trong DB, revoke được.
- Secrets (DB, JWT, LiveKit) qua env — file `.env.example` đầy đủ, không commit secret.

## 8. Testing & vận hành

- **Go**: table-driven tests cho service layer (auth, membership check, tasks, meetings); test tầng db chạy với Postgres trong docker (testcontainers hoặc compose).
- **FE**: vitest cho packages/core (api client, zod schemas); component test tối thiểu cho views phức tạp (board).
- **E2E**: 1 Playwright smoke: đăng ký → tạo workspace → tạo task → kéo task sang cột khác → tạo meeting → join phòng (mock/skip LiveKit connect trong CI).
- **Dev loop**: `make dev` (compose up postgres+redis, chạy server Go + `pnpm dev`); `make migrate`, `make sqlc`, `make test`.
- **Deploy demo**: `docker-compose.yml` build server + web images, chạy trên VPS/local.

## 9. Lộ trình sau đợt 1 (định hướng, chưa thiết kế)

Reports (trên dữ liệu tasks/meetings thật) → Workflows/Agents → Meeting AI (recording, transcript) → desktop app. Mỗi đợt lặp lại chu trình spec → plan → implement.
