package service

// ARCHIVE-01 (UNI-1845) SH-6: the change feed surfaces the shelf transition.
// document.shelved / document.unshelved are feed actions, so the transition
// reaches a caller as an upsert carrying shelved (never a removal and never
// silence): desktop flips the local copy read-only on the flag.

import (
	"testing"
)

func TestShelvedDocumentChangeFeed(t *testing.T) {
	w := newFeedWorld(t, "shfeed")

	t.Run("SH-6: document.shelved and document.unshelved are feed actions", func(t *testing.T) {
		if !feedDocumentActions["document.shelved"] || !feedDocumentActions["document.unshelved"] {
			t.Fatal("shelve/unshelve are not feed actions: a shelf transition would never reach the client")
		}
	})

	t.Run("SH-6: a shelve after the snapshot is an upsert carrying shelved", func(t *testing.T) {
		doc := w.createPage(t, "will be shelved")
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if !held[doc.ID] {
			t.Fatal("the document is missing from the snapshot")
		}
		if _, err := w.f.svc.ShelveDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("shelve: %v", err)
		}
		rows := feedRowsByDoc(w.drainFeed(t, feedCursor, 100))
		row, ok := rows[doc.ID]
		if !ok {
			t.Fatalf("no feed row for shelved document %s: %v", doc.ID, rows)
		}
		if row.ChangeKind != DocumentChangeKindUpsert || !row.Shelved || row.Archived {
			t.Fatalf("shelve feed row = %+v, want upsert shelved=true archived=false", row)
		}

		// The end cursor after the shelve: drainFeed drops it, so page it by
		// hand once.
		end := feedCursor
		for i := 0; ; i++ {
			page, err := w.list(t, w.tn.member.ID, end, 100)
			if err != nil {
				t.Fatalf("feed page %d: %v", i, err)
			}
			if !page.HasMore {
				end = page.NextCursor
				break
			}
			end = page.NextCursor
			if i > 20 {
				t.Fatal("feed never ended")
			}
		}
		if _, err := w.f.svc.UnshelveDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("unshelve: %v", err)
		}
		rows = feedRowsByDoc(w.drainFeed(t, end, 100))
		row, ok = rows[doc.ID]
		if !ok {
			t.Fatalf("no feed row for unshelved document %s", doc.ID)
		}
		if row.ChangeKind != DocumentChangeKindUpsert || row.Shelved {
			t.Fatalf("unshelve feed row = %+v, want upsert shelved=false", row)
		}
	})

	t.Run("SH-6: a shelved document still lands in a fresh snapshot", func(t *testing.T) {
		doc := w.createPage(t, "shelved before snapshot")
		if _, err := w.f.svc.ShelveDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatalf("shelve: %v", err)
		}
		_, held := w.snapshotThenFeed(t, 200)
		if !held[doc.ID] {
			t.Fatal("a shelved document is missing from the snapshot - it stays a read-only mirror row, only trashed rows leave")
		}
	})
}
