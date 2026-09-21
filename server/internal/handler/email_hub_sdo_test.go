package handler

import (
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
