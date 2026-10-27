package router

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// UNI-2181 (spec §8.2, §10): POST /workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals
// has its own 10 per 10-minute signed-in-user bucket ("drive-proposals") across
// all workspaces and files, without draining the 300/min global budget or
// blocking a colleague behind the same office NAT.
func TestDriveProposalsRateLimit10Per10MinPerUser(t *testing.T) {
	t.Setenv("FF_DRIVE_CONNECTOR", "true")
	minter := auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour}
	h := New(Deps{
		Cfg:          config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter:       minter,
		Redis:        newRedisTestClient(t),
		FeatureFlags: featureflag.NewService(featureflag.NewEnvProvider("FF_")),
	}, stubRoutes())

	const office = "10.20.0.42"
	const budget = 10

	alice := caller{ip: office, bearer: mustMint(t, minter, "alice")}
	for i := range budget {
		path := fmt.Sprintf("/api/v1/workspaces/ws-%d/drive-files/file-%d/task-proposals", i%2+1, i+1)
		if code := alice.send(h, http.MethodPost, path); code != http.StatusOK {
			t.Fatalf("proposal %d = %d, want 200", i+1, code)
		}
	}

	refused := alice.sendRec(h, http.MethodPost, "/api/v1/workspaces/ws-other/drive-files/file-other/task-proposals")
	if refused.Code != http.StatusTooManyRequests {
		t.Fatalf("11th proposal in 10 minutes = %d, want 429 (drive-proposals bucket across workspaces/files)", refused.Code)
	}
	if code := refusalCode(t, refused); code != "rate_limited" {
		t.Fatalf("refusal code = %q, want rate_limited", code)
	}
	if retry := refused.Header().Get("Retry-After"); retry != "600" {
		t.Fatalf("Retry-After = %q, want 600", retry)
	}

	// Reading or checking duplicates on an existing proposal does not draw on the propose bucket.
	if code := alice.send(h, http.MethodGet, "/api/v1/workspaces/ws-1/drive-task-proposals/prop-1"); code != http.StatusOK {
		t.Fatalf("GET proposal after propose budget spent = %d, want 200", code)
	}
	if code := alice.send(h, http.MethodPost, "/api/v1/workspaces/ws-1/drive-task-proposals/prop-1/duplicates"); code != http.StatusOK {
		t.Fatalf("POST duplicates after propose budget spent = %d, want 200", code)
	}

	// Another user behind the same office NAT keeps their own 10/10min budget.
	bob := caller{ip: office, bearer: mustMint(t, minter, "bob")}
	bob.spend(t, h, http.MethodPost, "/api/v1/workspaces/ws-1/drive-files/file-1/task-proposals", budget)
	bob.wantRefused(t, h, http.MethodPost, "/api/v1/workspaces/ws-1/drive-files/file-1/task-proposals", "second person's own 10/10min budget")
}
