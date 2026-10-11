package service

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The credential queries fence every write with credential_version: a write
// from an older snapshot changes nothing (spec §2.3).
func TestEmailHubAccountCredentialQueries(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	org := ws.OrganizationID
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, org)
	if acc.AuthKind != "password" || acc.ImapSecurity != "tls" || acc.SmtpSecurity != "starttls" || acc.CredentialVersion != 0 {
		t.Fatalf("new row: auth_kind=%q imap_security=%q smtp_security=%q version=%d", acc.AuthKind, acc.ImapSecurity, acc.SmtpSecurity, acc.CredentialVersion)
	}

	got, err := q.GetActiveEmailHubAccountByAddress(ctx, db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: org, UserID: user.ID, Email: "SEED@Gmail.com",
	})
	if err != nil || got.ID != acc.ID {
		t.Fatalf("lookup by address ignores case: got %q, err=%v", got.ID, err)
	}

	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, OrganizationID: org, SyncState: []byte(`{"INBOX":{"uid_validity":7}}`),
		CredentialVersion: acc.CredentialVersion,
	}); err != nil {
		t.Fatal(err)
	}

	mark := func(version int64) int64 {
		t.Helper()
		_, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: org, CredentialVersion: version, Reason: "imap_auth_failed",
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0
		}
		if err != nil {
			t.Fatal(err)
		}
		return 1
	}
	if n := mark(1); n != 0 {
		t.Fatalf("stale credential_version marked %d rows", n)
	}
	if n := mark(0); n != 1 {
		t.Fatalf("current credential_version marked %d rows, want 1", n)
	}
	if n := mark(0); n != 0 {
		t.Fatalf("an already failed account marked again: %d rows", n)
	}
	failed, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !failed.AuthFailedAt.Valid || failed.AuthFailedReason != "imap_auth_failed" || failed.PasswordEnc != "" || failed.DisconnectedAt.Valid {
		t.Fatalf("failed row: auth_failed_at=%v reason=%q password_enc=%q disconnected=%v",
			failed.AuthFailedAt.Valid, failed.AuthFailedReason, failed.PasswordEnc, failed.DisconnectedAt.Valid)
	}
	if _, err := q.GetActiveEmailHubAccountByAddress(ctx, db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: org, UserID: user.ID, Email: acc.EmailAddress,
	}); err != nil {
		t.Fatalf("a failed account is still the live row for its address: %v", err)
	}
	claimed, err := q.ClaimEmailHubAccountsForSync(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	if slices.ContainsFunc(claimed, func(a db.EmailHubAccount) bool { return a.ID == acc.ID }) {
		t.Fatal("sync claimed an account that needs reconnect")
	}

	update := func(imapHost string) db.EmailHubAccount {
		t.Helper()
		row, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: acc.ID, OrganizationID: org, Provider: acc.Provider,
			ImapHost: imapHost, ImapPort: acc.ImapPort, ImapSecurity: "tls",
			SmtpHost: acc.SmtpHost, SmtpPort: acc.SmtpPort, SmtpSecurity: "starttls",
			Username: "", AuthKind: "password", PasswordEnc: "sealed-new",
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	same := update(acc.ImapHost)
	if same.CredentialVersion != 1 || same.AuthFailedAt.Valid || same.AuthFailedReason != "" || same.PasswordEnc != "sealed-new" {
		t.Fatalf("reconnect: version=%d auth_failed=%v reason=%q password_enc=%q",
			same.CredentialVersion, same.AuthFailedAt.Valid, same.AuthFailedReason, same.PasswordEnc)
	}
	if string(same.SyncState) == "{}" {
		t.Fatal("reconnect to the same IMAP server reset sync_state")
	}
	moved := update("imap.other.example")
	if moved.CredentialVersion != 2 || string(moved.SyncState) != "{}" {
		t.Fatalf("reconnect to another IMAP server: version=%d sync_state=%s", moved.CredentialVersion, moved.SyncState)
	}

	if _, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: acc.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	gone, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gone.CredentialVersion != 3 || gone.PasswordEnc != "" {
		t.Fatalf("disconnect: version=%d password_enc=%q", gone.CredentialVersion, gone.PasswordEnc)
	}
	if _, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
		ID: acc.ID, OrganizationID: org, AuthKind: "password", ImapSecurity: "tls", SmtpSecurity: "starttls",
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("reconnecting a disconnected row: err=%v, want pgx.ErrNoRows", err)
	}
}

