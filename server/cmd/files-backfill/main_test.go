package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service/backfill"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

func TestRunUsageAndSubcommandErrors(t *testing.T) {
	if err := run(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("no-args err = %v", err)
	}
	if err := run(context.Background(), []string{"bogus"}); err == nil || !strings.Contains(err.Error(), "unknown subcommand") {
		t.Fatalf("bogus err = %v", err)
	}
	if err := run(context.Background(), []string{"rollback"}); err == nil || !strings.Contains(err.Error(), "--run") {
		t.Fatalf("rollback w/o --run err = %v", err)
	}
}

// plan against the test database through the real command path: connects via
// DATABASE_URL, resolves cohorts, writes a JSON report, and — being read-only
// — leaves no run row behind.
func TestPlanSubcommandWritesJSON(t *testing.T) {
	testutil.DB(t) // migrates + holds the shared test DB lock for this test
	t.Setenv("DATABASE_URL", os.Getenv("TEST_DATABASE_URL"))
	if os.Getenv("DATABASE_URL") == "" {
		t.Setenv("DATABASE_URL", "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable")
	}
	// config.Load validates these on every subcommand — the gate must pass on
	// a clean machine with only TEST_DATABASE_URL exported.
	t.Setenv("JWT_SECRET", "files-backfill-test-secret")
	t.Setenv("FRONTEND_ORIGIN", "http://localhost:3000")
	t.Setenv("API_PUBLIC_URL", "http://localhost:8080")

	out := filepath.Join(t.TempDir(), "plan.json")
	if err := run(context.Background(), []string{
		"plan", "--cohort", "task-attachments", "--format", "json", "--items", "--out", out,
	}); err != nil {
		t.Fatalf("plan: %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	var rep backfill.Report
	if err := json.Unmarshal(data, &rep); err != nil {
		t.Fatalf("report not JSON: %v", err)
	}
	if rep.Command != "plan" || len(rep.Cohorts) != 1 || rep.Cohorts[0].Name != backfill.CohortTaskAttachments {
		t.Fatalf("unexpected report: %q %v", rep.Command, rep.Cohorts)
	}
}

func TestSplitList(t *testing.T) {
	if got := splitList(" a, b ,,c "); len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Fatalf("splitList = %v", got)
	}
	if got := splitList("  "); got != nil {
		t.Fatalf("empty splitList = %v", got)
	}
}
