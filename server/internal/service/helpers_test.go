package service

import (
	"context"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// registerVerified registers a password user and marks the email verified,
// which is the state every fixture that goes on to create organizations,
// workspaces or invitations needs.
func registerVerified(t *testing.T, q *db.Queries, as *AuthService, email, name string) db.User {
	t.Helper()
	ctx := context.Background()
	s, err := as.Register(ctx, email, "password123", name, "vi")
	if err != nil {
		t.Fatal(err)
	}
	u, err := q.MarkEmailVerified(ctx, s.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// createLegacyOrganization founds an organization for userID without the
// one-organization rule, the way accounts were built before ADR 0032. Tests
// that are about one person in two organizations (isolation between them)
// seed the second one with it; such accounts still exist (ADR 0032 D2).
func createLegacyOrganization(t *testing.T, s *OrganizationService, userID, name, slug string) db.Organization {
	t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	o, err := createOrganizationQ(ctx, s.q.WithTx(tx), userID, name, slug)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return o
}
