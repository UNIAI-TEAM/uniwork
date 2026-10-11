package handler

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestToEmailHubSDO(t *testing.T) {
	t.Parallel()
	syncAt := time.Date(2026, 9, 18, 4, 0, 0, 0, time.UTC)
	acc := toEmailHubAccountSDO(service.EmailHubAccountView{
		ID: "acc-1", EmailAddress: "a@b.co", Provider: "gmail",
		ConnectedAt: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
		LastSyncAt:  &syncAt,
	})
	if acc.LastSyncAt == "" || acc.ConnectedAt == "" {
		t.Fatalf("account sdo timestamps: %+v", acc)
	}
	noSync := toEmailHubAccountSDO(service.EmailHubAccountView{
		ID: "acc-2", EmailAddress: "b@b.co", Provider: "gmail",
		ConnectedAt: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
	})
	if noSync.LastSyncAt != "" {
		t.Fatalf("expected empty last sync: %+v", noSync)
	}

	thread := toEmailHubThreadSDO(service.EmailHubThreadView{
		ID: "t1", AccountID: "acc-1", Folder: "INBOX", Subject: "Hi", Snippet: "hello",
		FromAddr: "a@b.co", FromName: "Alice", ToAddrs: []string{"b@b.co"},
		SentAt: time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC),
		IsRead: true, IsStarred: true, HasAttachments: true, BodyCached: true,
		BodyText: "text", BodyHTML: "<p>html</p>",
		Attachments: []service.EmailHubAttachmentView{
			{ID: "att-1", Filename: "doc.pdf", MimeType: "application/pdf", SizeBytes: 99},
		},
	})
	if len(thread.Attachments) != 1 || thread.Attachments[0].Filename != "doc.pdf" {
		t.Fatalf("thread attachments sdo: %+v", thread.Attachments)
	}
	if thread.FromName != "Alice" || !thread.IsStarred {
		t.Fatalf("thread sdo fields: %+v", thread)
	}
}

// The account the list and connect return carries the server settings the
// reconnect form refills, and never a secret (spec §5.1).
func TestEmailHubAccountSDOCarriesServerSettingsNotSecrets(t *testing.T) {
	t.Parallel()
	raw, err := json.Marshal(toEmailHubAccountSDO(service.EmailHubAccountView{
		ID: "acc-1", EmailAddress: "me@acme.example", Provider: "custom", AuthKind: "password",
		ConnectedAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		ImapHost:    "mail.acme.example", ImapPort: 143, ImapSecurity: "starttls",
		SmtpHost: "smtp.acme.example", SmtpPort: 465, SmtpSecurity: "tls", Username: "mailuser",
	}))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"imap_host": "mail.acme.example", "imap_port": float64(143), "imap_security": "starttls",
		"smtp_host": "smtp.acme.example", "smtp_port": float64(465), "smtp_security": "tls",
		"username": "mailuser",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	for _, k := range []string{"password", "password_enc", "app_password"} {
		if _, ok := got[k]; ok {
			t.Errorf("account JSON carries %q", k)
		}
	}
}
