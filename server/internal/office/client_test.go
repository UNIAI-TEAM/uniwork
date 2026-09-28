package office

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	testToken = "service-token-0123456789abcdef-0123456"
	testKey   = "grant-key-fedcba9876543210-fedcba98765"
)

func TestNewClientRefusesUnsafeConfig(t *testing.T) {
	ok := Config{BaseURL: "http://127.0.0.1:8090", ServiceToken: testToken, GrantKey: testKey}
	if _, err := NewClient(ok, nil); err != nil {
		t.Fatal(err)
	}
	for name, cfg := range map[string]Config{
		"relative":    {BaseURL: "engine:8090", ServiceToken: testToken, GrantKey: testKey},
		"ftp":         {BaseURL: "ftp://engine", ServiceToken: testToken, GrantKey: testKey},
		"short token": {BaseURL: ok.BaseURL, ServiceToken: "short", GrantKey: testKey},
		"short key":   {BaseURL: ok.BaseURL, ServiceToken: testToken, GrantKey: "short"},
		"same secret": {BaseURL: ok.BaseURL, ServiceToken: testToken, GrantKey: testToken},
	} {
		if _, err := NewClient(cfg, nil); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := NewClient(Config{}, nil); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("unset: %v", err)
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv("OFFICE_ENGINE_URL", " http://engine:8090 ")
	t.Setenv("OFFICE_ENGINE_SERVICE_TOKEN", testToken)
	t.Setenv("OFFICE_ENGINE_GRANT_KEY", testKey)
	t.Setenv("OFFICE_ENGINE_REQUEST_TIMEOUT_MS", "1500")
	t.Setenv("OFFICE_JOB_MAX_DEADLINE_MS", "bogus")
	t.Setenv("OFFICE_JOB_RECONCILE_INTERVAL_MS", "250")
	cfg := ConfigFromEnv()
	if !cfg.Enabled() || cfg.BaseURL != "http://engine:8090" || cfg.RequestTimeout != 1500*time.Millisecond ||
		cfg.MaxJobDeadline != defaultMaxJobDeadline || cfg.ReconcileInterval != 250*time.Millisecond {
		t.Fatalf("config: %+v", cfg)
	}
	t.Setenv("OFFICE_ENGINE_URL", "")
	if ConfigFromEnv().Enabled() {
		t.Fatal("empty URL enabled the engine")
	}
}

func fakeEngine(t *testing.T, status int, body string) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testToken {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"code":"service_unauthenticated"}}`))
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(Config{BaseURL: srv.URL, ServiceToken: testToken, GrantKey: testKey, RequestTimeout: 2 * time.Second}, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestClientMapsEngineAnswersToTypedErrors(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name, body, code string
		status           int
		retryable        bool
	}{
		{"overloaded", `{"state":"failed","error":{"code":"engine_overloaded","reason":"queue_full"}}`, "engine_overloaded", 503, true},
		{"grant expired", `{"state":"failed","error":{"code":"grant_expired","reason":"expires_at"}}`, "grant_expired", 401, false},
		{"q7", `{"state":"failed","error":{"code":"unsupported_operation","reason":"q7_blocker"}}`, "unsupported_operation", 501, false},
		{"unknown code", `{"error":{"code":"made_up"}}`, "engine_result_invalid", 409, true},
		{"not json", `<html>`, "engine_result_invalid", 502, true},
	}
	for _, tc := range cases {
		c := fakeEngine(t, tc.status, tc.body)
		_, err := c.Status(ctx, "job1", "grant")
		if ErrorCode(err) != tc.code || Retryable(err) != tc.retryable {
			t.Errorf("%s: code=%q retryable=%v err=%v", tc.name, ErrorCode(err), Retryable(err), err)
		}
	}

	c := fakeEngine(t, 400, `{"error":{"code":"contract_violation","field_path":"envelope.payload.x","rule":"unknown_field"}}`)
	_, err := c.Submit(ctx, "grant", Envelope{RequestID: "r"})
	var cv *ContractViolationError
	if !errors.As(err, &cv) || cv.FieldPath != "envelope.payload.x" || Retryable(err) {
		t.Fatalf("contract violation: %v", err)
	}

	c = fakeEngine(t, 200, `{"job_id":"job1","state":"running"}`)
	c.token = "wrong-token-000000000000000000000000000"
	if _, err := c.Status(ctx, "job1", "g"); !errors.Is(err, ErrServiceAuth) {
		t.Fatalf("service auth: %v", err)
	}
}

func TestClientDecodesJobsAndRefusesMalformedOnes(t *testing.T) {
	ctx := context.Background()
	c := fakeEngine(t, 200, `{"job_id":"job1","state":"completed","output_file_id":"f1","output_checksum":"ab","output_length":3,"warnings":[]}`)
	js, err := c.Cancel(ctx, "job1", "g")
	if err != nil || js.State != JobCompleted || js.OutputLength == nil || *js.OutputLength != 3 {
		t.Fatalf("decode: %+v %v", js, err)
	}
	for _, body := range []string{`{"state":"running"}`, `{"job_id":"j","state":"exploded"}`, `[]`} {
		c := fakeEngine(t, 200, body)
		if _, err := c.Status(ctx, "j", "g"); ErrorCode(err) != "engine_result_invalid" {
			t.Errorf("%s: %v", body, err)
		}
	}
}

func TestClientReportsAnUnreachableEngineAsRetryable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c, err := NewClient(Config{BaseURL: url, ServiceToken: testToken, GrantKey: testKey, RequestTimeout: time.Second}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Ready(context.Background())
	if ErrorCode(err) != "engine_crashed" || !Retryable(err) || !strings.Contains(err.Error(), "unreachable") {
		t.Fatalf("unreachable: %v", err)
	}
}

func TestClientReadiness(t *testing.T) {
	c := fakeEngine(t, 200, `{"status":"ready","queue_depth":2,"running":1,"max_workers":2,"max_queue":16}`)
	r, err := c.Ready(context.Background())
	if err != nil || r.QueueDepth != 2 || r.MaxQueue != 16 {
		t.Fatalf("ready: %+v %v", r, err)
	}
	c = fakeEngine(t, 503, `{"status":"draining"}`)
	if _, err := c.Ready(context.Background()); ErrorCode(err) != "engine_crashed" {
		t.Fatalf("draining: %v", err)
	}
	c = fakeEngine(t, 200, `{"engine_version":"genoffice@09485f88+uniwork-office.0","capabilities":[{"operation":"convert","supported":false,"runtime":"none","evidence_level":"pending"}]}`)
	res, err := c.Capability(context.Background(), FormatDOCX)
	if err != nil || len(res.Capabilities) != 1 || res.Capabilities[0].ProductSupported() || res.Supports(OperationConvert) {
		t.Fatalf("capability: %+v %v", res, err)
	}
	if res.EngineVersion != TrustedEngineVersion {
		t.Fatalf("engine version: %q", res.EngineVersion)
	}
	// Negotiation: a build the server was not written against is refused with
	// a typed error before any mutation; an answer carrying neither identity
	// nor rows is malformed drift, not an empty capability set.
	drift := fakeEngine(t, 200, `{"engine_version":"genoffice@deadbeef+uniwork-office.9","capabilities":[]}`)
	if _, err := Negotiate(context.Background(), drift, FormatDOCX); ErrorCode(err) != "engine_incompatible" {
		t.Fatalf("drift build: %v", err)
	}
	empty := fakeEngine(t, 200, `{}`)
	if _, err := empty.Capability(context.Background(), FormatDOCX); ErrorCode(err) != "engine_result_invalid" {
		t.Fatalf("empty capability: %v", err)
	}
}
