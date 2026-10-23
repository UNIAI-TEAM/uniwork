package graph

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// The seed migration and the Go catalogue name the same triples.
func TestGraphCatalogueMatchesSeed(t *testing.T) {
	pool := testutil.DB(t)
	rows, err := pool.Query(context.Background(),
		`SELECT edge_type, from_type, to_type, human_creatable, temporal FROM graph_edge_types`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []Triple
	for rows.Next() {
		var e, f, to string
		var tr Triple
		if err := rows.Scan(&e, &f, &to, &tr.HumanCreatable, &tr.Temporal); err != nil {
			t.Fatal(err)
		}
		tr.Edge, tr.From, tr.To = EdgeType(e), NodeType(f), NodeType(to)
		got = append(got, tr)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sortTriples(got)
	want := Triples()
	if len(got) != len(want) {
		t.Fatalf("seed has %d triples, catalogue %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("triple %d: seed %+v, catalogue %+v", i, got[i], want[i])
		}
	}
}

// graph_edges_validate refuses a triple outside the catalogue and an edge
// whose nodes sit in another organization.
func TestGraphEdgesRefuseWhatTheCatalogueDoesNot(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	for _, n := range [][3]string{{"n-task", "org-a", "TASK"}, {"n-actor", "org-a", "ACTOR"}, {"n-far", "org-b", "ACTOR"}} {
		if _, err := pool.Exec(ctx, `INSERT INTO graph_nodes (id, organization_id, node_type, source_id, visibility)
			VALUES ($1, $2, $3, $1, 'organization')`, n[0], n[1], n[2]); err != nil {
			t.Fatal(err)
		}
	}
	insert := func(id, from, to, edge string) error {
		_, err := pool.Exec(ctx, `INSERT INTO graph_edges
			(id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
			VALUES ($1, 'org-a', $2, $3, $4, 'SYSTEM', now(), 'source_row', 'x')`, id, from, to, edge)
		return err
	}
	if err := insert("e-ok", "n-task", "n-actor", "OWNED_BY"); err != nil {
		t.Fatalf("catalogue triple refused: %v", err)
	}
	cases := []struct{ name, id, from, to, edge string }{
		{"reversed", "e-rev", "n-actor", "n-task", "OWNED_BY"},
		{"unknown edge", "e-unk", "n-task", "n-actor", "RELATED_TO"},
		{"other organization", "e-far", "n-task", "n-far", "OWNED_BY"},
		{"missing node", "e-miss", "n-task", "n-nowhere", "OWNED_BY"},
	}
	for _, c := range cases {
		err := insert(c.id, c.from, c.to, c.edge)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Errorf("%s: err = %v, want SQLSTATE 23514", c.name, err)
		}
	}
}
