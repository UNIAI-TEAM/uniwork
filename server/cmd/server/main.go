package main

import (
	"context"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/handler"
	"github.com/unicomhub/uniwork/server/internal/logger"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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
	log.Info("listening", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, h); err != nil {
		log.Error("server", "err", err)
		os.Exit(1)
	}
}
