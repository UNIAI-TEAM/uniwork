package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fakeEmailHubRevoke stands in for Google's revoke endpoint. svc's Google
// provider posts to it, and Microsoft has none. Every call answers status;
// status 0 never answers (the client gives up). It returns the token= values
// received so far.
func fakeEmailHubRevoke(t *testing.T, svc *EmailHubService, status int) func() []string {
	t.Helper()
	var mu sync.Mutex
	var got []string
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.ParseForm() != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		got = append(got, r.PostForm.Get("token"))
		mu.Unlock()
		if status == 0 {
			select {
			case <-r.Context().Done():
			case <-release:
			}
			return
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(release) }) // LIFO: unblocks a hung handler before Close waits on it
	svc.oauthHTTP = srv.Client()
	svc.oauth = map[string]*emailHubOAuthProvider{
		"google":    {name: "google", authKind: "oauth_google", revokeURL: srv.URL},
		"microsoft": {name: "microsoft", authKind: "oauth_microsoft"},
	}
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return slices.Clone(got)
	}
}

// seedRevocableEmailHubAccount stores a live mailbox at email. Under an OAuth
// authKind, it holds the sealed refresh token refresh and a live access token.
// Under "password", it is the plain seed row.
func seedRevocableEmailHubAccount(t *testing.T, svc *EmailHubService, pool *pgxpool.Pool, userID, orgID, email, authKind, refresh string) db.EmailHubAccount {
	t.Helper()
	ctx := context.Background()
	acc := seedEmailHubAccountAddr(t, svc.q, svc.box, userID, orgID, email)
	if authKind == "password" {
		return acc
	}
	sealedRefresh, err := svc.sealSecret(refresh)
	if err != nil {
		t.Fatal(err)
	}
	sealedAccess, err := svc.sealSecret("access-" + refresh)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts
		SET auth_kind = $2, password_enc = '', oauth_refresh_token_enc = $3,
		    oauth_access_token_enc = $4, oauth_access_expires_at = now() + interval '1 hour'
		WHERE id = $1`, acc.ID, authKind, sealedRefresh, sealedAccess); err != nil {
		t.Fatal(err)
	}
	row, err := svc.q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// A manual disconnect revokes the Google grant it removed. A Microsoft
// refresh token has no revoke endpoint, a password row has nothing to revoke,
// and a repeated disconnect finds no token left (spec §3, §5.5).
func TestEmailHubRevokeOnDisconnect(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	google := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "g@gmail.com", "oauth_google", "google-refresh")
	microsoft := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "m@outlook.com", "oauth_microsoft", "microsoft-refresh")
	password := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "pw@gmail.com", "password", "")
	for _, acc := range []db.EmailHubAccount{google, microsoft, password, google} {
		if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
			t.Fatalf("disconnect %s: %v", acc.EmailAddress, err)
		}
	}
	if got := revoked(); !slices.Equal(got, []string{"google-refresh"}) {
		t.Fatalf("revoked %q, want only the Google refresh token, once", got)
	}
}

// Leave, an invitation switch out of the organization and account deletion
// disconnect every mailbox in one statement and revoke the Google grants that
// statement removed, after commit (spec §5.5, UNI-1456 §4.4).
func TestEmailHubRevokeOnLeaveAndAccountDeletion(t *testing.T) {
	ctx := context.Background()
	for _, how := range []string{"leave", "switch", "delete"} {
		t.Run(how, func(t *testing.T) {
			l := newEmailHubLifecycle(t)
			revoked := fakeEmailHubRevoke(t, l.svc, http.StatusOK)
			oauth := seedRevocableEmailHubAccount(t, l.svc, l.pool, l.member.ID, l.ws.OrganizationID,
				"member@gmail.com", "oauth_google", "member-refresh")
			l.members.SetEmailHub(l.svc)
			l.auth.SetEmailHub(l.svc)
			var err error
			switch how {
			case "leave":
				err = l.members.Leave(ctx, l.member.ID, l.ws.OrganizationID)
			case "switch":
				err = switchOutOf(t, l, l.ws.OrganizationID)
			default:
				err = l.auth.DeleteAccount(ctx, l.member.ID, DeleteAccountInput{Password: "password123"})
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := revoked(); !slices.Equal(got, []string{"member-refresh"}) {
				t.Fatalf("revoked %q, want the member's Google refresh token once", got)
			}
			row, err := l.q.GetEmailHubAccountByID(ctx, oauth.ID)
			if err != nil || !row.DisconnectedAt.Valid || row.OauthRefreshTokenEnc != "" {
				t.Fatalf("oauth mailbox after %s: disconnected=%v refresh=%q err=%v",
					how, row.DisconnectedAt.Valid, row.OauthRefreshTokenEnc, err)
			}
			l.assertRevoked(t)
		})
	}
}

// Replacing a Google sign-in with an app password leaves a grant nothing uses
// again, so the reconnect revokes it once the new credential is committed.
func TestEmailHubRevokeOnReconnectToPassword(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	acc := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "back@gmail.com", "oauth_google", "old-refresh")
	stubEmailHubDial(svc, nil)

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "back@gmail.com", AppPassword: "new-app-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ID != acc.ID || view.AuthKind != "password" {
		t.Fatalf("reconnect: id=%s auth_kind=%q, want id %s with password", view.ID, view.AuthKind, acc.ID)
	}
	if got := revoked(); !slices.Equal(got, []string{"old-refresh"}) {
		t.Fatalf("revoked %q, want the replaced Google refresh token", got)
	}
}

// A reconnect with the same auth kind lands on the address's same Google
// grant, and Google revokes per grant, not per token. Revoking the old token
// would sign the new one out.
func TestEmailHubRevokeSkipsASameKindReconnect(t *testing.T) {
	svc := NewEmailHubService(nil, nil, testEmailHubBox(t))
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	sealed, err := svc.sealSecret("old-refresh")
	if err != nil {
		t.Fatal(err)
	}
	prev := db.EmailHubAccount{ID: "acc-1", AuthKind: "oauth_google", OauthRefreshTokenEnc: sealed}
	row := db.EmailHubAccount{ID: "acc-1", AuthKind: "oauth_google", OauthRefreshTokenEnc: "sealed-new"}
	svc.revokeReplacedEmailHubToken(context.Background(), prev, row)
	if got := revoked(); len(got) != 0 {
		t.Fatalf("a same-kind reconnect revoked %q", got)
	}
}

// markAuthFailed removes the token. An IMAP refusal leaves the grant alive at
// Google, so it is revoked. invalid_grant means Google already ended the grant,
// so nothing is sent. A mark that matches no row revokes nothing.
func TestEmailHubRevokeOnImapAuthFailedNotOnInvalidGrant(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	refused := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "refused@gmail.com", "oauth_google", "refused-refresh")
	dead := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "dead@gmail.com", "oauth_google", "dead-refresh")

	if !svc.markAuthFailed(ctx, refused, refused.CredentialVersion, "imap_auth_failed") {
		t.Fatal("an IMAP refusal must mark the account")
	}
	if !svc.markAuthFailed(ctx, dead, dead.CredentialVersion, "oauth_invalid_grant") {
		t.Fatal("invalid_grant must mark the account")
	}
	if svc.markAuthFailed(ctx, refused, refused.CredentialVersion, "imap_auth_failed") {
		t.Fatal("an already failed account was marked again")
	}
	if got := revoked(); !slices.Equal(got, []string{"refused-refresh"}) {
		t.Fatalf("revoked %q, want only the IMAP-refused grant, once", got)
	}
}

// Revoke is best-effort after commit: an error answer or a hung endpoint
// costs at most emailHubRevokeTimeout and never fails the disconnect.
func TestEmailHubRevokeFailureDoesNotFailDisconnect(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
	}{{"server_error", http.StatusInternalServerError}, {"hang", 0}} {
		t.Run(tc.name, func(t *testing.T) {
			svc, q, user, ws, pool := emailHubFixture(t)
			ctx := context.Background()
			revoked := fakeEmailHubRevoke(t, svc, tc.status)
			acc := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "g@gmail.com", "oauth_google", "google-refresh")

			start := time.Now()
			if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
				t.Fatalf("a failed revoke failed the disconnect: %v", err)
			}
			if took := time.Since(start); took > emailHubRevokeTimeout+3*time.Second {
				t.Fatalf("disconnect took %v; the revoke must give up after %v", took, emailHubRevokeTimeout)
			}
			if got := revoked(); len(got) != 1 {
				t.Fatalf("revoke calls = %d, want 1", len(got))
			}
			row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
			if err != nil || !row.DisconnectedAt.Valid || row.OauthRefreshTokenEnc != "" {
				t.Fatalf("row after disconnect: disconnected=%v refresh=%q err=%v", row.DisconnectedAt.Valid, row.OauthRefreshTokenEnc, err)
			}
		})
	}
}

// The same Google account connected elsewhere (another organization here)
// shares the grant, so a disconnect revokes nothing until the last holder goes.
func TestEmailHubRevokeSkipsAGrantAnotherMailboxStillHolds(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	here := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "shared@gmail.com", "oauth_google", "refresh-here")
	seedRevocableEmailHubAccount(t, svc, pool, user.ID, util.NewID(), "Shared@Gmail.com", "oauth_google", "refresh-there")
	solo := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "solo@gmail.com", "oauth_google", "refresh-solo")

	for _, acc := range []db.EmailHubAccount{here, solo} {
		if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
			t.Fatal(err)
		}
	}
	if got := revoked(); !slices.Equal(got, []string{"refresh-solo"}) {
		t.Fatalf("revoked %q, want only the grant no other mailbox holds", got)
	}
}

// switchOutOf moves the lifecycle's member out of orgID by accepting an
// invitation into a fresh organization with resolve "leave".
func switchOutOf(t *testing.T, l emailHubLifecycle, orgID string) error {
	t.Helper()
	ctx := context.Background()
	founder := registerVerified(t, l.q, l.auth, "eh-founder@example.com", "EH Founder")
	target, err := l.svc.ws.orgs.Create(ctx, founder.ID, "Đích", "eh-dich")
	if err != nil {
		t.Fatal(err)
	}
	l.members.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	invs, _, err := l.members.InviteToOrg(ctx, founder.ID, target.ID, []string{l.member.Email}, OrgRoleMember)
	if err != nil || len(invs) != 1 {
		t.Fatalf("invite: %v", err)
	}
	ws := NewWorkspaceService(l.pool, l.q, l.svc.ws.orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ws.SetEmailHub(l.svc)
	_, err = ws.AcceptInvite(ctx, l.member.ID, invs[0].Token, []SwitchResolution{{OrganizationID: orgID, Action: SwitchActionLeave}})
	return err
}
