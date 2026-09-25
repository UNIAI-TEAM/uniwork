package service

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestEmailHubViewHelpers(t *testing.T) {
	t.Parallel()
	if got := cleanEmailList([]string{" A@B.co ", "", "C@D.co"}); len(got) != 2 || got[0] != "a@b.co" {
		t.Fatalf("cleanEmailList: %v", got)
	}
	if got := replySubject("Hello"); got != "Re: Hello" {
		t.Fatalf("replySubject prefix: %q", got)
	}
	if got := replySubject("Re: Hello"); got != "Re: Hello" {
		t.Fatalf("replySubject keeps re: %q", got)
	}
	if got := normalizeEmailHubFolder(""); got != emailHubFolderInbox {
		t.Fatalf("normalize empty folder: %q", got)
	}
	if got := backfillMailboxFolder(emailHubFolderInbox); got != emailHubFolderInbox {
		t.Fatalf("backfill inbox folder: %q", got)
	}
}

func TestAccountAndThreadViews(t *testing.T) {
	t.Parallel()
	syncRaw, err := json.Marshal(emailHubSyncState{
		emailHubFolderInbox: {LastSyncAt: "2026-09-18T04:00:00Z"},
	})
	if err != nil {
		t.Fatal(err)
	}
	acc := accountView(db.EmailHubAccount{
		ID: "acc-1", EmailAddress: "a@b.co", Provider: "gmail",
		CreatedAt: pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), Valid: true},
		SyncState: syncRaw,
	})
	if acc.ID != "acc-1" || acc.LastSyncAt == nil {
		t.Fatalf("account view: %+v", acc)
	}

	thread := threadView(db.EmailHubThread{
		ID: "t1", AccountID: "acc-1", Folder: emailHubFolderInbox, Subject: "Hi",
		Snippet: "hello", FromAddr: "a@b.co", ToAddrs: []string{"b@b.co"},
		SentAt:   pgtype.Timestamptz{Time: time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC), Valid: true},
		FromName: pgtype.Text{String: "Alice", Valid: true},
		BodyText: pgtype.Text{String: "Body", Valid: true},
	})
	if thread.FromName != "Alice" || thread.BodyText != "Body" {
		t.Fatalf("thread view: %+v", thread)
	}

	att := attachmentView(db.EmailHubAttachment{
		ID: "att-1", ThreadID: "t1", Filename: "doc.pdf", MimeType: "application/pdf", SizeBytes: 42, PartID: "1",
	})
	if att.Filename != "doc.pdf" || att.SizeBytes != 42 {
		t.Fatalf("attachment view: %+v", att)
	}
}

func TestShouldInvalidateCachedBody(t *testing.T) {
	t.Parallel()
	shortSent := EmailHubThreadView{
		Folder: emailhub.FolderSent, Snippet: "hehe", BodyText: "hehe", BodyCached: true,
	}
	if shouldInvalidateCachedBody(shortSent) {
		t.Fatal("expected sent short body to stay cached")
	}
	inboxPlaceholder := EmailHubThreadView{
		Folder: emailhub.FolderInbox, Snippet: "Hello team", BodyText: "Hello team", BodyCached: true,
	}
	if !shouldInvalidateCachedBody(inboxPlaceholder) {
		t.Fatal("expected inbox snippet placeholder to invalidate")
	}
}

func TestSentMessageHTML(t *testing.T) {
	t.Parallel()
	got := sentMessageHTML("hehe\nline2")
	if !strings.Contains(got, "hehe") || !strings.Contains(got, "<br>") {
		t.Fatalf("expected escaped html body, got %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Fatalf("expected newlines converted, got %q", got)
	}
}

func TestEmailHubServiceEnabledAndOpenPassword(t *testing.T) {
	t.Parallel()
	disabled := NewEmailHubService(nil, nil, nil)
	if disabled.Enabled() {
		t.Fatal("expected disabled without secretbox")
	}

	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	enabled := NewEmailHubService(nil, nil, box)
	if !enabled.Enabled() {
		t.Fatal("expected enabled with secretbox")
	}
	sealed, err := box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := enabled.openPassword(base64.StdEncoding.EncodeToString(sealed))
	if err != nil || got != "app-password" {
		t.Fatalf("openPassword: %q err=%v", got, err)
	}
}
