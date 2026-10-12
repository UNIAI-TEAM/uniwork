package notification

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func seedEmailHubNewMail(t *testing.T, f *fixture) db.EmailHubAccount {
	t.Helper()
	account, err := f.q.CreateEmailHubAccount(f.ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: f.member.ID, OrganizationID: f.orgID,
		EmailAddress: f.member.Email, Provider: "gmail",
		ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 587, SmtpSecurity: "starttls",
		Username: f.member.Email, AuthKind: "password", PasswordEnc: "test-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.UpsertEmailHubThread(f.ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: account.ID, OrganizationID: f.orgID,
		Folder: "INBOX", ImapUid: 1, Subject: "New mail", Snippet: "hello",
		FromAddr: "sender@example.com", ToAddrs: []string{f.member.Email},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		ImapLabels: []string{},
	}); err != nil {
		t.Fatal(err)
	}
	return account
}

func emailHubNewMailEvent(f *fixture, accountID string) db.OutboxEvent {
	return db.OutboxEvent{
		ID:      util.NewID(),
		Topic:   "email_hub.new_mail",
		Payload: `{"account_id":"` + accountID + `","user_id":"` + f.member.ID + `"}`,
	}
}

func TestEmailHubNewMailRequiresCurrentOrganizationMembership(t *testing.T) {
	tests := []struct {
		name   string
		revoke func(*testing.T, *fixture)
	}{
		{
			name: "member left organization",
			revoke: func(t *testing.T, f *fixture) {
				t.Helper()
				if err := f.q.DeleteWorkspaceMembershipsInOrg(f.ctx, db.DeleteWorkspaceMembershipsInOrgParams{
					OrganizationID: f.orgID, UserID: f.member.ID,
				}); err != nil {
					t.Fatal(err)
				}
				if err := f.q.DeleteOrganizationMember(f.ctx, db.DeleteOrganizationMemberParams{
					OrganizationID: f.orgID, UserID: f.member.ID,
				}); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "member deactivated",
			revoke: func(t *testing.T, f *fixture) {
				t.Helper()
				if _, err := f.q.SetOrganizationMemberDeactivated(f.ctx, db.SetOrganizationMemberDeactivatedParams{
					OrganizationID: f.orgID, UserID: f.member.ID,
					DeactivatedBy: pgtype.Text{String: f.owner.ID, Valid: true},
				}); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "organization suspended",
			revoke: func(t *testing.T, f *fixture) {
				t.Helper()
				if _, err := f.q.AdminSetOrganizationStatus(f.ctx, db.AdminSetOrganizationStatusParams{
					ID: f.orgID, Status: "suspended",
					SuspendedAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
					SuspendedReason: pgtype.Text{String: "notification membership test", Valid: true},
				}); err != nil {
					t.Fatal(err)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFixture(t)
			account := seedEmailHubNewMail(t, f)
			tt.revoke(t, f)

			if err := f.consumer.Handle(f.ctx, emailHubNewMailEvent(f, account.ID)); err != nil {
				t.Fatal(err)
			}
			if got := f.inbox(t, f.member.ID); len(got) != 0 {
				t.Fatalf("revoked member received email notification: %+v", got)
			}
			if got := f.events(t, TopicPush); len(got) != 0 {
				t.Fatalf("revoked member received push event: %+v", got)
			}
		})
	}
}

func TestEmailHubNewMailAllowsOrganizationMemberWithoutWorkspace(t *testing.T) {
	f := newFixture(t)
	account := seedEmailHubNewMail(t, f)
	if err := f.q.DeleteWorkspaceMembershipsInOrg(f.ctx, db.DeleteWorkspaceMembershipsInOrgParams{
		OrganizationID: f.orgID, UserID: f.member.ID,
	}); err != nil {
		t.Fatal(err)
	}

	if err := f.consumer.Handle(f.ctx, emailHubNewMailEvent(f, account.ID)); err != nil {
		t.Fatal(err)
	}
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindEmailHubNewMail || got[0].WorkspaceID.Valid {
		t.Fatalf("organization-level email notification = %+v", got)
	}
}

func TestEmailHubNewMailRejectsRevokedWorkspaceScope(t *testing.T) {
	f := newFixture(t)
	account := seedEmailHubNewMail(t, f)
	if err := f.q.DeleteWorkspaceMembershipsInOrg(f.ctx, db.DeleteWorkspaceMembershipsInOrgParams{
		OrganizationID: f.orgID, UserID: f.member.ID,
	}); err != nil {
		t.Fatal(err)
	}

	ev := emailHubNewMailEvent(f, account.ID)
	ev.Payload = `{"account_id":"` + account.ID + `","user_id":"` + f.member.ID + `","workspace_id":"` + f.wsID + `"}`
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if got := f.inbox(t, f.member.ID); len(got) != 0 {
		t.Fatalf("revoked workspace member received email notification: %+v", got)
	}
}
