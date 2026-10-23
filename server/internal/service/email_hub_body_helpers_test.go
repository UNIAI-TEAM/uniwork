package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestPgTextString(t *testing.T) {
	t.Parallel()
	if pgTextString(pgtype.Text{}) != "" {
		t.Fatal("expected empty invalid text")
	}
	if got := pgTextString(pgtype.Text{String: "hello", Valid: true}); got != "hello" {
		t.Fatalf("unexpected text: %q", got)
	}
}
