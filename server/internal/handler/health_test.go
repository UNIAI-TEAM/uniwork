package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// /api/v1/healthz is the same liveness answer under /api: the production edge
// sends only /api (and the MCP paths) to the server, so the phone's
// reachability probe (apps/chat-mobile lib/reachability.ts) asks there and
// accepts exactly 200 {"status":"ok"}.
func TestHealth(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default()})
	srv := httptest.NewServer(h)
	defer srv.Close()

	for _, path := range []string{"/healthz", "/api/v1/healthz"} {
		res, err := srv.Client().Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		err = json.NewDecoder(res.Body).Decode(&body)
		_ = res.Body.Close()
		if err != nil {
			t.Fatalf("%s body: %v", path, err)
		}
		if res.StatusCode != 200 || body["status"] != "ok" {
			t.Fatalf("%s = %d %v, want 200 {status: ok}", path, res.StatusCode, body)
		}
	}
}

// /readyz must say no when the database is gone: a 200 from a node that
// cannot reach Postgres keeps it in the load balancer during an outage.
func TestReadyFailsWithoutDatabase(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://nobody:nobody@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default(), Readiness: service.NewReadiness(pool, nil)})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: %s", rec.Code, rec.Body)
	}
	var rep service.ReadinessReport
	if err := json.Unmarshal(rec.Body.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Ready || len(rep.Checks) == 0 || rep.Checks[0].Name != "db" || rep.Checks[0].OK {
		t.Fatalf("report = %+v", rep)
	}
}

func TestReadyPassesOnMigratedDatabase(t *testing.T) {
	pool := testutil.DB(t)
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default(), Readiness: service.NewReadiness(pool, nil)})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}
