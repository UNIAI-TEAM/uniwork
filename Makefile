.PHONY: dev server web db-up db-down migrate-up migrate-down sqlc test test-go test-fe e2e

ENV_FILE ?= .env
ifneq ($(wildcard $(ENV_FILE)),)
include $(ENV_FILE)
export
endif

DATABASE_URL ?= postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable
TEST_DATABASE_URL ?= postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable
REDIS_TEST_URL ?= redis://localhost:6379

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

e2e:
	pnpm --filter @uniwork/e2e exec playwright install chromium
	pnpm --filter @uniwork/e2e test
