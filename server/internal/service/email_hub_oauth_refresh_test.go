package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubTokenServer is a fake OAuth token endpoint; refreshes counts the
// refresh_token grants it answered.
type emailHubTokenServer struct {
	url       string
	refreshes atomic.Int32
}

// newEmailHubTokenServer answers each refresh grant with reply, given the
// refresh token the service sent. Anything else is a bare 400.
func newEmailHubTokenServer(t *testing.T, reply func(w http.ResponseWriter, r *http.Request, refreshToken string)) *emailHubTokenServer {
	t.Helper()
	ts := &emailHubTokenServer{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" || r.FormValue("grant_type") != "refresh_token" ||
			r.FormValue("client_id") != "eh-client" || r.FormValue("client_secret") != "eh-secret" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		ts.refreshes.Add(1)
		reply(w, r, r.FormValue("refresh_token"))
	}))
	t.Cleanup(srv.Close)
	ts.url = srv.URL
	return ts
}

// useEmailHubTokenServer points both providers of svc at ts. AuthStyleInParams
// keeps oauth2 from probing twice, so refreshes counts real refreshes.
func useEmailHubTokenServer(svc *EmailHubService, ts *emailHubTokenServer) {
	svc.oauthHTTP = &http.Client{Timeout: 5 * time.Second}
	svc.oauth = map[string]*emailHubOAuthProvider{}
	for name, kind := range map[string]string{"google": "oauth_google", "microsoft": "oauth_microsoft"} {
		svc.oauth[name] = &emailHubOAuthProvider{name: name, authKind: kind, config: oauth2.Config{
			ClientID: "eh-client", ClientSecret: "eh-secret",
			Endpoint: oauth2.Endpoint{TokenURL: ts.url + "/token", AuthStyle: oauth2.AuthStyleInParams},
		}}
	}
}

func writeEmailHubToken(w http.ResponseWriter, access, refresh string) {
	body := map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": 3600}
	if refresh != "" {
		body["refresh_token"] = refresh
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func writeEmailHubTokenError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code, "error_description": "Token has been expired or revoked."})
}

// emailHubTokenGate holds token requests until release; arrived tells the
// test a request is in. Tests `defer gate.release()`: defers run before
// t.Cleanup, so srv.Close never waits on a held request.
type emailHubTokenGate struct {
	arrived chan struct{}
	open    chan struct{}
	release func()
}

func newEmailHubTokenGate(callers int) *emailHubTokenGate {
	g := &emailHubTokenGate{arrived: make(chan struct{}, callers), open: make(chan struct{})}
	g.release = sync.OnceFunc(func() { close(g.open) })
	return g
}

func (g *emailHubTokenGate) hold(r *http.Request) bool {
	select {
	case g.arrived <- struct{}{}:
	default:
	}
	select {
	case <-g.open:
		return true
	case <-r.Context().Done():
		return false
	}
}

// emailHubWithin receives from ch, failing the test after 10s instead of hanging it.
func emailHubWithin[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting on the token endpoint or a refresh")
	}
	var zero T
	return zero
}

// emailHubSoon is an access-token expiry inside the refresh skew.
func emailHubSoon() time.Time { return time.Now().Add(time.Minute) }

