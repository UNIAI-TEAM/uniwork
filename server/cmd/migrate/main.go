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
