# UniWork

Nền tảng làm việc số (tasks + meetings với video call) — kiến trúc kế thừa từ usf:
backend Go (chi + pgx + sqlc) · PostgreSQL · Redis · monorepo pnpm/turbo ·
Next.js + Tailwind 4 + Base UI · realtime WebSocket · LiveKit.

## Yêu cầu

- Go ≥ 1.26, Node ≥ 22, pnpm ≥ 9, Docker
- `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest` (khi sửa queries)

## Chạy dev

```sh
cp .env.example .env        # điền JWT_SECRET; LiveKit để trống nếu chưa có
pnpm install
make dev                    # db-up + migrate + server :8080 + web :3000
```

Lưu ý: nếu cổng 8080 đã bị chiếm, đổi `PORT`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_WS_URL` trong `.env` (ví dụ 8090).

## Video call (LiveKit)

Tạo project free ở https://cloud.livekit.io, điền vào `.env`:
`LIVEKIT_URL` (wss://…livekit.cloud), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
restart server.

## Test

```sh
make test      # Go + FE (cần docker db: make db-up)
make e2e       # Playwright smoke (cần make dev đang chạy)
```

## Cấu trúc

- `server/` — Go: handler → service → pkg/db (sqlc); realtime WS; migrations
- `packages/core` — api client, zod schemas, hooks, i18n
- `packages/ui` — design tokens + primitives (Base UI)
- `packages/views` — màn hình theo domain
- `apps/web` — Next.js shell
- `docs/superpowers/` — spec & plan

Spec: `docs/superpowers/specs/2026-08-24-uniwork-platform-design.md`

## Deploy demo

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```
