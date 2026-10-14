package handler

// Handler-level tests for the G6-05k (UNI-1637, ADR 0034) BYOK proxy on a
// native desktop device session over the real router: a device-session bearer
// reaches R2 with a fake TLS vendor and gets the SSE bytes unchanged, its
// usage row settles with capability office.byok_desktop while a web session
// settles office.byok, and a web bearer and a device bearer of the same user
// share one 60/min ai-byok rate-limit budget (the 61st call answers 429).

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// byokHandlerRedisTestDB keeps this package's rate-limit keys apart from
// router (12), service (10, 11), realtime (13), middleware (14) and auth (15).
const byokHandlerRedisTestDB = 9

func byokHandlerRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_TEST_URL: %v", err)
	}
	opts.DB = byokHandlerRedisTestDB
	rdb := redis.NewClient(opts)
	ctx := context.Background()
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flush redis test db: %v", err)
	}
	t.Cleanup(func() {
		_ = rdb.FlushDB(ctx).Err()
		_ = rdb.Close()
	})
	return rdb
}

func TestAIBYOKDeviceSessionStreamsAndMetersDesktopCapability(t *testing.T) {
	var vendorAuth string
	vendor := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vendorAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, frameAISSE)
	}))
	t.Cleanup(vendor.Close)
	target := vendor.Listener.Addr().String()

	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	d.Cfg.DesktopAuthClientID = "uniwork-office"
	d.Cfg.DesktopAuthDeploymentIDs = []string{"default"}
	d.DesktopAuth = service.NewDesktopAuthService(pool, q, d.Minter, d.Cfg)
	gw := ai.NewGateway(q, nil, nil, nil, ai.Options{})
	gw.SetBYOKClient(provider.NewBYOKClient(provider.BYOKClientOptions{
		Resolver:  frameAIPublicResolver{},
		TLSConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // test vendor
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var dl net.Dialer
			return dl.DialContext(ctx, network, target)
		},
	}))
	d.AIBYOK = service.NewAIBYOKService(d.Organizations, service.NewEntitlementService(pool, q), d.AICredentials, gw)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	webToken, userID := filesRegister(t, srv, "byok-desktop-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", webToken, map[string]string{"name": "BYOK Desktop Org", "slug": "byok-desktop-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	credPath := "/api/v1/orgs/" + orgID + "/ai/credentials/openai"
	if code, body := rawCall(t, srv, "PUT", credPath, webToken, `{"api_key":"`+testHandlerAIKey+`"}`); code != http.StatusCreated {
		t.Fatalf("save key = %d %s", code, body)
	}

	const deviceSessionID = "byok-device-session"
	if _, err := q.CreateDeviceSession(context.Background(), db.CreateDeviceSessionParams{
		ID: deviceSessionID, UserID: userID, SessionFamilyID: "byok-family-1",
		ClientID: "uniwork-office", DeploymentID: "default", DeviceLabel: "MacBook",
		Platform: "darwin", Build: "1.0.0", RefreshTokenDigest: "byok-refresh-digest-1",
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	deviceToken, err := minter.MintSession(userID, deviceSessionID)
	if err != nil {
		t.Fatal(err)
	}

	chatPath := "/api/v1/orgs/" + orgID + "/ai/byok/openai/chat/completions"
	for _, tc := range []struct {
		name, token string
	}{
		{"device session", deviceToken},
		{"web session", webToken},
	} {
		vendorAuth = ""
		req, err := http.NewRequest(http.MethodPost, srv.URL+chatPath, strings.NewReader(`{"model":"gpt-4.1-mini","stream":true,"messages":[]}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+tc.token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || string(raw) != frameAISSE || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
			t.Fatalf("%s stream = %d %q %q", tc.name, resp.StatusCode, resp.Header.Get("Content-Type"), raw)
		}
		if vendorAuth != "Bearer "+testHandlerAIKey {
			t.Fatalf("%s vendor saw Authorization %q, want stored key", tc.name, vendorAuth)
		}
	}

	rows, err := q.AiUsageByDay(context.Background(), db.AiUsageByDayParams{
		OrganizationID: orgID, FromAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
	})
	if err != nil || len(rows) != 2 {
		t.Fatalf("usage rows = %v (%v), want 2", rows, err)
	}
	if rows[0].Capability != string(ai.CapOfficeBYOK) || rows[0].Calls != 1 {
		t.Fatalf("web usage row = %+v, want capability %q calls=1", rows[0], ai.CapOfficeBYOK)
	}
	if rows[1].Capability != string(ai.CapOfficeBYOKDesktop) || rows[1].Calls != 1 {
		t.Fatalf("desktop usage row = %+v, want capability %q calls=1", rows[1], ai.CapOfficeBYOKDesktop)
	}

	if _, err := q.RevokeDeviceSession(context.Background(), db.RevokeDeviceSessionParams{ID: deviceSessionID, UserID: userID}); err != nil {
		t.Fatal(err)
	}
	if code, body := rawCall(t, srv, "POST", chatPath, deviceToken, `{"model":"gpt-4.1-mini","stream":true,"messages":[]}`); code != http.StatusUnauthorized || !strings.Contains(body, "device_revoked") {
		t.Fatalf("revoked device session = %d %s, want 401 device_revoked", code, body)
	}
}

func TestAIBYOKWebAndDeviceSessionsShareRateLimitBudget(t *testing.T) {
	vendor := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, frameAISSE)
	}))
	t.Cleanup(vendor.Close)
	target := vendor.Listener.Addr().String()

	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Redis = byokHandlerRedis(t)
	q := db.New(pool)
	gw := ai.NewGateway(q, nil, nil, nil, ai.Options{})
	gw.SetBYOKClient(provider.NewBYOKClient(provider.BYOKClientOptions{
		Resolver:  frameAIPublicResolver{},
		TLSConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // test vendor
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var dl net.Dialer
			return dl.DialContext(ctx, network, target)
		},
	}))
	d.AIBYOK = service.NewAIBYOKService(d.Organizations, service.NewEntitlementService(pool, q), d.AICredentials, gw)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	webToken, userID := filesRegister(t, srv, "byok-budget-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", webToken, map[string]string{"name": "BYOK Budget Org", "slug": "byok-budget-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	if code, body := rawCall(t, srv, "PUT", "/api/v1/orgs/"+orgID+"/ai/credentials/openai", webToken, `{"api_key":"`+testHandlerAIKey+`"}`); code != http.StatusCreated {
		t.Fatalf("save key = %d %s", code, body)
	}

	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	deviceToken, err := minter.MintSession(userID, "byok-budget-device")
	if err != nil {
		t.Fatal(err)
	}

	chatPath := "/api/v1/orgs/" + orgID + "/ai/byok/openai/chat/completions"
	reqBody := `{"model":"gpt-4.1-mini","stream":true,"messages":[]}`
	for i := 0; i < 30; i++ {
		if code, body := rawCall(t, srv, "POST", chatPath, webToken, reqBody); code != http.StatusOK {
			t.Fatalf("web call %d = %d %s, want 200", i+1, code, body)
		}
	}
	for i := 0; i < 30; i++ {
		if code, body := rawCall(t, srv, "POST", chatPath, deviceToken, reqBody); code != http.StatusOK {
			t.Fatalf("device call %d = %d %s, want 200", i+1, code, body)
		}
	}
	if code, body := rawCall(t, srv, "POST", chatPath, deviceToken, reqBody); code != http.StatusTooManyRequests {
		t.Fatalf("61st call (device) = %d %s, want 429", code, body)
	}
	if code, body := rawCall(t, srv, "POST", chatPath, webToken, reqBody); code != http.StatusTooManyRequests {
		t.Fatalf("62nd call (web) = %d %s, want 429", code, body)
	}
}
