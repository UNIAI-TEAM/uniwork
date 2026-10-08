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
		if err := run(context.Background(), args, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "usage") {
			t.Errorf("args %v: err = %v", args, err)
		}
	}
}

func TestVerifyAnEmptyOrganization(t *testing.T) {
	testutil.DB(t)
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	t.Setenv("DATABASE_URL", url)
	var out bytes.Buffer
	if err := run(context.Background(), []string{"--org", "org-empty", "--verify", "--format", "json"}, &out); err != nil {
		t.Fatal(err)
	}
	var reps []projector.Report
	if err := json.Unmarshal(out.Bytes(), &reps); err != nil || len(reps) != 1 || reps[0].Drift.Total() != 0 {
		t.Fatalf("report = %s (%v)", out.String(), err)
	}
}
