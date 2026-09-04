# UniWork Đợt 1 — Kế hoạch triển khai

> **Trạng thái:** shipped

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng codebase `uniwork` mới 100% theo kiến trúc usf: backend Go + Postgres, monorepo pnpm/turbo, Next.js web app — chạy thật Auth + Workspaces, Tasks, Meetings (video call LiveKit).

**Architecture:** Backend Go phân lớp handler → service → pkg/db (sqlc), realtime qua WebSocket hub (+ Redis pub/sub), JWT auth với refresh-token rotation. Frontend là monorepo `packages/core|ui|views` + `apps/web` (Next.js App Router shell mỏng), design tokens grayscale theo triết lý usf. unidigiwork (`../unidigiwork`) chỉ dùng đối chiếu tính năng — KHÔNG copy code.

**Tech Stack:** Go 1.26 (chi v5, pgx v5, sqlc, golang-jwt v5, gorilla/websocket, go-redis v9, oklog/ulid v2, livekit/protocol) · PostgreSQL 16 · Redis 7 · Next.js ^16.2 · React 19.2 · Tailwind CSS 4 · @base-ui/react ^1.3 · TanStack Query v5 · zod · @dnd-kit · @livekit/components-react · pnpm + turbo · vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-uniwork-platform-design.md`

## Global Constraints

- Go module: `github.com/unicomhub/uniwork/server`; Go `1.26`.
- Node ≥ 22, pnpm ≥ 9. FE packages scope `@uniwork/*` (core, ui, views, tsconfig, eslint-config), app `@uniwork/web`.
- ID mọi bảng: ULID (text 26 ký tự), sinh bằng `oklog/ulid/v2`. Timestamps `timestamptz`, default `now()`.
- Error contract API: JSON `{"error":{"code":"...","message":"..."}}`. Map lỗi: not_found→404, forbidden→403, invalid_credentials→401, unauthorized→401, conflict→409, invalid_request→400, còn lại→500.
- REST prefix `/api/v1`. Auth: access JWT (Bearer, HS256, TTL 15m) + refresh token (cookie httpOnly `uniwork_refresh`, TTL 30 ngày, rotation, lưu SHA-256 hash trong DB).
- Tenant isolation: mọi service method nghiệp vụ kiểm tra workspace membership trước khi đọc/ghi. KHÔNG tin `workspace_id` từ client cho tài nguyên đã có id — load tài nguyên rồi check membership theo `workspace_id` của nó.
- Design tokens: views/ui KHÔNG hardcode màu Tailwind (`bg-gray-100`, `text-red-500`…); chỉ dùng class ánh xạ token (`bg-surface`, `text-secondary`, `text-danger`…) định nghĩa ở Task 9. Hierarchy bằng grayscale, màu chỉ là signal.
- i18n: chuỗi UI qua i18next key (namespace mặc định, locale `vi`); en để trống đợt 1 nhưng cấu trúc sẵn.
- sqlc: queries ở `server/pkg/db/queries/*.sql`, generated ra `server/pkg/db/generated` (package `db`). Sau khi sửa `.sql` phải chạy `make sqlc` và commit code generated.
- Migrations: `server/migrations/NNN_name.up.sql` + `.down.sql`, runner tự viết (Task 2), track bảng `schema_migrations`.
- Test Go cần Postgres: đọc `TEST_DATABASE_URL` (default `postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable`), `t.Skip` nếu không kết nối được. Chạy `make db-up` trước khi test.
- Commit sau mỗi task (message tiếng Anh, conventional commits). TDD: viết test trước ở mọi bước có logic.
- Khi phân vân convention: mở `../usf` xem cách usf làm và làm giống.

---

## Phase A — Nền tảng backend (Task 1–4)

### Task 1: Scaffold monorepo + server Go skeleton + health endpoint

**Files:**
- Create: `.gitignore`, `.env.example`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `Makefile`, `docker-compose.yml`
- Create: `server/go.mod`, `server/cmd/server/main.go`
- Create: `server/internal/config/config.go`, `server/internal/logger/logger.go`
- Create: `server/internal/handler/router.go`, `server/internal/handler/json.go`, `server/internal/handler/health.go`
- Test: `server/internal/handler/health_test.go`

**Interfaces:**
- Produces: `config.Load() (Config, error)`; `logger.New() *slog.Logger`; `handler.Deps{Cfg config.Config, Log *slog.Logger}` + `handler.New(d Deps) http.Handler`; `respondJSON(w http.ResponseWriter, status int, v any)`, `respondError(w http.ResponseWriter, status int, code, msg string)` (dùng bởi mọi handler sau).
- Docker: Postgres dev port `5432` db `uniwork`, Postgres test port `5433` db `uniwork_test`, Redis `6379`. User/pass đều `uniwork`/`uniwork`.

- [ ] **Step 1: Files gốc repo**

`.gitignore`:

```
node_modules/
.next/
dist/
.turbo/
.env
*.local
server/bin/
coverage/
test-results/
playwright-report/
```

`package.json` (root):

```json
{
  "name": "uniwork",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "typecheck": "turbo typecheck",
    "lint": "turbo lint",
    "test": "turbo test"
  },
  "devDependencies": {
    "turbo": "^2.5.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  react: "19.2.3"
  react-dom: "19.2.3"
  "@types/react": "^19.2.0"
  "@types/react-dom": "^19.2.0"
  typescript: "^5.9.3"
  "@types/node": "^25.0.10"
  zod: "^4.1.5"
  "@tanstack/react-query": "^5.96.2"
  tailwindcss: "^4"
  "@tailwindcss/postcss": "^4"
  postcss: "^8"
  tailwind-merge: "^3.4.0"
  class-variance-authority: "^0.7.1"
  clsx: "^2.1.1"
  lucide-react: "^1.0.1"
  i18next: "^26.0.8"
  react-i18next: "^17.0.6"
  vitest: "^4.1.0"
  jsdom: "^29.0.1"
  "@vitejs/plugin-react": "^6.0.1"
  "@testing-library/react": "^16.3.2"
  "@testing-library/jest-dom": "^6.9.1"
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "lint": {},
    "test": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

`docker-compose.yml`:

```yaml
name: uniwork
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: uniwork
      POSTGRES_USER: uniwork
      POSTGRES_PASSWORD: uniwork
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: uniwork_test
      POSTGRES_USER: uniwork
      POSTGRES_PASSWORD: uniwork
    ports: ["5433:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
volumes:
  pgdata:
```

`.env.example`:

```
PORT=8080
DATABASE_URL=postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable
TEST_DATABASE_URL=postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-me
FRONTEND_ORIGIN=http://localhost:3000
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

`Makefile`:

```makefile
.PHONY: dev server web db-up db-down migrate-up migrate-down sqlc test test-go test-fe e2e

ENV_FILE ?= .env
ifneq ($(wildcard $(ENV_FILE)),)
include $(ENV_FILE)
export
endif

DATABASE_URL ?= postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable
TEST_DATABASE_URL ?= postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable

db-up:
	docker compose up -d postgres postgres-test redis

db-down:
	docker compose down

migrate-up:
	cd server && go run ./cmd/migrate up

migrate-down:
	cd server && go run ./cmd/migrate down

sqlc:
	cd server && sqlc generate

server:
	cd server && go run ./cmd/server

web:
	pnpm --filter @uniwork/web dev

dev: db-up migrate-up
	$(MAKE) -j2 server web

test-go:
	cd server && go test ./...

test-fe:
	pnpm test

test: test-go test-fe
```

- [ ] **Step 2: Server skeleton**

`server/go.mod` — khởi tạo bằng lệnh (đừng viết tay):

```bash
cd server && go mod init github.com/unicomhub/uniwork/server
go get github.com/go-chi/chi/v5@latest github.com/go-chi/cors@latest github.com/lmittmann/tint@latest
```

`server/internal/config/config.go`:

```go
package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	Port             string
	DatabaseURL      string
	RedisURL         string
	JWTSecret        string
	AccessTokenTTL   time.Duration
	RefreshTokenTTL  time.Duration
	FrontendOrigin   string
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
}

func Load() (Config, error) {
	c := Config{
		Port:            getenv("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		RedisURL:        os.Getenv("REDIS_URL"),
		JWTSecret:       os.Getenv("JWT_SECRET"),
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 30 * 24 * time.Hour,
		FrontendOrigin:  getenv("FRONTEND_ORIGIN", "http://localhost:3000"),
		LiveKitURL:       os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:    os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return c, fmt.Errorf("JWT_SECRET is required")
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
```

`server/internal/logger/logger.go`:

```go
package logger

import (
	"log/slog"
	"os"

	"github.com/lmittmann/tint"
)

func New() *slog.Logger {
	return slog.New(tint.NewHandler(os.Stderr, &tint.Options{Level: slog.LevelDebug}))
}
```

`server/internal/handler/json.go`:

```go
package handler

import (
	"encoding/json"
	"net/http"
)

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func respondError(w http.ResponseWriter, status int, code, msg string) {
	respondJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: msg}})
}

func decode[T any](r *http.Request, dst *T) error {
	return json.NewDecoder(r.Body).Decode(dst)
}
```

`server/internal/handler/health.go`:

```go
package handler

import "net/http"

func (h *handlers) health(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```

`server/internal/handler/router.go`:

```go
package handler

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/unicomhub/uniwork/server/internal/config"
)

type Deps struct {
	Cfg config.Config
	Log *slog.Logger
}

type handlers struct {
	Deps
}

func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{d.Cfg.FrontendOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))
	r.Get("/healthz", h.health)
	r.Route("/api/v1", func(r chi.Router) {
		// domains mount thêm ở các task sau
	})
	return r
}
```

`server/cmd/server/main.go`:

```go
package main

import (
	"net/http"
	"os"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/handler"
	"github.com/unicomhub/uniwork/server/internal/logger"
)

func main() {
	log := logger.New()
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	h := handler.New(handler.Deps{Cfg: cfg, Log: log})
	log.Info("listening", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, h); err != nil {
		log.Error("server", "err", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 3: Test health (viết trước khi chạy — TDD cho router)**

`server/internal/handler/health_test.go`:

```go
package handler

import (
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestHealth(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default()})
	srv := httptest.NewServer(h)
	defer srv.Close()

	res, err := srv.Client().Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
}
```

- [ ] **Step 4: Chạy test + build**

Run: `cd server && go mod tidy && go test ./... && go build ./...`
Expected: PASS, build sạch.

- [ ] **Step 5: Docker + commit**

Run: `make db-up` → 3 container chạy (`docker compose ps`).

```bash
git add -A
git commit -m "feat: scaffold monorepo, Go server skeleton with health endpoint"
```

### Task 2: Migration runner + migration 001 (nền auth/workspace) + sqlc

**Files:**
- Create: `server/migrations/embed.go`, `server/migrations/001_init.up.sql`, `server/migrations/001_init.down.sql`
- Create: `server/cmd/migrate/main.go`
- Create: `server/sqlc.yaml`, `server/pkg/db/queries/users.sql`, `server/pkg/db/queries/refresh_tokens.sql`
- Create: `server/internal/testutil/db.go`
- Test: `server/migrations/migrate_test.go`
- Generated: `server/pkg/db/generated/*` (sqlc)

**Interfaces:**
- Consumes: `config.Load()` (Task 1).
- Produces: `migrations.Up(ctx, pool) error`, `migrations.Down(ctx, pool) error` (rollback 1 bản mới nhất); package `db` (sqlc generated): `db.New(pool) *db.Queries`, `db.User`, `db.RefreshToken`, các method `CreateUser`, `GetUserByEmail`, `GetUserByID`, `CreateRefreshToken`, `GetRefreshTokenByHash`, `RevokeRefreshToken`; `testutil.DB(t) *pgxpool.Pool` (kết nối TEST_DATABASE_URL, migrate up, truncate sạch dữ liệu — mọi test DB sau này dùng hàm này).

- [ ] **Step 1: Viết migration 001**

`server/migrations/001_init.up.sql`:

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE invitations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','member')),
  token        TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_members_user ON workspace_members(user_id);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
```

`server/migrations/001_init.down.sql`:

```sql
DROP TABLE refresh_tokens;
DROP TABLE invitations;
DROP TABLE workspace_members;
DROP TABLE workspaces;
DROP TABLE users;
```

- [ ] **Step 2: Viết test cho runner (fail trước)**

`server/migrations/migrate_test.go`:

```go
package migrations

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Skip("no test database:", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Skip("no test database:", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestUpIsIdempotent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := Up(ctx, pool); err != nil {
		t.Fatal("second up:", err)
	}
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&n); err != nil {
		t.Fatal("users table missing:", err)
	}
}
```

Run: `cd server && go test ./migrations/` → FAIL (Up chưa tồn tại).

- [ ] **Step 3: Viết runner**

`server/migrations/embed.go`:

```go
// Package migrations embeds SQL migrations and applies them in order,
// tracked in schema_migrations, serialized by a Postgres advisory lock
// so concurrent instances don't race (same model as usf).
package migrations

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var fsys embed.FS

const lockKey = 727272

func versions() ([]string, error) {
	entries, err := fsys.ReadDir(".")
	if err != nil {
		return nil, err
	}
	var vs []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".up.sql") {
			vs = append(vs, strings.TrimSuffix(e.Name(), ".up.sql"))
		}
	}
	sort.Strings(vs)
	return vs, nil
}

func Up(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockKey); err != nil {
		return err
	}
	defer conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockKey)

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	vs, err := versions()
	if err != nil {
		return err
	}
	for _, v := range vs {
		var exists bool
		if err := conn.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", v).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := fsys.ReadFile(v + ".up.sql")
		if err != nil {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", v, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", v); err != nil {
			tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

// Down rolls back the single most recent applied migration.
func Down(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var v string
	err = conn.QueryRow(ctx, "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&v)
	if err != nil {
		return fmt.Errorf("nothing to roll back: %w", err)
	}
	sql, err := fsys.ReadFile(v + ".down.sql")
	if err != nil {
		return err
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, string(sql)); err != nil {
		tx.Rollback(ctx)
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM schema_migrations WHERE version=$1", v); err != nil {
		tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}
```

`server/cmd/migrate/main.go`:

```go
package main

import (
	"context"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/logger"
	"github.com/unicomhub/uniwork/server/migrations"
)

func main() {
	log := logger.New()
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("connect", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	dir := "up"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	switch dir {
	case "up":
		err = migrations.Up(ctx, pool)
	case "down":
		err = migrations.Down(ctx, pool)
	}
	if err != nil {
		log.Error("migrate", "dir", dir, "err", err)
		os.Exit(1)
	}
	log.Info("migrate done", "dir", dir)
}
```

Run: `cd server && go get github.com/jackc/pgx/v5@latest && go mod tidy && go test ./migrations/`
Expected: PASS (cần `make db-up` trước).

- [ ] **Step 4: sqlc setup + queries users/refresh_tokens**

Cài sqlc nếu chưa có: `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`

`server/sqlc.yaml`:

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "pkg/db/queries/"
    schema: "migrations/"
    gen:
      go:
        package: "db"
        out: "pkg/db/generated"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_empty_slices: true
```

`server/pkg/db/queries/users.sql`:

```sql
-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, display_name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;
```

`server/pkg/db/queries/refresh_tokens.sql`:

```sql
-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetRefreshTokenByHash :one
SELECT * FROM refresh_tokens
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1;
```

Run: `make sqlc && cd server && go build ./...`
Expected: sinh `pkg/db/generated/{db.go,models.go,users.sql.go,refresh_tokens.sql.go}`, build sạch.

- [ ] **Step 5: testutil.DB**

`server/internal/testutil/db.go`:

```go
// Package testutil provides shared test helpers. DB returns a pool on the
// test database with migrations applied and all business tables truncated,
// so each test starts from a clean slate.
package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/migrations"
)

func DB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skip("no test database:", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skip("no test database:", err)
	}
	if err := migrations.Up(ctx, pool); err != nil {
		t.Fatal("migrate:", err)
	}
	_, err = pool.Exec(ctx, `TRUNCATE users, workspaces, workspace_members,
		invitations, refresh_tokens CASCADE`)
	if err != nil {
		t.Fatal("truncate:", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
```

Lưu ý: các migration sau (002, 003) phải bổ sung bảng mới vào câu TRUNCATE này.

- [ ] **Step 6: Chạy toàn bộ + commit**

Run: `cd server && go test ./... && go vet ./...`
Expected: PASS.

```bash
git add -A
git commit -m "feat: migration runner, schema 001, sqlc setup with user/refresh queries"
```

### Task 3: Auth — password, JWT, register/login/refresh/logout/me

**Files:**
- Create: `server/internal/util/ids.go`
- Create: `server/internal/auth/password.go`, `server/internal/auth/token.go`
- Create: `server/internal/service/errors.go`, `server/internal/service/auth.go`
- Create: `server/internal/middleware/auth.go`
- Create: `server/internal/handler/auth.go`
- Modify: `server/internal/handler/router.go`, `server/internal/handler/json.go`, `server/cmd/server/main.go`
- Test: `server/internal/auth/password_test.go`, `server/internal/auth/token_test.go`, `server/internal/service/auth_test.go`, `server/internal/handler/auth_test.go`

**Interfaces:**
- Consumes: `db.Queries` (Task 2), `testutil.DB` (Task 2).
- Produces:
  - `util.NewID() string` (ULID)
  - `auth.HashPassword(pw string) (string, error)`, `auth.CheckPassword(hash, pw string) bool`
  - `auth.TokenMinter{Secret []byte, TTL time.Duration}` với `Mint(userID string) (string, error)` và `Parse(token string) (userID string, err error)`
  - service sentinel errors: `service.ErrNotFound`, `service.ErrForbidden`, `service.ErrInvalidCredentials`, `service.ErrConflict`, `service.Invalid(msg string) error` (type `ValidationError`)
  - `service.NewAuthService(q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration) *AuthService`; methods: `Register(ctx, email, password, displayName) (Session, error)`, `Login(ctx, email, password) (Session, error)`, `Refresh(ctx, rawToken) (Session, error)`, `Logout(ctx, rawToken) error`, `Me(ctx, userID) (db.User, error)`. `Session{User db.User; AccessToken, RefreshToken string; RefreshExpiresAt time.Time}`
  - `middleware.RequireAuth(m auth.TokenMinter) func(http.Handler) http.Handler`, `middleware.UserID(ctx) string`
  - `handler.mapServiceError(w, log, err)` — map sentinel → HTTP theo Global Constraints
  - `handler.Deps` thêm field: `Auth *service.AuthService`, `Minter auth.TokenMinter`
  - Routes: `POST /api/v1/auth/register|login|refresh|logout`, `GET /api/v1/me`

- [ ] **Step 1: util + auth unit tests (fail trước)**

`server/internal/auth/password_test.go`:

```go
package auth

import "testing"

func TestPasswordRoundtrip(t *testing.T) {
	h, err := HashPassword("s3cret-pass")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "s3cret-pass") {
		t.Fatal("correct password rejected")
	}
	if CheckPassword(h, "wrong") {
		t.Fatal("wrong password accepted")
	}
}
```

`server/internal/auth/token_test.go`:

```go
package auth

import (
	"testing"
	"time"
)

func TestTokenRoundtrip(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	tok, err := m.Mint("user_123")
	if err != nil {
		t.Fatal(err)
	}
	uid, err := m.Parse(tok)
	if err != nil {
		t.Fatal(err)
	}
	if uid != "user_123" {
		t.Fatalf("uid = %q", uid)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	m := TokenMinter{Secret: []byte("test-secret"), TTL: -time.Minute}
	tok, _ := m.Mint("user_123")
	if _, err := m.Parse(tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestWrongSecretRejected(t *testing.T) {
	m := TokenMinter{Secret: []byte("a"), TTL: time.Minute}
	tok, _ := m.Mint("u")
	m2 := TokenMinter{Secret: []byte("b"), TTL: time.Minute}
	if _, err := m2.Parse(tok); err == nil {
		t.Fatal("token with wrong secret accepted")
	}
}
```

Run: `cd server && go test ./internal/auth/` → FAIL (chưa có code).

- [ ] **Step 2: Implement util + auth**

`server/internal/util/ids.go`:

```go
package util

import (
	"crypto/rand"

	"github.com/oklog/ulid/v2"
)

func NewID() string {
	return ulid.MustNew(ulid.Now(), rand.Reader).String()
}
```

`server/internal/auth/password.go`:

```go
package auth

import "golang.org/x/crypto/bcrypt"

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}
```

`server/internal/auth/token.go`:

```go
package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type TokenMinter struct {
	Secret []byte
	TTL    time.Duration
}

func (m TokenMinter) Mint(userID string) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   userID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(m.TTL)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.Secret)
}

func (m TokenMinter) Parse(token string) (string, error) {
	parsed, err := jwt.ParseWithClaims(token, &jwt.RegisteredClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return m.Secret, nil
	})
	if err != nil {
		return "", err
	}
	claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return "", fmt.Errorf("invalid claims")
	}
	return claims.Subject, nil
}
```

Run: `cd server && go get github.com/golang-jwt/jwt/v5@latest golang.org/x/crypto@latest github.com/oklog/ulid/v2@latest && go mod tidy && go test ./internal/auth/`
Expected: PASS.

- [ ] **Step 3: Service errors + AuthService test (fail trước)**

`server/internal/service/errors.go`:

```go
package service

import "errors"

var (
	ErrNotFound           = errors.New("not_found")
	ErrForbidden          = errors.New("forbidden")
	ErrInvalidCredentials = errors.New("invalid_credentials")
	ErrConflict           = errors.New("conflict")
)

type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

func Invalid(msg string) error { return ValidationError{Msg: msg} }
```

`server/internal/service/auth_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

func newAuthService(t *testing.T) *AuthService {
	pool := testutil.DB(t)
	q := db.New(pool)
	m := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	return NewAuthService(q, m, time.Hour)
}

func TestRegisterLoginRefresh(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()

	sess, err := s.Register(ctx, "a@example.com", "password123", "An")
	if err != nil {
		t.Fatal(err)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" {
		t.Fatal("empty tokens")
	}

	if _, err := s.Register(ctx, "a@example.com", "x2345678", "An"); err != ErrConflict {
		t.Fatalf("duplicate email: got %v, want ErrConflict", err)
	}

	if _, err := s.Login(ctx, "a@example.com", "wrong-pass"); err != ErrInvalidCredentials {
		t.Fatalf("wrong password: got %v", err)
	}
	sess2, err := s.Login(ctx, "a@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}

	// rotation: refresh cũ bị revoke sau khi dùng
	sess3, err := s.Refresh(ctx, sess2.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if sess3.RefreshToken == sess2.RefreshToken {
		t.Fatal("refresh token not rotated")
	}
	if _, err := s.Refresh(ctx, sess2.RefreshToken); err != ErrInvalidCredentials {
		t.Fatalf("reused refresh token: got %v", err)
	}

	if err := s.Logout(ctx, sess3.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(ctx, sess3.RefreshToken); err != ErrInvalidCredentials {
		t.Fatalf("refresh after logout: got %v", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()
	if _, err := s.Register(ctx, "bad-email", "password123", "An"); err == nil {
		t.Fatal("bad email accepted")
	}
	if _, err := s.Register(ctx, "b@example.com", "short", "An"); err == nil {
		t.Fatal("short password accepted")
	}
}
```

Run: `cd server && go test ./internal/service/` → FAIL.

- [ ] **Step 4: Implement AuthService**

`server/internal/service/auth.go`:

```go
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type AuthService struct {
	q          *db.Queries
	minter     auth.TokenMinter
	refreshTTL time.Duration
}

func NewAuthService(q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration) *AuthService {
	return &AuthService{q: q, minter: minter, refreshTTL: refreshTTL}
}

type Session struct {
	User             db.User
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
}

func (s *AuthService) Register(ctx context.Context, email, password, displayName string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		return Session{}, Invalid("email không hợp lệ")
	}
	if len(password) < 8 {
		return Session{}, Invalid("mật khẩu tối thiểu 8 ký tự")
	}
	if strings.TrimSpace(displayName) == "" {
		return Session{}, Invalid("tên hiển thị không được để trống")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Session{}, err
	}
	u, err := s.q.CreateUser(ctx, db.CreateUserParams{
		ID: util.NewID(), Email: email, PasswordHash: hash, DisplayName: displayName,
	})
	if isUniqueViolation(err) {
		return Session{}, ErrConflict
	}
	if err != nil {
		return Session{}, err
	}
	return s.newSession(ctx, u)
}

func (s *AuthService) Login(ctx context.Context, email, password string) (Session, error) {
	u, err := s.q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !auth.CheckPassword(u.PasswordHash, password) {
		return Session{}, ErrInvalidCredentials
	}
	return s.newSession(ctx, u)
}

func (s *AuthService) Refresh(ctx context.Context, rawToken string) (Session, error) {
	rt, err := s.q.GetRefreshTokenByHash(ctx, hashToken(rawToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if err := s.q.RevokeRefreshToken(ctx, rt.TokenHash); err != nil {
		return Session{}, err
	}
	u, err := s.q.GetUserByID(ctx, rt.UserID)
	if err != nil {
		return Session{}, err
	}
	return s.newSession(ctx, u)
}

func (s *AuthService) Logout(ctx context.Context, rawToken string) error {
	return s.q.RevokeRefreshToken(ctx, hashToken(rawToken))
}

func (s *AuthService) Me(ctx context.Context, userID string) (db.User, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

func (s *AuthService) newSession(ctx context.Context, u db.User) (Session, error) {
	access, err := s.minter.Mint(u.ID)
	if err != nil {
		return Session{}, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Session{}, err
	}
	refresh := hex.EncodeToString(raw)
	exp := time.Now().Add(s.refreshTTL)
	_, err = s.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(refresh),
		ExpiresAt: pgtype.Timestamptz{Time: exp, Valid: true},
	})
	if err != nil {
		return Session{}, err
	}
	return Session{User: u, AccessToken: access, RefreshToken: refresh, RefreshExpiresAt: exp}, nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
```

Lưu ý: nếu sqlc generate kiểu `ExpiresAt` là `time.Time` (không phải `pgtype.Timestamptz`) thì bỏ wrapper pgtype — đọc `pkg/db/generated/models.go` để khớp đúng kiểu.

Run: `cd server && go test ./internal/service/`
Expected: PASS.

- [ ] **Step 5: Middleware + handler auth (test fail trước)**

`server/internal/middleware/auth.go`:

```go
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

type ctxKey int

const userIDKey ctxKey = 1

func RequireAuth(m auth.TokenMinter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(h, "Bearer ")
			if !ok || token == "" {
				http.Error(w, `{"error":{"code":"unauthorized","message":"missing bearer token"}}`, http.StatusUnauthorized)
				return
			}
			uid, err := m.Parse(token)
			if err != nil {
				http.Error(w, `{"error":{"code":"unauthorized","message":"invalid token"}}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), uid)))
		})
	}
}

func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, userIDKey, uid)
}

func UserID(ctx context.Context) string {
	uid, _ := ctx.Value(userIDKey).(string)
	return uid
}
```

`server/internal/handler/auth_test.go`:

```go
package handler

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// newTestServer dựng handler đầy đủ trên DB test. Các task sau mở rộng
// hàm này khi Deps thêm service mới.
func newTestServer(t *testing.T) *httptest.Server {
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	d := Deps{
		Cfg:    config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: "test"},
		Log:    slog.Default(),
		Minter: minter,
		Auth:   service.NewAuthService(q, minter, time.Hour),
	}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv
}

func postJSON(t *testing.T, srv *httptest.Server, path string, body any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	res, err := srv.Client().Post(srv.URL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestRegisterAndMe(t *testing.T) {
	srv := newTestServer(t)

	res := postJSON(t, srv, "/api/v1/auth/register", map[string]string{
		"email": "h@example.com", "password": "password123", "display_name": "Hà",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register status = %d", res.StatusCode)
	}
	var out struct {
		User        struct{ ID, Email string } `json:"user"`
		AccessToken string                     `json:"access_token"`
	}
	json.NewDecoder(res.Body).Decode(&out)
	if out.AccessToken == "" {
		t.Fatal("no access token")
	}
	// refresh cookie được set
	found := false
	for _, c := range res.Cookies() {
		if c.Name == "uniwork_refresh" && c.HttpOnly {
			found = true
		}
	}
	if !found {
		t.Fatal("refresh cookie not set")
	}

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+out.AccessToken)
	res2, _ := srv.Client().Do(req)
	if res2.StatusCode != 200 {
		t.Fatalf("me status = %d", res2.StatusCode)
	}
}

func TestMeWithoutTokenIs401(t *testing.T) {
	srv := newTestServer(t)
	res, _ := srv.Client().Get(srv.URL + "/api/v1/me")
	if res.StatusCode != 401 {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
}
```

Run: `cd server && go test ./internal/handler/` → FAIL.

- [ ] **Step 6: Implement handler auth + wire router/main**

`server/internal/handler/auth.go`:

```go
package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const refreshCookie = "uniwork_refresh"

type userDTO struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

func toUserDTO(u db.User) userDTO {
	dto := userDTO{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName}
	if u.AvatarUrl != nil {
		dto.AvatarURL = *u.AvatarUrl
	}
	return dto
}

// Lưu ý: kiểu field AvatarUrl do sqlc generate (con trỏ hoặc pgtype.Text) —
// đọc models.go và chỉnh cho khớp.

func (h *handlers) setRefreshCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: token, Path: "/api/v1/auth",
		Expires: exp, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func (h *handlers) sessionResponse(w http.ResponseWriter, sess service.Session) {
	h.setRefreshCookie(w, sess.RefreshToken, sess.RefreshExpiresAt)
	respondJSON(w, http.StatusOK, map[string]any{
		"user": toUserDTO(sess.User), "access_token": sess.AccessToken,
	})
}

func (h *handlers) register(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	sess, err := h.Auth.Register(r.Context(), in.Email, in.Password, in.DisplayName)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	sess, err := h.Auth.Login(r.Context(), in.Email, in.Password)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil || c.Value == "" {
		respondError(w, 401, "unauthorized", "missing refresh token")
		return
	}
	sess, err := h.Auth.Refresh(r.Context(), c.Value)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.sessionResponse(w, sess)
}

func (h *handlers) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		_ = h.Auth.Logout(r.Context(), c.Value)
	}
	h.setRefreshCookie(w, "", time.Unix(0, 0))
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handlers) me(w http.ResponseWriter, r *http.Request) {
	u, err := h.Auth.Me(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}

func (h *handlers) mapServiceError(w http.ResponseWriter, err error) {
	var ve service.ValidationError
	switch {
	case errors.As(err, &ve):
		respondError(w, 400, "invalid_request", ve.Msg)
	case errors.Is(err, service.ErrNotFound):
		respondError(w, 404, "not_found", "not found")
	case errors.Is(err, service.ErrForbidden):
		respondError(w, 403, "forbidden", "forbidden")
	case errors.Is(err, service.ErrInvalidCredentials):
		respondError(w, 401, "invalid_credentials", "invalid credentials")
	case errors.Is(err, service.ErrConflict):
		respondError(w, 409, "conflict", "already exists")
	default:
		h.Log.Error("internal", "err", err)
		respondError(w, 500, "internal", "internal error")
	}
}
```

Sửa `server/internal/handler/router.go` — thêm vào `Deps`:

```go
type Deps struct {
	Cfg    config.Config
	Log    *slog.Logger
	Minter auth.TokenMinter
	Auth   *service.AuthService
}
```

và trong `r.Route("/api/v1", ...)`:

```go
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", h.register)
		r.Post("/auth/login", h.login)
		r.Post("/auth/refresh", h.refresh)
		r.Post("/auth/logout", h.logout)
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAuth(d.Minter))
			r.Get("/me", h.me)
		})
	})
```

(import `mw "github.com/unicomhub/uniwork/server/internal/middleware"` và `"github.com/unicomhub/uniwork/server/internal/auth"`, `"github.com/unicomhub/uniwork/server/internal/service"`.)

Sửa `server/cmd/server/main.go` — wire DB + services:

```go
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db connect", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte(cfg.JWTSecret), TTL: cfg.AccessTokenTTL}
	h := handler.New(handler.Deps{
		Cfg: cfg, Log: log, Minter: minter,
		Auth: service.NewAuthService(q, minter, cfg.RefreshTokenTTL),
	})
```

- [ ] **Step 7: Test + commit**

Run: `cd server && go test ./... && go vet ./...`
Expected: PASS toàn bộ.

```bash
git add -A
git commit -m "feat: auth with JWT access + rotating refresh tokens"
```

### Task 4: Workspaces — CRUD, members, invitations

**Files:**
- Create: `server/pkg/db/queries/workspaces.sql`
- Create: `server/internal/service/workspace.go`
- Create: `server/internal/handler/workspace.go`
- Modify: `server/internal/handler/router.go`, `server/internal/handler/auth_test.go` (mở rộng `newTestServer`), `server/cmd/server/main.go`
- Test: `server/internal/service/workspace_test.go`
- Generated: `server/pkg/db/generated/workspaces.sql.go`

**Interfaces:**
- Consumes: `db.Queries`, `service.Err*`, `util.NewID`, `middleware.UserID` (Task 2–3).
- Produces:
  - `service.NewWorkspaceService(q *db.Queries) *WorkspaceService`; methods:
    - `Create(ctx, userID, name, slug string) (db.Workspace, error)` — tạo workspace + member role `owner`; slug regex `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`, trùng → `ErrConflict`
    - `ListForUser(ctx, userID) ([]db.Workspace, error)`
    - `GetBySlug(ctx, userID, slug) (db.Workspace, error)` — non-member → `ErrNotFound`
    - `RequireMember(ctx, workspaceID, userID) (db.WorkspaceMember, error)` — non-member → `ErrForbidden` (mọi service khác gọi hàm này)
    - `Members(ctx, userID, workspaceID) ([]db.ListWorkspaceMembersRow, error)`
    - `Invite(ctx, userID, workspaceID, email, role string) (db.Invitation, error)` — chỉ owner/admin; role chỉ `admin|member`; TTL 7 ngày
    - `AcceptInvite(ctx, userID, token string) (db.Workspace, error)` — hết hạn/đã dùng → `ErrNotFound`
  - `handler.Deps` thêm `Workspaces *service.WorkspaceService`
  - Routes (đều sau RequireAuth): `GET|POST /workspaces`, `GET /workspaces/{slug}`, `GET /workspaces/{workspaceID}/members`, `POST /workspaces/{workspaceID}/invitations`, `POST /invitations/{token}/accept`

- [ ] **Step 1: Queries**

`server/pkg/db/queries/workspaces.sql`:

```sql
-- name: CreateWorkspace :one
INSERT INTO workspaces (id, slug, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetWorkspaceByID :one
SELECT * FROM workspaces WHERE id = $1;

-- name: GetWorkspaceBySlug :one
SELECT * FROM workspaces WHERE slug = $1;

-- name: ListWorkspacesForUser :many
SELECT w.* FROM workspaces w
JOIN workspace_members m ON m.workspace_id = w.id
WHERE m.user_id = $1
ORDER BY w.created_at;

-- name: AddWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: GetWorkspaceMember :one
SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2;

-- name: ListWorkspaceMembers :many
SELECT m.workspace_id, m.user_id, m.role, m.created_at,
       u.email, u.display_name, u.avatar_url
FROM workspace_members m
JOIN users u ON u.id = m.user_id
WHERE m.workspace_id = $1
ORDER BY m.created_at;

-- name: CreateInvitation :one
INSERT INTO invitations (id, workspace_id, email, role, token, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetInvitationByToken :one
SELECT * FROM invitations
WHERE token = $1 AND accepted_at IS NULL AND expires_at > now();

-- name: MarkInvitationAccepted :exec
UPDATE invitations SET accepted_at = now() WHERE id = $1;
```

Run: `make sqlc && cd server && go build ./...` → OK.

- [ ] **Step 2: Service test (fail trước)**

`server/internal/service/workspace_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// fixture: tạo 2 user, trả (WorkspaceService, userA, userB)
func wsFixture(t *testing.T) (*WorkspaceService, db.User, db.User) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour)
	ctx := context.Background()
	sa, err := as.Register(ctx, "a@example.com", "password123", "A")
	if err != nil {
		t.Fatal(err)
	}
	sb, err := as.Register(ctx, "b@example.com", "password123", "B")
	if err != nil {
		t.Fatal(err)
	}
	return NewWorkspaceService(q), sa.User, sb.User
}

func TestCreateAndMembership(t *testing.T) {
	s, ua, ub := wsFixture(t)
	ctx := context.Background()

	w, err := s.Create(ctx, ua.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.RequireMember(ctx, w.ID, ua.ID)
	if err != nil || m.Role != "owner" {
		t.Fatalf("owner membership: %v role=%s", err, m.Role)
	}
	if _, err := s.RequireMember(ctx, w.ID, ub.ID); err != ErrForbidden {
		t.Fatalf("non-member: got %v, want ErrForbidden", err)
	}
	if _, err := s.GetBySlug(ctx, ub.ID, "doi-alpha"); err != ErrNotFound {
		t.Fatalf("non-member GetBySlug: got %v", err)
	}
	if _, err := s.Create(ctx, ub.ID, "Khác", "doi-alpha"); err != ErrConflict {
		t.Fatalf("dup slug: got %v", err)
	}
	if _, err := s.Create(ctx, ua.ID, "X", "Bad Slug!"); err == nil {
		t.Fatal("invalid slug accepted")
	}
}

func TestInviteFlow(t *testing.T) {
	s, ua, ub := wsFixture(t)
	ctx := context.Background()
	w, _ := s.Create(ctx, ua.ID, "Đội Alpha", "doi-alpha")

	// member thường không được mời
	if _, err := s.Invite(ctx, ub.ID, w.ID, "c@example.com", "member"); err != ErrForbidden {
		t.Fatalf("outsider invite: got %v", err)
	}
	inv, err := s.Invite(ctx, ua.ID, w.ID, "b@example.com", "member")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.AcceptInvite(ctx, ub.ID, inv.Token)
	if err != nil || got.ID != w.ID {
		t.Fatalf("accept: %v", err)
	}
	if _, err := s.RequireMember(ctx, w.ID, ub.ID); err != nil {
		t.Fatal("member not added after accept")
	}
	// token dùng lại → not found
	if _, err := s.AcceptInvite(ctx, ub.ID, inv.Token); err != ErrNotFound {
		t.Fatalf("reused invite: got %v", err)
	}
}
```

Run: `cd server && go test ./internal/service/ -run 'TestCreateAndMembership|TestInviteFlow'` → FAIL.

- [ ] **Step 3: Implement WorkspaceService**

`server/internal/service/workspace.go`:

```go
package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`)

type WorkspaceService struct {
	q *db.Queries
}

func NewWorkspaceService(q *db.Queries) *WorkspaceService {
	return &WorkspaceService{q: q}
}

func (s *WorkspaceService) Create(ctx context.Context, userID, name, slug string) (db.Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return db.Workspace{}, Invalid("tên workspace không được để trống")
	}
	if !slugRe.MatchString(slug) {
		return db.Workspace{}, Invalid("slug chỉ gồm a-z, 0-9 và dấu gạch ngang (3-40 ký tự)")
	}
	w, err := s.q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		ID: util.NewID(), Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return db.Workspace{}, ErrConflict
	}
	if err != nil {
		return db.Workspace{}, err
	}
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: userID, Role: "owner",
	}); err != nil {
		return db.Workspace{}, err
	}
	return w, nil
}

func (s *WorkspaceService) ListForUser(ctx context.Context, userID string) ([]db.Workspace, error) {
	return s.q.ListWorkspacesForUser(ctx, userID)
}

func (s *WorkspaceService) GetBySlug(ctx context.Context, userID, slug string) (db.Workspace, error) {
	w, err := s.q.GetWorkspaceBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	if err != nil {
		return db.Workspace{}, err
	}
	if _, err := s.RequireMember(ctx, w.ID, userID); err != nil {
		return db.Workspace{}, ErrNotFound // không lộ sự tồn tại của workspace
	}
	return w, nil
}

func (s *WorkspaceService) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	m, err := s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceMember{}, ErrForbidden
	}
	return m, err
}

func (s *WorkspaceService) Members(ctx context.Context, userID, workspaceID string) ([]db.ListWorkspaceMembersRow, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListWorkspaceMembers(ctx, workspaceID)
}

func (s *WorkspaceService) Invite(ctx context.Context, userID, workspaceID, email, role string) (db.Invitation, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.Invitation{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return db.Invitation{}, ErrForbidden
	}
	if role != "admin" && role != "member" {
		return db.Invitation{}, Invalid("role phải là admin hoặc member")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return db.Invitation{}, Invalid("email không hợp lệ")
	}
	return s.q.CreateInvitation(ctx, db.CreateInvitationParams{
		ID: util.NewID(), WorkspaceID: workspaceID, Email: email, Role: role,
		Token:     util.NewID() + util.NewID(),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	})
}

func (s *WorkspaceService) AcceptInvite(ctx context.Context, userID, token string) (db.Workspace, error) {
	inv, err := s.q.GetInvitationByToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	if err != nil {
		return db.Workspace{}, err
	}
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: inv.WorkspaceID, UserID: userID, Role: inv.Role,
	}); err != nil {
		return db.Workspace{}, err
	}
	if err := s.q.MarkInvitationAccepted(ctx, inv.ID); err != nil {
		return db.Workspace{}, err
	}
	return s.q.GetWorkspaceByID(ctx, inv.WorkspaceID)
}
```

Run: `cd server && go test ./internal/service/` → PASS.

- [ ] **Step 4: Handler + routes**

`server/internal/handler/workspace.go`:

```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type workspaceDTO struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

func toWorkspaceDTO(w db.Workspace) workspaceDTO {
	return workspaceDTO{ID: w.ID, Slug: w.Slug, Name: w.Name}
}

func (h *handlers) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.ListForUser(r.Context(), middleware.UserID(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]workspaceDTO, 0, len(ws))
	for _, x := range ws {
		out = append(out, toWorkspaceDTO(x))
	}
	respondJSON(w, 200, map[string]any{"workspaces": out})
}

func (h *handlers) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	ws, err := h.Workspaces.Create(r.Context(), middleware.UserID(r.Context()), in.Name, in.Slug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}

func (h *handlers) getWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.GetBySlug(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "slug"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}

func (h *handlers) listMembers(w http.ResponseWriter, r *http.Request) {
	ms, err := h.Workspaces.Members(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"members": ms})
}

func (h *handlers) createInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	inv, err := h.Workspaces.Invite(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), in.Email, in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"invitation": map[string]string{
		"id": inv.ID, "email": inv.Email, "role": inv.Role, "token": inv.Token,
	}})
}

func (h *handlers) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Workspaces.AcceptInvite(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "token"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"workspace": toWorkspaceDTO(ws)})
}
```

Trong `router.go`, thêm `Workspaces *service.WorkspaceService` vào `Deps` và trong group RequireAuth:

```go
			r.Get("/workspaces", h.listWorkspaces)
			r.Post("/workspaces", h.createWorkspace)
			r.Get("/workspaces/{slug}", h.getWorkspace)
			r.Get("/workspaces/{workspaceID}/members", h.listMembers)
			r.Post("/workspaces/{workspaceID}/invitations", h.createInvitation)
			r.Post("/invitations/{token}/accept", h.acceptInvitation)
```

Lưu ý route trùng pattern `/workspaces/{slug}` vs `/workspaces/{workspaceID}/members`: chi phân biệt được vì độ dài path khác nhau — giữ nguyên.

Mở rộng `newTestServer` trong `auth_test.go`: thêm `Workspaces: service.NewWorkspaceService(q),` vào `Deps`. Wire tương tự trong `cmd/server/main.go`.

- [ ] **Step 5: Test + commit**

Run: `cd server && go test ./... && go vet ./...` → PASS.

```bash
git add -A
git commit -m "feat: workspaces with members and invitations"
```

---

## Phase B — Tasks & Meetings backend (Task 5–8)

### Task 5: Tasks backend — migration 002, service, handlers, comments

**Files:**
- Create: `server/migrations/002_tasks.up.sql`, `server/migrations/002_tasks.down.sql`
- Create: `server/pkg/db/queries/tasks.sql`
- Create: `server/internal/service/events.go`, `server/internal/service/task.go`
- Create: `server/internal/handler/task.go`
- Modify: `server/internal/handler/router.go`, `server/internal/handler/auth_test.go` (newTestServer), `server/cmd/server/main.go`, `server/internal/testutil/db.go` (TRUNCATE thêm bảng)
- Test: `server/internal/service/task_test.go`

**Interfaces:**
- Consumes: `WorkspaceService.RequireMember` (Task 4).
- Produces:
  - `service.Event{Type string; Payload map[string]string}`, `service.EventPublisher interface{ Publish(ctx context.Context, workspaceID string, ev Event) }`, `service.NopPublisher{}` — Task 8 sẽ có Redis/hub implementation; Task 5–6 dùng Nop trong test.
  - `service.NewTaskService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *TaskService`; methods:
    - `Create(ctx, userID, workspaceID string, in CreateTaskInput) (db.Task, error)`; `CreateTaskInput{Title string; Description string; Priority string; AssigneeID *string; DueDate *string /*YYYY-MM-DD*/}`
    - `List(ctx, userID, workspaceID) ([]db.Task, error)` — order by status, position
    - `Get(ctx, userID, taskID) (db.Task, error)`
    - `Update(ctx, userID, taskID string, in UpdateTaskInput) (db.Task, error)`; `UpdateTaskInput{Title, Description, Status, Priority *string; Position *float64; AssigneeID **string; DueDate **string}` (con trỏ kép: nil = không đổi, con trỏ tới nil = xóa giá trị)
    - `Delete(ctx, userID, taskID) error`
    - `AddComment(ctx, userID, taskID, body string) (db.TaskComment, error)`, `Comments(ctx, userID, taskID) ([]db.ListTaskCommentsRow, error)`
  - Status hợp lệ: `todo|in_progress|done|cancelled`; priority: `low|medium|high|urgent`.
  - Events phát: `task.created`, `task.updated`, `task.deleted`, `comment.created` — payload `{"task_id": id}`.
  - Routes: `GET|POST /workspaces/{workspaceID}/tasks`, `GET|PATCH|DELETE /tasks/{taskID}`, `GET|POST /tasks/{taskID}/comments`.
  - Task DTO JSON: `{id, workspace_id, title, description, status, priority, assignee_id?, due_date?, position, created_by, created_at, updated_at}` (assignee_id/due_date bỏ qua nếu null; due_date dạng `YYYY-MM-DD`).

- [ ] **Step 1: Migration 002 + queries**

`server/migrations/002_tasks.up.sql`:

```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('todo','in_progress','done','cancelled')),
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date     DATE,
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_ws_status_pos ON tasks(workspace_id, status, position);

CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_task ON task_comments(task_id, created_at);
```

`server/migrations/002_tasks.down.sql`:

```sql
DROP TABLE task_comments;
DROP TABLE tasks;
```

`server/pkg/db/queries/tasks.sql`:

```sql
-- name: CreateTask :one
INSERT INTO tasks (id, workspace_id, title, description, priority, assignee_id, due_date, position, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListTasksByWorkspace :many
SELECT * FROM tasks WHERE workspace_id = $1 ORDER BY status, position, created_at;

-- name: GetTask :one
SELECT * FROM tasks WHERE id = $1;

-- name: UpdateTask :one
UPDATE tasks SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  status      = COALESCE(sqlc.narg('status'), status),
  priority    = COALESCE(sqlc.narg('priority'), priority),
  position    = COALESCE(sqlc.narg('position'), position),
  updated_at  = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: SetTaskAssignee :one
UPDATE tasks SET assignee_id = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: SetTaskDueDate :one
UPDATE tasks SET due_date = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteTask :exec
DELETE FROM tasks WHERE id = $1;

-- name: MaxTaskPosition :one
SELECT COALESCE(MAX(position), 0)::float8 FROM tasks WHERE workspace_id = $1 AND status = $2;

-- name: CreateTaskComment :one
INSERT INTO task_comments (id, task_id, author_id, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListTaskComments :many
SELECT c.id, c.task_id, c.author_id, c.body, c.created_at, u.display_name, u.avatar_url
FROM task_comments c JOIN users u ON u.id = c.author_id
WHERE c.task_id = $1 ORDER BY c.created_at;
```

Cập nhật `testutil/db.go` TRUNCATE: thêm `tasks, task_comments`.

Run: `make sqlc && cd server && go build ./... && go test ./migrations/` → PASS.

- [ ] **Step 2: Events + service test (fail trước)**

`server/internal/service/events.go`:

```go
package service

import "context"

type Event struct {
	Type    string            `json:"type"`
	Payload map[string]string `json:"payload"`
}

// EventPublisher fanouts workspace-scoped events to connected clients.
// Task 8 provides the realtime implementation; NopPublisher is for tests
// and for wiring before realtime exists.
type EventPublisher interface {
	Publish(ctx context.Context, workspaceID string, ev Event)
}

type NopPublisher struct{}

func (NopPublisher) Publish(context.Context, string, Event) {}
```

`server/internal/service/task_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

type capturePublisher struct{ events []Event }

func (c *capturePublisher) Publish(_ context.Context, _ string, ev Event) {
	c.events = append(c.events, ev)
}

// fixture: user A (member), user B (ngoài), workspace của A
func taskFixture(t *testing.T) (*TaskService, *capturePublisher, db.User, db.User, db.Workspace) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour)
	ws := NewWorkspaceService(q)
	ctx := context.Background()
	sa, _ := as.Register(ctx, "a@example.com", "password123", "A")
	sb, _ := as.Register(ctx, "b@example.com", "password123", "B")
	w, _ := ws.Create(ctx, sa.User.ID, "Alpha", "alpha")
	pub := &capturePublisher{}
	return NewTaskService(q, ws, pub), pub, sa.User, sb.User, w
}