// A sync that read the account before a reconnect holds the old
// credential_version; its cursors belong to the old IMAP server and must not
// overwrite the reset sync_state (spec §2.1, §3).
func TestUpdateEmailHubAccountSyncStateIgnoresAStaleVersion(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	moved, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, Provider: "custom",
		ImapHost: "mail.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "mail.example.com", SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: "sealed-new",
	})
	if err != nil {
		t.Fatal(err)
	}
	write := func(version int64, state string) {
		t.Helper()
		if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
			ID: acc.ID, OrganizationID: acc.OrganizationID, SyncState: []byte(state), CredentialVersion: version,
		}); err != nil {
			t.Fatal(err)
		}
	}
	read := func() db.EmailHubAccount {
		t.Helper()
		row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}

	write(acc.CredentialVersion, `{"INBOX":{"uidvalidity":7,"last_uid":42}}`)
	if got := read(); string(got.SyncState) != "{}" {
		t.Fatalf("a write from the pre-reconnect snapshot landed: sync_state=%s", got.SyncState)
	}
	write(moved.CredentialVersion, `{"INBOX":{"uidvalidity":9,"last_uid":3}}`)
	if got := parseEmailHubSyncState(read().SyncState).folder(emailHubFolderInbox); got.UIDValidity != 9 || got.LastUID != 3 {
		t.Fatalf("the current snapshot must write its cursor, got %+v", got)
	}
}