// oauthEmailHubAccount turns a seeded password mailbox into one that signs in
// with authKind. It holds refresh token "refresh-1" and access token
// "access-old", which expires at expires, both sealed as the callback stores them.
func oauthEmailHubAccount(t *testing.T, svc *EmailHubService, pool *pgxpool.Pool, acc db.EmailHubAccount, authKind string, expires time.Time) db.EmailHubAccount {
	t.Helper()
	refreshEnc, err := svc.sealSecret("refresh-1")
	if err != nil {
		t.Fatal(err)
	}
	accessEnc, err := svc.sealSecret("access-old")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE email_hub_accounts
		SET auth_kind = $2, password_enc = '', oauth_refresh_token_enc = $3,
		    oauth_access_token_enc = $4, oauth_access_expires_at = $5
		WHERE id = $1`, acc.ID, authKind, refreshEnc, accessEnc, expires); err != nil {
		t.Fatal(err)
	}
	return emailHubAccountRow(t, svc, acc.ID)
}

func emailHubAccountRow(t *testing.T, svc *EmailHubService, id string) db.EmailHubAccount {
	t.Helper()
	row, err := svc.q.GetEmailHubAccountByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// openEmailHubSecret opens a sealed column; "" stays "".
func openEmailHubSecret(t *testing.T, svc *EmailHubService, enc string) string {
	t.Helper()
	if enc == "" {
		return ""
	}
	v, err := svc.openPassword(enc)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// A token inside the skew is refreshed and stored without a version bump; the
// sessions carry it instead of a password, and the next caller, even one
// holding the old snapshot, uses the stored token without a refresh (spec §4.4).
func TestEmailHubOAuthRefreshNearExpiry(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	sent := make(chan string, 4)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, refresh string) {
		sent <- refresh
		writeEmailHubToken(w, "access-new", "")
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	creds, err := svc.credentials(ctx, acc)
	if err != nil {
		t.Fatal(err)
	}
	if creds.IMAP.AccessToken != "access-new" || creds.SMTP.AccessToken != "access-new" ||
		creds.IMAP.Password != "" || creds.SMTP.Password != "" {
		t.Fatalf("creds: imap token=%q password=%q, smtp token=%q password=%q",
			creds.IMAP.AccessToken, creds.IMAP.Password, creds.SMTP.AccessToken, creds.SMTP.Password)
	}
	if creds.Version != acc.CredentialVersion || creds.IMAP.Host != acc.ImapHost || creds.SMTP.Email != acc.EmailAddress {
		t.Fatalf("creds do not mirror the row: %+v", creds)
	}
	if got := emailHubWithin(t, sent); got != "refresh-1" {
		t.Fatalf("refresh sent %q, want the stored refresh-1", got)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	if openEmailHubSecret(t, svc, row.OauthAccessTokenEnc) != "access-new" ||
		openEmailHubSecret(t, svc, row.OauthRefreshTokenEnc) != "refresh-1" || row.CredentialVersion != acc.CredentialVersion {
		t.Fatalf("stored row: version=%d", row.CredentialVersion)
	}
	if !row.OauthAccessExpiresAt.Valid || time.Until(row.OauthAccessExpiresAt.Time) < 50*time.Minute {
		t.Fatalf("stored expiry %v, want about an hour out", row.OauthAccessExpiresAt.Time)
	}
	for name, snapshot := range map[string]db.EmailHubAccount{"fresh row": row, "stale snapshot": acc} {
		again, err := svc.credentials(ctx, snapshot)
		if err != nil || again.IMAP.AccessToken != "access-new" {
			t.Fatalf("%s: token=%q err=%v", name, again.IMAP.AccessToken, err)
		}
	}
	if n := ts.refreshes.Load(); n != 1 {
		t.Fatalf("token endpoint hit %d times, want once", n)
	}
}

// Microsoft returns a new refresh token with each refresh; it is stored and
// sent on the next refresh.
func TestEmailHubOAuthRefreshStoresRotatedRefreshToken(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	sent := make(chan string, 4)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, refresh string) {
		sent <- refresh
		writeEmailHubToken(w, "access-new", "refresh-2")
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_microsoft", emailHubSoon())

	if creds, err := svc.credentials(ctx, acc); err != nil || creds.IMAP.AccessToken != "access-new" {
		t.Fatalf("token=%q err=%v", creds.IMAP.AccessToken, err)
	}
	if got := emailHubWithin(t, sent); got != "refresh-1" {
		t.Fatalf("first refresh sent %q", got)
	}
	if got := openEmailHubSecret(t, svc, emailHubAccountRow(t, svc, acc.ID).OauthRefreshTokenEnc); got != "refresh-2" {
		t.Fatalf("stored refresh token %q, want the rotated refresh-2", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts SET oauth_access_expires_at = now() WHERE id = $1`, acc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.credentials(ctx, acc); err != nil {
		t.Fatal(err)
	}
	if got := emailHubWithin(t, sent); got != "refresh-2" {
		t.Fatalf("second refresh sent %q, want the rotated refresh-2", got)
	}
}

