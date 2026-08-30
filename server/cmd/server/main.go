package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/events"
	"github.com/unicomhub/uniwork/server/internal/handler"
	"github.com/unicomhub/uniwork/server/internal/logger"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/matrix"
	"github.com/unicomhub/uniwork/server/internal/metrics"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
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
	var membershipCache *auth.MembershipCache
	if rdb != nil {
		membershipCache = auth.NewMembershipCache(rdb)
	}
	// Flags come from FEATURE_FLAGS_FILE when set; absent, every lookup returns
	// its default and the service is nil.
	flags, err := featureflag.NewServiceFromEnv(featureflag.WithLogger(log))
	if err != nil {
		log.Error("feature flags", "err", err)
		os.Exit(1)
	}
	bus := events.New()
	// METRICS_ADDR (e.g. 127.0.0.1:9090) exposes Prometheus metrics on a
	// separate listener so the scrape endpoint never shares the public port.
	var httpMetrics *metrics.HTTPMetrics
	var metricsSrv *http.Server
	if mcfg := metrics.ConfigFromEnv(); mcfg.Enabled() {
		reg := metrics.NewRegistry(metrics.RegistryOptions{Pool: pool, Realtime: realtime.M})
		httpMetrics = reg.HTTP
		metricsSrv = metrics.NewServer(mcfg.Addr, reg.Gatherer)
		go func() {
			log.Info("metrics listening", "addr", mcfg.Addr)
			if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("metrics server", "err", err)
			}
		}()
	}
	// STORAGE_BACKEND=s3 uses the S3-compatible backend (AWS_* / AWS_ENDPOINT_URL);
	// anything else is local disk under LOCAL_UPLOAD_DIR, served by the API.
	var store storage.Storage
	if os.Getenv("STORAGE_BACKEND") == "s3" {
		store = storage.NewS3StorageFromEnv()
	} else if local := storage.NewLocalStorageFromEnv(); local != nil {
		store = local
	}
	hub := realtime.NewHub()
	go hub.Run()
	// Without Redis every event fans out in-process only. With it, the relay
	// writes each event to a per-scope stream and consumes the streams this
	// node has subscribers for, so several API nodes deliver each other's
	// events; DualWrite keeps local delivery immediate.
	var broadcaster realtime.Broadcaster = hub
	var relay *realtime.RedisRelay
	if rdb != nil {
		relay = realtime.NewRedisRelay(hub, rdb)
		relay.Start(ctx)
		broadcaster = realtime.NewDualWriteBroadcaster(hub, relay)
	}
	pub := realtime.NewPublisher(broadcaster, log)
	// SMTP when SMTP_HOST is set; otherwise messages (and verification codes)
	// are printed to the log, which is what local development runs on.
	sender, err := mail.New(mail.SMTPConfig{
		Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
		From: cfg.MailFrom, TLS: cfg.SMTPTLS, TLSInsecure: cfg.SMTPTLSInsecure, EHLOName: cfg.SMTPEHLOName,
	}, log)
	if err != nil {
		log.Error("mail", "err", err)
		os.Exit(1)
	}
	if code := cfg.DevVerificationCode(); code != "" {
		log.Warn("DEV_VERIFICATION_CODE is set: any user can verify with it", "app_env", cfg.AppEnv)
	}
	verification := service.NewVerificationService(q, sender, cfg.DevVerificationCode())
	var matrixClient service.MatrixClient
	matrixURL := cfg.MatrixHomeserverURL
	if matrixURL != "" {
		matrixClient = matrix.New(matrixURL)
		log.Info("matrix registration enabled", "homeserver", matrixURL)
	} else {
		log.Info("matrix registration disabled", "hint", "set MATRIX_HOMESERVER_URL to provision Synapse users on register")
	}
	authSvc := service.NewAuthService(q, minter, cfg.RefreshTokenTTL, verification, matrixClient, matrixURL)
	chatSvc := service.NewChatService(q, matrixClient, wsSvc)
	// Google needs both credentials; discovery runs once here. A failed
	// discovery leaves Google off rather than taking the API down with it.
	var google handler.GoogleExchanger
	if cfg.GoogleEnabled() {
		g, err := auth.NewGoogleOAuth(ctx, auth.GoogleIssuer, cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL())
		if err != nil {
			log.Error("google sign-in disabled", "err", err)
		} else {
			google = g
			log.Info("google sign-in enabled", "redirect_url", cfg.GoogleRedirectURL())
		}
	}
	h := handler.New(handler.Deps{
		Cfg: cfg, Log: log, Minter: minter,
		Auth:            authSvc,
		Verification:    verification,
		GoogleAuth:      service.NewGoogleAuthService(q, authSvc),
		Google:          google,
		Organizations:   orgSvc,
		Workspaces:      wsSvc,
		Onboarding:      service.NewOnboardingService(q, wsSvc, pub),
		Tasks:           service.NewTaskService(q, wsSvc, pub),
		Meetings:        service.NewMeetingService(q, wsSvc, pub),
		Chat:            chatSvc,
		Hub:             hub,
		Redis:           rdb,
		FeatureFlags:    flags,
		Bus:             bus,
		Storage:         store,
		MembershipCache: membershipCache,
		HTTPMetrics:     httpMetrics,
	})
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: h,
		// ReadHeaderTimeout bounds how long a peer may sit on an open socket
		// without sending headers (slowloris). No ReadTimeout/WriteTimeout:
		// WebSocket connections are hijacked and live far longer than any
		// sensible request deadline; per-request bodies are capped in the
		// handlers instead.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		if cfg.EnableSwagger {
			log.Info("listening", "port", cfg.Port, "swagger", "http://localhost:"+cfg.Port+"/swagger/index.html")
		} else {
			log.Info("listening", "port", cfg.Port)
		}
		errCh <- srv.ListenAndServe()
	}()

	// SIGTERM is what a container runtime sends first; finish in-flight
	// requests before the process goes away so a rolling deploy does not
	// surface as a burst of failed requests.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server", "err", err)
			os.Exit(1)
		}
	case sig := <-quit:
		log.Info("shutting down", "signal", sig.String())
	}
	signal.Stop(quit)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown", "err", err)
	}
	if relay != nil {
		relay.Stop()
	}
	if metricsSrv != nil {
		metricsCtx, metricsCancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = metricsSrv.Shutdown(metricsCtx)
		metricsCancel()
	}
	log.Info("stopped")
}