func TestTaskCRUD(t *testing.T) {
	s, pub, ua, ub, w := taskFixture(t)
	ctx := context.Background()

	task, err := s.Create(ctx, ua.ID, w.ID, CreateTaskInput{Title: "Việc 1", Priority: "high"})
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "todo" || task.Priority != "high" {
		t.Fatalf("defaults: %+v", task)
	}
	// non-member bị chặn
	if _, err := s.Create(ctx, ub.ID, w.ID, CreateTaskInput{Title: "X"}); err != ErrForbidden {
		t.Fatalf("non-member create: %v", err)
	}
	if _, err := s.Get(ctx, ub.ID, task.ID); err != ErrForbidden {
		t.Fatalf("non-member get: %v", err)
	}

	// update status + position
	st, pos := "in_progress", 10.5
	up, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{Status: &st, Position: &pos})
	if err != nil || up.Status != "in_progress" || up.Position != 10.5 {
		t.Fatalf("update: %v %+v", err, up)
	}
	bad := "not-a-status"
	if _, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{Status: &bad}); err == nil {
		t.Fatal("invalid status accepted")
	}

	// assignee set và clear qua con trỏ kép
	aid := &ua.ID
	if _, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{AssigneeID: &aid}); err != nil {
		t.Fatal(err)
	}
	var nilStr *string
	cleared, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{AssigneeID: &nilStr})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.AssigneeID != nil {
		t.Fatal("assignee not cleared")
	}

	// comments
	if _, err := s.AddComment(ctx, ua.ID, task.ID, "chú thích"); err != nil {
		t.Fatal(err)
	}
	cs, err := s.Comments(ctx, ua.ID, task.ID)
	if err != nil || len(cs) != 1 {
		t.Fatalf("comments: %v n=%d", err, len(cs))
	}

	if err := s.Delete(ctx, ua.ID, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, ua.ID, task.ID); err != ErrNotFound {
		t.Fatalf("after delete: %v", err)
	}

	// events phát ra đúng loại
	types := map[string]bool{}
	for _, e := range pub.events {
		types[e.Type] = true
	}
	for _, want := range []string{"task.created", "task.updated", "comment.created", "task.deleted"} {
		if !types[want] {
			t.Fatalf("missing event %s (got %v)", want, pub.events)
		}
	}
}
```

Lưu ý: kiểu `task.AssigneeID`/`Position` do sqlc generate (`*string`/`pgtype.Text`, `float64`) — đọc `models.go` và chỉnh test/service cho khớp.

Run: `cd server && go test ./internal/service/ -run TestTaskCRUD` → FAIL.

- [ ] **Step 3: Implement TaskService**

`server/internal/service/task.go`:

```go
package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var validStatus = map[string]bool{"todo": true, "in_progress": true, "done": true, "cancelled": true}
var validPriority = map[string]bool{"low": true, "medium": true, "high": true, "urgent": true}

type TaskService struct {
	q   *db.Queries
	ws  *WorkspaceService
	pub EventPublisher
}

func NewTaskService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *TaskService {
	return &TaskService{q: q, ws: ws, pub: pub}
}

type CreateTaskInput struct {
	Title       string
	Description string
	Priority    string
	AssigneeID  *string
	DueDate     *string
}

type UpdateTaskInput struct {
	Title       *string
	Description *string
	Status      *string
	Priority    *string
	Position    *float64
	AssigneeID  **string
	DueDate     **string
}

func (s *TaskService) Create(ctx context.Context, userID, workspaceID string, in CreateTaskInput) (db.Task, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Task{}, err
	}
	if strings.TrimSpace(in.Title) == "" {
		return db.Task{}, Invalid("tiêu đề không được để trống")
	}
	if in.Priority == "" {
		in.Priority = "medium"
	}
	if !validPriority[in.Priority] {
		return db.Task{}, Invalid("priority không hợp lệ")
	}
	maxPos, err := s.q.MaxTaskPosition(ctx, db.MaxTaskPositionParams{WorkspaceID: workspaceID, Status: "todo"})
	if err != nil {
		return db.Task{}, err
	}
	due, err := parseDate(in.DueDate)
	if err != nil {
		return db.Task{}, err
	}
	task, err := s.q.CreateTask(ctx, db.CreateTaskParams{
		ID: util.NewID(), WorkspaceID: workspaceID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		Priority: in.Priority, AssigneeID: in.AssigneeID, DueDate: due,
		Position: maxPos + 1024, CreatedBy: userID,
	})
	if err != nil {
		return db.Task{}, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "task.created", Payload: map[string]string{"task_id": task.ID}})
	return task, nil
}

func (s *TaskService) List(ctx context.Context, userID, workspaceID string) ([]db.Task, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListTasksByWorkspace(ctx, workspaceID)
}

// load task rồi check membership theo workspace của chính task đó
func (s *TaskService) authorize(ctx context.Context, userID, taskID string) (db.Task, error) {
	task, err := s.q.GetTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Task{}, ErrNotFound
	}
	if err != nil {
		return db.Task{}, err
	}
	if _, err := s.ws.RequireMember(ctx, task.WorkspaceID, userID); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

func (s *TaskService) Get(ctx context.Context, userID, taskID string) (db.Task, error) {
	return s.authorize(ctx, userID, taskID)
}

func (s *TaskService) Update(ctx context.Context, userID, taskID string, in UpdateTaskInput) (db.Task, error) {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return db.Task{}, err
	}
	if in.Status != nil && !validStatus[*in.Status] {
		return db.Task{}, Invalid("status không hợp lệ")
	}
	if in.Priority != nil && !validPriority[*in.Priority] {
		return db.Task{}, Invalid("priority không hợp lệ")
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Task{}, Invalid("tiêu đề không được để trống")
	}
	task, err = s.q.UpdateTask(ctx, db.UpdateTaskParams{
		ID: taskID, Title: in.Title, Description: in.Description,
		Status: in.Status, Priority: in.Priority, Position: in.Position,
	})
	if err != nil {
		return db.Task{}, err
	}
	if in.AssigneeID != nil {
		task, err = s.q.SetTaskAssignee(ctx, db.SetTaskAssigneeParams{ID: taskID, AssigneeID: *in.AssigneeID})
		if err != nil {
			return db.Task{}, err
		}
	}
	if in.DueDate != nil {
		due, err := parseDate(*in.DueDate)
		if err != nil {
			return db.Task{}, err
		}
		task, err = s.q.SetTaskDueDate(ctx, db.SetTaskDueDateParams{ID: taskID, DueDate: due})
		if err != nil {
			return db.Task{}, err
		}
	}
	s.pub.Publish(ctx, task.WorkspaceID, Event{Type: "task.updated", Payload: map[string]string{"task_id": task.ID}})
	return task, nil
}

func (s *TaskService) Delete(ctx context.Context, userID, taskID string) error {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return err
	}
	if err := s.q.DeleteTask(ctx, taskID); err != nil {
		return err
	}
	s.pub.Publish(ctx, task.WorkspaceID, Event{Type: "task.deleted", Payload: map[string]string{"task_id": taskID}})
	return nil
}

func (s *TaskService) AddComment(ctx context.Context, userID, taskID, body string) (db.TaskComment, error) {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return db.TaskComment{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.TaskComment{}, Invalid("nội dung không được để trống")
	}
	c, err := s.q.CreateTaskComment(ctx, db.CreateTaskCommentParams{
		ID: util.NewID(), TaskID: taskID, AuthorID: userID, Body: body,
	})
	if err != nil {
		return db.TaskComment{}, err
	}
	s.pub.Publish(ctx, task.WorkspaceID, Event{Type: "comment.created", Payload: map[string]string{"task_id": taskID}})
	return c, nil
}

func (s *TaskService) Comments(ctx context.Context, userID, taskID string) ([]db.ListTaskCommentsRow, error) {
	if _, err := s.authorize(ctx, userID, taskID); err != nil {
		return nil, err
	}
	return s.q.ListTaskComments(ctx, taskID)
}

func parseDate(s *string) (pgtype.Date, error) {
	if s == nil || *s == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", *s)
	if err != nil {
		return pgtype.Date{}, Invalid("due_date phải dạng YYYY-MM-DD")
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}
```

Lưu ý kiểu sqlc: `UpdateTaskParams` với `sqlc.narg` sinh `pgtype.Text`/`pgtype.Float8` — nếu vậy wrap con trỏ vào pgtype (`pgtype.Text{String: *in.Title, Valid: in.Title != nil}`). Đọc generated code và khớp; test là trọng tài.

Run: `cd server && go test ./internal/service/` → PASS.

- [ ] **Step 4: Handler + routes + wire**

`server/internal/handler/task.go`:

```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type taskDTO struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Status      string  `json:"status"`
	Priority    string  `json:"priority"`
	AssigneeID  *string `json:"assignee_id,omitempty"`
	DueDate     *string `json:"due_date,omitempty"`
	Position    float64 `json:"position"`
	CreatedBy   string  `json:"created_by"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

func toTaskDTO(t db.Task) taskDTO {
	dto := taskDTO{
		ID: t.ID, WorkspaceID: t.WorkspaceID, Title: t.Title, Description: t.Description,
		Status: t.Status, Priority: t.Priority, AssigneeID: t.AssigneeID,
		Position: t.Position, CreatedBy: t.CreatedBy,
		CreatedAt: t.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: t.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
	}
	if t.DueDate.Valid {
		s := t.DueDate.Time.Format("2006-01-02")
		dto.DueDate = &s
	}
	return dto
}

func (h *handlers) listTasks(w http.ResponseWriter, r *http.Request) {
	ts, err := h.Tasks.List(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]taskDTO, 0, len(ts))
	for _, t := range ts {
		out = append(out, toTaskDTO(t))
	}
	respondJSON(w, 200, map[string]any{"tasks": out})
}

func (h *handlers) createTask(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       string  `json:"title"`
		Description string  `json:"description"`
		Priority    string  `json:"priority"`
		AssigneeID  *string `json:"assignee_id"`
		DueDate     *string `json:"due_date"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	t, err := h.Tasks.Create(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		service.CreateTaskInput{Title: in.Title, Description: in.Description, Priority: in.Priority,
			AssigneeID: in.AssigneeID, DueDate: in.DueDate})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"task": toTaskDTO(t)})
}

func (h *handlers) getTask(w http.ResponseWriter, r *http.Request) {
	t, err := h.Tasks.Get(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"task": toTaskDTO(t)})
}

// PATCH body: field vắng mặt = không đổi; assignee_id/due_date gửi null = xóa.
// Dùng json.RawMessage để phân biệt "vắng mặt" và "null".
func (h *handlers) updateTask(w http.ResponseWriter, r *http.Request) {
	var raw map[string]jsonRaw
	if err := decode(r, &raw); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	in, err := parseTaskPatch(raw)
	if err != nil {
		respondError(w, 400, "invalid_request", err.Error())
		return
	}
	t, err := h.Tasks.Update(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"task": toTaskDTO(t)})
}

func (h *handlers) deleteTask(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.Delete(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) listComments(w http.ResponseWriter, r *http.Request) {
	cs, err := h.Tasks.Comments(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"comments": cs})
}

func (h *handlers) createComment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	c, err := h.Tasks.AddComment(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "taskID"), in.Body)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"comment": c})
}
```

`parseTaskPatch` + `jsonRaw` thêm vào cuối `task.go`:

```go
type jsonRaw = json.RawMessage

func parseTaskPatch(raw map[string]jsonRaw) (service.UpdateTaskInput, error) {
	var in service.UpdateTaskInput
	str := func(k string) (*string, error) {
		v, ok := raw[k]
		if !ok {
			return nil, nil
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, fmt.Errorf("%s phải là chuỗi", k)
		}
		return &s, nil
	}
	var err error
	if in.Title, err = str("title"); err != nil {
		return in, err
	}
	if in.Description, err = str("description"); err != nil {
		return in, err
	}
	if in.Status, err = str("status"); err != nil {
		return in, err
	}
	if in.Priority, err = str("priority"); err != nil {
		return in, err
	}
	if v, ok := raw["position"]; ok {
		var f float64
		if err := json.Unmarshal(v, &f); err != nil {
			return in, fmt.Errorf("position phải là số")
		}
		in.Position = &f
	}
	nullable := func(k string) (**string, error) {
		v, ok := raw[k]
		if !ok {
			return nil, nil
		}
		if string(v) == "null" {
			var p *string
			return &p, nil
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, fmt.Errorf("%s phải là chuỗi hoặc null", k)
		}
		p := &s
		return &p, nil
	}
	if in.AssigneeID, err = nullable("assignee_id"); err != nil {
		return in, err
	}
	if in.DueDate, err = nullable("due_date"); err != nil {
		return in, err
	}
	return in, nil
}
```

(import thêm `"encoding/json"`, `"fmt"`.)

Routes trong group RequireAuth của `router.go`:

```go
			r.Get("/workspaces/{workspaceID}/tasks", h.listTasks)
			r.Post("/workspaces/{workspaceID}/tasks", h.createTask)
			r.Get("/tasks/{taskID}", h.getTask)
			r.Patch("/tasks/{taskID}", h.updateTask)
			r.Delete("/tasks/{taskID}", h.deleteTask)
			r.Get("/tasks/{taskID}/comments", h.listComments)
			r.Post("/tasks/{taskID}/comments", h.createComment)
