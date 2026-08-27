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

func newAuthService(t *testing.T) *AuthService {
	pool := testutil.DB(t)
	q := db.New(pool)
	m := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	return NewAuthService(q, m, time.Hour, nil)
}

func TestRegisterLoginRefresh(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()

	sess, err := s.Register(ctx, "a@example.com", "password123", "An")
	if err != nil {
		t.Fatal(err)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" {
		t.Fatal("empty tokens")
	}

	if _, err := s.Register(ctx, "a@example.com", "x2345678", "An"); err != ErrConflict {
		t.Fatalf("duplicate email: got %v, want ErrConflict", err)
	}

	if _, err := s.Login(ctx, "a@example.com", "wrong-pass"); err != ErrInvalidCredentials {
		t.Fatalf("wrong password: got %v", err)
	}
	sess2, err := s.Login(ctx, "a@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}

	// rotation: refresh cũ bị revoke sau khi dùng
	sess3, err := s.Refresh(ctx, sess2.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if sess3.RefreshToken == sess2.RefreshToken {
		t.Fatal("refresh token not rotated")
	}
	if _, err := s.Refresh(ctx, sess2.RefreshToken); err != ErrInvalidCredentials {
		t.Fatalf("reused refresh token: got %v", err)
	}

	if err := s.Logout(ctx, sess3.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Refresh(ctx, sess3.RefreshToken); err != ErrInvalidCredentials {
		t.Fatalf("refresh after logout: got %v", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()
	if _, err := s.Register(ctx, "bad-email", "password123", "An"); err == nil {
		t.Fatal("bad email accepted")
	}
	if _, err := s.Register(ctx, "b@example.com", "short", "An"); err == nil {
		t.Fatal("short password accepted")
	}
}

func TestLoginRejectsUserWithoutPassword(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()
	_, err := s.q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{
		ID: "01GOOGLEONLY", Email: "g@example.com", DisplayName: "G",
		GoogleID: pgtype.Text{String: "sub-1", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Login(ctx, "g@example.com", ""); err != ErrInvalidCredentials {
		t.Fatalf("empty password: want ErrInvalidCredentials, got %v", err)
	}
	if _, err := s.Login(ctx, "g@example.com", "anything"); err != ErrInvalidCredentials {
		t.Fatalf("any password: want ErrInvalidCredentials, got %v", err)
	}
}

func TestUpdateProfile(t *testing.T) {
	s := newAuthService(t)
	ctx := context.Background()
	sess, err := s.Register(ctx, "patch@example.com", "password123", "Before")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := s.UpdateProfile(ctx, sess.User.ID, "  After  ")
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayName != "After" {
		t.Fatalf("display_name = %q", updated.DisplayName)
	}
	if _, err := s.UpdateProfile(ctx, sess.User.ID, "   "); err == nil {
		t.Fatal("empty display name accepted")
	}
}
