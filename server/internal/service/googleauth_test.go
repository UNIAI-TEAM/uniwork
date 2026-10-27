package service

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func newGoogleFixture(t *testing.T) (*GoogleAuthService, *AuthService, *db.Queries) {
	f := newIdentityFixture(t)
	return f.google, f.auth, f.q
}

// A Google identity no account knows opens a new password-less account. An
// address Google owns (Gmail, the Workspace domain) starts verified; the
// subject finds the account again whatever address it carries later.
func TestGoogleSignInCreatesVerifiedUserWithoutPassword(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := context.Background()
	res, err := f.google.SignIn(ctx, GoogleClaims{Sub: "sub-1", Email: "New@Gmail.com", EmailVerified: true, Name: "Ngọc", Picture: "https://img/p.png"}, "vi")
	if err != nil {
		t.Fatal(err)
	}
	sess := res.Session
	u := sess.User
	if u.Email != "new@gmail.com" || u.DisplayName != "Ngọc" || !u.EmailVerifiedAt.Valid || u.PasswordHash.Valid || u.Locale != "vi" {
		t.Fatalf("user = %+v", u)
	}
	if u.GoogleID.String != "sub-1" || u.GoogleEmail.String != "new@gmail.com" || !u.GoogleLinkedAt.Valid || u.AvatarUrl.String != "https://img/p.png" {
		t.Fatalf("google fields = %+v", u)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" || res.Reclaimed {
		t.Fatalf("session = %+v", res)
	}
	// Signing in again finds the same account by google_id.
	again, err := f.google.SignIn(ctx, GoogleClaims{Sub: "sub-1", Email: "other@example.com", EmailVerified: true}, "vi")
	if err != nil || again.Session.User.ID != u.ID {
		t.Fatalf("second sign-in: id=%s err=%v", again.Session.User.ID, err)
	}
	if _, err := f.auth.Login(ctx, "new@gmail.com", "anything"); err != ErrInvalidCredentials {
		t.Fatalf("password login on google-only user: %v", err)
	}
	// A Workspace address starts verified too.
	ws, err := f.google.SignIn(ctx, GoogleClaims{Sub: "sub-ws", Email: "an@company.vn", EmailVerified: true, HD: "company.vn"}, "vi")
	if err != nil || !ws.Session.User.EmailVerifiedAt.Valid {
		t.Fatalf("workspace account: %+v %v", ws.Session.User, err)
	}
	if len(f.mailsTo("new@gmail.com")) != 0 || len(f.mailsTo("an@company.vn")) != 0 {
		t.Fatal("a new account with a verified address gets no mail")
	}
}

// An address Google does not own is only Google's word: the account it opens
// starts unverified and is mailed a code, as a password sign-up is, so the
// mailbox's owner can still prove it or take the account back.
func TestGoogleSignInCreatesAnUnverifiedAccountForAnAddressGoogleDoesNotOwn(t *testing.T) {
	f := newIdentityFixture(t)
	res, err := f.google.SignIn(context.Background(), GoogleClaims{Sub: "sub-x", Email: "an@yahoo.com", EmailVerified: true, Name: "An"}, "en")
	if err != nil {
		t.Fatal(err)
	}
	u := res.Session.User
	if u.EmailVerifiedAt.Valid || u.GoogleID.String != "sub-x" || res.Session.RefreshToken == "" {
		t.Fatalf("user = %+v", u)
	}
	f.mailOfKind(t, "an@yahoo.com", mail.KindVerificationCode)
}

// A verified password account with the address Google owns is linked, not
// duplicated: the name and password stay, an empty avatar is filled, and the
// link is audited and told to the owner.
func TestGoogleSignInLinksAVerifiedPasswordAccountByEmail(t *testing.T) {
	f := newIdentityFixture(t)
	ctx := context.Background()
	reg := registerVerified(t, f.q, f.auth, "link@gmail.com", "Link")
	res, err := f.google.SignIn(ctx, GoogleClaims{Sub: "sub-2", Email: "LINK@gmail.com", EmailVerified: true, Name: "Ignored", Picture: "https://img/a.png"}, "vi")
	if err != nil {
		t.Fatal(err)
	}
	u := res.Session.User
	if u.ID != reg.ID || u.GoogleID.String != "sub-2" || u.DisplayName != "Link" || u.AvatarUrl.String != "https://img/a.png" {
		t.Fatalf("linked user = %+v", u)
	}
	if _, err := f.auth.Login(ctx, "link@gmail.com", "password123"); err != nil {
		t.Fatalf("password login after link: %v", err)
	}
	if f.linkAudits(t, reg.ID, ProviderGoogle, "email_match") != 1 {
		t.Fatal("the link is audited")
	}
	if m := f.mailOfKind(t, "link@gmail.com", mail.KindSignInMethodChanged); m.UserID != reg.ID {
		t.Fatalf("the notice goes to the owner: %+v", m)
	}
}

// An account with a second factor is not linked by the first factor alone:
// TestLinkWaitsForTheSecondFactor (second_factor_test.go) holds it, and the
// link written once the second factor passes.

func TestGoogleSignInRejectsUnverifiedEmailAndForeignLink(t *testing.T) {
	g, _, q := newGoogleFixture(t)
	ctx := context.Background()
	if _, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-3", Email: "u@gmail.com", EmailVerified: false}, "vi"); !codedIs(err, "sign_in_email_unverified") {
		t.Fatalf("unverified google email: got %v", err)
	}
	for _, email := range []string{"", "nobody", "@gmail.com", "a@"} {
		if _, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-4", Email: email, EmailVerified: true}, "vi"); !codedIs(err, "sign_in_email_unverified") {
			t.Fatalf("email %q: got %v", email, err)
		}
	}
	// An account already linked to a different Google subject is not re-linked.
	if _, err := q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{ID: "01LINKED", Email: "taken@gmail.com", DisplayName: "T", GoogleID: pgtype.Text{String: "sub-5", Valid: true}, EmailVerified: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.SignIn(ctx, GoogleClaims{Sub: "sub-6", Email: "taken@gmail.com", EmailVerified: true}, "vi"); !codedIs(err, "sign_in_account_conflict") {
		t.Fatalf("foreign link: got %v", err)
	}
}

func TestGoogleSignInFallsBackToEmailLocalPartForName(t *testing.T) {
	g, _, _ := newGoogleFixture(t)
	res, err := g.SignIn(context.Background(), GoogleClaims{Sub: "sub-7", Email: "minh.anh@gmail.com", EmailVerified: true}, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if res.Session.User.DisplayName != "minh.anh" {
		t.Fatalf("display name = %q", res.Session.User.DisplayName)
	}
}