```

`Deps` thêm `Tasks *service.TaskService`; wire trong `newTestServer` và `main.go` với `service.NopPublisher{}` (Task 8 thay bằng realtime publisher).

- [ ] **Step 5: Test + commit**

Run: `cd server && go test ./... && go vet ./...` → PASS.

```bash
git add -A
git commit -m "feat: tasks with comments, board position, workspace events"
```

### Task 6: Meetings backend — migration 003, service, handlers

**Files:**
- Create: `server/migrations/003_meetings.up.sql`, `server/migrations/003_meetings.down.sql`
- Create: `server/pkg/db/queries/meetings.sql`
- Create: `server/internal/service/meeting.go`
- Create: `server/internal/handler/meeting.go`
- Modify: `server/internal/handler/router.go`, `server/internal/handler/auth_test.go` (newTestServer), `server/cmd/server/main.go`, `server/internal/testutil/db.go` (TRUNCATE)
- Test: `server/internal/service/meeting_test.go`

**Interfaces:**
- Consumes: `WorkspaceService.RequireMember`, `EventPublisher` (Task 4–5).
- Produces:
  - `service.NewMeetingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *MeetingService`; methods:
    - `Create(ctx, userID, workspaceID string, in CreateMeetingInput) (db.Meeting, error)`; `CreateMeetingInput{Title, Description string; StartsAt, EndsAt time.Time}` — validate: title bắt buộc, EndsAt sau StartsAt; `room_name = "uniwork-" + meeting.ID`; creator tự động thành attendee
    - `List(ctx, userID, workspaceID) ([]db.Meeting, error)` — order by starts_at desc
    - `Get(ctx, userID, meetingID) (db.Meeting, error)`
    - `Update(ctx, userID, meetingID string, in UpdateMeetingInput) (db.Meeting, error)`; `UpdateMeetingInput{Title, Description *string; StartsAt, EndsAt *time.Time}`
    - `Delete(ctx, userID, meetingID) error`
    - `AddNote(ctx, userID, meetingID, body string) (db.MeetingNote, error)`, `Notes(ctx, userID, meetingID) ([]db.ListMeetingNotesRow, error)`
  - Events: `meeting.created|updated|deleted` payload `{"meeting_id": id}`.
  - Routes: `GET|POST /workspaces/{workspaceID}/meetings`, `GET|PATCH|DELETE /meetings/{meetingID}`, `GET|POST /meetings/{meetingID}/notes`.
  - Meeting DTO JSON: `{id, workspace_id, title, description, starts_at, ends_at, room_name, created_by}` (thời gian RFC3339).

- [ ] **Step 1: Migration 003 + queries**

`server/migrations/003_meetings.up.sql`:

```sql
CREATE TABLE meetings (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  room_name    TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_ws_start ON meetings(workspace_id, starts_at DESC);

CREATE TABLE meeting_attendees (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE meeting_notes (
  id         TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`server/migrations/003_meetings.down.sql`:

```sql
DROP TABLE meeting_notes;
DROP TABLE meeting_attendees;
DROP TABLE meetings;
```

`server/pkg/db/queries/meetings.sql`:

```sql
-- name: CreateMeeting :one
INSERT INTO meetings (id, workspace_id, title, description, starts_at, ends_at, room_name, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListMeetingsByWorkspace :many
SELECT * FROM meetings WHERE workspace_id = $1 ORDER BY starts_at DESC;

-- name: GetMeeting :one
SELECT * FROM meetings WHERE id = $1;

-- name: UpdateMeeting :one
UPDATE meetings SET
  title       = COALESCE(sqlc.narg('title'), title),
  description = COALESCE(sqlc.narg('description'), description),
  starts_at   = COALESCE(sqlc.narg('starts_at'), starts_at),
  ends_at     = COALESCE(sqlc.narg('ends_at'), ends_at),
  updated_at  = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: DeleteMeeting :exec
DELETE FROM meetings WHERE id = $1;

-- name: AddMeetingAttendee :exec
INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: CreateMeetingNote :one
INSERT INTO meeting_notes (id, meeting_id, author_id, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListMeetingNotes :many
SELECT n.id, n.meeting_id, n.author_id, n.body, n.created_at, u.display_name, u.avatar_url
FROM meeting_notes n JOIN users u ON u.id = n.author_id
WHERE n.meeting_id = $1 ORDER BY n.created_at;
```

Cập nhật TRUNCATE trong `testutil/db.go`: thêm `meetings, meeting_attendees, meeting_notes`.

Run: `make sqlc && cd server && go build ./...` → OK.

- [ ] **Step 2: Service test (fail trước)**

`server/internal/service/meeting_test.go`:

```go
package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

func meetingFixture(t *testing.T) (*MeetingService, db.User, db.User, db.Workspace) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour)
	ws := NewWorkspaceService(q)
	ctx := context.Background()
	sa, _ := as.Register(ctx, "a@example.com", "password123", "A")
	sb, _ := as.Register(ctx, "b@example.com", "password123", "B")
	w, _ := ws.Create(ctx, sa.User.ID, "Alpha", "alpha")
	return NewMeetingService(q, ws, NopPublisher{}), sa.User, sb.User, w
}

func TestMeetingCRUD(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)

	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Daily", StartsAt: start, EndsAt: start.Add(30 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(m.RoomName, "uniwork-") {
		t.Fatalf("room_name = %q", m.RoomName)
	}
	// EndsAt trước StartsAt → lỗi
	if _, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "X", StartsAt: start, EndsAt: start.Add(-time.Minute),
	}); err == nil {
		t.Fatal("invalid time range accepted")
	}
	// non-member
	if _, err := s.Get(ctx, ub.ID, m.ID); err != ErrForbidden {
		t.Fatalf("non-member get: %v", err)
	}

	title := "Daily standup"
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title})
	if err != nil || up.Title != "Daily standup" {
		t.Fatalf("update: %v", err)
	}

	if _, err := s.AddNote(ctx, ua.ID, m.ID, "biên bản"); err != nil {
		t.Fatal(err)
	}
	ns, err := s.Notes(ctx, ua.ID, m.ID)
	if err != nil || len(ns) != 1 {
		t.Fatalf("notes: %v n=%d", err, len(ns))
	}

	if err := s.Delete(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, ua.ID, m.ID); err != ErrNotFound {
		t.Fatalf("after delete: %v", err)
	}
}
```

Run: `cd server && go test ./internal/service/ -run TestMeetingCRUD` → FAIL.

- [ ] **Step 3: Implement MeetingService**

`server/internal/service/meeting.go`:

```go
package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type MeetingService struct {
	q   *db.Queries
	ws  *WorkspaceService
	pub EventPublisher
}

func NewMeetingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *MeetingService {
	return &MeetingService{q: q, ws: ws, pub: pub}
}

type CreateMeetingInput struct {
	Title       string
	Description string
	StartsAt    time.Time
	EndsAt      time.Time
}

type UpdateMeetingInput struct {
	Title       *string
	Description *string
	StartsAt    *time.Time
	EndsAt      *time.Time
}

func (s *MeetingService) Create(ctx context.Context, userID, workspaceID string, in CreateMeetingInput) (db.Meeting, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Meeting{}, err
	}
	if strings.TrimSpace(in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	if !in.EndsAt.After(in.StartsAt) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	id := util.NewID()
	m, err := s.q.CreateMeeting(ctx, db.CreateMeetingParams{
		ID: id, WorkspaceID: workspaceID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		StartsAt: pgtype.Timestamptz{Time: in.StartsAt, Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: in.EndsAt, Valid: true},
		RoomName: "uniwork-" + id, CreatedBy: userID,
	})
	if err != nil {
		return db.Meeting{}, err
	}
	if err := s.q.AddMeetingAttendee(ctx, db.AddMeetingAttendeeParams{MeetingID: id, UserID: userID}); err != nil {
		return db.Meeting{}, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "meeting.created", Payload: map[string]string{"meeting_id": id}})
	return m, nil
}

func (s *MeetingService) List(ctx context.Context, userID, workspaceID string) ([]db.Meeting, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingsByWorkspace(ctx, workspaceID)
}

func (s *MeetingService) authorize(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, userID); err != nil {
		return db.Meeting{}, err
	}
	return m, nil
}

func (s *MeetingService) Get(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	return s.authorize(ctx, userID, meetingID)
}

func (s *MeetingService) Update(ctx context.Context, userID, meetingID string, in UpdateMeetingInput) (db.Meeting, error) {
	if _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return db.Meeting{}, err
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	params := db.UpdateMeetingParams{ID: meetingID, Title: in.Title, Description: in.Description}
	if in.StartsAt != nil {
		params.StartsAt = pgtype.Timestamptz{Time: *in.StartsAt, Valid: true}
	}
	if in.EndsAt != nil {
		params.EndsAt = pgtype.Timestamptz{Time: *in.EndsAt, Valid: true}
	}
	m, err := s.q.UpdateMeeting(ctx, params)
	if err != nil {
		return db.Meeting{}, err
	}
	if !m.EndsAt.Time.After(m.StartsAt.Time) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.updated", Payload: map[string]string{"meeting_id": m.ID}})
	return m, nil
}

func (s *MeetingService) Delete(ctx context.Context, userID, meetingID string) error {
	m, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	if err := s.q.DeleteMeeting(ctx, meetingID); err != nil {
		return err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.deleted", Payload: map[string]string{"meeting_id": meetingID}})
	return nil
}

func (s *MeetingService) AddNote(ctx context.Context, userID, meetingID, body string) (db.MeetingNote, error) {
	if _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return db.MeetingNote{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.MeetingNote{}, Invalid("nội dung không được để trống")
	}
	return s.q.CreateMeetingNote(ctx, db.CreateMeetingNoteParams{
		ID: util.NewID(), MeetingID: meetingID, AuthorID: userID, Body: body,
	})
}

func (s *MeetingService) Notes(ctx context.Context, userID, meetingID string) ([]db.ListMeetingNotesRow, error) {
	if _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingNotes(ctx, meetingID)
}
```

(Lưu ý kiểu `UpdateMeetingParams` do sqlc narg sinh ra — khớp theo generated code, như Task 5.)

Run: `cd server && go test ./internal/service/` → PASS.

- [ ] **Step 4: Handler + routes + wire**

`server/internal/handler/meeting.go`:

```go
package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type meetingDTO struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	StartsAt    string `json:"starts_at"`
	EndsAt      string `json:"ends_at"`
	RoomName    string `json:"room_name"`
	CreatedBy   string `json:"created_by"`
}

func toMeetingDTO(m db.Meeting) meetingDTO {
	return meetingDTO{
		ID: m.ID, WorkspaceID: m.WorkspaceID, Title: m.Title, Description: m.Description,
		StartsAt: m.StartsAt.Time.Format(time.RFC3339), EndsAt: m.EndsAt.Time.Format(time.RFC3339),
		RoomName: m.RoomName, CreatedBy: m.CreatedBy,
	}
}

func (h *handlers) listMeetings(w http.ResponseWriter, r *http.Request) {
	ms, err := h.Meetings.List(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]meetingDTO, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMeetingDTO(m))
	}
	respondJSON(w, 200, map[string]any{"meetings": out})
}

func (h *handlers) createMeeting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       string    `json:"title"`
		Description string    `json:"description"`
		StartsAt    time.Time `json:"starts_at"`
		EndsAt      time.Time `json:"ends_at"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	m, err := h.Meetings.Create(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		service.CreateMeetingInput{Title: in.Title, Description: in.Description, StartsAt: in.StartsAt, EndsAt: in.EndsAt})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) getMeeting(w http.ResponseWriter, r *http.Request) {
	m, err := h.Meetings.Get(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) updateMeeting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       *string    `json:"title"`
		Description *string    `json:"description"`
		StartsAt    *time.Time `json:"starts_at"`
		EndsAt      *time.Time `json:"ends_at"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	m, err := h.Meetings.Update(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.UpdateMeetingInput{Title: in.Title, Description: in.Description, StartsAt: in.StartsAt, EndsAt: in.EndsAt})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}

func (h *handlers) deleteMeeting(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.Delete(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) listNotes(w http.ResponseWriter, r *http.Request) {
	ns, err := h.Meetings.Notes(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"notes": ns})
}

func (h *handlers) createNote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		respondError(w, 400, "invalid_request", "invalid json")
		return
	}
	n, err := h.Meetings.AddNote(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Body)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"note": n})
}
```

Routes trong group RequireAuth:

```go
			r.Get("/workspaces/{workspaceID}/meetings", h.listMeetings)
			r.Post("/workspaces/{workspaceID}/meetings", h.createMeeting)
			r.Get("/meetings/{meetingID}", h.getMeeting)
			r.Patch("/meetings/{meetingID}", h.updateMeeting)
			r.Delete("/meetings/{meetingID}", h.deleteMeeting)
			r.Get("/meetings/{meetingID}/notes", h.listNotes)
			r.Post("/meetings/{meetingID}/notes", h.createNote)
```

`Deps` thêm `Meetings *service.MeetingService`; wire vào `newTestServer` + `main.go`.

- [ ] **Step 5: Test + commit**

Run: `cd server && go test ./... && go vet ./...` → PASS.

```bash
git add -A
git commit -m "feat: meetings with attendees and notes"
```

### Task 7: LiveKit token minting

**Files:**
- Create: `server/internal/meetings/livekit.go`
- Create: `server/internal/handler/meeting_token.go`
- Modify: `server/internal/handler/router.go`
- Test: `server/internal/meetings/livekit_test.go`

**Interfaces:**
- Consumes: `MeetingService.Get` (Task 6), `config.Config.LiveKit*` (Task 1).
- Produces: `meetings.MintToken(apiKey, apiSecret, room, identity, name string, ttl time.Duration) (string, error)`; route `POST /api/v1/meetings/{meetingID}/token` → `{"token": "...", "url": "<LIVEKIT_URL>"}`; LiveKit chưa cấu hình → 503 code `livekit_not_configured`.

- [ ] **Step 1: Test mint token (fail trước)**

`server/internal/meetings/livekit_test.go`:

```go
package meetings

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestMintToken(t *testing.T) {
	tok, err := MintToken("api-key", "api-secret-at-least-32-characters!!", "uniwork-room1", "user_1", "Hà", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(tok, func(*jwt.Token) (any, error) {
		return []byte("api-secret-at-least-32-characters!!"), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatal("token does not verify:", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["sub"] != "user_1" {
		t.Fatalf("sub = %v", claims["sub"])
	}
	video, ok := claims["video"].(map[string]any)
	if !ok || video["room"] != "uniwork-room1" || video["roomJoin"] != true {
		t.Fatalf("video grant = %v", claims["video"])
	}
}
```

Run: `cd server && go test ./internal/meetings/` → FAIL.

- [ ] **Step 2: Implement**

```bash
cd server && go get github.com/livekit/protocol@latest
```

`server/internal/meetings/livekit.go`:

```go
// Package meetings mints LiveKit access tokens server-side so the
// LiveKit API secret never reaches the frontend.
package meetings

import (
	"time"

	"github.com/livekit/protocol/auth"
)

func MintToken(apiKey, apiSecret, room, identity, name string, ttl time.Duration) (string, error) {
	at := auth.NewAccessToken(apiKey, apiSecret)
	grant := &auth.VideoGrant{RoomJoin: true, Room: room}
	at.SetVideoGrant(grant).SetIdentity(identity).SetName(name).SetValidFor(ttl)
	return at.ToJWT()
}
```

Run: `cd server && go test ./internal/meetings/` → PASS.

- [ ] **Step 3: Handler**

`server/internal/handler/meeting_token.go`:

```go
package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) meetingToken(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.LiveKitAPIKey == "" || h.Cfg.LiveKitAPISecret == "" || h.Cfg.LiveKitURL == "" {
		respondError(w, http.StatusServiceUnavailable, "livekit_not_configured",
			"LiveKit chưa được cấu hình trên server")
		return
	}
	userID := middleware.UserID(r.Context())
	m, err := h.Meetings.Get(r.Context(), userID, chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	u, err := h.Auth.Me(r.Context(), userID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tok, err := meetings.MintToken(h.Cfg.LiveKitAPIKey, h.Cfg.LiveKitAPISecret,
		m.RoomName, u.ID, u.DisplayName, 6*time.Hour)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"token": tok, "url": h.Cfg.LiveKitURL})
}
```

Route trong group RequireAuth: `r.Post("/meetings/{meetingID}/token", h.meetingToken)`.

- [ ] **Step 4: Test + commit**

Run: `cd server && go test ./... && go vet ./...` → PASS.

```bash
git add -A
git commit -m "feat: LiveKit token minting endpoint"
```

### Task 8: Realtime — WebSocket hub + Redis pub/sub + wire publisher

**Files:**
- Create: `server/internal/realtime/hub.go`, `server/internal/realtime/client.go`, `server/internal/realtime/publisher.go`
- Create: `server/internal/handler/ws.go`
- Modify: `server/internal/handler/router.go`, `server/cmd/server/main.go` (thay NopPublisher)
- Test: `server/internal/realtime/hub_test.go`

**Interfaces:**
- Consumes: `service.Event`, `service.EventPublisher` (Task 5), `auth.TokenMinter`, `WorkspaceService.RequireMember`.
- Produces:
  - `realtime.NewHub() *Hub`; `Hub.Add(workspaceID string, c *Client)`, `Hub.Remove(workspaceID string, c *Client)`, `Hub.Broadcast(workspaceID string, msg []byte)` (non-blocking, drop khi buffer đầy)
  - `realtime.NewClient(send chan []byte) *Client` — client có `Send() <-chan []byte`
  - `realtime.NewPublisher(hub *Hub, redisURL string, log *slog.Logger) (service.EventPublisher, error)` — redisURL rỗng → publish thẳng vào hub; có Redis → PUBLISH kênh `ws:{workspaceID}`, kèm goroutine PSubscribe `ws:*` đẩy về hub (đường chạy multi-instance)
  - Route `GET /api/v1/ws?workspace={workspaceID}&token={accessJWT}` — verify token qua query (browser WS không gửi được header), check membership, upgrade websocket; server chỉ đẩy xuống, bỏ qua message từ client; ping mỗi 30s.
  - Wire format xuống client: `{"type":"task.updated","payload":{"task_id":"..."}}`.

- [ ] **Step 1: Hub test (fail trước)**

`server/internal/realtime/hub_test.go`:

```go
package realtime

import (
	"testing"
	"time"
)

func recvOrTimeout(t *testing.T, ch <-chan []byte) []byte {
	t.Helper()
	select {
	case m := <-ch:
		return m
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for message")
		return nil
	}
}

func TestBroadcastToWorkspaceOnly(t *testing.T) {
	h := NewHub()
	c1 := NewClient(make(chan []byte, 8))
	c2 := NewClient(make(chan []byte, 8))
	other := NewClient(make(chan []byte, 8))
	h.Add("ws1", c1)
	h.Add("ws1", c2)
	h.Add("ws2", other)

	h.Broadcast("ws1", []byte("hello"))
	if string(recvOrTimeout(t, c1.Send())) != "hello" {
		t.Fatal("c1 missed")
	}
	if string(recvOrTimeout(t, c2.Send())) != "hello" {
		t.Fatal("c2 missed")
	}
	select {
	case <-other.Send():
		t.Fatal("ws2 client received ws1 message")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestRemoveStopsDelivery(t *testing.T) {
	h := NewHub()
	c := NewClient(make(chan []byte, 1))
	h.Add("ws1", c)
	h.Remove("ws1", c)
	h.Broadcast("ws1", []byte("x"))
	select {
	case <-c.Send():
		t.Fatal("removed client received message")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSlowClientDoesNotBlock(t *testing.T) {
	h := NewHub()
	slow := NewClient(make(chan []byte)) // unbuffered, không ai đọc
	ok := NewClient(make(chan []byte, 8))
	h.Add("ws1", slow)
	h.Add("ws1", ok)
	done := make(chan struct{})
	go func() {
		h.Broadcast("ws1", []byte("m"))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("broadcast blocked on slow client")
	}
	recvOrTimeout(t, ok.Send())
}
```

Run: `cd server && go test ./internal/realtime/` → FAIL.

- [ ] **Step 2: Implement hub + client**

`server/internal/realtime/hub.go`:

```go
// Package realtime fans out workspace-scoped events to connected
// WebSocket clients. Scaled-down version of usf's internal/realtime:
// one room per workspace, drop-on-full delivery, Redis pub/sub bridge
// for multi-instance fanout.
package realtime

import "sync"

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{}
}

func NewHub() *Hub {
	return &Hub{rooms: map[string]map[*Client]struct{}{}}
}

func (h *Hub) Add(workspaceID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[workspaceID] == nil {
		h.rooms[workspaceID] = map[*Client]struct{}{}
	}
	h.rooms[workspaceID][c] = struct{}{}
}

func (h *Hub) Remove(workspaceID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms[workspaceID], c)
	if len(h.rooms[workspaceID]) == 0 {
		delete(h.rooms, workspaceID)
	}
}

func (h *Hub) Broadcast(workspaceID string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.rooms[workspaceID] {
		select {
		case c.send <- msg:
		default: // client chậm: drop message thay vì block cả hub
		}
	}
}
```

`server/internal/realtime/client.go`:

```go
package realtime

type Client struct {
	send chan []byte
}

func NewClient(send chan []byte) *Client {
	return &Client{send: send}
}

func (c *Client) Send() <-chan []byte { return c.send }
```

Run: `cd server && go test ./internal/realtime/` → PASS.

- [ ] **Step 3: Publisher (hub trực tiếp + Redis bridge)**

`server/internal/realtime/publisher.go`:

```go
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/service"
)

const channelPrefix = "ws:"

type publisher struct {
	hub *Hub
	red *redis.Client
	log *slog.Logger
}

// NewPublisher returns an EventPublisher. With redisURL empty it fans out
// in-process only; with Redis it PUBLISHes and a subscriber goroutine
// feeds the local hub, so multiple server instances stay in sync.
func NewPublisher(hub *Hub, redisURL string, log *slog.Logger) (service.EventPublisher, error) {
	p := &publisher{hub: hub, log: log}
	if redisURL == "" {
		return p, nil
	}
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	p.red = redis.NewClient(opt)
	go p.subscribe()
	return p, nil
}

func (p *publisher) Publish(ctx context.Context, workspaceID string, ev service.Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		p.log.Error("marshal event", "err", err)
		return
	}
	if p.red == nil {
		p.hub.Broadcast(workspaceID, b)
		return
	}
	if err := p.red.Publish(ctx, channelPrefix+workspaceID, b).Err(); err != nil {
		p.log.Error("redis publish", "err", err)
		p.hub.Broadcast(workspaceID, b) // degrade về local
	}
}

func (p *publisher) subscribe() {
	ctx := context.Background()
	sub := p.red.PSubscribe(ctx, channelPrefix+"*")
	for msg := range sub.Channel() {
		wsID := strings.TrimPrefix(msg.Channel, channelPrefix)
		p.hub.Broadcast(wsID, []byte(msg.Payload))
	}
}
```

- [ ] **Step 4: WS handler**

```bash
cd server && go get github.com/gorilla/websocket@latest github.com/redis/go-redis/v9@latest
```

`server/internal/handler/ws.go`:

```go
package handler

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/unicomhub/uniwork/server/internal/realtime"
)

var upgrader = websocket.Upgrader{
	// CORS đã chặn ở tầng HTTP; origin FE cho phép qua config
	CheckOrigin: func(r *http.Request) bool { return true },
}

// GET /api/v1/ws?workspace=...&token=...
// Token qua query vì browser WebSocket không gửi được Authorization header.
func (h *handlers) ws(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	workspaceID := r.URL.Query().Get("workspace")
	uid, err := h.Minter.Parse(token)
	if err != nil {
		respondError(w, 401, "unauthorized", "invalid token")
		return
	}
	if _, err := h.Workspaces.RequireMember(r.Context(), workspaceID, uid); err != nil {
		respondError(w, 403, "forbidden", "not a member")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	send := make(chan []byte, 32)
	client := realtime.NewClient(send)
	h.Hub.Add(workspaceID, client)
	defer func() {
		h.Hub.Remove(workspaceID, client)
		conn.Close()
	}()

	// reader: chỉ để phát hiện close
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				conn.Close()
				return
			}
		}
	}()

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case msg, ok := <-send:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

`Deps` thêm `Hub *realtime.Hub`. Route (NGOÀI group RequireAuth vì token đi qua query): `r.Get("/ws", h.ws)` trong `/api/v1`.

Wire `main.go`:

```go
	hub := realtime.NewHub()
	pub, err := realtime.NewPublisher(hub, cfg.RedisURL, log)
	if err != nil {
		log.Error("realtime", "err", err)
		os.Exit(1)
	}
	wsSvc := service.NewWorkspaceService(q)
	h := handler.New(handler.Deps{
		Cfg: cfg, Log: log, Minter: minter, Hub: hub,
		Auth:       service.NewAuthService(q, minter, cfg.RefreshTokenTTL),
		Workspaces: wsSvc,
		Tasks:      service.NewTaskService(q, wsSvc, pub),
		Meetings:   service.NewMeetingService(q, wsSvc, pub),
	})
```

Trong `newTestServer` (handler tests): `Hub: realtime.NewHub()` và giữ NopPublisher cho services.

- [ ] **Step 5: Test + commit**

Run: `cd server && go test ./... && go vet ./...` → PASS.
Smoke thủ công: `make db-up migrate-up && make server` rồi từ terminal khác `curl localhost:8080/healthz`.

```bash
git add -A
git commit -m "feat: realtime websocket hub with redis pub/sub fanout"
```

---

## Phase C — Frontend nền (Task 9–12)

### Task 9: FE monorepo scaffold — tsconfig, eslint-config, ui (design tokens), web shell

**Files:**
- Create: `packages/tsconfig/package.json`, `packages/tsconfig/base.json`, `packages/tsconfig/react-library.json`, `packages/tsconfig/nextjs.json`
- Create: `packages/eslint-config/package.json`, `packages/eslint-config/index.mjs`
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/styles/tokens.css`, `packages/ui/styles/base.css`, `packages/ui/lib/utils.ts`, `packages/ui/components/ui/button.tsx`, `packages/ui/components/ui/input.tsx`, `packages/ui/components/ui/label.tsx`, `packages/ui/components/ui/dialog.tsx`, `packages/ui/components/ui/select.tsx`, `packages/ui/vitest.config.ts`, `packages/ui/test/setup.ts`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.mjs`, `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
- Test: `packages/ui/lib/utils.test.ts`, `packages/ui/components/ui/button.test.tsx`

**Interfaces:**
- Produces:
  - `@uniwork/tsconfig/base.json|react-library.json|nextjs.json` — mọi package extend
  - `@uniwork/ui/styles/tokens.css` — design tokens (biến CSS); `@uniwork/ui/styles/base.css` — reset + nền
  - `@uniwork/ui/lib/utils` → `cn(...inputs)` (clsx + tailwind-merge)
  - `@uniwork/ui/components/ui/button` → `<Button variant="primary|secondary|ghost|danger" size="sm|md">`; `input` → `<Input>`; `label` → `<Label>`; `dialog` → `<Dialog><DialogTrigger/><DialogContent title=...>` (Base UI); `select` → `<Select items={[{value,label}]} value onValueChange>` (Base UI)
  - Token semantic classes (map qua Tailwind `@theme`): nền `bg-canvas`, `bg-surface`, `bg-subtle`; chữ `text-primary`, `text-secondary`, `text-tertiary`, `text-inverse`; viền `border-line`, `border-line-strong`; signal `text-danger`, `bg-danger`, `text-success`, `text-warning`, `bg-brand`, `text-brand`, `text-on-brand`. Views CHỈ dùng các class này cho màu.

- [ ] **Step 1: tsconfig + eslint-config packages**

`packages/tsconfig/package.json`:

```json
{ "name": "@uniwork/tsconfig", "version": "0.0.0", "private": true }
```

`packages/tsconfig/base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`packages/tsconfig/react-library.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": { "jsx": "react-jsx", "noEmit": true }
}
```

`packages/tsconfig/nextjs.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  }
}
```

`packages/eslint-config/package.json`:

```json
{
  "name": "@uniwork/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.mjs" },
  "dependencies": {
    "@eslint/js": "^9.32.0",
    "typescript-eslint": "^8.56.1",
    "eslint-plugin-react-hooks": "^5.2.0"
  }
}
```

`packages/eslint-config/index.mjs`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  },
  { ignores: ["**/.next/**", "**/dist/**", "**/node_modules/**"] }
);
```

