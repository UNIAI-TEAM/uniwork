# UniWork

Nền tảng làm việc số (tasks + meetings với video call) — kiến trúc kế thừa từ usf:
backend Go (chi + pgx + sqlc) · PostgreSQL · Redis · monorepo pnpm/turbo ·
Next.js + Tailwind 4 + Base UI · realtime WebSocket · LiveKit.

## Yêu cầu

- Go ≥ 1.26, Node ≥ 22, pnpm ≥ 9, Docker
- `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest` (khi sửa queries)

## Chạy dev

```sh
make dev                    # tạo .env từ .env.example nếu chưa có, cài deps, db, migrate, chạy server + web
make help                   # mọi target, có mô tả
```

Cổng mặc định 8080/3000 — đổi `PORT`, `FRONTEND_PORT`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_WS_URL` trong `.env` nếu bị chiếm. `.env.example` liệt kê **mọi**
biến server và script đọc.

### Worktree (chạy nhiều nhánh song song)

Mỗi git worktree có DB riêng trên cùng container Postgres và cặp cổng riêng:

```sh
make worktree-env           # sinh .env.worktree (DB + cổng duy nhất theo đường dẫn)
make setup-worktree && make start-worktree
make check-worktree
```

## Video call (LiveKit)

Tạo project free ở https://cloud.livekit.io, điền vào `.env`:
`LIVEKIT_URL` (wss://…livekit.cloud), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
restart server.

## Kiểm tra

```sh
make check     # typecheck → lint → unit + contract tests → Go (-race) → Playwright
make test-go   # chỉ Go (tự đảm bảo DB test + migration)
make e2e       # chỉ Playwright, cần app đang chạy (E2E_BASE_URL)
```

CI (`.github/workflows/ci.yml`) chạy mọi thứ trừ Playwright.

## Cấu trúc

- `server/` — Go: handler → service → pkg/db (sqlc); realtime WS; migrations
- `packages/core` — api endpoints (qua `parseWithFallback`), hooks, stores, realtime, permissions, paths, i18n
- `packages/ui` — design tokens + primitives (Base UI)
- `packages/views` — màn hình theo domain + `navigation/` (adapter, `AppLink`) + `layout/` (guard)
- `apps/web` — Next.js shell
- `docs/superpowers/` — spec & plan · `docs/conventions.md` — naming, glossary vi–en, giọng văn
- `CLAUDE.md` / `AGENTS.md` — luật cho agent (nguồn sự thật)

Spec đợt 1: `docs/superpowers/specs/2026-08-24-uniwork-platform-design.md`
Spec onboarding + tổ chức: `docs/superpowers/specs/2026-08-25-onboarding-organizations-design.md`

URL workspace có dạng `/{orgSlug}/{workspaceSlug}/…` — workspace nằm trong tổ chức; `NEXT_PUBLIC_APP_URL` là host hiển thị trong pill đường dẫn khi onboarding.

## Deploy demo

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```
