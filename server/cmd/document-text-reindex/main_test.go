package main

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

const topic = "document.text_index_requested"

func TestUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"--org", "o", "--all"}, {"--all", "extra"}, {"--all", "--batch-size", "0"}} {
		err := run(context.Background(), args, &bytes.Buffer{})
		if err == nil || !strings.Contains(err.Error(), "usage") {
			t.Errorf("args %v: err = %v", args, err)
		}
	}
}

// seed makes two organizations: org-a with two files and a page, org-b with
// one file. Documents have no foreign keys, so no workspace row is needed.
func seed(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := testutil.DB(t)
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	t.Setenv("DATABASE_URL", url)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users (id, email, display_name, locale) VALUES ('user-reindex', 'reindex@example.com', 'Reindex', 'en')`)
	for _, o := range []string{"org-a", "org-b"} {
		exec(`INSERT INTO organizations (id, slug, name, created_by) VALUES ($1, $1, $1, 'user-reindex')`, o)
	}
	doc := func(id, org, kind string, version any) {
		exec(`INSERT INTO documents (id, organization_id, workspace_id, kind, title, file_version_id,
			created_by, created_by_kind, updated_by, updated_by_kind)
			VALUES ($1, $2, 'ws-1', $3, $1, $4, 'user-reindex', 'human', 'user-reindex', 'human')`, id, org, kind, version)
	}
	doc("doc-1", "org-a", "file", "ver-1")
	doc("doc-2", "org-a", "file", "ver-2")
	doc("doc-3", "org-a", "page", nil)
	doc("doc-4", "org-b", "file", "ver-4")
	return pool
}

func requests(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT payload::jsonb->>'document_id', payload::jsonb->>'version_id' FROM outbox_events WHERE topic = $1`, topic)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var d, v string
		if err := rows.Scan(&d, &v); err != nil {
			t.Fatal(err)
		}
		got[d] = v
	}
	return got
}

func TestReindexDryRunWritesNothing(t *testing.T) {
	pool := seed(t)
	var out bytes.Buffer
	if err := run(context.Background(), []string{"--all", "--dry-run"}, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "would request=3") {
		t.Fatalf("out = %q", out.String())
	}
	if got := requests(t, pool); len(got) != 0 {
		t.Fatalf("dry run wrote %v", got)
	}
}

func TestReindexRequestsEveryFileDocument(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want map[string]string
	}{
		{"org", []string{"--org", "org-a"}, map[string]string{"doc-1": "ver-1", "doc-2": "ver-2"}},
		{"all", []string{"--all"}, map[string]string{"doc-1": "ver-1", "doc-2": "ver-2", "doc-4": "ver-4"}},
		{"batch of one", []string{"--all", "--batch-size", "1"}, map[string]string{"doc-1": "ver-1", "doc-2": "ver-2", "doc-4": "ver-4"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := seed(t)
			var out bytes.Buffer
			if err := run(context.Background(), c.args, &out); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), "requested=") {
				t.Fatalf("out = %q", out.String())
			}
			got := requests(t, pool)
			if len(got) != len(c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			for d, v := range c.want {
				if got[d] != v {
					t.Fatalf("got %v, want %v", got, c.want)
				}
			}
		})
	}
}

func TestRejectsAnUnknownOrganization(t *testing.T) {
	seed(t)
	err := run(context.Background(), []string{"--org", "org-typo"}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), `organization "org-typo" does not exist`) {
		t.Fatalf("err = %v", err)
	}
}