// However many callers on one process find the token expired, the token
// endpoint is hit once: the rest wait on the account's lock or arrive after
// the write, and re-read the stored token.
func TestEmailHubOAuthRefreshOneCallPerProcess(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	gate := newEmailHubTokenGate(1)
	defer gate.release()
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		if gate.hold(r) {
			writeEmailHubToken(w, "access-new", "")
		}
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	const callers = 8
	type result struct {
		token string
		err   error
	}
	results := make(chan result, callers)
	run := func() {
		creds, err := svc.credentials(ctx, acc)
		results <- result{creds.IMAP.AccessToken, err}
	}
	go run()
	emailHubWithin(t, gate.arrived) // the first caller holds the lock at the token endpoint
	for range callers - 1 {
		go run()
	}
	gate.release()
	for range callers {
		if r := emailHubWithin(t, results); r.err != nil || r.token != "access-new" {
			t.Fatalf("caller got token=%q err=%v", r.token, r.err)
		}
	}
	if n := ts.refreshes.Load(); n != 1 {
		t.Fatalf("%d callers refreshed %d times, want once", callers, n)
	}
}

// Two pods (two services, one database) refresh the same expired token at
// once. Exactly one write lands; the loser drops its token, uses the winner's,
// and the account never moves to needs_reconnect (spec §10, rolling update).
func TestEmailHubOAuthRefreshTwoServicesOneWriter(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	other := NewEmailHubService(q, svc.ws, svc.box) // its own refresh locks, the same rows
	gate := newEmailHubTokenGate(2)
	defer gate.release()
	var issued atomic.Int32
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		n := issued.Add(1)
		if gate.hold(r) {
			writeEmailHubToken(w, fmt.Sprintf("access-%d", n), "")
		}
	})
	useEmailHubTokenServer(svc, ts)
	useEmailHubTokenServer(other, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	type result struct {
		token string
		err   error
	}
	results := make(chan result, 2)
	for _, pod := range []*EmailHubService{svc, other} {
		go func() {
			creds, err := pod.credentials(ctx, acc)
			results <- result{creds.IMAP.AccessToken, err}
		}()
	}
	emailHubWithin(t, gate.arrived)
	emailHubWithin(t, gate.arrived) // both pods read the same expired row and are out refreshing
	gate.release()
	a, b := emailHubWithin(t, results), emailHubWithin(t, results)
	if a.err != nil || b.err != nil {
		t.Fatalf("refresh errors: %v, %v", a.err, b.err)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	stored := openEmailHubSecret(t, svc, row.OauthAccessTokenEnc)
	if a.token != stored || b.token != stored {
		t.Fatalf("both pods must use the one stored token %q, got %q and %q", stored, a.token, b.token)
	}
	if row.AuthFailedAt.Valid || row.CredentialVersion != acc.CredentialVersion ||
		openEmailHubSecret(t, svc, row.OauthRefreshTokenEnc) != "refresh-1" {
		t.Fatalf("row after the race: auth_failed=%v version=%d", row.AuthFailedAt.Valid, row.CredentialVersion)
	}
	if n := ts.refreshes.Load(); n != 2 {
		t.Fatalf("token endpoint hit %d times, want one per pod", n)
	}
}

// A refused grant moves the account to needs_reconnect. The credential goes,
// the cached mail stays, and the system audit and inbox_changed are written once
// (spec §3, §4.4).
func TestEmailHubOAuthInvalidGrantMarksNeedsReconnect(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var code atomic.Value
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		writeEmailHubTokenError(w, http.StatusBadRequest, code.Load().(string))
	})
	useEmailHubTokenServer(svc, ts)

	for _, c := range []struct{ code, email string }{
		{"invalid_grant", "seed@gmail.com"},
		{"unauthorized_client", "second@gmail.com"},
	} {
		code.Store(c.code)
		acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, c.email), "oauth_google", emailHubSoon())
		seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
		before := ts.refreshes.Load()

		if _, err := svc.credentials(ctx, acc); !errors.Is(err, ErrEmailHubReauthRequired) {
			t.Fatalf("%s: expected ErrEmailHubReauthRequired, got %v", c.code, err)
		}
		row := emailHubAccountRow(t, svc, acc.ID)
		if !row.AuthFailedAt.Valid || row.AuthFailedReason != "oauth_invalid_grant" || row.DisconnectedAt.Valid ||
			row.OauthRefreshTokenEnc != "" || row.OauthAccessTokenEnc != "" || row.OauthAccessExpiresAt.Valid {
			t.Fatalf("%s: row auth_failed=%v reason=%q disconnected=%v refresh_cleared=%v access_cleared=%v expires=%v", c.code,
				row.AuthFailedAt.Valid, row.AuthFailedReason, row.DisconnectedAt.Valid,
				row.OauthRefreshTokenEnc == "", row.OauthAccessTokenEnc == "", row.OauthAccessExpiresAt.Valid)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n != 1 {
			t.Fatalf("%s: cached mail must survive, %d threads left", c.code, n)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events
			WHERE action = $1 AND resource_id = $2 AND actor_kind = 'system' AND metadata::jsonb->>'reason' = 'oauth_invalid_grant'`,
			audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 1 {
			t.Fatalf("%s: expected one system auth_failed audit row, got %d", c.code, n)
		}
		if n := emailHubCount(t, pool, emailHubInboxChangedFor, acc.ID); n != 1 {
			t.Fatalf("%s: expected one inbox_changed event, got %d", c.code, n)
		}
		// The marked row answers before any refresh.
		if _, err := svc.credentials(ctx, row); !errors.Is(err, ErrEmailHubReauthRequired) {
			t.Fatalf("%s: a marked account must answer reauth, got %v", c.code, err)
		}
		if n := ts.refreshes.Load() - before; n != 1 {
			t.Fatalf("%s: token endpoint hit %d times, want once", c.code, n)
		}
	}
}

// Another pod rotated the grant while this one was out, so this pod's refresh
// is refused. The re-read row holds the other pod's token, which is used, and
// the account stays active.
func TestEmailHubOAuthInvalidGrantAfterOtherPodRefreshedStaysActive(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_microsoft", emailHubSoon())
	otherAccess, err := svc.sealSecret("access-other")
	if err != nil {
		t.Fatal(err)
	}
	otherRefresh, err := svc.sealSecret("refresh-rotated")
	if err != nil {
		t.Fatal(err)
	}
	otherDone := make(chan error, 1)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		n, err := svc.q.UpdateEmailHubAccountOAuthTokens(context.Background(), db.UpdateEmailHubAccountOAuthTokensParams{
			ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion,
			PrevExpiresAt: acc.OauthAccessExpiresAt, AccessEnc: otherAccess,
			ExpiresAt:  pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
			RefreshEnc: otherRefresh,
		})
		if err == nil && n != 1 {
			err = fmt.Errorf("the other pod wrote %d rows", n)
		}
		otherDone <- err
		writeEmailHubTokenError(w, http.StatusBadRequest, "invalid_grant")
	})
	useEmailHubTokenServer(svc, ts)

	creds, err := svc.credentials(ctx, acc)
	if werr := emailHubWithin(t, otherDone); werr != nil {
		t.Fatal(werr)
	}
	if err != nil || creds.IMAP.AccessToken != "access-other" {
		t.Fatalf("want the other pod's token, got token=%q err=%v", creds.IMAP.AccessToken, err)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	if row.AuthFailedAt.Valid || openEmailHubSecret(t, svc, row.OauthRefreshTokenEnc) != "refresh-rotated" {
		t.Fatalf("row: auth_failed=%v reason=%q", row.AuthFailedAt.Valid, row.AuthFailedReason)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 0 {
		t.Fatalf("a grant another pod rotated is no auth failure, got %d audit rows", n)
	}
}

// A reconnect landed while this refresh was out (spec §8: invalid_grant from
// the old token after an OAuth reconnect): the bumped credential_version means
// the refusal is about a grant the row no longer holds, so the reconnected
// token is used and the account stays active.
func TestEmailHubOAuthInvalidGrantAfterReconnectStaysActive(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())
	reconnected, err := svc.sealSecret("access-reconnected")
	if err != nil {
		t.Fatal(err)
	}
	bumped := make(chan error, 1)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		_, err := pool.Exec(context.Background(), `UPDATE email_hub_accounts
			SET credential_version = credential_version + 1, oauth_access_token_enc = $2,
			    oauth_access_expires_at = now() + interval '1 hour'
			WHERE id = $1`, acc.ID, reconnected)
		bumped <- err
		writeEmailHubTokenError(w, http.StatusBadRequest, "invalid_grant")
	})
	useEmailHubTokenServer(svc, ts)

	creds, err := svc.credentials(ctx, acc)
	if berr := emailHubWithin(t, bumped); berr != nil {
		t.Fatal(berr)
	}
	if err != nil || creds.IMAP.AccessToken != "access-reconnected" {
		t.Fatalf("want the reconnected token, got token=%q err=%v", creds.IMAP.AccessToken, err)
	}
	if row := emailHubAccountRow(t, svc, acc.ID); row.AuthFailedAt.Valid {
		t.Fatalf("a refusal of the replaced grant marked the account: reason=%q", row.AuthFailedReason)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 0 {
		t.Fatalf("a refusal of the replaced grant is no auth failure, got %d audit rows", n)
	}
}

// A disconnect that lands while a refresh is out wins: the late token is
// dropped, the row stays disconnected with no credential, and the caller is
// told to reconnect.
func TestEmailHubOAuthRefreshRacingDisconnect(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	gate := newEmailHubTokenGate(1)
	defer gate.release()
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		if gate.hold(r) {
			writeEmailHubToken(w, "access-late", "refresh-late")
		}
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	errc := make(chan error, 1)
	go func() {
		_, err := svc.credentials(ctx, acc)
		errc <- err
	}()
	emailHubWithin(t, gate.arrived)
	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	gate.release()
	if err := emailHubWithin(t, errc); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("a refresh that lost to a disconnect: got %v, want ErrEmailHubReauthRequired", err)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	if !row.DisconnectedAt.Valid || row.OauthRefreshTokenEnc != "" || row.OauthAccessTokenEnc != "" || row.OauthAccessExpiresAt.Valid {
		t.Fatalf("disconnected row: disconnected=%v refresh_cleared=%v access_cleared=%v expires=%v",
			row.DisconnectedAt.Valid, row.OauthRefreshTokenEnc == "", row.OauthAccessTokenEnc == "", row.OauthAccessExpiresAt.Valid)
	}
}

// A 5xx from the token endpoint, or a provider whose env was removed, is
// transient. It changes nothing, and the error carries a code, never the
// provider's text.
func TestEmailHubOAuthTransientRefreshKeepsState(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		writeEmailHubTokenError(w, http.StatusServiceUnavailable, "temporarily_unavailable")
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())
	unchanged := func(step string) {
		t.Helper()
		row := emailHubAccountRow(t, svc, acc.ID)
		if row.AuthFailedAt.Valid || row.CredentialVersion != acc.CredentialVersion ||
			row.OauthRefreshTokenEnc != acc.OauthRefreshTokenEnc || row.OauthAccessTokenEnc != acc.OauthAccessTokenEnc ||
			!row.OauthAccessExpiresAt.Time.Equal(acc.OauthAccessExpiresAt.Time) {
			t.Fatalf("%s changed the row: auth_failed=%v version=%d", step, row.AuthFailedAt.Valid, row.CredentialVersion)
		}
	}

	_, err := svc.credentials(ctx, acc)
	if err == nil || errors.Is(err, ErrEmailHubReauthRequired) || emailHubErrCode(err) != "oauth_refresh_failed" {
		t.Fatalf("5xx: err=%v code=%q", err, emailHubErrCode(err))
	}
	if strings.Contains(err.Error(), "expired or revoked") || strings.Contains(err.Error(), "temporarily_unavailable") {
		t.Fatal("the provider's reply must not leave the refresh")
	}
	unchanged("a 5xx")

	svc.oauth = nil // EMAIL_HUB_GOOGLE_* removed
	_, err = svc.credentials(ctx, acc)
	if !errors.Is(err, errEmailHubOAuthNotConfigured) || emailHubErrCode(err) != "oauth_not_configured" {
		t.Fatalf("no provider: err=%v code=%q", err, emailHubErrCode(err))
	}
	if n := ts.refreshes.Load(); n != 1 {
		t.Fatalf("an unconfigured provider must not reach the token endpoint, hit %d times", n)
	}
	unchanged("a missing provider")

	if code := emailHubErrCode(&oauth2.RetrieveError{ErrorCode: "invalid_request"}); code != "oauth_refresh_failed" {
		t.Fatalf("a raw oauth2 error must log as oauth_refresh_failed, got %q", code)
	}
}