- [ ] **Step 2: packages/ui — tokens + base css**

`packages/ui/package.json`:

```json
{
  "name": "@uniwork/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "exports": {
    "./components/ui/*": "./components/ui/*.tsx",
    "./lib/utils": "./lib/utils.ts",
    "./styles/tokens.css": "./styles/tokens.css",
    "./styles/base.css": "./styles/base.css"
  },
  "dependencies": {
    "@base-ui/react": "^1.3.0",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "lucide-react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "tailwind-merge": "catalog:"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@uniwork/tsconfig": "workspace:*",
    "@vitejs/plugin-react": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{ "extends": "@uniwork/tsconfig/react-library.json", "include": ["."] }
```

`packages/ui/styles/tokens.css` — triết lý usf: hierarchy bằng grayscale, màu chỉ là signal:

```css
/* UniWork design tokens. Light mặc định; dark qua .dark trên <html>.
   Views không được hardcode màu — chỉ dùng các biến/class token. */
:root {
  /* nền */
  --uw-canvas: #fafafa;
  --uw-surface: #ffffff;
  --uw-subtle: #f4f4f5;
  /* chữ */
  --uw-text-primary: #18181b;
  --uw-text-secondary: #52525b;
  --uw-text-tertiary: #a1a1aa;
  --uw-text-inverse: #fafafa;
  /* viền */
  --uw-line: #e4e4e7;
  --uw-line-strong: #d4d4d8;
  /* brand + signal (màu là tín hiệu, không trang trí) */
  --uw-brand: #2f5aff;
  --uw-on-brand: #ffffff;
  --uw-danger: #dc2626;
  --uw-success: #16a34a;
  --uw-warning: #d97706;
  /* khác */
  --uw-radius: 6px;
  --uw-focus: #2f5aff;
}

.dark {
  --uw-canvas: #111113;
  --uw-surface: #18181b;
  --uw-subtle: #232326;
  --uw-text-primary: #f4f4f5;
  --uw-text-secondary: #a1a1aa;
  --uw-text-tertiary: #6b6b74;
  --uw-text-inverse: #18181b;
  --uw-line: #2a2a2e;
  --uw-line-strong: #3b3b41;
  --uw-brand: #6584ff;
  --uw-on-brand: #0d1220;
  --uw-danger: #f87171;
  --uw-success: #4ade80;
  --uw-warning: #fbbf24;
  --uw-focus: #6584ff;
}
```

`packages/ui/styles/base.css`:

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--uw-canvas);
  color: var(--uw-text-primary);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
:focus-visible { outline: 2px solid var(--uw-focus); outline-offset: 2px; }
```

- [ ] **Step 3: cn + Button test (fail trước)**

`packages/ui/lib/utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges tailwind classes with later value winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});
```

`packages/ui/components/ui/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders children and respects variant class", () => {
    render(<Button variant="danger">Xóa</Button>);
    const btn = screen.getByRole("button", { name: "Xóa" });
    expect(btn.className).toContain("bg-danger");
  });
});
```

`packages/ui/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

`packages/ui/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Run: `pnpm install && pnpm --filter @uniwork/ui test` → FAIL.

- [ ] **Step 4: Implement utils + primitives**

`packages/ui/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`packages/ui/components/ui/button.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--uw-radius)] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-brand text-on-brand hover:opacity-90",
        secondary: "bg-surface text-primary border border-line hover:bg-subtle",
        ghost: "text-secondary hover:bg-subtle hover:text-primary",
        danger: "bg-danger text-on-brand hover:opacity-90",
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-8 px-3 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

`packages/ui/components/ui/input.tsx`:

```tsx
import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-[var(--uw-radius)] border border-line bg-surface px-2.5 text-sm text-primary placeholder:text-tertiary",
        className,
      )}
      {...props}
    />
  );
}
```

`packages/ui/components/ui/label.tsx`:

```tsx
import * as React from "react";
import { cn } from "../../lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-[13px] font-medium text-secondary", className)} {...props} />;
}
```

`packages/ui/components/ui/dialog.tsx` (Base UI):

```tsx
"use client";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "../../lib/utils";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;

export function DialogContent({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 bg-black/40" />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-4 shadow-xl",
          className,
        )}
      >
        <BaseDialog.Title className="mb-3 text-base font-semibold text-primary">{title}</BaseDialog.Title>
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
```

`packages/ui/components/ui/select.tsx` (Base UI):

```tsx
"use client";
import { Select as BaseSelect } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectItem {
  value: string;
  label: string;
}

export function Select({
  items,
  value,
  onValueChange,
  placeholder,
  className,
}: {
  items: SelectItem[];
  value: string | null;
  onValueChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <BaseSelect.Root items={items} value={value} onValueChange={onValueChange}>
      <BaseSelect.Trigger
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-[var(--uw-radius)] border border-line bg-surface px-2.5 text-sm text-primary",
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon>
          <ChevronDown className="size-4 text-tertiary" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4}>
          <BaseSelect.Popup className="min-w-[var(--anchor-width)] rounded-[var(--uw-radius)] border border-line bg-surface p-1 shadow-lg">
            {items.map((item) => (
              <BaseSelect.Item
                key={item.value}
                value={item.value}
                className="cursor-default rounded px-2 py-1 text-sm text-primary data-[highlighted]:bg-subtle"
              >
                <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
```

Lưu ý: API Base UI 1.x — nếu tên component khác (Popup/Positioner), xem `../usf/packages/ui/components/ui/` để khớp cách usf dùng.

Run: `pnpm --filter @uniwork/ui test` → PASS.

- [ ] **Step 5: apps/web shell (Next.js + Tailwind 4 map token)**

`apps/web/package.json`:

```json
{
  "name": "@uniwork/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "sh -c 'next dev --port \"${FRONTEND_PORT:-3000}\"'",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@uniwork/ui": "workspace:*",
    "next": "^16.2.5",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@uniwork/eslint-config": "workspace:*",
    "@uniwork/tsconfig": "workspace:*",
    "eslint": "^9.32.0",
    "postcss": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "@uniwork/tsconfig/nextjs.json",
  "compilerOptions": { "paths": { "@/*": ["./*"] } },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@uniwork/ui", "@uniwork/core", "@uniwork/views"],
};
export default nextConfig;
```

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`apps/web/app/globals.css` — map token → Tailwind theme (Tailwind 4):

```css
@import "tailwindcss";
@import "@uniwork/ui/styles/tokens.css";
@import "@uniwork/ui/styles/base.css";

@theme inline {
  --color-canvas: var(--uw-canvas);
  --color-surface: var(--uw-surface);
  --color-subtle: var(--uw-subtle);
  --color-primary: var(--uw-text-primary);
  --color-secondary: var(--uw-text-secondary);
  --color-tertiary: var(--uw-text-tertiary);
  --color-inverse: var(--uw-text-inverse);
  --color-line: var(--uw-line);
  --color-line-strong: var(--uw-line-strong);
  --color-brand: var(--uw-brand);
  --color-on-brand: var(--uw-on-brand);
  --color-danger: var(--uw-danger);
  --color-success: var(--uw-success);
  --color-warning: var(--uw-warning);
}
```

(`@theme inline` sinh các class `bg-canvas`, `text-secondary`, `border-line`, `bg-danger`… đúng contract Interfaces.)

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "UniWork" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/app/page.tsx` (tạm — Task 11 thay bằng redirect theo session):

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/login");
}
```

- [ ] **Step 6: Build + commit**

Run: `pnpm install && pnpm --filter @uniwork/ui test && pnpm --filter @uniwork/web typecheck && pnpm --filter @uniwork/web build`
Expected: test PASS, build OK (route `/login` chưa tồn tại — build vẫn qua vì redirect chạy runtime).

```bash
git add -A
git commit -m "feat: FE monorepo scaffold with design tokens and web shell"
```

### Task 10: packages/core — api client, zod types, query client, i18n, session store

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/types/index.ts`
- Create: `packages/core/api/client.ts`, `packages/core/api/session.ts`
- Create: `packages/core/query-client.ts`
- Create: `packages/core/i18n/index.ts`, `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json`
- Create: `packages/core/index.ts`
- Test: `packages/core/types/index.test.ts`, `packages/core/api/client.test.ts`

**Interfaces:**
- Consumes: API contract backend (Task 3–7): response shapes `{user, access_token}`, `{workspaces}`, `{workspace}`, `{members}`, `{tasks}`, `{task}`, `{comments}`, `{meetings}`, `{meeting}`, `{notes}`, `{token, url}`, error `{error:{code,message}}`.
- Produces (mọi package views/web import từ `@uniwork/core`):
  - zod schemas + types: `User`, `Workspace`, `Member`, `Task`, `TaskComment`, `Meeting`, `MeetingNote` và `UserSchema`… tương ứng
  - `session`: `getAccessToken(): string | null`, `setAccessToken(t: string | null)`, `subscribe(fn)` — module-level store (access token chỉ ở memory; refresh nằm trong cookie httpOnly do server quản)
  - `ApiError extends Error { code: string; status: number }`
  - `api.request<T>(path: string, opts?: { method?, body?, schema?: ZodType<T> }): Promise<T>` — base URL từ `NEXT_PUBLIC_API_URL`, tự gắn Bearer, tự refresh 1 lần khi 401 rồi retry, `credentials: "include"`
  - `api.login(email, password)`, `api.register(...)`, `api.refresh()`, `api.logout()` — cập nhật session store
  - `createQueryClient(): QueryClient`
  - `initI18n(): i18n` — i18next, `lng: "vi"`, resources vi/en; views dùng `useTranslation()` từ react-i18next

- [ ] **Step 1: Package + types test (fail trước)**

`packages/core/package.json`:

```json
{
  "name": "@uniwork/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "exports": {
    ".": "./index.ts",
    "./types": "./types/index.ts",
    "./api": "./api/client.ts",
    "./session": "./api/session.ts",
    "./query-client": "./query-client.ts",
    "./i18n": "./i18n/index.ts",
    "./auth": "./auth/hooks.ts",
    "./workspaces": "./workspaces/hooks.ts",
    "./tasks": "./tasks/hooks.ts",
    "./tasks/position": "./tasks/position.ts",
    "./meetings": "./meetings/hooks.ts",
    "./realtime": "./realtime/use-workspace-events.ts"
  },
  "dependencies": {
    "@tanstack/react-query": "catalog:",
    "i18next": "catalog:",
    "react": "catalog:",
    "react-i18next": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/react": "catalog:",
    "@uniwork/tsconfig": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

(Các export `auth|workspaces|tasks|meetings|realtime` tạo ở Task 11–13 — khai báo trước để contract ổn định; typecheck sẽ fail nếu import sớm.)

`packages/core/tsconfig.json`:

```json
{ "extends": "@uniwork/tsconfig/react-library.json", "include": ["."] }
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

`packages/core/types/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TaskSchema, UserSchema } from "./index";

describe("schemas", () => {
  it("parses a task from the API", () => {
    const task = TaskSchema.parse({
      id: "01ABC", workspace_id: "01WS", title: "Việc",
      description: "", status: "todo", priority: "medium",
      position: 1024, created_by: "01U",
      created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T00:00:00Z",
    });
    expect(task.assignee_id).toBeUndefined();
  });
  it("rejects unknown status", () => {
    expect(() =>
      TaskSchema.parse({
        id: "x", workspace_id: "w", title: "t", description: "",
        status: "weird", priority: "medium", position: 0, created_by: "u",
        created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T00:00:00Z",
      }),
    ).toThrow();
  });
  it("parses user", () => {
    expect(UserSchema.parse({ id: "u", email: "a@b.c", display_name: "A" }).display_name).toBe("A");
  });
});
```

Run: `pnpm install && pnpm --filter @uniwork/core test` → FAIL.

- [ ] **Step 2: Implement types**

`packages/core/types/index.ts`:

```ts
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const MemberSchema = z.object({
  workspace_id: z.string(),
  user_id: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullish(),
});
export type Member = z.infer<typeof MemberSchema>;

export const TaskStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
  position: z.number(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCommentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  created_at: z.union([z.string(), z.object({}).passthrough().transform(() => "")]),
  display_name: z.string().optional(),
  avatar_url: z.string().nullish(),
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;

export const MeetingSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  room_name: z.string(),
  created_by: z.string(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MeetingNoteSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  display_name: z.string().optional(),
});
export type MeetingNote = z.infer<typeof MeetingNoteSchema>;

export const SessionResponseSchema = z.object({
  user: UserSchema,
  access_token: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const WorkspaceEventSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.string()).optional(),
});
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
```

Lưu ý: comment/note trả thẳng row sqlc (snake_case, `created_at` có thể là object pgtype) — schema trên phòng thủ bằng union/passthrough; nếu backend chuẩn hoá DTO thì siết lại.

Run: `pnpm --filter @uniwork/core test` → PASS phần types.

- [ ] **Step 3: Client test (fail trước)**

`packages/core/api/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, request } from "./client";
import { setAccessToken } from "./session";

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("request", () => {
  beforeEach(() => {
    setAccessToken("tok-1");
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setAccessToken(null);
  });

  it("attaches bearer token and parses with schema", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ value: 7 }));
    const out = await request("/api/v1/x", { schema: z.object({ value: z.number() }) });
    expect(out.value).toBe(7);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/x");
    expect((init!.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
  });

  it("refreshes once on 401 then retries", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson({ error: { code: "unauthorized", message: "x" } }, 401))
      .mockResolvedValueOnce(okJson({ user: { id: "u", email: "a@b.c", display_name: "A" }, access_token: "tok-2" }))
      .mockResolvedValueOnce(okJson({ ok: true }));
    const out = await request<{ ok: boolean }>("/api/v1/x");
    expect(out.ok).toBe(true);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("http://api.test/api/v1/auth/refresh");
  });

  it("throws ApiError with code from body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ error: { code: "not_found", message: "m" } }, 404));
    await expect(request("/api/v1/x")).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(() => new ApiError("x", "c", 1)).not.toThrow();
  });
});
```

Run: `pnpm --filter @uniwork/core test` → FAIL.

- [ ] **Step 4: Implement session + client**

`packages/core/api/session.ts`:

```ts
// Access token sống trong memory (không localStorage — XSS-safe);
// refresh token là cookie httpOnly do server quản lý.
type Listener = () => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(t: string | null) {
  accessToken = t;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
```

`packages/core/api/client.ts`:

```ts
import type { ZodType } from "zod";
import { SessionResponseSchema, type SessionResponse } from "../types";
import { getAccessToken, setAccessToken } from "./session";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
}

interface RequestOpts<T> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  schema?: ZodType<T>;
  skipRefresh?: boolean;
}

async function rawFetch(path: string, opts: RequestOpts<unknown>): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(baseUrl() + path, {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export async function request<T = unknown>(path: string, opts: RequestOpts<T> = {}): Promise<T> {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && !opts.skipRefresh && !path.startsWith("/api/v1/auth/")) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, opts);
  }
  if (!res.ok) {
    let code = "internal";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) ({ code, message } = body.error);
    } catch {
      /* body không phải JSON */
    }
    throw new ApiError(message, code, res.status);
  }
  const data: unknown = await res.json();
  return opts.schema ? opts.schema.parse(data) : (data as T);
}

async function tryRefresh(): Promise<boolean> {
  try {
    const sess = await request<SessionResponse>("/api/v1/auth/refresh", {
      method: "POST",
      schema: SessionResponseSchema,
      skipRefresh: true,
    });
    setAccessToken(sess.access_token);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

export async function login(email: string, password: string): Promise<SessionResponse> {
  const sess = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    schema: SessionResponseSchema,
    skipRefresh: true,
  });
  setAccessToken(sess.access_token);
  return sess;
}

export async function registerUser(
  email: string,
  password: string,
  displayName: string,
): Promise<SessionResponse> {
  const sess = await request("/api/v1/auth/register", {
    method: "POST",
    body: { email, password, display_name: displayName },
    schema: SessionResponseSchema,
    skipRefresh: true,
  });
  setAccessToken(sess.access_token);
  return sess;
}

export async function refreshSession(): Promise<SessionResponse | null> {
  try {
    const sess = await request<SessionResponse>("/api/v1/auth/refresh", {
      method: "POST",
      schema: SessionResponseSchema,
      skipRefresh: true,
    });
    setAccessToken(sess.access_token);
    return sess;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export async function logout(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST", skipRefresh: true }).catch(() => {});
  setAccessToken(null);
}
```

Run: `pnpm --filter @uniwork/core test` → PASS.

- [ ] **Step 5: query-client + i18n + index**

`packages/core/query-client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
}
```

`packages/core/i18n/locales/vi.json`:

```json
{
  "common": {
    "save": "Lưu",
    "cancel": "Hủy",
    "delete": "Xóa",
    "create": "Tạo",
    "loading": "Đang tải…",
    "error": "Có lỗi xảy ra",
    "empty": "Chưa có dữ liệu"
  },
  "auth": {
    "login": "Đăng nhập",
    "register": "Đăng ký",
    "logout": "Đăng xuất",
    "email": "Email",
    "password": "Mật khẩu",
    "displayName": "Tên hiển thị",
    "noAccount": "Chưa có tài khoản?",
    "hasAccount": "Đã có tài khoản?",
    "invalidCredentials": "Email hoặc mật khẩu không đúng"
  },
  "workspace": {
    "create": "Tạo workspace",
    "name": "Tên workspace",
    "slug": "Định danh (slug)",
    "members": "Thành viên",
    "invite": "Mời thành viên",
    "inviteLink": "Link mời",
    "role": "Vai trò",
    "acceptInvite": "Tham gia workspace"
  },
  "nav": { "tasks": "Công việc", "meetings": "Cuộc họp", "members": "Thành viên" },
  "tasks": {
    "title": "Công việc",
    "new": "Việc mới",
    "board": "Bảng",
    "list": "Danh sách",
    "taskTitle": "Tiêu đề",
    "description": "Mô tả",
    "status": "Trạng thái",
    "priority": "Độ ưu tiên",
    "assignee": "Người phụ trách",
    "dueDate": "Hạn",
    "comments": "Bình luận",
    "addComment": "Viết bình luận…",
    "unassigned": "Chưa giao",
    "status_todo": "Cần làm",
    "status_in_progress": "Đang làm",
    "status_done": "Hoàn thành",
    "status_cancelled": "Đã hủy",
    "priority_low": "Thấp",
    "priority_medium": "Trung bình",
    "priority_high": "Cao",
    "priority_urgent": "Khẩn cấp"
  },
  "meetings": {
    "title": "Cuộc họp",
    "new": "Tạo cuộc họp",
    "upcoming": "Sắp diễn ra",
    "past": "Đã diễn ra",
    "meetingTitle": "Tiêu đề",
    "startsAt": "Bắt đầu",
    "endsAt": "Kết thúc",
    "join": "Vào phòng họp",
    "leave": "Rời phòng",
    "notes": "Biên bản",
    "notConfigured": "LiveKit chưa được cấu hình trên server"
  }
}
```

`packages/core/i18n/locales/en.json`:

```json
{}
```

`packages/core/i18n/index.ts`:

```ts
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

export function initI18n() {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      lng: "vi",
      fallbackLng: "vi",
      resources: { vi: { translation: vi }, en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return i18next;
}
```

`packages/core/index.ts`:

```ts
export * from "./types";
export * as api from "./api/client";
export * as session from "./api/session";
export { createQueryClient } from "./query-client";
export { initI18n } from "./i18n";
```

- [ ] **Step 6: Test + commit**

Run: `pnpm --filter @uniwork/core test && pnpm --filter @uniwork/core typecheck`
Expected: PASS (nếu typecheck kêu export chưa tồn tại của Task 11+, tạm bỏ các dòng export đó khỏi package.json và thêm lại đúng task).

```bash
git add -A
git commit -m "feat: core package with api client, schemas, i18n"
```

### Task 11: Auth FE — hooks, màn đăng nhập/đăng ký, providers, guard

**Files:**
- Create: `packages/core/auth/hooks.ts`
- Create: `packages/views/package.json`, `packages/views/tsconfig.json`, `packages/views/vitest.config.ts`, `packages/views/test/setup.ts`
- Create: `packages/views/auth/login-view.tsx`, `packages/views/auth/register-view.tsx`, `packages/views/auth/auth-card.tsx`
- Create: `apps/web/app/providers.tsx`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/register/page.tsx`
- Modify: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/package.json` (dep `@uniwork/core`, `@uniwork/views`)
- Test: `packages/views/auth/login-view.test.tsx`

**Interfaces:**
- Consumes: `api.*`, `session`, `createQueryClient`, `initI18n` (Task 10); ui primitives (Task 9).
- Produces:
  - `@uniwork/core/auth` hooks: `useSession()` → `{ user: User | null, status: "loading" | "authed" | "anon" }` (mount lần đầu gọi `refreshSession()`); `useLogin()`, `useRegister()`, `useLogout()` (TanStack mutations)
  - `@uniwork/views` package (react-library, phụ thuộc `@uniwork/core` + `@uniwork/ui`); export pattern `"./auth/*": "./auth/*.tsx"` v.v. theo domain
  - `LoginView({ onSuccess })`, `RegisterView({ onSuccess })` — form controlled, hiện lỗi `invalid_credentials`/`conflict` bằng i18n
  - `apps/web/app/providers.tsx` — client component bọc `QueryClientProvider` + `initI18n()`
  - Guard: mọi page trong `(auth)` nếu đã authed → redirect `/workspaces` (client-side trong view qua `useSession`); `app/page.tsx` → luôn redirect `/login` (Task 12 chuyển hướng tiếp)

- [ ] **Step 1: views package + test (fail trước)**

`packages/views/package.json`:

```json
{
  "name": "@uniwork/views",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "exports": {
    "./auth/*": "./auth/*.tsx",
    "./layout/*": "./layout/*.tsx",
    "./workspace/*": "./workspace/*.tsx",
    "./tasks/*": "./tasks/*.tsx",
    "./meetings/*": "./meetings/*.tsx"
  },
  "dependencies": {
    "@tanstack/react-query": "catalog:",
    "@uniwork/core": "workspace:*",
    "@uniwork/ui": "workspace:*",
    "lucide-react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-i18next": "catalog:"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "@uniwork/tsconfig": "workspace:*",
    "@vitejs/plugin-react": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/views/tsconfig.json`:

```json
{ "extends": "@uniwork/tsconfig/react-library.json", "include": ["."] }
```

`packages/views/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

`packages/views/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`packages/views/auth/login-view.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LoginView } from "./login-view";

initI18n();

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe("LoginView", () => {
  it("renders email/password fields and submit", () => {
    render(wrap(<LoginView onSuccess={() => {}} />));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
  });
});
```

Run: `pnpm install && pnpm --filter @uniwork/views test` → FAIL.

- [ ] **Step 2: core auth hooks**

`packages/core/auth/hooks.ts`:

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as api from "../api/client";
import { getAccessToken, subscribe } from "../api/session";
import type { User } from "../types";

export type SessionStatus = "loading" | "authed" | "anon";

let cachedUser: User | null = null;

export function useSession(): { user: User | null; status: SessionStatus } {
  const [state, setState] = useState<{ user: User | null; status: SessionStatus }>(
    cachedUser ? { user: cachedUser, status: "authed" } : { user: null, status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    if (!cachedUser && !getAccessToken()) {
      void api.refreshSession().then((sess) => {
        if (cancelled) return;
        cachedUser = sess?.user ?? null;
        setState(sess ? { user: sess.user, status: "authed" } : { user: null, status: "anon" });
      });
    }
    const unsub = subscribe(() => {
      if (!getAccessToken()) {
        cachedUser = null;
        if (!cancelled) setState({ user: null, status: "anon" });
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return state;
}

export function useLogin() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: (sess) => {
      cachedUser = sess.user;
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: ({ email, password, displayName }: { email: string; password: string; displayName: string }) =>
      api.registerUser(email, password, displayName),
    onSuccess: (sess) => {
      cachedUser = sess.user;
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      cachedUser = null;
      qc.clear();
    },
  });
}
```

- [ ] **Step 3: Auth views**

`packages/views/auth/auth-card.tsx`:

```tsx
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6">
        <h1 className="mb-4 text-lg font-semibold text-primary">{title}</h1>
        {children}
      </div>
    </div>
  );
}
```

`packages/views/auth/login-view.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLogin } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { AuthCard } from "./auth-card";

export function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const errorMsg =
    login.error instanceof ApiError && login.error.code === "invalid_credentials"
      ? t("auth.invalidCredentials")
      : login.error
        ? t("common.error")
        : null;

  return (
    <AuthCard title={t("auth.login")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password }, { onSuccess });
        }}
      >
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {errorMsg && <p className="text-[13px] text-danger">{errorMsg}</p>}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {t("auth.login")}
        </Button>
        <p className="text-center text-[13px] text-secondary">
          {t("auth.noAccount")}{" "}
          <a href="/register" className="text-brand hover:underline">
            {t("auth.register")}
          </a>
        </p>
      </form>
    </AuthCard>
  );
}
```

`packages/views/auth/register-view.tsx` — cùng cấu trúc LoginView, thêm field `displayName`, dùng `useRegister`, lỗi `conflict` → hiện "Email đã được đăng ký" (thêm key `auth.emailTaken` vào `vi.json`), link ngược về `/login` với `t("auth.hasAccount")`. Code đầy đủ:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRegister } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { AuthCard } from "./auth-card";

export function RegisterView({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const reg = useRegister();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const errorMsg =
    reg.error instanceof ApiError && reg.error.code === "conflict"
      ? t("auth.emailTaken")
      : reg.error
        ? t("common.error")
        : null;

  return (
    <AuthCard title={t("auth.register")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          reg.mutate({ email, password, displayName }, { onSuccess });
        }}
      >
        <div>
          <Label htmlFor="displayName">{t("auth.displayName")}</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input id="password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {errorMsg && <p className="text-[13px] text-danger">{errorMsg}</p>}
        <Button type="submit" className="w-full" disabled={reg.isPending}>
          {t("auth.register")}
        </Button>
        <p className="text-center text-[13px] text-secondary">
          {t("auth.hasAccount")}{" "}
          <a href="/login" className="text-brand hover:underline">
            {t("auth.login")}
          </a>
        </p>
      </form>
    </AuthCard>
  );
}
```