// A refresh writes only over the token it read (spec §2.3, §4.4): a stale
// version or expiry, a failed or a disconnected row takes nothing, NULL
// matches NULL, and an empty refresh_enc keeps the stored refresh token.
func TestUpdateEmailHubAccountOAuthTokensConditional(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	org := ws.OrganizationID
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, org)
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts
		SET auth_kind = 'oauth_google', password_enc = '', oauth_refresh_token_enc = 'refresh-old'
		WHERE id = $1`, acc.ID); err != nil {
		t.Fatal(err)
	}
	at := func(d time.Duration) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: time.Now().Add(d).UTC().Truncate(time.Microsecond), Valid: true}
	}
	var never pgtype.Timestamptz // NULL: no access token yet
	write := func(id string, version int64, prev pgtype.Timestamptz, access string, expires pgtype.Timestamptz, refresh string) int64 {
		t.Helper()
		n, err := q.UpdateEmailHubAccountOAuthTokens(ctx, db.UpdateEmailHubAccountOAuthTokensParams{
			ID: id, OrganizationID: org, CredentialVersion: version, PrevExpiresAt: prev,
			AccessEnc: access, ExpiresAt: expires, RefreshEnc: refresh,
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	read := func(id string) db.EmailHubAccount {
		t.Helper()
		row, err := q.GetEmailHubAccountByID(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}

	first := at(time.Hour)
	if n := write(acc.ID, acc.CredentialVersion+1, never, "access-1", first, ""); n != 0 {
		t.Fatalf("a stale credential_version wrote %d rows", n)
	}
	if n := write(acc.ID, acc.CredentialVersion, first, "access-1", first, ""); n != 0 {
		t.Fatalf("a prev expiry the row does not hold wrote %d rows", n)
	}
	if n := write(acc.ID, acc.CredentialVersion, never, "access-1", first, ""); n != 1 {
		t.Fatalf("a NULL prev must match a NULL expiry, wrote %d rows", n)
	}
	row := read(acc.ID)
	if row.OauthAccessTokenEnc != "access-1" || !row.OauthAccessExpiresAt.Time.Equal(first.Time) ||
		row.OauthRefreshTokenEnc != "refresh-old" || row.CredentialVersion != acc.CredentialVersion {
		t.Fatalf("first write: access=%q expires=%v refresh=%q version=%d",
			row.OauthAccessTokenEnc, row.OauthAccessExpiresAt.Time, row.OauthRefreshTokenEnc, row.CredentialVersion)
	}

	second := at(2 * time.Hour)
	if n := write(acc.ID, acc.CredentialVersion, never, "access-2", second, ""); n != 0 {
		t.Fatalf("the NULL this pod read no longer holds, yet %d rows were written", n)
	}
	if n := write(acc.ID, acc.CredentialVersion, first, "access-2", second, "refresh-new"); n != 1 {
		t.Fatalf("a rotated refresh token over the read expiry wrote %d rows", n)
	}
	if row := read(acc.ID); row.OauthAccessTokenEnc != "access-2" || row.OauthRefreshTokenEnc != "refresh-new" ||
		row.CredentialVersion != acc.CredentialVersion {
		t.Fatalf("second write: access=%q refresh=%q version=%d", row.OauthAccessTokenEnc, row.OauthRefreshTokenEnc, row.CredentialVersion)
	}

	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: org, CredentialVersion: acc.CredentialVersion, Reason: "oauth_invalid_grant",
	}); err != nil {
		t.Fatalf("mark auth failed: %v", err)
	}
	// Same version, and the expiry is NULL again: only auth_failed_at stops this write.
	if n := write(acc.ID, acc.CredentialVersion, never, "access-3", second, ""); n != 0 {
		t.Fatalf("an account that needs reconnect took a token: %d rows", n)
	}

	gone := seedEmailHubAccountAddr(t, q, svc.box, user.ID, org, "gone@gmail.com")
	if _, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: gone.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	// The current version and expiry: only disconnected_at stops this write.
	if n := write(gone.ID, read(gone.ID).CredentialVersion, never, "access-1", first, ""); n != 0 {
		t.Fatalf("a disconnected account took a token: %d rows", n)
	}
}

// Each statement that removes a refresh token returns the one it removed, so
// the caller revokes exactly that token after commit (spec §2.3, §5.5).
func TestDisconnectReturnsPreviousRefreshToken(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	org := ws.OrganizationID
	assertCleared := func(acc db.EmailHubAccount, wantVersion int64) {
		t.Helper()
		row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if row.OauthRefreshTokenEnc != "" || row.OauthAccessTokenEnc != "" || row.OauthAccessExpiresAt.Valid || row.CredentialVersion != wantVersion {
			t.Fatalf("%s: refresh=%q access=%q expires=%v version=%d, want tokens cleared at version %d",
				acc.EmailAddress, row.OauthRefreshTokenEnc, row.OauthAccessTokenEnc, row.OauthAccessExpiresAt.Valid,
				row.CredentialVersion, wantVersion)
		}
	}

	one := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "one@gmail.com", "oauth_google", "refresh-one")
	params := db.DisconnectEmailHubAccountParams{ID: one.ID, UserID: user.ID, OrganizationID: org}
	got, err := q.DisconnectEmailHubAccount(ctx, params)
	if err != nil || got.AuthKind != "oauth_google" || got.OauthRefreshTokenEnc != one.OauthRefreshTokenEnc {
		t.Fatalf("disconnect returned auth_kind=%q same_token=%v err=%v; want the sealed token it removed",
			got.AuthKind, got.OauthRefreshTokenEnc == one.OauthRefreshTokenEnc, err)
	}
	assertCleared(one, one.CredentialVersion+1)
	if _, err := q.DisconnectEmailHubAccount(ctx, params); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a second disconnect: err=%v, want pgx.ErrNoRows", err)
	}

	two := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "two@gmail.com", "oauth_google", "refresh-two")
	three := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "three@outlook.com", "oauth_microsoft", "refresh-three")
	rows, err := q.DisconnectEmailHubAccountsForUser(ctx, db.DisconnectEmailHubAccountsForUserParams{
		UserID: user.ID, OrganizationID: pgtype.Text{String: org, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]db.DisconnectEmailHubAccountsForUserRow{
		two.ID:   {ID: two.ID, OrganizationID: org, AuthKind: "oauth_google", OauthRefreshTokenEnc: two.OauthRefreshTokenEnc},
		three.ID: {ID: three.ID, OrganizationID: org, AuthKind: "oauth_microsoft", OauthRefreshTokenEnc: three.OauthRefreshTokenEnc},
	}
	if len(rows) != len(want) {
		t.Fatalf("disconnect for user returned %d rows, want %d (the disconnected one is not live)", len(rows), len(want))
	}
	for _, r := range rows {
		if want[r.ID] != r {
			t.Fatalf("row %s: got auth_kind=%q, want the old auth kind and sealed token", r.ID, r.AuthKind)
		}
	}
	assertCleared(two, two.CredentialVersion+1)
	assertCleared(three, three.CredentialVersion+1)

	four := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "four@gmail.com", "oauth_google", "refresh-four")
	mark := db.MarkEmailHubAccountAuthFailedParams{
		ID: four.ID, OrganizationID: org, CredentialVersion: four.CredentialVersion + 1, Reason: "imap_auth_failed",
	}
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, mark); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a stale snapshot marked the account: err=%v, want pgx.ErrNoRows", err)
	}
	mark.CredentialVersion = four.CredentialVersion
	marked, err := q.MarkEmailHubAccountAuthFailed(ctx, mark)
	if err != nil || marked.AuthKind != "oauth_google" || marked.OauthRefreshTokenEnc != four.OauthRefreshTokenEnc {
		t.Fatalf("mark returned auth_kind=%q same_token=%v err=%v; want the sealed token it removed",
			marked.AuthKind, marked.OauthRefreshTokenEnc == four.OauthRefreshTokenEnc, err)
	}
	assertCleared(four, four.CredentialVersion) // only a reconnect bumps the version
}
