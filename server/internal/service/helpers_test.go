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
