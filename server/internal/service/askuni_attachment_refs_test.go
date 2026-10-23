package service

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The collector deletes any file no provider holds, so these rows decide
// whether a file an Ask UNI question still carries survives. The queries are
// tenant-scoped; each scope is checked with a caller that differs in one key.
func TestAskUniAttachmentHoldsAndQueries(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	org, ws, user := util.NewID(), util.NewID(), util.NewID()
	convA, convB := util.NewID(), util.NewID()
	msg := util.NewID()
	insert := func(orgID, convID, messageID string) db.AiInsertAttachmentParams {
		t.Helper()
		p := db.AiInsertAttachmentParams{
			ID: util.NewID(), OrganizationID: orgID, WorkspaceID: ws, UserID: user,
			ConversationID: convID, MessageID: messageID, FileID: util.NewID(),
			Name: "a.pdf", Mime: "application/pdf", SizeBytes: 10, Kind: "pdf",
		}
		if err := q.AiInsertAttachment(ctx, p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	first, second, third := insert(org, convA, msg), insert(org, convA, msg), insert(org, convA, msg)
	other := insert(org, convB, util.NewID())
	foreign := insert(util.NewID(), convA, msg) // another organization, same conversation and message ids

	// created_at then id: the first row is the newest, the other two share a
	// timestamp, so the id breaks their tie.
	base := time.Now().UTC().Truncate(time.Second)
	for id, at := range map[string]time.Time{first.ID: base, second.ID: base.Add(-time.Hour), third.ID: base.Add(-time.Hour)} {
		if _, err := pool.Exec(ctx, `UPDATE ai_attachments SET created_at = $2 WHERE id = $1`, id, at); err != nil {
			t.Fatal(err)
		}
	}
	tie := []string{second.ID, third.ID}
	slices.Sort(tie)
	want := append(tie, first.ID)
	rows, err := q.AiListAttachmentsForMessages(ctx, db.AiListAttachmentsForMessagesParams{OrganizationID: org, MessageIds: []string{msg}})
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, len(rows))
	for i, r := range rows {
		got[i] = r.ID
	}
	if !slices.Equal(got, want) {
		t.Fatalf("AiListAttachmentsForMessages = %v, want %v (created_at, id; other organization's row excluded)", got, want)
	}

	// The provider holds what a row names and nothing else.
	held, err := AskUniAttachmentProvider{}.HeldBy(ctx, q, []files.FileID{files.FileID(first.FileID), files.FileID(foreign.FileID), "absent"})
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 2 || held[files.FileID(first.FileID)] != files.HoldActive || held[files.FileID(foreign.FileID)] != files.HoldActive {
		t.Fatalf("HeldBy = %v, want both stored files held active and the absent id not held", held)
	}

	// The owner reads their own row; a change of user, workspace or
	// organization finds nothing.
	own := db.AiGetUserAttachmentParams{OrganizationID: org, WorkspaceID: ws, UserID: user, ID: first.ID}
	if r, err := q.AiGetUserAttachment(ctx, own); err != nil || r.FileID != first.FileID || r.Kind != "pdf" {
		t.Fatalf("owner read = %+v err=%v", r, err)
	}
	for name, p := range map[string]db.AiGetUserAttachmentParams{
		"other user":      {OrganizationID: org, WorkspaceID: ws, UserID: util.NewID(), ID: first.ID},
		"other workspace": {OrganizationID: org, WorkspaceID: util.NewID(), UserID: user, ID: first.ID},
		"other org":       {OrganizationID: util.NewID(), WorkspaceID: ws, UserID: user, ID: first.ID},
	} {
		if _, err := q.AiGetUserAttachment(ctx, p); !errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("%s: err = %v, want pgx.ErrNoRows", name, err)
		}
	}

	// A delete is scoped to the organization and the conversation, returns the
	// file ids to release, and lets go of the holds.
	if ids, err := q.AiDeleteConversationAttachments(ctx, db.AiDeleteConversationAttachmentsParams{OrganizationID: util.NewID(), ConversationID: convA}); err != nil || len(ids) != 0 {
		t.Fatalf("delete from another organization = %v err=%v, want nothing", ids, err)
	}
	ids, err := q.AiDeleteConversationAttachments(ctx, db.AiDeleteConversationAttachmentsParams{OrganizationID: org, ConversationID: convA})
	if err != nil {
		t.Fatal(err)
	}
	wantIDs := []string{first.FileID, second.FileID, third.FileID}
	slices.Sort(ids)
	slices.Sort(wantIDs)
	if !slices.Equal(ids, wantIDs) {
		t.Fatalf("deleted file ids = %v, want %v", ids, wantIDs)
	}
	held, err = AskUniAttachmentProvider{}.HeldBy(ctx, q, []files.FileID{files.FileID(first.FileID), files.FileID(second.FileID), files.FileID(other.FileID), files.FileID(foreign.FileID)})
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 2 || held[files.FileID(other.FileID)] != files.HoldActive || held[files.FileID(foreign.FileID)] != files.HoldActive {
		t.Fatalf("HeldBy after delete = %v, want only the other conversation's and the other organization's files", held)
	}
}
