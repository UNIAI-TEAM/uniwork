package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func newGoogleFixture(t *testing.T) (*GoogleAuthService, *AuthService, *db.Queries) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil, nil, "")
	return NewGoogleAuthService(q, as), as, q
}

func TestGoogleSignInCreatesVerifiedUserWithoutPassword(t *testing.T) {
	g, as, _ := newGoogleFixture(t)
	ctx := context.Background()
	sess, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-1", Email: "New@Example.com", EmailVerified: true, Name: "Ngọc", Picture: "https://img/p.png"}, "vi")
	if err != nil {
		t.Fatal(err)
	}
	u := sess.User
	if u.Email != "new@example.com" || u.DisplayName != "Ngọc" || !u.EmailVerifiedAt.Valid || u.PasswordHash.Valid {
		t.Fatalf("user = %+v", u)
	}
	if u.GoogleID.String != "sub-1" || u.AvatarUrl.String != "https://img/p.png" {
		t.Fatalf("google fields = %+v", u)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" {
		t.Fatal("no session tokens")
	}
	// Signing in again finds the same account by google_id.
	again, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-1", Email: "other@example.com", EmailVerified: true}, "vi")
	if err != nil || again.User.ID != u.ID {
		t.Fatalf("second sign-in: id=%s err=%v", again.User.ID, err)
	}
	if _, err := as.Login(ctx, "new@example.com", "anything"); err != ErrInvalidCredentials {
		t.Fatalf("password login on google-only user: %v", err)
	}
}

func TestGoogleSignInLinksExistingPasswordAccountByEmail(t *testing.T) {
	g, as, _ := newGoogleFixture(t)
	ctx := context.Background()
	reg, err := as.Register(ctx, "link@example.com", "password123", "Link", "vi")
	if err != nil {
		t.Fatal(err)
	}
	if reg.User.EmailVerifiedAt.Valid {
		t.Fatal("password user starts unverified")
	}
	sess, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-2", Email: "LINK@example.com", EmailVerified: true, Name: "Ignored", Picture: "https://img/a.png"}, "vi")
	if err != nil {
		t.Fatal(err)
	}
	u := sess.User
	if u.ID != reg.User.ID || u.GoogleID.String != "sub-2" || !u.EmailVerifiedAt.Valid {
		t.Fatalf("linked user = %+v", u)
	}
	if u.DisplayName != "Link" || u.AvatarUrl.String != "https://img/a.png" {
		t.Fatalf("link keeps the name and fills the empty avatar: %+v", u)
	}
	// The password still works.
	if _, err := as.Login(ctx, "link@example.com", "password123"); err != nil {
		t.Fatalf("password login after link: %v", err)
	}
}

func TestGoogleSignInRejectsUnverifiedEmailAndForeignLink(t *testing.T) {
	g, _, q := newGoogleFixture(t)
	ctx := context.Background()
	if _, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-3", Email: "u@example.com", EmailVerified: false}, "vi"); err != ErrEmailUnverified {
		t.Fatalf("unverified google email: want ErrEmailUnverified, got %v", err)
	}
	if _, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-4", Email: "", EmailVerified: true}, "vi"); err != ErrEmailUnverified {
		t.Fatalf("empty email: want ErrEmailUnverified, got %v", err)
	}
	// An account already linked to a different Google subject is not re-linked.
	if _, err := q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{ID: "01LINKED", Email: "taken@example.com", DisplayName: "T", GoogleID: pgtype.Text{String: "sub-5", Valid: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-6", Email: "taken@example.com", EmailVerified: true}, "vi"); err != ErrConflict {
		t.Fatalf("foreign link: want ErrConflict, got %v", err)
	}
}

func TestGoogleSignInFallsBackToEmailLocalPartForName(t *testing.T) {
	g, _, _ := newGoogleFixture(t)
	sess, err := g.SignIn(context.Background(), GoogleClaims{Sub: "sub-7", Email: "minh.anh@example.com", EmailVerified: true}, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if sess.User.DisplayName != "minh.anh" {
		t.Fatalf("display name = %q", sess.User.DisplayName)
	}
}