Thêm vào `vi.json` mục auth: `"emailTaken": "Email đã được đăng ký"`.

Run: `pnpm --filter @uniwork/views test` → PASS.

- [ ] **Step 4: Wire vào apps/web**

`apps/web/app/providers.tsx`:

```tsx
"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createQueryClient, initI18n } from "@uniwork/core";

initI18n();

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(createQueryClient);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
```

`apps/web/app/layout.tsx` — bọc `<Providers>{children}</Providers>` trong body.

`apps/web/app/(auth)/login/page.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { LoginView } from "@uniwork/views/auth/login-view";

export default function LoginPage() {
  const router = useRouter();
  return <LoginView onSuccess={() => router.push("/workspaces")} />;
}
```

`apps/web/app/(auth)/register/page.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { RegisterView } from "@uniwork/views/auth/register-view";

export default function RegisterPage() {
  const router = useRouter();
  return <RegisterView onSuccess={() => router.push("/workspaces")} />;
}
```

`apps/web/package.json` dependencies thêm: `"@uniwork/core": "workspace:*"`, `"@uniwork/views": "workspace:*"`, `"@tanstack/react-query": "catalog:"`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm install && pnpm --filter @uniwork/views test && pnpm typecheck && pnpm --filter @uniwork/web build`
Smoke thủ công: `make dev` → mở `http://localhost:3000/register`, đăng ký tài khoản → được chuyển đến `/workspaces` (404 — Task 12 tạo).

```bash
git add -A
git commit -m "feat: auth screens with session hooks"
```

### Task 12: Workspace shell — sidebar layout, chọn/tạo workspace, members, invite

**Files:**
- Create: `packages/core/workspaces/hooks.ts`
- Create: `packages/views/layout/app-shell.tsx`, `packages/views/layout/sidebar.tsx`
- Create: `packages/views/workspace/workspace-picker-view.tsx`, `packages/views/workspace/create-workspace-form.tsx`, `packages/views/workspace/members-view.tsx`, `packages/views/workspace/accept-invite-view.tsx`
- Create: `apps/web/app/workspaces/page.tsx`, `apps/web/app/invite/[token]/page.tsx`, `apps/web/app/[workspaceSlug]/layout.tsx`, `apps/web/app/[workspaceSlug]/page.tsx`, `apps/web/app/[workspaceSlug]/members/page.tsx`
- Test: `packages/core/workspaces/hooks.test.ts` (slug helper)

**Interfaces:**
- Consumes: `api.request`, schemas (Task 10), `useSession` (Task 11), ui primitives.
- Produces:
  - `@uniwork/core/workspaces`: `useWorkspaces()`, `useWorkspace(slug)`, `useCreateWorkspace()`, `useMembers(workspaceId)`, `useInvite(workspaceId)`, `useAcceptInvite()`, và pure helper `slugify(name: string): string` (bỏ dấu tiếng Việt, lowercase, `-`)
  - Query keys chuẩn (mọi task sau dùng đúng key): `["workspaces"]`, `["workspace", slug]`, `["members", workspaceId]`, `["tasks", workspaceId]`, `["task", taskId]`, `["comments", taskId]`, `["meetings", workspaceId]`, `["meeting", meetingId]`, `["notes", meetingId]`
  - `AppShell({ workspace, user, children })` — sidebar trái 240px (tên workspace, nav Tasks/Meetings/Members qua `<a href="/{slug}/...">`, nút logout ở đáy), main content bg-canvas
  - Route guard pattern: layout `[workspaceSlug]` là client component — `useSession()` anon → redirect `/login`; load workspace theo slug, 404/forbidden → redirect `/workspaces`
  - `/workspaces`: authed → danh sách workspace của user; có → click vào `/{slug}/tasks`; chưa có → form tạo (auto-slug từ tên); tạo xong → `/{slug}/tasks`
  - `/invite/[token]`: authed → gọi accept → redirect `/{slug}/tasks`; anon → redirect `/login` (đợt 1 chấp nhận user phải mở lại link sau đăng nhập)

- [ ] **Step 1: slugify test (fail trước)**

`packages/core/workspaces/hooks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify } from "./hooks";

describe("slugify", () => {
  it("strips Vietnamese diacritics and lowercases", () => {
    expect(slugify("Đội Alpha số 1")).toBe("doi-alpha-so-1");
  });
  it("collapses separators and trims", () => {
    expect(slugify("  Hello   World!  ")).toBe("hello-world");
  });
});
```

Run: `pnpm --filter @uniwork/core test` → FAIL.

- [ ] **Step 2: workspaces hooks**

`packages/core/workspaces/hooks.ts`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { MemberSchema, WorkspaceSchema, type Workspace } from "../types";

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });
const MembersResponse = z.object({ members: z.array(MemberSchema) });

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.request("/api/v1/workspaces", { schema: WorkspacesResponse }),
    select: (d) => d.workspaces,
  });
}

export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: ["workspace", slug],
    queryFn: () => api.request(`/api/v1/workspaces/${slug}`, { schema: WorkspaceResponse }),
    select: (d) => d.workspace,
    retry: false,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, slug }: { name: string; slug: string }) =>
      api.request("/api/v1/workspaces", {
        method: "POST",
        body: { name, slug },
        schema: WorkspaceResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api.request(`/api/v1/workspaces/${workspaceId}/members`, { schema: MembersResponse }),
    select: (d) => d.members,
    enabled: !!workspaceId,
  });
}

const InviteResponse = z.object({
  invitation: z.object({ id: z.string(), email: z.string(), role: z.string(), token: z.string() }),
});

