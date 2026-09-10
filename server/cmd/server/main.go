package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/extra/redisotel/v9"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/events"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler"
	"github.com/unicomhub/uniwork/server/internal/logger"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/metrics"
	"github.com/unicomhub/uniwork/server/internal/notification"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// version is set at build time: -ldflags "-X main.version=<git sha>". It
// reaches the OTel resource and the build_info metric.
var (
	version = "dev"
	commit  = ""
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
	// Tracing first so the pool and the Redis client below are instrumented.
	// No OTEL_EXPORTER_OTLP_ENDPOINT means spans are created (every request
	// still gets an X-Trace-Id) but never exported.
	stopTracing, err := telemetry.Init(ctx, telemetry.ConfigFromEnv(version), log)
	if err != nil {
		log.Error("otel", "err", err)
		os.Exit(1)
	}
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Error("db url", "err", err)
		os.Exit(1)
	}
	// One tracer yields both the otelpgx spans and the per-query histogram
	// (registered below once the metrics registry exists).
	dbTracer := metrics.NewDBQueryTracer(otelpgx.NewTracer(otelpgx.WithTrimSQLInSpanName()))
	poolCfg.ConnConfig.Tracer = dbTracer
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		log.Error("db connect", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte(cfg.JWTSecret), TTL: cfg.AccessTokenTTL}
	orgSvc := service.NewOrganizationService(pool, q)
	orgMemberSvc := service.NewOrganizationMemberService(pool, q, orgSvc)
	var rdb *redis.Client
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			log.Error("redis url", "err", err)
			os.Exit(1)
		}
		rdb = redis.NewClient(opt)
		if err := redisotel.InstrumentTracing(rdb); err != nil {
			log.Warn("redis tracing", "err", err)
		}
	}
	var membershipCache *auth.MembershipCache
	if rdb != nil {
		membershipCache = auth.NewMembershipCache(rdb)
	}
	// Flags come from FEATURE_FLAGS_FILE when set; absent, every lookup returns
	// its default and the service is nil.
	// Flags: organization/user overrides from the database first, then the
	// FEATURE_FLAGS_FILE rules and FF_* env kill switches (F-11 §7).
	flags, flagOverrides, err := featureflags.NewService(q, log)
	if err != nil {
		log.Error("feature flags", "err", err)
		os.Exit(1)
	}
	bus := events.New()
	// METRICS_ADDR (e.g. 127.0.0.1:9090) exposes Prometheus metrics on a
	// separate listener so the scrape endpoint never shares the public port.
	var httpMetrics *metrics.HTTPMetrics
	var metricsSrv *http.Server
	var reg *metrics.Registry
	if mcfg := metrics.ConfigFromEnv(); mcfg.Enabled() {
		reg = metrics.NewRegistry(metrics.RegistryOptions{Pool: pool, Realtime: realtime.M, Version: version, Commit: commit, DBQueries: dbTracer})
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
	if cfg.SMTPHost == "" && strings.EqualFold(cfg.AppEnv, "production") {
		log.Warn("SMTP_HOST is empty in production: mail (including password reset links) is only written to the log")
	}
	if code := cfg.DevVerificationCode(); code != "" {
		log.Warn("DEV_VERIFICATION_CODE is set: any user can verify with it", "app_env", cfg.AppEnv)
	}
	mailOutbox := mail.NewOutbox(pool, sender, log)
	if reg != nil {
		mailOutbox.Counter = reg.Emails
	}
	renderer := mail.Renderer{AppURL: cfg.FrontendOrigin}
	wsSvc := service.NewWorkspaceService(pool, q, orgSvc, renderer, mailOutbox)
	orgMemberSvc.SetMail(renderer, mailOutbox)
	verification := service.NewVerificationService(q, renderer, mailOutbox, cfg.DevVerificationCode())
	authSvc := service.NewAuthService(pool, q, minter, cfg.RefreshTokenTTL, verification)
	authSvc.SetMail(renderer, mailOutbox)
	passwordReset := service.NewPasswordResetService(pool, q, authSvc, renderer, mailOutbox)
	var conference meetings.ConferenceProvider
	if cfg.LiveKitURL != "" && cfg.LiveKitAPIKey != "" && cfg.LiveKitAPISecret != "" {
		lk := &meetings.LiveKitAdapter{
			URL: cfg.LiveKitURL, APIKey: cfg.LiveKitAPIKey, APISecret: cfg.LiveKitAPISecret,
			TokenTTL: cfg.LiveKitTokenTTL, EmptyTimeout: cfg.LiveKitEmptyTimeout,
		}
		if cfg.LiveKitRecordingBucket != "" {
			lk.Recording = &meetings.RecordingS3{
				AccessKey: os.Getenv("AWS_ACCESS_KEY_ID"), Secret: os.Getenv("AWS_SECRET_ACCESS_KEY"),
				Region: os.Getenv("AWS_REGION"), Endpoint: os.Getenv("AWS_ENDPOINT_URL"),
				Bucket: cfg.LiveKitRecordingBucket,
			}
			log.Info("meeting recording enabled", "bucket", cfg.LiveKitRecordingBucket)
		}
		conference = lk
	}
	meetingSvc := service.NewMeetingService(pool, q, wsSvc, pub, conference, service.MeetingRuntime{
		TokenTTL: cfg.LiveKitTokenTTL, HMACKey: []byte(cfg.JWTSecret), LiveKitURL: cfg.LiveKitURL,
		ProviderKey: cfg.MeetingProvider, EmptyTimeout: cfg.LiveKitEmptyTimeout,
		WorkerTick: cfg.MeetingWorkerTick, OutboxBatch: cfg.MeetingOutboxBatch,
		WebhookBatch: cfg.MeetingWebhookBatch, WebhookConcurrency: int(cfg.MeetingWebhookConcurrency),
		STTAgentSecret: cfg.MeetingSTTAgentSecret,
	})
	taskSvc := service.NewTaskService(pool, q, wsSvc, store)
	meetingSvc.Tasks = taskSvc
	agentSvc := service.NewAgentService(pool, q, orgSvc, wsSvc)
	readiness := service.NewReadiness(pool, rdb)
	billingSvc := service.NewBillingService(pool, q, orgSvc, billing.FromConfig(cfg.BillingProvider))
	actorSvc := service.NewActorService(q)
	// One AI gateway for the process (F-09): meeting summaries and Ask UNI
	// share the provider, the policy, the meter and the audit trail. No
	// credential in the environment means a disabled gateway, not an error.
	aiProvider, aiOpts := ai.FromEnv(os.Getenv)
	gateway := service.NewAIGateway(pool, q, aiProvider, aiOpts)
	meetingSvc.AI = gateway
	if gateway.Enabled() {
		log.Info("ai gateway enabled", "provider", gateway.Provider())
	}
	if reg != nil {
		gateway.SetMetrics(reg.AI)
	}
	if reg != nil && reg.Meetings != nil {
		meetingSvc.SetMeetingMetrics(reg.Meetings)
	}
	chatSvc := service.NewChatService(pool, q, wsSvc, pub)
	chatSvc.TenorAPIKey = cfg.TenorAPIKey
	taskSvc.Chat = chatSvc
	askUNI := service.NewAskUNIService(pool, q, wsSvc, orgSvc, taskSvc, meetingSvc, chatSvc, gateway, rdb)
	hub.SetAuthorizer(realtime.ChatScopeAuthorizer{Gate: chatSvc})
	// Directory and department events belong to the organization, so every
	// connection joins its organization scope at connect time (F-03 §6.4).
	hub.SetOrganizationResolver(wsSvc.OrganizationOf)
	auditSvc := service.NewAuditService(pool, q, orgSvc, wsSvc)
	// One dispatcher drains outbox_events for the whole process. Registering a
	// consumer is the only thing a new bounded context has to do to receive
	// domain events; nothing here knows what produced them.
	dispatcher := outbox.New(pool, q, outbox.Options{
		Batch: cfg.MeetingOutboxBatch, Tick: cfg.MeetingWorkerTick, Log: log,
	})
	dispatcher.Register(meetingSvc.ProviderConsumer())
	realtimeConsumer := outbox.NewRealtimeConsumer(service.RealtimePublisher{Pub: pub}).WithMembers(chatSvc)
	dispatcher.Register(realtimeConsumer)
	dispatcher.Register(service.NewAuditExportConsumer(q, store))
	dispatcher.Register(outbox.WebhookConsumer{})
	// Notifications are the first bounded context fed purely by the outbox:
	// the consumer turns committed events into inbox rows, the push consumer
	// delivers notification.push, and two jobs (digest, reminder) run beside
	// them. VAPID keys missing means push is off, not broken.
	notifConsumer := notification.NewConsumer(pool, q, wsSvc)
	var pushSender notification.PushSender
	if cfg.PushEnabled() {
		pushSender = notification.WebPushSender{PublicKey: cfg.VAPIDPublicKey, PrivateKey: cfg.VAPIDPrivateKey, Subject: cfg.VAPIDSubject}
		log.Info("web push enabled", "subject", cfg.VAPIDSubject)
	}
	pushConsumer := notification.NewPushConsumer(q, pushSender, cfg.FrontendOrigin)
	digest := notification.NewDigestScheduler(q, renderer, mailOutbox)
	notifSvc := notification.NewService(q, notification.PushConfig{Enabled: cfg.PushEnabled(), PublicKey: cfg.VAPIDPublicKey})
	dispatcher.Register(notifConsumer)
	dispatcher.Register(featureflags.NewInvalidator(flagOverrides))
	dispatcher.Register(pushConsumer)
	if reg != nil {
		dispatcher.SetMetrics(reg.Outbox)
		realtimeConsumer.SetMetrics(reg.Outbox)
		service.SetAuditCounter(reg.Outbox)
		notifConsumer.SetMetrics(reg.Notifications)
		pushConsumer.SetMetrics(reg.Notifications)
		digest.SetMetrics(reg.Notifications)
	}
	runCtx, runCancel := context.WithCancel(context.Background())
	defer runCancel()
	go meetingSvc.RunWorkers(runCtx)
	go meetingSvc.RunAutoEnd(runCtx)
	go digest.Run(runCtx)
	go notification.NewMeetingReminder(notifConsumer).Run(runCtx)
	dispatcherDone := make(chan struct{})
	go func() { dispatcher.Run(runCtx); close(dispatcherDone) }()
	if reg != nil {
		go auditSvc.RunRetentionMarker(runCtx, reg.Outbox)
	}
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
	// Platform console (F-11): reads metadata across tenants, guarded by
	// users.platform_role rather than membership.
	adminSvc := service.NewAdminService(pool, q, billingSvc, service.NewEntitlementService(pool, q))
	adminSvc.SetSystemSources(readiness, realtime.M.ActiveConnections.Load, featureflag.ProviderNames(flags))
	h := handler.New(handler.Deps{
		Cfg: cfg, Log: log, Minter: minter,
		Auth:            authSvc,
		Verification:    verification,
		PasswordReset:   passwordReset,
		GoogleAuth:      service.NewGoogleAuthService(q, authSvc),
		Google:          google,
		Organizations:   orgSvc,
		OrgMembers:      orgMemberSvc,
		People:          service.NewPeopleService(pool, q, orgSvc),
		Departments:     service.NewDepartmentService(pool, q, orgSvc),
		Workspaces:      wsSvc,
		Onboarding:      service.NewOnboardingService(q, wsSvc, renderer, mailOutbox),
		Tasks:           taskSvc,
		Agents:          agentSvc,
		Actors:          actorSvc,
		Audit:           auditSvc,
		Billing:         billingSvc,
		Notifications:   notifSvc,
		AskUNI:          askUNI,
		Meetings:        meetingSvc,
		Chat:            chatSvc,
		Hub:             hub,
		Redis:           rdb,
		FeatureFlags:    flags,
		Bus:             bus,
		Storage:         store,
		MembershipCache: membershipCache,
		HTTPMetrics:     httpMetrics,
		WebVitals:       webVitals(reg),
		Readiness:       readiness,
		Admin:           adminSvc,
		Version:         version,
		Commit:          commit,
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
	workerCtx, stopWorker := context.WithCancel(ctx)
	outboxDone := make(chan struct{})
	go func() { mailOutbox.Run(workerCtx); close(outboxDone) }()

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
	stopWorker()
	select {
	case <-outboxDone:
	case <-time.After(30 * time.Second):
		log.Warn("mail: outbox worker did not stop in time")
	}
	// The event dispatcher stops before the relay it publishes through, so a
	// consumer is never handed a broadcaster that is already shutting down.
	runCancel()
	select {
	case <-dispatcherDone:
	case <-time.After(30 * time.Second):
		log.Warn("outbox: dispatcher did not stop in time")
	}
	if relay != nil {
		relay.Stop()
	}
	if metricsSrv != nil {
		metricsCtx, metricsCancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = metricsSrv.Shutdown(metricsCtx)
		metricsCancel()
	}
	// Last: flush whatever the batcher still holds for the spans above.
	traceCtx, traceCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := stopTracing(traceCtx); err != nil {
		log.Warn("otel shutdown", "err", err)
	}
	traceCancel()
	log.Info("stopped")
}

// webVitals keeps a nil registry from becoming a non-nil metric.
func webVitals(reg *metrics.Registry) *metrics.WebVitals {
	if reg == nil {
		return nil
	}
	return reg.WebVitals
}
