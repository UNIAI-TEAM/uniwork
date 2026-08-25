package main

import (
	"context"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/events"
	"github.com/unicomhub/uniwork/server/internal/handler"
	"github.com/unicomhub/uniwork/server/internal/logger"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

func main() {
	logger.Init()
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
	orgSvc := service.NewOrganizationService(q)
	wsSvc := service.NewWorkspaceService(pool, q, orgSvc)
	var rdb *redis.Client
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			log.Error("redis url", "err", err)
			os.Exit(1)
		}
		rdb = redis.NewClient(opt)
	}
	// Flags come from FEATURE_FLAGS_FILE when set; absent, every lookup returns
	// its default and the service is nil.
	flags, err := featureflag.NewServiceFromEnv(featureflag.WithLogger(log))
	if err != nil {
		log.Error("feature flags", "err", err)
		os.Exit(1)
	}
	bus := events.New()
	hub := realtime.NewHub()
	go hub.Run()
	// Without Redis every event fans out in-process only. With it, the relay
	// writes each event to a per-scope stream and consumes the streams this
	// node has subscribers for, so several API nodes deliver each other's
	// events; DualWrite keeps local delivery immediate.
	var broadcaster realtime.Broadcaster = hub
	if rdb != nil {
		relay := realtime.NewRedisRelay(hub, rdb)
		relay.Start(ctx)
		defer relay.Stop()
		broadcaster = realtime.NewDualWriteBroadcaster(hub, relay)
	}
	pub := realtime.NewPublisher(broadcaster, log)
	h := handler.New(handler.Deps{
		Cfg: cfg, Log: log, Minter: minter,
		Auth:          service.NewAuthService(q, minter, cfg.RefreshTokenTTL),
		Organizations: orgSvc,
		Workspaces:    wsSvc,
		Onboarding:    service.NewOnboardingService(q, wsSvc, pub),
		Tasks:         service.NewTaskService(q, wsSvc, pub),
		Meetings:      service.NewMeetingService(q, wsSvc, pub),
		Hub:           hub,
		Redis:         rdb,
		FeatureFlags:  flags,
		Bus:           bus,
	})
	log.Info("listening", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, h); err != nil {
		log.Error("server", "err", err)
		os.Exit(1)
	}
}