export function useInvite(workspaceId: string) {
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: "admin" | "member" }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        body: { email, role },
        schema: InviteResponse,
      }),
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.request<{ workspace: Workspace }>(`/api/v1/invitations/${token}/accept`, {
        method: "POST",
        schema: WorkspaceResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}
```

Run: `pnpm --filter @uniwork/core test` → PASS.

- [ ] **Step 3: Shell + sidebar**

`packages/views/layout/sidebar.tsx`:

```tsx
"use client";
import { CalendarDays, LogOut, SquareCheckBig, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import type { User, Workspace } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

const nav = [
  { key: "nav.tasks", href: "tasks", icon: SquareCheckBig },
  { key: "nav.meetings", href: "meetings", icon: CalendarDays },
  { key: "nav.members", href: "members", icon: Users },
] as const;

export function Sidebar({
  workspace,
  user,
  active,
}: {
  workspace: Workspace;
  user: User;
  active: string;
}) {
  const { t } = useTranslation();
  const logout = useLogout();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <div className="truncate text-sm font-semibold text-primary">{workspace.name}</div>
        <div className="truncate text-[12px] text-tertiary">{user.display_name}</div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {nav.map(({ key, href, icon: Icon }) => (
          <a
            key={href}
            href={`/${workspace.slug}/${href}`}
            className={cn(
              "flex items-center gap-2 rounded-[var(--uw-radius)] px-2.5 py-1.5 text-sm",
              active === href
                ? "bg-subtle font-medium text-primary"
                : "text-secondary hover:bg-subtle hover:text-primary",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </a>
        ))}
      </nav>
      <button
        className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm text-secondary hover:text-primary"
        onClick={() => {
          logout.mutate(undefined, { onSuccess: () => window.location.assign("/login") });
        }}
      >
        <LogOut className="size-4" />
        {t("auth.logout")}
      </button>
    </aside>
  );
}
```

`packages/views/layout/app-shell.tsx`:

```tsx
import type { User, Workspace } from "@uniwork/core/types";
import { Sidebar } from "./sidebar";

export function AppShell({
  workspace,
  user,
  active,
  children,
}: {
  workspace: Workspace;
  user: User;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh bg-canvas">
      <Sidebar workspace={workspace} user={user} active={active} />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Workspace views**

`packages/views/workspace/create-workspace-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { slugify, useCreateWorkspace } from "@uniwork/core/workspaces";
import type { Workspace } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function CreateWorkspaceForm({ onCreated }: { onCreated: (w: Workspace) => void }) {
  const { t } = useTranslation();
  const create = useCreateWorkspace();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ name, slug }, { onSuccess: (d) => onCreated(d.workspace) });
      }}
    >
      <div>
        <Label htmlFor="ws-name">{t("workspace.name")}</Label>
        <Input
          id="ws-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          required
        />
      </div>
      <div>
        <Label htmlFor="ws-slug">{t("workspace.slug")}</Label>
        <Input
          id="ws-slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          required
        />
      </div>
      {create.error && <p className="text-[13px] text-danger">{t("common.error")}</p>}
      <Button type="submit" disabled={create.isPending}>
        {t("workspace.create")}
      </Button>
    </form>
  );
}
```

`packages/views/workspace/workspace-picker-view.tsx`:

```tsx
"use client";
import { useTranslation } from "react-i18next";
import { useWorkspaces } from "@uniwork/core/workspaces";
import type { Workspace } from "@uniwork/core/types";
import { CreateWorkspaceForm } from "./create-workspace-form";

export function WorkspacePickerView({ onPick }: { onPick: (w: Workspace) => void }) {
  const { t } = useTranslation();
  const { data: workspaces, isLoading } = useWorkspaces();

  if (isLoading) return <p className="p-8 text-secondary">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-md p-8">
      {workspaces && workspaces.length > 0 ? (
        <div className="space-y-2">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => onPick(w)}
              className="block w-full rounded-lg border border-line bg-surface px-4 py-3 text-left text-sm font-medium text-primary hover:bg-subtle"
            >
              {w.name}
              <span className="ml-2 text-[12px] font-normal text-tertiary">/{w.slug}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="mb-4 text-lg font-semibold text-primary">{t("workspace.create")}</h1>
          <CreateWorkspaceForm onCreated={onPick} />
        </div>
      )}
    </div>
  );
}
```

`packages/views/workspace/members-view.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInvite, useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

export function MembersView({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const invite = useInvite(workspaceId);
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-semibold text-primary">{t("workspace.members")}</h1>
      <ul className="mb-6 divide-y divide-line rounded-lg border border-line bg-surface">
        {(members ?? []).map((m) => (
          <li key={m.user_id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <div className="text-sm text-primary">{m.display_name}</div>
              <div className="text-[12px] text-tertiary">{m.email}</div>
            </div>
            <span className="text-[12px] text-secondary">{m.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate(
            { email, role: "member" },
            {
              onSuccess: (d) =>
                setInviteLink(`${window.location.origin}/invite/${d.invitation.token}`),
            },
          );
        }}
      >
        <Input type="email" placeholder={t("auth.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Button type="submit" disabled={invite.isPending}>
          {t("workspace.invite")}
        </Button>
      </form>
      {inviteLink && (
        <p className="mt-3 break-all rounded border border-line bg-subtle p-2 text-[13px] text-secondary">
          {t("workspace.inviteLink")}: {inviteLink}
        </p>
      )}
    </div>
  );
}
```

(Đợt 1 chưa gửi email mời — hiển thị link để copy gửi tay. YAGNI.)

`packages/views/workspace/accept-invite-view.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { useAcceptInvite } from "@uniwork/core/workspaces";

export function AcceptInviteView({
  token,
  onAccepted,
  onAnon,
}: {
  token: string;
  onAccepted: (slug: string) => void;
  onAnon: () => void;
}) {
  const { t } = useTranslation();
  const { status } = useSession();
  const accept = useAcceptInvite();
  const fired = useRef(false);

  useEffect(() => {
    if (status === "anon") onAnon();
    if (status === "authed" && !fired.current) {
      fired.current = true;
      accept.mutate(token, { onSuccess: (d) => onAccepted(d.workspace.slug) });
    }
  }, [status, token, accept, onAccepted, onAnon]);

  return (
    <p className="p-8 text-secondary">
      {accept.error ? t("common.error") : t("common.loading")}
    </p>
  );
}
```

- [ ] **Step 5: Routes apps/web**

`apps/web/app/workspaces/page.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@uniwork/core/auth";
import { WorkspacePickerView } from "@uniwork/views/workspace/workspace-picker-view";

export default function WorkspacesPage() {
  const router = useRouter();
  const { status } = useSession();
  useEffect(() => {
    if (status === "anon") router.replace("/login");
  }, [status, router]);
  if (status !== "authed") return null;
  return <WorkspacePickerView onPick={(w) => router.push(`/${w.slug}/tasks`)} />;
}
```

`apps/web/app/invite/[token]/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { AcceptInviteView } from "@uniwork/views/workspace/accept-invite-view";

export default function InvitePage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  return (
    <AcceptInviteView
      token={token}
      onAccepted={(slug) => router.replace(`/${slug}/tasks`)}
      onAnon={() => router.replace("/login")}
    />
  );
}
```

`apps/web/app/[workspaceSlug]/layout.tsx` — guard + shell, expose workspace qua context:

```tsx
"use client";
import { createContext, useContext, useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useSession } from "@uniwork/core/auth";
import { useWorkspace } from "@uniwork/core/workspaces";
import type { User, Workspace } from "@uniwork/core/types";
import { AppShell } from "@uniwork/views/layout/app-shell";

const WorkspaceContext = createContext<{ workspace: Workspace; user: User } | null>(null);

export function useCurrentWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useCurrentWorkspace outside workspace layout");
  return ctx;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { user, status } = useSession();
  const { data: workspace, error } = useWorkspace(status === "authed" ? workspaceSlug : "");

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    if (error) router.replace("/workspaces");
  }, [status, error, router]);

  if (status !== "authed" || !workspace || !user) return null;

  const active = pathname.split("/")[2] ?? "tasks";
  return (
    <WorkspaceContext.Provider value={{ workspace, user }}>
      <AppShell workspace={workspace} user={user} active={active}>
        {children}
      </AppShell>
    </WorkspaceContext.Provider>
  );
}
```

`apps/web/app/[workspaceSlug]/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspaceHome() {
  const router = useRouter();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  useEffect(() => router.replace(`/${workspaceSlug}/tasks`), [router, workspaceSlug]);
  return null;
}
```

`apps/web/app/[workspaceSlug]/members/page.tsx`:

```tsx
"use client";
import { MembersView } from "@uniwork/views/workspace/members-view";
import { useCurrentWorkspace } from "../layout";

export default function MembersPage() {
  const { workspace } = useCurrentWorkspace();
  return <MembersView workspaceId={workspace.id} />;
}
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm test && pnpm --filter @uniwork/web build`
Smoke thủ công `make dev`: đăng ký → tạo workspace "Đội Alpha" (slug tự sinh `doi-alpha`) → vào `/doi-alpha/tasks` (404 — Task 13) → `/doi-alpha/members` hiện member + tạo được link mời; mở link mời bằng tài khoản thứ 2 → thành member.

```bash
git add -A
git commit -m "feat: workspace shell, picker, members and invite flow"
```

---

## Phase D — Tasks & Meetings UI + e2e (Task 13–17)

### Task 13: Tasks UI — hooks, board kéo-thả, list, realtime invalidation

**Files:**
- Create: `packages/core/tasks/hooks.ts`, `packages/core/tasks/position.ts`
- Create: `packages/core/realtime/use-workspace-events.ts`
- Create: `packages/views/tasks/board-view.tsx`, `packages/views/tasks/task-card.tsx`, `packages/views/tasks/new-task-dialog.tsx`, `packages/views/tasks/list-view.tsx`, `packages/views/tasks/tasks-page-view.tsx`
- Create: `apps/web/app/[workspaceSlug]/tasks/page.tsx`
- Modify: `packages/views/package.json` (dep `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`)
- Test: `packages/core/tasks/position.test.ts`

**Interfaces:**
- Consumes: query keys (Task 12), `api.request`, `TaskSchema`, `useCurrentWorkspace` (Task 12), WS endpoint (Task 8).
- Produces:
  - `@uniwork/core/tasks`: `useTasks(workspaceId)`, `useCreateTask(workspaceId)`, `useUpdateTask(workspaceId)` (nhận `{taskId, patch}`, optimistic update cache `["tasks", workspaceId]`), `useDeleteTask(workspaceId)`, `useTask(taskId)`, `useComments(taskId)`, `useAddComment(taskId)`
  - `@uniwork/core/tasks/position`: `computeDropPosition(tasks: {id, position}[], overIndex: number): number` — midpoint giữa 2 hàng xóm, đầu = first/2 hoặc 1024 nếu cột rỗng, cuối = last + 1024
  - `@uniwork/core/realtime`: `useWorkspaceEvents(workspaceId)` — mở WS `NEXT_PUBLIC_WS_URL + /api/v1/ws?workspace=&token=`, mỗi event `task.*|comment.*` → invalidate `["tasks", wsId]` (+ `["task", payload.task_id]`, `["comments", payload.task_id]`), `meeting.*` → invalidate `["meetings", wsId]`; tự reconnect sau 3s khi đứt
  - `TasksPageView({ workspaceId, onOpenTask })` — header (tiêu đề + nút "Việc mới") + board 4 cột theo status; card click → `onOpenTask(taskId)`
  - Board dùng `@dnd-kit/core` `DndContext` + `useDraggable`/`useDroppable`; drop → `useUpdateTask` với `{status, position}`

- [ ] **Step 1: position test (fail trước)**

`packages/core/tasks/position.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDropPosition } from "./position";

const rows = [
  { id: "a", position: 1024 },
  { id: "b", position: 2048 },
  { id: "c", position: 3072 },
];

describe("computeDropPosition", () => {
  it("empty column → 1024", () => {
    expect(computeDropPosition([], 0)).toBe(1024);
  });
  it("drop at head → half of first", () => {
    expect(computeDropPosition(rows, 0)).toBe(512);
  });
  it("drop in middle → midpoint of neighbours", () => {
    expect(computeDropPosition(rows, 1)).toBe(1536);
  });
  it("drop at tail → last + 1024", () => {
    expect(computeDropPosition(rows, 3)).toBe(4096);
  });
});
```

Run: `pnpm --filter @uniwork/core test` → FAIL.

- [ ] **Step 2: Implement position + hooks + realtime**

`packages/core/tasks/position.ts`:

```ts
// Board ordering: float positions với midpoint insertion (kiểu Linear/usf).
// overIndex = vị trí muốn chèn trong danh sách đích (0..len).
export function computeDropPosition(
  rows: { id: string; position: number }[],
  overIndex: number,
): number {
  if (rows.length === 0) return 1024;
  if (overIndex <= 0) return rows[0]!.position / 2;
  if (overIndex >= rows.length) return rows[rows.length - 1]!.position + 1024;
  return (rows[overIndex - 1]!.position + rows[overIndex]!.position) / 2;
}
```

`packages/core/tasks/hooks.ts`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { TaskCommentSchema, TaskSchema, type Task } from "../types";

const TasksResponse = z.object({ tasks: z.array(TaskSchema) });
const TaskResponse = z.object({ task: TaskSchema });
const CommentsResponse = z.object({ comments: z.array(TaskCommentSchema) });
const CommentResponse = z.object({ comment: TaskCommentSchema });

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: Task["status"];
  priority?: Task["priority"];
  position?: number;
  assignee_id?: string | null;
  due_date?: string | null;
}

export function useTasks(workspaceId: string) {
  return useQuery({
    queryKey: ["tasks", workspaceId],
    queryFn: () => api.request(`/api/v1/workspaces/${workspaceId}/tasks`, { schema: TasksResponse }),
    select: (d) => d.tasks,
    enabled: !!workspaceId,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.request(`/api/v1/tasks/${taskId}`, { schema: TaskResponse }),
    select: (d) => d.task,
    enabled: !!taskId,
  });
}

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string; priority?: Task["priority"] }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body,
        schema: TaskResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: TaskPatch }) =>
      api.request(`/api/v1/tasks/${taskId}`, { method: "PATCH", body: patch, schema: TaskResponse }),
    // optimistic: board phản hồi tức thì khi kéo-thả
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks", workspaceId] });
      const prev = qc.getQueryData<{ tasks: Task[] }>(["tasks", workspaceId]);
      if (prev) {
        qc.setQueryData(["tasks", workspaceId], {
          tasks: prev.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  ...Object.fromEntries(
                    Object.entries(patch).filter(([, v]) => v !== undefined),
                  ),
                }
              : t,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks", workspaceId], ctx.prev);
    },
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.request(`/api/v1/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
}

export function useComments(taskId: string) {
  return useQuery({
    queryKey: ["comments", taskId],
    queryFn: () => api.request(`/api/v1/tasks/${taskId}/comments`, { schema: CommentsResponse }),
    select: (d) => d.comments,
    enabled: !!taskId,
  });
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.request(`/api/v1/tasks/${taskId}/comments`, {
        method: "POST",
        body: { body },
        schema: CommentResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", taskId] }),
  });
}
```

`packages/core/realtime/use-workspace-events.ts`:

```ts
"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getAccessToken } from "../api/session";
import { WorkspaceEventSchema } from "../types";

export function useWorkspaceEvents(workspaceId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = getAccessToken();
      if (!token) return;
      const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
      ws = new WebSocket(`${base}/api/v1/ws?workspace=${workspaceId}&token=${token}`);
      ws.onmessage = (msg) => {
        const parsed = WorkspaceEventSchema.safeParse(JSON.parse(String(msg.data)));
        if (!parsed.success) return;
        const { type, payload } = parsed.data;
        if (type.startsWith("task.") || type.startsWith("comment.")) {
          void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
          const taskId = payload?.task_id;
          if (taskId) {
            void qc.invalidateQueries({ queryKey: ["task", taskId] });
            void qc.invalidateQueries({ queryKey: ["comments", taskId] });
          }
        }
        if (type.startsWith("meeting.")) {
          void qc.invalidateQueries({ queryKey: ["meetings", workspaceId] });
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [workspaceId, qc]);
}
```

Run: `pnpm --filter @uniwork/core test && pnpm --filter @uniwork/core typecheck` → PASS.

- [ ] **Step 3: Board views**

Thêm vào `packages/views/package.json` dependencies: `"@dnd-kit/core": "^6.3.1"` rồi `pnpm install`.

`packages/views/tasks/task-card.tsx`:

```tsx
"use client";
import { useDraggable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import type { Task } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

// Màu chỉ là signal: priority cao/khẩn mới có màu, còn lại grayscale.
const priorityClass: Record<Task["priority"], string> = {
  low: "text-tertiary",
  medium: "text-secondary",
  high: "text-warning",
  urgent: "text-danger",
};

export function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined
      }
      className={cn(
        "block w-full rounded-[var(--uw-radius)] border border-line bg-surface p-2.5 text-left hover:border-line-strong",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="text-sm text-primary">{task.title}</div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        <span className={priorityClass[task.priority]}>{t(`tasks.priority_${task.priority}`)}</span>
        {task.due_date && <span className="text-tertiary">{task.due_date}</span>}
      </div>
    </button>
  );
}
```

`packages/views/tasks/board-view.tsx`:

```tsx
"use client";
import { DndContext, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import { useTasks, useUpdateTask } from "@uniwork/core/tasks";
import { computeDropPosition } from "@uniwork/core/tasks/position";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { TaskCard } from "./task-card";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: TaskStatus;
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-lg bg-subtle p-2 ${isOver ? "ring-2 ring-[var(--uw-focus)]" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-medium text-secondary">{t(`tasks.status_${status}`)}</span>
        <span className="text-[12px] text-tertiary">{tasks.length}</span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-auto">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export function BoardView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { data: tasks } = useTasks(workspaceId);
  const update = useUpdateTask(workspaceId);

  const byStatus = (s: TaskStatus) =>
    (tasks ?? []).filter((t) => t.status === s).sort((a, b) => a.position - b.position);

  const onDragEnd = (e: DragEndEvent) => {
    const task = e.active.data.current?.task as Task | undefined;
    const target = e.over?.id as TaskStatus | undefined;
    if (!task || !target || !COLUMNS.includes(target)) return;
    const dest = byStatus(target).filter((t) => t.id !== task.id);
    // Đợt 1: thả vào cuối cột (drop theo cột, chưa sort trong cột)
    const position = computeDropPosition(dest, dest.length);
    if (task.status === target && task.position === position) return;
    update.mutate({ taskId: task.id, patch: { status: target, position } });
  };

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {COLUMNS.map((s) => (
          <Column key={s} status={s} tasks={byStatus(s)} onOpen={onOpenTask} />
        ))}
      </div>
    </DndContext>
  );
}
```

`packages/views/tasks/new-task-dialog.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateTask } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function NewTaskDialog({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const create = useCreateTask(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("tasks.new")}</Button>} />
      <DialogContent title={t("tasks.new")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { title },
              {
                onSuccess: () => {
                  setTitle("");
                  setOpen(false);
                },
              },
            );
          }}
        >
          <div>
            <Label htmlFor="task-title">{t("tasks.taskTitle")}</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t("common.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

(Base UI 1.x: `DialogTrigger` nhận prop `render` thay vì `asChild` — nếu API khác, đối chiếu `../usf/packages/ui`.)

`packages/views/tasks/tasks-page-view.tsx`:

```tsx
"use client";
import { useTranslation } from "react-i18next";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { BoardView } from "./board-view";
import { NewTaskDialog } from "./new-task-dialog";

export function TasksPageView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();
  useWorkspaceEvents(workspaceId);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h1 className="text-sm font-semibold text-primary">{t("tasks.title")}</h1>
        <NewTaskDialog workspaceId={workspaceId} />
      </header>
      <div className="min-h-0 flex-1">
        <BoardView workspaceId={workspaceId} onOpenTask={onOpenTask} />
      </div>
    </div>
  );
}
```

`apps/web/app/[workspaceSlug]/tasks/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { TasksPageView } from "@uniwork/views/tasks/tasks-page-view";
import { useCurrentWorkspace } from "../layout";

export default function TasksPage() {
  const router = useRouter();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <TasksPageView
      workspaceId={workspace.id}
      onOpenTask={(id) => router.push(`/${workspaceSlug}/tasks/${id}`)}
    />
  );
}
```

- [ ] **Step 4: List view + toggle Bảng/Danh sách**

`packages/views/tasks/list-view.tsx`:

```tsx
"use client";
import { useTranslation } from "react-i18next";
import { useTasks } from "@uniwork/core/tasks";
import { useMembers } from "@uniwork/core/workspaces";

