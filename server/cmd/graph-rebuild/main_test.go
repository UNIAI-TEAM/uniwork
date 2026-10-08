package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

func TestUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"--org", "o", "--all"}, {"--all", "--format", "xml"}} {
		err := run(context.Background(), args, &bytes.Buffer{})
		if err == nil || !strings.Contains(err.Error(), "usage") {
			t.Errorf("args %v: err = %v", args, err)
		}
		// --all ignores the per-organization flag: while graph is on for some
		// organizations only, a weekly --all --verify fails on every flag-off
		// one and an apply builds graphs the marker never refreshes.
		if err != nil && !strings.Contains(err.Error(), "--all only once graph is enabled globally") {
			t.Errorf("args %v: usage does not say when --all is safe: %v", args, err)
		}
	}
}

// testDatabase points DATABASE_URL at the test database and returns an
// organization that exists there and has nothing else: no member, no
// workspace, no graph row.
func testDatabase(t *testing.T) string {
	t.Helper()
	pool := testutil.DB(t)
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	t.Setenv("DATABASE_URL", url)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, display_name, locale) VALUES ('user-rebuild', 'rebuild@example.com', 'Rebuild', 'en')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-empty', 'org-empty', 'Empty', 'user-rebuild')`); err != nil {
		t.Fatal(err)
	}
	return "org-empty"
}

func TestVerifyAnEmptyOrganization(t *testing.T) {
	org := testDatabase(t)
	var out bytes.Buffer
	if err := run(context.Background(), []string{"--org", org, "--verify", "--format", "json"}, &out); err != nil {
		t.Fatal(err)
	}
	var reps []projector.Report
	if err := json.Unmarshal(out.Bytes(), &reps); err != nil || len(reps) != 1 ||
		reps[0].OrganizationID != org || reps[0].Nodes != 0 || reps[0].Drift.Total() != 0 {
		t.Fatalf("report = %s (%v)", out.String(), err)
	}
}

// A mistyped id must not report a clean rebuild of nothing: rollout step 3
// (enable graph, then graph-rebuild --org <id>) would read it as success.
func TestRejectsAnUnknownOrganization(t *testing.T) {
	testDatabase(t)
	var out bytes.Buffer
	for _, args := range [][]string{{"--org", "org-typo"}, {"--org", "org-typo", "--verify"}} {
		err := run(context.Background(), args, &out)
		if err == nil || !strings.Contains(err.Error(), `organization "org-typo" does not exist`) {
			t.Errorf("args %v: err = %v", args, err)
		}
	}
	if out.Len() != 0 {
		t.Fatalf("printed a report for an unknown organization: %s", out.String())
	}
}

// The flag package stops at the first positional argument, so without this
// check "--org a b" rebuilds a alone and "--org a stray --verify" drops
// --verify and writes.
func TestRejectsExtraArguments(t *testing.T) {
	org := testDatabase(t)
	var out bytes.Buffer
	for _, args := range [][]string{{"--org", org, "stray"}, {"--org", org, "stray", "--verify"}} {
		err := run(context.Background(), args, &out)
		if err == nil || !strings.Contains(err.Error(), "usage") || !strings.Contains(err.Error(), `"stray"`) {
			t.Errorf("args %v: err = %v", args, err)
		}
	}
	if out.Len() != 0 {
		t.Fatalf("ran despite extra arguments: %s", out.String())
	}
}
