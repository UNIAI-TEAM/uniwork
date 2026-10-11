package service

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

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
	}); err != nil {
		t.Fatal(err)
	}

	mark := func(version int64) int64 {
		t.Helper()
		n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: org, CredentialVersion: version, Reason: "imap_auth_failed",
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
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

	if n, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: acc.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil || n != 1 {
		t.Fatalf("disconnect: n=%d err=%v", n, err)
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
