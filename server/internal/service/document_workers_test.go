package service

// G1-04b (UNI-678) worker tests: the auto-version pass stamps a quiet page
// exactly once (last_version_at is the idempotency marker), and Run joins
// the shutdown sequence on context cancel.

import (
	"context"
	"testing"
	"time"
)

func countVersions(t *testing.T, f *docPermFixture, documentID, reason string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM document_versions WHERE document_id = $1 AND reason = $2`,
		documentID, reason).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDocumentWorkers(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "wrk")
	f.svc.SetFiles(&releaseSpy{})

	t.Run("a quiet page versions once; retries never duplicate", func(t *testing.T) {
		now := time.Now()
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			contentText: "nội dung", contentSavedAt: now.Add(-20 * time.Minute)})
		if _, err := f.svc.autoVersionOne(f.ctx, doc.ID, tn.orgID, tn.wsA, now); err != nil {
			t.Fatal(err)
		}
		if n := countVersions(t, f, doc.ID, "auto"); n != 1 {
			t.Fatalf("auto versions = %d, want 1", n)
		}
		// The marker moved: a retry over the same page is a no-op.
		d, err := f.q.GetDocumentByID(f.ctx, doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !d.LastVersionAt.Valid {
			t.Fatal("last_version_at not stamped")
		}
		if _, err := f.svc.autoVersionOne(f.ctx, doc.ID, tn.orgID, tn.wsA, now); err != nil {
			t.Fatal(err)
		}
		if n := countVersions(t, f, doc.ID, "auto"); n != 1 {
			t.Fatalf("retry duplicated: auto versions = %d", n)
		}
	})

	t.Run("a page saved inside the quiet window is skipped", func(t *testing.T) {
		now := time.Now()
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			contentText: "mới", contentSavedAt: now.Add(-time.Minute)})
		if _, err := f.svc.autoVersionOne(f.ctx, doc.ID, tn.orgID, tn.wsA, now); err != nil {
			t.Fatal(err)
		}
		if n := countVersions(t, f, doc.ID, "auto"); n != 0 {
			t.Fatalf("auto versions = %d, want 0 inside the quiet window", n)
		}
	})

	t.Run("the sweep pass finds the quiet page without a real clock", func(t *testing.T) {
		fixed := time.Now()
		f.svc.SetClock(func() time.Time { return fixed })
		t.Cleanup(func() { f.svc.SetClock(nil) })
		doc := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID,
			contentText: "quét", contentSavedAt: fixed.Add(-30 * time.Minute)})
		w := f.svc.NewDocumentWorkers()
		if failed, err := w.autoVersionPass(f.ctx); err != nil || failed != 0 {
			t.Fatalf("pass: failed=%d err=%v", failed, err)
		}
		if n := countVersions(t, f, doc.ID, "auto"); n != 1 {
			t.Fatalf("sweep made %d auto versions, want 1", n)
		}
		// A second pass over the same clock finds nothing to do.
		if failed, err := w.autoVersionPass(f.ctx); err != nil || failed != 0 {
			t.Fatalf("second pass: failed=%d err=%v", failed, err)
		}
		if n := countVersions(t, f, doc.ID, "auto"); n != 1 {
			t.Fatalf("second sweep duplicated: %d auto versions", n)
		}
	})

	t.Run("Run stops on context cancel", func(t *testing.T) {
		w := f.svc.NewDocumentWorkers()
		ctx, cancel := context.WithCancel(f.ctx)
		done := make(chan struct{})
		go func() {
			w.Run(ctx)
			close(done)
		}()
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Fatal("worker did not stop on cancel")
		}
	})
}
