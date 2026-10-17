package service

// G1-04b (UNI-678) worker tests: the auto-version pass stamps a quiet page
// exactly once (last_version_at is the idempotency marker), and Run joins
// the shutdown sequence on context cancel.

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
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

func TestDocumentWorkersCommitIntentSweepTick(t *testing.T) {
	t.Run("unset policy keeps commitIntentSweepTick default", func(t *testing.T) {
		svc := NewDocumentService(nil, nil, nil, nil)
		w := svc.NewDocumentWorkers()
		if w.IntentTick != 0 {
			t.Fatalf("IntentTick = %v, want 0 when policy SweepTick is unset", w.IntentTick)
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		var mu sync.Mutex
		var ticks []time.Duration
		w.after = func(d time.Duration) <-chan time.Time {
			mu.Lock()
			ticks = append(ticks, d)
			if slices.Contains(ticks, commitIntentSweepTick) {
				cancel()
			}
			mu.Unlock()
			return make(chan time.Time)
		}
		w.Run(ctx)
		if !slices.Contains(ticks, commitIntentSweepTick) {
			t.Fatalf("observed ticks %v, want default %v (%v)", ticks, commitIntentSweepTick, 10*time.Minute)
		}
	})

	t.Run("configured policy SweepTick threads into NewDocumentWorkers and Run", func(t *testing.T) {
		const customTick = 15 * time.Millisecond
		svc := NewDocumentService(nil, nil, nil, nil)
		svc.SetCommitIntentPolicy(CommitIntentPolicy{SweepTick: customTick})
		w := svc.NewDocumentWorkers()
		if w.IntentTick != customTick {
			t.Fatalf("NewDocumentWorkers().IntentTick = %v, want %v", w.IntentTick, customTick)
		}

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		var mu sync.Mutex
		var ticks []time.Duration
		intentPasses := 0
		w.swept = func(kind string, err error) {
			if kind != "commit_intent" {
				return
			}
			if err != nil {
				t.Errorf("commit_intent sweep error: %v", err)
			}
			mu.Lock()
			intentPasses++
			if intentPasses >= 3 {
				cancel()
			}
			mu.Unlock()
		}
		w.after = func(d time.Duration) <-chan time.Time {
			mu.Lock()
			ticks = append(ticks, d)
			mu.Unlock()
			if d == customTick {
				ch := make(chan time.Time, 1)
				time.AfterFunc(customTick, func() { ch <- time.Now() })
				return ch
			}
			return make(chan time.Time)
		}
		w.Run(ctx)
		if intentPasses < 3 {
			t.Fatalf("commit_intent passes = %d, want at least 3 on %v tick", intentPasses, customTick)
		}
		if !slices.Contains(ticks, customTick) {
			t.Fatalf("observed ticks %v, want %v", ticks, customTick)
		}
		if slices.Contains(ticks, commitIntentSweepTick) {
			t.Fatalf("observed ticks %v still used default %v instead of override %v", ticks, commitIntentSweepTick, customTick)
		}
	})
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

// BIGUP S1-b (R1-11): the running worker, not a direct call, must be what
// expires an expired multipart session: parts aborted, quota released, row
// terminal and the system audit row written.
func TestDocumentWorkersRunExpiresMultipartUpload(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	_, probe := buildLargePDF(size, "worker-gc")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:       "worker-gc.pdf",
		SizeBytes:      size,
		Probe:          probe,
		IdempotencyKey: nextIDK(),
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if used, _ := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID); used != size {
		t.Fatalf("reserved bytes = %d, want %d", used, size)
	}

	// Push the session past expires_at, then run the real worker for one
	// commit_intent pass on a fake clock.
	env.clock.Advance(UploadSessionTTL + time.Hour)
	w := env.svc.NewDocumentWorkers()
	w.now = env.clock.Now
	w.after = func(time.Duration) <-chan time.Time { return make(chan time.Time) }

	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		w.Run(runCtx)
	}()
	swept := make(chan error, 8)
	w.swept = func(kind string, err error) {
		if kind == "commit_intent" {
			swept <- err
		}
	}
	select {
	case serr := <-swept:
		if serr != nil {
			t.Fatalf("commit_intent sweep: %v", serr)
		}
	case <-time.After(30 * time.Second):
		cancel()
		t.Fatal("commit_intent sweep did not run")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("worker did not stop on cancel")
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "expired" {
		t.Fatalf("session status = %q, want expired", row.Status)
	}
	env.store.mu.Lock()
	aborts := env.store.abortsByKey[row.ObjectKey]
	env.store.mu.Unlock()
	if aborts != 1 {
		t.Fatalf("aborts for %s = %d, want 1", row.ObjectKey, aborts)
	}
	if used, _ := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID); used != 0 {
		t.Fatalf("reserved bytes after expiry = %d, want 0", used)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, opened.SessionID); n != 1 {
		t.Fatalf("expired audit rows = %d, want 1", n)
	}
}