export function ListView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: tasks } = useTasks(workspaceId);
  const { data: members } = useMembers(workspaceId);
  const nameOf = (id?: string) =>
    members?.find((m) => m.user_id === id)?.display_name ?? t("tasks.unassigned");

  return (
    <div className="overflow-auto p-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-tertiary">
            <th className="py-2 pr-4 font-medium">{t("tasks.taskTitle")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.status")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.priority")}</th>
            <th className="py-2 pr-4 font-medium">{t("tasks.assignee")}</th>
            <th className="py-2 font-medium">{t("tasks.dueDate")}</th>
          </tr>
        </thead>
        <tbody>
          {(tasks ?? []).map((task) => (
            <tr
              key={task.id}
              onClick={() => onOpenTask(task.id)}
              className="cursor-pointer border-b border-line hover:bg-subtle"
            >
              <td className="py-2 pr-4 text-primary">{task.title}</td>
              <td className="py-2 pr-4 text-secondary">{t(`tasks.status_${task.status}`)}</td>
              <td className="py-2 pr-4 text-secondary">{t(`tasks.priority_${task.priority}`)}</td>
              <td className="py-2 pr-4 text-secondary">{nameOf(task.assignee_id)}</td>
              <td className="py-2 text-tertiary">{task.due_date ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Sửa `packages/views/tasks/tasks-page-view.tsx` — thêm toggle Bảng/Danh sách vào header:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { BoardView } from "./board-view";
import { ListView } from "./list-view";
import { NewTaskDialog } from "./new-task-dialog";

export function TasksPageView({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"board" | "list">("board");
  useWorkspaceEvents(workspaceId);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h1 className="text-sm font-semibold text-primary">{t("tasks.title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={mode === "board" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("board")}
          >
            {t("tasks.board")}
          </Button>
          <Button
            variant={mode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("list")}
          >
            {t("tasks.list")}
          </Button>
          <NewTaskDialog workspaceId={workspaceId} />
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {mode === "board" ? (
          <BoardView workspaceId={workspaceId} onOpenTask={onOpenTask} />
        ) : (
          <ListView workspaceId={workspaceId} onOpenTask={onOpenTask} />
        )}
      </div>
    </div>
  );
}
```

(Bản `tasks-page-view.tsx` ở Step 3 là bản trước toggle — dùng bản này làm bản cuối.)

- [ ] **Step 5: Verify + commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @uniwork/web build`
Smoke thủ công `make dev`: tạo vài task, kéo card giữa các cột — vị trí giữ sau reload; mở 2 tab cùng workspace, tạo task ở tab 1 → tab 2 tự cập nhật (realtime).

```bash
git add -A
git commit -m "feat: tasks board with drag-drop and realtime updates"
```

### Task 14: Task detail — mô tả, status/priority/assignee/due date, comments

**Files:**
- Create: `packages/views/tasks/task-detail-view.tsx`
- Create: `apps/web/app/[workspaceSlug]/tasks/[taskId]/page.tsx`

**Interfaces:**
- Consumes: `useTask`, `useUpdateTask`, `useDeleteTask`, `useComments`, `useAddComment` (Task 13), `useMembers` (Task 12), `Select` (Task 9), `useCurrentWorkspace`.
- Produces: `TaskDetailView({ workspaceId, taskId, onDeleted })` — 2 cột: trái = title (input inline, blur → save) + description (textarea, blur → save) + comments; phải = panel thuộc tính (status, priority, assignee từ members, due date `<input type="date">`, nút xóa task).

- [ ] **Step 1: Implement view**

`packages/views/tasks/task-detail-view.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import {
  useAddComment,
  useComments,
  useDeleteTask,
  useTask,
  useUpdateTask,
} from "@uniwork/core/tasks";
import type { TaskPriority, TaskStatus } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export function TaskDetailView({
  workspaceId,
  taskId,
  onDeleted,
}: {
  workspaceId: string;
  taskId: string;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { data: task } = useTask(taskId);
  const { data: members } = useMembers(workspaceId);
  const update = useUpdateTask(workspaceId);
  const del = useDeleteTask(workspaceId);
  const { data: comments } = useComments(taskId);
  const addComment = useAddComment(taskId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
    }
  }, [task?.id, task?.updated_at]);

  if (!task) return <p className="p-6 text-secondary">{t("common.loading")}</p>;

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ taskId, patch: p });

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && patch({ title })}
          className="w-full bg-transparent text-lg font-semibold text-primary outline-none"
        />
        <textarea
          value={description}
          placeholder={t("tasks.description")}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== task.description && patch({ description })}
          rows={8}
          className="mt-4 w-full resize-y rounded-[var(--uw-radius)] border border-line bg-surface p-3 text-sm text-primary placeholder:text-tertiary"
        />
        <h2 className="mb-2 mt-6 text-sm font-semibold text-primary">{t("tasks.comments")}</h2>
        <ul className="space-y-3">
          {(comments ?? []).map((c) => (
            <li key={c.id} className="rounded-[var(--uw-radius)] border border-line bg-surface p-3">
              <div className="mb-1 text-[12px] text-tertiary">{c.display_name ?? c.author_id}</div>
              <div className="whitespace-pre-wrap text-sm text-primary">{c.body}</div>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim())
              addComment.mutate(comment, { onSuccess: () => setComment("") });
          }}
        >
          <Input
            placeholder={t("tasks.addComment")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" disabled={addComment.isPending}>
            {t("common.save")}
          </Button>
        </form>
      </div>

      <aside className="w-64 shrink-0 space-y-4 border-l border-line p-4">
        <div>
          <Label>{t("tasks.status")}</Label>
          <Select
            items={STATUSES.map((s) => ({ value: s, label: t(`tasks.status_${s}`) }))}
            value={task.status}
            onValueChange={(v) => v && patch({ status: v as TaskStatus })}
          />
        </div>
        <div>
          <Label>{t("tasks.priority")}</Label>
          <Select
            items={PRIORITIES.map((p) => ({ value: p, label: t(`tasks.priority_${p}`) }))}
            value={task.priority}
            onValueChange={(v) => v && patch({ priority: v as TaskPriority })}
          />
        </div>
        <div>
          <Label>{t("tasks.assignee")}</Label>
          <Select
            items={[
              { value: "", label: t("tasks.unassigned") },
              ...(members ?? []).map((m) => ({ value: m.user_id, label: m.display_name })),
            ]}
            value={task.assignee_id ?? ""}
            onValueChange={(v) => patch({ assignee_id: v ? v : null })}
          />
        </div>
        <div>
          <Label>{t("tasks.dueDate")}</Label>
          <Input
            type="date"
            value={task.due_date ?? ""}
            onChange={(e) => patch({ due_date: e.target.value || null })}
          />
        </div>
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => del.mutate(taskId, { onSuccess: onDeleted })}
        >
          {t("common.delete")}
        </Button>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Route**

`apps/web/app/[workspaceSlug]/tasks/[taskId]/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { TaskDetailView } from "@uniwork/views/tasks/task-detail-view";
import { useCurrentWorkspace } from "../../layout";

export default function TaskDetailPage() {
  const router = useRouter();
  const { workspaceSlug, taskId } = useParams<{ workspaceSlug: string; taskId: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <TaskDetailView
      workspaceId={workspace.id}
      taskId={taskId}
      onDeleted={() => router.replace(`/${workspaceSlug}/tasks`)}
    />
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm --filter @uniwork/web build`
Smoke thủ công: mở task từ board → sửa title/description (blur lưu), đổi status/priority/assignee/due date, thêm comment, xóa task → về board.

```bash
git add -A
git commit -m "feat: task detail with properties panel and comments"
```

### Task 15: Meetings UI — hooks, danh sách, tạo cuộc họp, notes

**Files:**
- Create: `packages/core/meetings/hooks.ts`
- Create: `packages/views/meetings/meetings-page-view.tsx`, `packages/views/meetings/new-meeting-dialog.tsx`, `packages/views/meetings/meeting-detail-view.tsx`
- Create: `apps/web/app/[workspaceSlug]/meetings/page.tsx`, `apps/web/app/[workspaceSlug]/meetings/[meetingId]/page.tsx`
- Test: `packages/core/meetings/hooks.test.ts`

**Interfaces:**
- Consumes: query keys (Task 12), `MeetingSchema`, `useWorkspaceEvents` (Task 13), ui primitives.
- Produces:
  - `@uniwork/core/meetings`: `useMeetings(workspaceId)`, `useMeeting(meetingId)`, `useCreateMeeting(workspaceId)`, `useDeleteMeeting(workspaceId)`, `useNotes(meetingId)`, `useAddNote(meetingId)`, `useMeetingToken()` (mutation `meetingId` → `{token, url}`), và pure helper `splitMeetings(meetings, now): { upcoming: Meeting[]; past: Meeting[] }` (upcoming: `ends_at >= now` sort tăng theo starts_at; past: sort giảm)
  - `MeetingsPageView({ workspaceId, onOpen })` — 2 section Sắp diễn ra / Đã diễn ra + nút tạo
  - `MeetingDetailView({ meetingId, onJoin, onDeleted })` — info + notes + nút "Vào phòng họp" gọi `onJoin()`
  - `NewMeetingDialog({ workspaceId })` — form title + `datetime-local` start/end, submit gửi ISO string

- [ ] **Step 1: splitMeetings test (fail trước)**

`packages/core/meetings/hooks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitMeetings } from "./hooks";
import type { Meeting } from "../types";

const mk = (id: string, starts: string, ends: string): Meeting => ({
  id, workspace_id: "w", title: id, description: "",
  starts_at: starts, ends_at: ends, room_name: `uniwork-${id}`, created_by: "u",
});

describe("splitMeetings", () => {
  it("splits by ends_at and sorts each side", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const a = mk("a", "2026-08-24T13:00:00Z", "2026-08-24T14:00:00Z"); // upcoming
    const b = mk("b", "2026-08-25T09:00:00Z", "2026-08-25T10:00:00Z"); // upcoming, sau a
    const c = mk("c", "2026-08-20T09:00:00Z", "2026-08-20T10:00:00Z"); // past
    const d = mk("d", "2026-08-23T09:00:00Z", "2026-08-23T10:00:00Z"); // past, mới hơn c
    const { upcoming, past } = splitMeetings([d, b, c, a], now);
    expect(upcoming.map((m) => m.id)).toEqual(["a", "b"]);
    expect(past.map((m) => m.id)).toEqual(["d", "c"]);
  });
});
```

Run: `pnpm --filter @uniwork/core test` → FAIL.

- [ ] **Step 2: Implement hooks**

`packages/core/meetings/hooks.ts`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { MeetingNoteSchema, MeetingSchema, type Meeting } from "../types";

const MeetingsResponse = z.object({ meetings: z.array(MeetingSchema) });
const MeetingResponse = z.object({ meeting: MeetingSchema });
const NotesResponse = z.object({ notes: z.array(MeetingNoteSchema) });
const TokenResponse = z.object({ token: z.string(), url: z.string() });

export function splitMeetings(
  meetings: Meeting[],
  now: Date,
): { upcoming: Meeting[]; past: Meeting[] } {
  const upcoming = meetings
    .filter((m) => new Date(m.ends_at) >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = meetings
    .filter((m) => new Date(m.ends_at) < now)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

export function useMeetings(workspaceId: string) {
  return useQuery({
    queryKey: ["meetings", workspaceId],
    queryFn: () =>
      api.request(`/api/v1/workspaces/${workspaceId}/meetings`, { schema: MeetingsResponse }),
    select: (d) => d.meetings,
    enabled: !!workspaceId,
  });
}

export function useMeeting(meetingId: string) {
  return useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => api.request(`/api/v1/meetings/${meetingId}`, { schema: MeetingResponse }),
    select: (d) => d.meeting,
    enabled: !!meetingId,
  });
}

export function useCreateMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string; starts_at: string; ends_at: string }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/meetings`, {
        method: "POST",
        body,
        schema: MeetingResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", workspaceId] }),
  });
}

export function useDeleteMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) =>
      api.request(`/api/v1/meetings/${meetingId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", workspaceId] }),
  });
}

export function useNotes(meetingId: string) {
  return useQuery({
    queryKey: ["notes", meetingId],
    queryFn: () => api.request(`/api/v1/meetings/${meetingId}/notes`, { schema: NotesResponse }),
    select: (d) => d.notes,
    enabled: !!meetingId,
  });
}

export function useAddNote(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.request(`/api/v1/meetings/${meetingId}/notes`, { method: "POST", body: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", meetingId] }),
  });
}

export function useMeetingToken() {
  return useMutation({
    mutationFn: (meetingId: string) =>
      api.request(`/api/v1/meetings/${meetingId}/token`, { method: "POST", schema: TokenResponse }),
  });
}
```

Thêm export vào `packages/core/package.json`: `"./meetings": "./meetings/hooks.ts"` (đã khai từ Task 10).

Run: `pnpm --filter @uniwork/core test` → PASS.

- [ ] **Step 3: Views + routes**

`packages/views/meetings/new-meeting-dialog.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateMeeting } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function NewMeetingDialog({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const create = useCreateMeeting(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("meetings.new")}</Button>} />
      <DialogContent title={t("meetings.new")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                title,
                starts_at: new Date(start).toISOString(),
                ends_at: new Date(end).toISOString(),
              },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          <div>
            <Label htmlFor="m-title">{t("meetings.meetingTitle")}</Label>
            <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div>
            <Label htmlFor="m-start">{t("meetings.startsAt")}</Label>
            <Input id="m-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="m-end">{t("meetings.endsAt")}</Label>
            <Input id="m-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
          {create.error && <p className="text-[13px] text-danger">{t("common.error")}</p>}
          <Button type="submit" disabled={create.isPending}>
            {t("common.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`packages/views/meetings/meetings-page-view.tsx`:

```tsx
"use client";
import { useTranslation } from "react-i18next";
import { splitMeetings, useMeetings } from "@uniwork/core/meetings";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import type { Meeting } from "@uniwork/core/types";
import { NewMeetingDialog } from "./new-meeting-dialog";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function MeetingRow({ meeting, onOpen }: { meeting: Meeting; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(meeting.id)}
      className="flex w-full items-center justify-between rounded-[var(--uw-radius)] border border-line bg-surface px-4 py-2.5 text-left hover:border-line-strong"
    >
      <span className="text-sm text-primary">{meeting.title}</span>
      <span className="text-[12px] text-tertiary">
        {fmt(meeting.starts_at)} – {fmt(meeting.ends_at)}
      </span>
    </button>
  );
}

export function MeetingsPageView({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  useWorkspaceEvents(workspaceId);
  const { data: meetings } = useMeetings(workspaceId);
  const { upcoming, past } = splitMeetings(meetings ?? [], new Date());

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h1 className="text-sm font-semibold text-primary">{t("meetings.title")}</h1>
        <NewMeetingDialog workspaceId={workspaceId} />
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-auto p-6">
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-secondary">{t("meetings.upcoming")}</h2>
          <div className="space-y-2">
            {upcoming.length === 0 && <p className="text-[13px] text-tertiary">{t("common.empty")}</p>}
            {upcoming.map((m) => (
              <MeetingRow key={m.id} meeting={m} onOpen={onOpen} />
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-secondary">{t("meetings.past")}</h2>
          <div className="space-y-2">
            {past.map((m) => (
              <MeetingRow key={m.id} meeting={m} onOpen={onOpen} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

`packages/views/meetings/meeting-detail-view.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddNote, useDeleteMeeting, useMeeting, useNotes } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

export function MeetingDetailView({
  workspaceId,
  meetingId,
  onJoin,
  onDeleted,
}: {
  workspaceId: string;
  meetingId: string;
  onJoin: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { data: meeting } = useMeeting(meetingId);
  const { data: notes } = useNotes(meetingId);
  const addNote = useAddNote(meetingId);
  const del = useDeleteMeeting(workspaceId);
  const [note, setNote] = useState("");

  if (!meeting) return <p className="p-6 text-secondary">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary">{meeting.title}</h1>
          <p className="text-[13px] text-tertiary">
            {new Date(meeting.starts_at).toLocaleString("vi-VN")} –{" "}
            {new Date(meeting.ends_at).toLocaleString("vi-VN")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onJoin}>{t("meetings.join")}</Button>
          <Button variant="danger" size="md" onClick={() => del.mutate(meetingId, { onSuccess: onDeleted })}>
            {t("common.delete")}
          </Button>
        </div>
      </div>
      {meeting.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-secondary">{meeting.description}</p>
      )}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-primary">{t("meetings.notes")}</h2>
      <ul className="space-y-2">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="rounded-[var(--uw-radius)] border border-line bg-surface p-3">
            <div className="mb-1 text-[12px] text-tertiary">{n.display_name ?? n.author_id}</div>
            <div className="whitespace-pre-wrap text-sm text-primary">{n.body}</div>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) addNote.mutate(note, { onSuccess: () => setNote("") });
        }}
      >
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("meetings.notes")} />
        <Button type="submit" disabled={addNote.isPending}>
          {t("common.save")}
        </Button>
      </form>
    </div>
  );
}
```

`apps/web/app/[workspaceSlug]/meetings/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { MeetingsPageView } from "@uniwork/views/meetings/meetings-page-view";
import { useCurrentWorkspace } from "../layout";

export default function MeetingsPage() {
  const router = useRouter();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <MeetingsPageView
      workspaceId={workspace.id}
      onOpen={(id) => router.push(`/${workspaceSlug}/meetings/${id}`)}
    />
  );
}
```

`apps/web/app/[workspaceSlug]/meetings/[meetingId]/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { MeetingDetailView } from "@uniwork/views/meetings/meeting-detail-view";
import { useCurrentWorkspace } from "../../layout";

export default function MeetingDetailPage() {
  const router = useRouter();
  const { workspaceSlug, meetingId } = useParams<{ workspaceSlug: string; meetingId: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <MeetingDetailView
      workspaceId={workspace.id}
      meetingId={meetingId}
      onJoin={() => router.push(`/${workspaceSlug}/meetings/${meetingId}/room`)}
      onDeleted={() => router.replace(`/${workspaceSlug}/meetings`)}
    />
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @uniwork/web build`
Smoke thủ công: tạo cuộc họp, thấy trong "Sắp diễn ra", mở detail, thêm note, xóa.

```bash
git add -A
git commit -m "feat: meetings list, detail and notes"
```

### Task 16: Phòng họp LiveKit

**Files:**
- Create: `packages/views/meetings/room-view.tsx`
- Create: `apps/web/app/[workspaceSlug]/meetings/[meetingId]/room/page.tsx`
- Modify: `packages/views/package.json` (dep `@livekit/components-react@^2.9.23`, `@livekit/components-styles@^1.2.0`, `livekit-client@^2.21.0`)

**Interfaces:**
- Consumes: `useMeetingToken` (Task 15), route `POST /meetings/{id}/token` (Task 7), i18n key `meetings.notConfigured`.
- Produces: `MeetingRoomView({ meetingId, onLeave })` — fetch token khi mount; đang lấy → loading; lỗi `livekit_not_configured` → thông báo cấu hình; có token → `<LiveKitRoom>` với `<VideoConference/>` (mic/cam/screen-share/chat có sẵn từ components-react), `onDisconnected={onLeave}`.

- [ ] **Step 1: Implement room view**

Thêm dependencies vào `packages/views/package.json` rồi `pnpm install`:

```json
    "@livekit/components-react": "^2.9.23",
    "@livekit/components-styles": "^1.2.0",
    "livekit-client": "^2.21.0",
```

`packages/views/meetings/room-view.tsx`:

```tsx
"use client";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useMeetingToken } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";

export function MeetingRoomView({
  meetingId,
  onLeave,
}: {
  meetingId: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const tokenReq = useMeetingToken();

  useEffect(() => {
    tokenReq.mutate(meetingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi đổi meeting
  }, [meetingId]);

  if (tokenReq.error) {
    const msg =
      tokenReq.error instanceof ApiError && tokenReq.error.code === "livekit_not_configured"
        ? t("meetings.notConfigured")
        : t("common.error");
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-secondary">{msg}</p>
        <Button variant="secondary" onClick={onLeave}>
          {t("meetings.leave")}
        </Button>
      </div>
    );
  }

  if (!tokenReq.data) {
    return <p className="p-6 text-secondary">{t("common.loading")}</p>;
  }

  return (
    <div className="h-full" data-lk-theme="default">
      <LiveKitRoom
        serverUrl={tokenReq.data.url}
        token={tokenReq.data.token}
        connect
        video
        audio
        onDisconnected={onLeave}
        style={{ height: "100%" }}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
```

- [ ] **Step 2: Route (full-screen, ngoài AppShell sidebar vẫn OK — giữ trong layout)**

`apps/web/app/[workspaceSlug]/meetings/[meetingId]/room/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { MeetingRoomView } from "@uniwork/views/meetings/room-view";

export default function MeetingRoomPage() {
  const router = useRouter();
  const { workspaceSlug, meetingId } = useParams<{ workspaceSlug: string; meetingId: string }>();
  return (
    <MeetingRoomView
      meetingId={meetingId}
      onLeave={() => router.replace(`/${workspaceSlug}/meetings/${meetingId}`)}
    />
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm --filter @uniwork/web build`
Smoke thủ công (cần LiveKit Cloud: tạo project free tại cloud.livekit.io, điền `LIVEKIT_URL` (wss://…), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` vào `.env`, restart server):
1. Chưa cấu hình → vào phòng thấy thông báo "LiveKit chưa được cấu hình trên server".
2. Đã cấu hình → 2 browser (2 tài khoản cùng workspace) join cùng meeting → thấy/nghe nhau, screen share hoạt động.

```bash
git add -A
git commit -m "feat: LiveKit meeting room with video conference UI"
```

### Task 17: E2E smoke, Docker images, README

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/smoke.spec.ts`
- Create: `server/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.prod.yml`
- Create: `README.md`
- Modify: `Makefile` (target `e2e`), `.gitignore` (nếu thiếu)

**Interfaces:**
- Consumes: toàn bộ app chạy qua `make dev` (backend :8080, web :3000).
- Produces: `make e2e` chạy Playwright smoke; `docker compose -f docker-compose.yml -f docker-compose.prod.yml up` chạy full stack; README hướng dẫn từ zero → demo.

- [ ] **Step 1: Playwright setup + spec**

`e2e/package.json`:

```json
{
  "name": "@uniwork/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "playwright test" },
  "devDependencies": {
    "@playwright/test": "^1.56.0",
    "@types/node": "catalog:"
  }
}
```

`e2e/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
```

`e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Smoke: đăng ký → tạo workspace → tạo task → đổi status → tạo meeting → mở phòng.
// Yêu cầu `make dev` đang chạy. Mỗi lần chạy dùng email mới để không đụng dữ liệu cũ.
const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;

test("register → workspace → task → meeting", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("E2E Bot");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();

  // tạo workspace
  await page.getByLabel("Tên workspace").fill(`Đội E2E ${stamp}`);
  await expect(page.getByLabel("Định danh (slug)")).toHaveValue(new RegExp(`doi-e2e-${stamp}`));
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/doi-e2e-${stamp}/tasks`));

  // tạo task
  await page.getByRole("button", { name: "Việc mới" }).click();
  await page.getByLabel("Tiêu đề").fill("Task từ e2e");
  await page.getByRole("button", { name: "Tạo" }).click();
  await expect(page.getByText("Task từ e2e")).toBeVisible();

  // mở detail, đổi status qua panel
  await page.getByText("Task từ e2e").click();
  await expect(page).toHaveURL(/\/tasks\/[0-9A-Z]+/);

  // tạo meeting
  await page.goto(`/doi-e2e-${stamp}/meetings`);
  await page.getByRole("button", { name: "Tạo cuộc họp" }).click();
  await page.getByLabel("Tiêu đề").fill("Họp e2e");
  await page.getByLabel("Bắt đầu").fill("2030-01-01T10:00");
  await page.getByLabel("Kết thúc").fill("2030-01-01T11:00");
  await page.getByRole("button", { name: "Tạo" }).click();
  await expect(page.getByText("Họp e2e")).toBeVisible();

  // mở phòng: chấp nhận 1 trong 2 trạng thái (LiveKit cấu hình hoặc chưa)
  await page.getByText("Họp e2e").click();
  await page.getByRole("button", { name: "Vào phòng họp" }).click();
  await expect(
    page
      .getByText("LiveKit chưa được cấu hình trên server")
      .or(page.locator("[data-lk-theme]")),
  ).toBeVisible({ timeout: 15_000 });
});
```

Makefile thêm:

```makefile
e2e:
	pnpm --filter @uniwork/e2e exec playwright install chromium
	pnpm --filter @uniwork/e2e test
```

Run: `make dev` (terminal khác) rồi `pnpm install && make e2e`
Expected: PASS.

- [ ] **Step 2: Dockerfiles + compose prod**

`server/Dockerfile`:

```dockerfile
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -o /out/migrate ./cmd/migrate

FROM alpine:3.20
RUN adduser -D app
USER app
COPY --from=build /out/server /out/migrate /usr/local/bin/
EXPOSE 8080
CMD ["sh", "-c", "migrate up && server"]
```

`apps/web/Dockerfile` (build từ root monorepo):

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @uniwork/web build

FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo .
EXPOSE 3000
CMD ["pnpm", "--filter", "@uniwork/web", "start"]
```

`docker-compose.prod.yml`:

```yaml
services:
  server:
    build: ./server
    environment:
      DATABASE_URL: postgres://uniwork:uniwork@postgres:5432/uniwork?sslmode=disable
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      FRONTEND_ORIGIN: ${FRONTEND_ORIGIN:-http://localhost:3000}
      LIVEKIT_URL: ${LIVEKIT_URL:-}
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY:-}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET:-}
    ports: ["8080:8080"]
    depends_on: [postgres, redis]
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:8080}
      NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:-ws://localhost:8080}
    ports: ["3000:3000"]
    depends_on: [server]
```

Run: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d` → mở `http://localhost:3000` đăng ký/đăng nhập được.

Lưu ý: `NEXT_PUBLIC_*` bake vào lúc build Next — đổi API URL production thì build lại image web với build args tương ứng (chấp nhận cho đợt 1).

- [ ] **Step 3: README**

`README.md`:

````markdown
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

## Video call (LiveKit)

Tạo project free ở https://cloud.livekit.io, điền vào `.env`:
`LIVEKIT_URL` (wss://…livekit.cloud), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, restart server.

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
````

- [ ] **Step 4: Verify toàn bộ + commit**

Run: `make test && pnpm --filter @uniwork/web build && cd server && go vet ./...`
Expected: PASS toàn bộ.

```bash
git add -A
git commit -m "feat: e2e smoke, docker images, README"
```

---

## Định nghĩa Hoàn Thành (đợt 1)

1. `make dev` từ máy sạch (sau `cp .env.example .env` + `pnpm install`) chạy được cả stack.
2. Flow demo end-to-end bằng tay: đăng ký → tạo workspace → mời user 2 qua link → cả hai thấy board tasks realtime → tạo/kéo task, sửa detail, comment → tạo meeting → 2 người join phòng LiveKit thấy/nghe nhau.
3. `make test` xanh (Go + FE), `make e2e` xanh.
4. Không có màu hardcode trong `packages/views` (kiểm bằng `grep -rn "bg-gray-\|text-red-\|bg-blue-" packages/views` → rỗng).
