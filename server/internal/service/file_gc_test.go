package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Collector tests (T5, UNI-743): every one runs the real FileService on the
// test database and the local adapter, with the service clock under test
// control. Barrier tests park one actor behind the other's row lock and check
// pg_stat_activity before letting go, so the order is proven, not timed.

func TestFileGCDefaultIsDryRunAndWritesNothing(t *testing.T) {
	h := newGCHarness(t, "")
	if h.svc.gc.Mode != FileGCDryRun {
		t.Fatalf("default mode = %s, want dry_run", h.svc.gc.Mode)
	}
	id := h.claimedAndReleased(t, "dry-1", time.Hour)
	h.clock.Advance(25 * time.Hour)

	rep := h.sweep(t)
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCWouldDelete {
		t.Fatalf("dry-run entry = %+v, want would_delete", e)
	}
	row := h.wantStatus(t, id, files.StatusReady)
	if !h.objectExists(t, row) {
		t.Fatal("dry-run removed the object")
	}
	job := h.liveJob(t, id, fileJobCleanup)
	if job.Status != "pending" || job.Attempt != 0 || job.Generation != 0 {
		t.Fatalf("dry-run touched the job: %+v", job)
	}
}

func TestFileGCOffDoesNothing(t *testing.T) {
	h := newGCHarness(t, FileGCOff)
	rep := h.sweep(t)
	if rep.Skipped != "disabled" || len(rep.Entries) != 0 {
		t.Fatalf("off sweep = %+v", rep)
	}
}

// T1-Q5: a canceled upload is garbage 24 hours after ready, not 24 hours
// after the cancel.
func TestFileGCCancelDoesNotResetAge(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	up := t3UploadOK(t, h.fileHarness, "cancel-age")
	h.clock.Advance(23 * time.Hour)
	if err := h.svc.CancelUpload(context.Background(), files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: up.File.ID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	h.clock.Advance(30 * time.Minute) // ready + 23h30m: not yet
	rep := h.sweep(t)
	for _, e := range rep.Entries {
		if e.FileID == up.File.ID && e.Action == FileGCDeleted {
			t.Fatal("collected before ready + 24h")
		}
	}
	h.wantStatus(t, up.File.ID, files.StatusReady)

	h.clock.Advance(31 * time.Minute) // ready + 24h01m, one hour after the cancel
	rep = h.sweep(t)
	if e := entry(t, rep, up.File.ID, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("entry = %+v, want deleted", e)
	}
	row := h.wantStatus(t, up.File.ID, files.StatusDeleted)
	if h.objectExists(t, row) {
		t.Fatal("object survived the delete")
	}
	if !row.ReadyAt.Time.Equal(up.File.ReadyAt) {
		t.Fatalf("ready_at moved: %s -> %s", up.File.ReadyAt, row.ReadyAt.Time)
	}
}

// T1-Q5: an upload nobody claims is closed by the sweep after its window and
// collected in the same pass.
func TestFileGCExpiresUnclaimedUploads(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	up := t3UploadOK(t, h.fileHarness, "unclaimed")
	h.clock.Advance(12 * time.Hour)
	rep := h.sweep(t)
	if rep.SessionsExpired != 0 {
		t.Fatalf("expired %d sessions inside the window", rep.SessionsExpired)
	}
	h.clock.Advance(12*time.Hour + time.Minute)
	rep = h.sweep(t)
	if rep.SessionsExpired != 1 {
		t.Fatalf("expired sessions = %d, want 1", rep.SessionsExpired)
	}
	h.wantStatus(t, up.File.ID, files.StatusDeleted)
}

// T1-Q6: the last reference going away makes the file garbage on the next
// sweep once it is past ready + 24h - no extra wait after the unlink - and a
// younger file waits exactly until ready + 24h.
func TestFileGCLastReferenceGone(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	old := h.claimedAndReleased(t, "old-ref", 30*time.Hour)
	rep := h.sweep(t)
	if e := entry(t, rep, old, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("old file entry = %+v, want deleted right after the unlink", e)
	}

	young := h.claimedAndReleased(t, "young-ref", time.Hour)
	readyAt := h.file(t, young).ReadyAt.Time
	rep = h.sweep(t)
	e := entry(t, rep, young, fileJobCleanup)
	if e.Action != FileGCRetry || e.Reason != "too_young" {
		t.Fatalf("young file entry = %+v, want retry too_young", e)
	}
	if job := h.liveJob(t, young, fileJobCleanup); !job.NextAttemptAt.Time.Equal(readyAt.Add(24 * time.Hour)) {
		t.Fatalf("next attempt = %s, want ready + 24h %s", job.NextAttemptAt.Time, readyAt.Add(24*time.Hour))
	}
	h.until(readyAt.Add(24 * time.Hour))
	rep = h.sweep(t)
	if e := entry(t, rep, young, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("young file at ready + 24h = %+v, want deleted", e)
	}
}

// avatarFixture: an account avatar claimed by a users row and released
// again, 25 hours old - garbage unless someone attaches it again.
func avatarFixture(t *testing.T, h *gcHarness) files.FileID {
	t.Helper()
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, 'gc@example.com', 'x', 'GC')`, t3User); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	up, err := t3Upload(t, h.fileHarness, files.UserAvatar, files.Scope{UserID: t3User}, "avatar-1", "me.png", t3PNG)
	if err != nil {
		t.Fatalf("avatar upload: %v", err)
	}
	if err := h.tx(t, func(tx pgx.Tx, q *db.Queries) error { return attachAvatar(ctx, h, tx, q, up.File.ID) }); err != nil {
		t.Fatalf("attach: %v", err)
	}
	if err := h.tx(t, func(tx pgx.Tx, q *db.Queries) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET avatar_file_id = NULL WHERE id = $1`, t3User); err != nil {
			return err
		}
		return h.svc.ReleaseInTx(ctx, q, []files.FileID{up.File.ID})
	}); err != nil {
		t.Fatalf("detach: %v", err)
	}
	h.clock.Advance(25 * time.Hour)
	return up.File.ID
}

func attachAvatar(ctx context.Context, h *gcHarness, tx pgx.Tx, q *db.Queries, id files.FileID) error {
	if _, err := h.svc.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: t3Actor, Purpose: files.UserAvatar, Scope: files.Scope{UserID: t3User}, FileIDs: []files.FileID{id},
	}); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE users SET avatar_file_id = $1 WHERE id = $2`, string(id), t3User)
	return err
}

// Barrier: the claim holds the file lock first. The collector waits on it,
// then re-reads the providers after the lock and sees the new reference.
func TestFileGCBarrierClaimWins(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	id := avatarFixture(t, h)
	ctx := context.Background()

	// The collector has leased the cleanup job; the claim takes the file
	// lock before the collector's batch does.
	leased, proceed := make(chan struct{}), make(chan struct{})
	var once sync.Once
	h.svc.gcHooks.beforeBatchLock = func() {
		once.Do(func() {
			close(leased)
			<-proceed
		})
	}
	done := make(chan *FileGCReport, 1)
	go func() {
		rep, err := h.svc.SweepFiles(ctx)
		if err != nil {
			t.Errorf("sweep: %v", err)
		}
		done <- rep
	}()
	<-leased
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := attachAvatar(ctx, h, tx, db.New(h.pool).WithTx(tx), id); err != nil {
		t.Fatalf("attach in open tx: %v", err)
	}
	close(proceed)
	h.waitForLockWaiter(t)
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit claim: %v", err)
	}
	rep := <-done
	e := entry(t, rep, id, fileJobCleanup)
	if e.Action != FileGCHeld || e.Reason != "held:users.avatar:active" {
		t.Fatalf("entry = %+v, want held by users.avatar", e)
	}
	row := h.wantStatus(t, id, files.StatusReady)
	if !h.objectExists(t, row) {
		t.Fatal("object of an attached avatar was removed")
	}
}

// Barrier: the collector locks first and commits the deleting barrier; the
// claim parked behind it is refused file_deleting and rolls back, so no row
// ever points at a file the collector took.
func TestFileGCBarrierGCWins(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	id := avatarFixture(t, h)
	ctx := context.Background()

	locked, proceed := make(chan struct{}), make(chan struct{})
	var once sync.Once
	h.svc.gcHooks.batchLocked = func([]files.FileID) {
		once.Do(func() {
			close(locked)
			<-proceed
		})
	}
	done := make(chan *FileGCReport, 1)
	go func() {
		rep, err := h.svc.SweepFiles(ctx)
		if err != nil {
			t.Errorf("sweep: %v", err)
		}
		done <- rep
	}()
	<-locked
	claimErr := make(chan error, 1)
	go func() {
		claimErr <- h.tx(t, func(tx pgx.Tx, q *db.Queries) error { return attachAvatar(ctx, h, tx, q, id) })
	}()
	h.waitForLockWaiter(t)
	close(proceed)
	rep := <-done
	t3Code(t, <-claimErr, files.CodeDeleting)
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("entry = %+v, want deleted", e)
	}
	var avatar *string
	if err := h.pool.QueryRow(ctx, `SELECT avatar_file_id FROM users WHERE id = $1`, t3User).Scan(&avatar); err != nil {
		t.Fatal(err)
	}
	if avatar != nil {
		t.Fatalf("users.avatar_file_id = %q after the refused claim", *avatar)
	}
}

// Cancel vs save: the save holds the lock, the cancel waits and answers
// already_claimed, and the collector keeps the referenced file.
func TestFileGCCancelVersusSave(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	up := t3UploadOK(t, h.fileHarness, "cancel-save")

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := h.svc.ClaimInTx(ctx, db.New(h.pool).WithTx(tx), files.ClaimInput{
		Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope, FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	h.mem.hold(up.File.ID, files.HoldActive)
	cancelErr := make(chan error, 1)
	go func() {
		cancelErr <- h.svc.CancelUpload(ctx, files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: up.File.ID})
	}()
	h.waitForLockWaiter(t)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t3Code(t, <-cancelErr, files.CodeAlreadyClaimed)

	h.clock.Advance(25 * time.Hour)
	h.sweep(t)
	h.wantStatus(t, up.File.ID, files.StatusReady)
	if n := len(h.jobs(t, up.File.ID, fileJobCleanup)); n != 0 {
		t.Fatalf("a claimed file got %d cleanup jobs", n)
	}
}

// Two replicas: the run lease lets one sweep at a time, and a leased job is
// fenced from a second sweep until the lease runs out.
func TestFileGCTwoWorkers(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	id := h.claimedAndReleased(t, "two-workers", 30*time.Hour)

	locked, proceed := make(chan struct{}), make(chan struct{})
	var once sync.Once
	h.svc.gcHooks.batchLocked = func([]files.FileID) {
		once.Do(func() {
			close(locked)
			<-proceed
		})
	}
	done := make(chan *FileGCReport, 1)
	go func() {
		rep, err := h.svc.SweepFiles(ctx)
		if err != nil {
			t.Errorf("sweep: %v", err)
		}
		done <- rep
	}()
	<-locked
	second := h.sweep(t)
	if second.Skipped != "run_lease_held" {
		t.Fatalf("second replica = %+v, want skipped run_lease_held", second)
	}
	close(proceed)
	first := <-done
	if e := entry(t, first, id, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("first replica entry = %+v", e)
	}
	if n := len(h.jobs(t, id, fileJobCleanup)); n != 1 {
		t.Fatalf("cleanup jobs = %d, want the one", n)
	}
}

// Crash after the barrier: the file stays deleting and the job leased; a
// second sweep inside the lease does nothing, and once the lease expires the
// next sweep retakes the job and finishes the delete.
func TestFileGCCrashAfterBarrierResumes(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	id := h.claimedAndReleased(t, "crash", 30*time.Hour)
	h.svc.gcHooks.deletingCommitted = func(files.FileID) bool { return false }
	h.sweep(t)
	row := h.wantStatus(t, id, files.StatusDeleting)
	if !h.objectExists(t, row) {
		t.Fatal("object gone before the delete phase")
	}
	if job := h.liveJob(t, id, fileJobCleanup); job.Status != "leased" {
		t.Fatalf("job = %+v, want still leased by the crashed sweep", job)
	}
	h.svc.gcHooks.deletingCommitted = nil

	rep := h.sweep(t)
	for _, e := range rep.Entries {
		if e.FileID == id {
			t.Fatalf("a live lease was retaken: %+v", e)
		}
	}
	h.clock.Advance(h.svc.gc.JobLease + time.Minute)
	rep = h.sweep(t)
	if rep.LeasesReleased != 1 {
		t.Fatalf("leases released = %d, want 1", rep.LeasesReleased)
	}
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("resume entry = %+v", e)
	}
	row = h.wantStatus(t, id, files.StatusDeleted)
	if h.objectExists(t, row) {
		t.Fatal("object survived the resumed delete")
	}
}

// A failing Delete keeps the file deleting and the job pending with its code
// and a daily backoff; a Delete that answers nil but keeps the bytes (an
// Object Lock hold) is not success either. Both finish once storage behaves.
func TestFileGCDeleteFailureKeepsJob(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		phantom bool
		code    string
	}{
		{"error", errTestStorageDown, false, files.CodeStorageUnavailable},
		{"object lock", nil, true, "object_still_present"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newGCHarness(t, FileGCDestructive)
			id := h.claimedAndReleased(t, "delete-fail", 30*time.Hour)
			h.gcs.setDelete(tc.err, tc.phantom)
			rep := h.sweep(t)
			if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCRetry || e.Reason != tc.code {
				t.Fatalf("entry = %+v, want retry %s", e, tc.code)
			}
			row := h.wantStatus(t, id, files.StatusDeleting)
			if !h.objectExists(t, row) {
				t.Fatal("bytes gone although the delete failed")
			}
			job := h.liveJob(t, id, fileJobCleanup)
			if job.Status != "pending" || job.Attempt != 1 || job.ErrorCode.String != tc.code {
				t.Fatalf("job = %+v", job)
			}
			if want := h.svc.gc.nextRun(h.clock.Now()); !job.NextAttemptAt.Time.Equal(want) {
				t.Fatalf("next attempt = %s, want next daily slot %s", job.NextAttemptAt.Time, want)
			}
			// A second failure backs off two days, on a slot.
			h.until(job.NextAttemptAt.Time)
			h.sweep(t)
			job2 := h.liveJob(t, id, fileJobCleanup)
			if want := job.NextAttemptAt.Time.AddDate(0, 0, 2); job2.Attempt != 2 || !job2.NextAttemptAt.Time.Equal(want) {
				t.Fatalf("second backoff = %+v, want attempt 2 at %s", job2, want)
			}
			h.gcs.setDelete(nil, false)
			h.until(job2.NextAttemptAt.Time)
			rep = h.sweep(t)
			if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted {
				t.Fatalf("after recovery = %+v", e)
			}
			h.wantStatus(t, id, files.StatusDeleted)
		})
	}
}

// A provider error stops the whole batch: every file in it is kept, even the
// ones the failing provider would not have held.
func TestFileGCProviderErrorAbortsBatch(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	a := h.claimedAndReleased(t, "perr-a", 30*time.Hour)
	b := h.claimedAndReleased(t, "perr-b", 30*time.Hour)
	h.mem.fail(errors.New("provider down"))
	rep := h.sweep(t)
	for _, id := range []files.FileID{a, b} {
		if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCAborted || e.Reason != "provider_error" {
			t.Fatalf("%s entry = %+v, want aborted", id, e)
		}
		row := h.wantStatus(t, id, files.StatusReady)
		if !h.objectExists(t, row) {
			t.Fatal("object deleted in an aborted batch")
		}
		if job := h.liveJob(t, id, fileJobCleanup); job.ErrorCode.String != "provider_error" || job.Attempt != 1 {
			t.Fatalf("job = %+v", job)
		}
	}
	h.mem.fail(nil)
	h.until(h.liveJob(t, a, fileJobCleanup).NextAttemptAt.Time)
	rep = h.sweep(t)
	for _, id := range []files.FileID{a, b} {
		if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted {
			t.Fatalf("%s after recovery = %+v", id, e)
		}
	}
}

// A catalogue column without its provider: the collector cannot prove any
// file is unreferenced, so it leaves every cleanup job untouched.
func TestFileGCMissingProviderDeletesNothing(t *testing.T) {
	mem := newMemProvider("test.holds")
	h := newGCHarness(t, FileGCDestructive, withProviders(
		NewTaskAttachmentProvider(), NewUserAvatarProvider(), chatVoiceRecordingProvider{}, MeetingRecordingProvider{}, mem,
	))
	h.mem = mem
	id := h.claimedAndReleased(t, "no-chat-provider", 30*time.Hour)
	rep := h.sweep(t)
	if rep.Coverage == "" {
		t.Fatal("coverage gap not reported")
	}
	h.wantStatus(t, id, files.StatusReady)
	job := h.liveJob(t, id, fileJobCleanup)
	if job.Status != "pending" || job.Attempt != 0 || job.Generation != 0 {
		t.Fatalf("job was touched: %+v", job)
	}
}

// Version history, soft delete, retention and legal holds all keep the file;
// the report names the reason; soft delete then restore keeps it, and only a
// purge that releases the last hold lets it go.
func TestFileGCHoldReasonsAndSoftDeleteRestore(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	for _, reason := range []files.HoldReason{files.HoldVersionHistory, files.HoldRetention, files.HoldLegalHold} {
		up := t3UploadOK(t, h.fileHarness, "hold-"+string(reason))
		if _, err := t3Claim(t, h.fileHarness, up.File.ID); err != nil {
			t.Fatal(err)
		}
		h.mem.hold(up.File.ID, reason)
		h.releaseT3(t, up.File.ID)
		h.clock.Advance(25 * time.Hour)
		rep := h.sweep(t)
		if e := entry(t, rep, up.File.ID, fileJobCleanup); e.Action != FileGCHeld || e.Reason != "held:test.holds:"+string(reason) {
			t.Fatalf("%s entry = %+v", reason, e)
		}
		h.wantStatus(t, up.File.ID, files.StatusReady)
	}

	up := t3UploadOK(t, h.fileHarness, "soft-delete")
	if _, err := t3Claim(t, h.fileHarness, up.File.ID); err != nil {
		t.Fatal(err)
	}
	h.mem.hold(up.File.ID, files.HoldSoftDeleted) // soft deleted, restorable
	h.releaseT3(t, up.File.ID)
	h.clock.Advance(25 * time.Hour)
	h.sweep(t)
	h.wantStatus(t, up.File.ID, files.StatusReady)
	h.mem.hold(up.File.ID, files.HoldActive) // restored
	h.clock.Advance(24 * time.Hour)
	h.sweep(t)
	h.wantStatus(t, up.File.ID, files.StatusReady)
	h.mem.release(up.File.ID) // purged after retention
	h.releaseT3(t, up.File.ID)
	rep := h.sweep(t)
	if e := entry(t, rep, up.File.ID, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("after purge = %+v", e)
	}
}

// T1-Q3: one file_id held by two modules. Unlinking one keeps the file for
// the other - even a provider whose purposes do not include the file's own is
// asked - and only the last unlink lets it go.
func TestFileGCTwoReferences(t *testing.T) {
	taskRefs := newMemProvider("test.tasks", files.TaskAttachment)
	chatRefs := newMemProvider("test.chat", files.ChatAttachment)
	h := newGCHarness(t, FileGCDestructive, withProviders(append(productionProviders(), taskRefs, chatRefs, newMemProvider("test.all"))...))
	up := t3UploadOK(t, h.fileHarness, "two-refs")
	if _, err := t3Claim(t, h.fileHarness, up.File.ID); err != nil {
		t.Fatal(err)
	}
	taskRefs.hold(up.File.ID, files.HoldActive)
	chatRefs.hold(up.File.ID, files.HoldActive)
	h.clock.Advance(25 * time.Hour)

	taskRefs.release(up.File.ID)
	h.releaseT3(t, up.File.ID)
	rep := h.sweep(t)
	if e := entry(t, rep, up.File.ID, fileJobCleanup); e.Action != FileGCHeld || e.Reason != "held:test.chat:active" {
		t.Fatalf("after task unlink = %+v, want held by chat", e)
	}
	chatRefs.release(up.File.ID)
	h.releaseT3(t, up.File.ID)
	rep = h.sweep(t)
	if e := entry(t, rep, up.File.ID, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("after last unlink = %+v", e)
	}
}

// A reference that disappeared without ReleaseInTx is still found: the scan
// queues the unreferenced file and the job collects it under the lock.
func TestFileGCDiscoversUnreleasedGarbage(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	up := t3UploadOK(t, h.fileHarness, "unreleased")
	if _, err := t3Claim(t, h.fileHarness, up.File.ID); err != nil {
		t.Fatal(err)
	}
	h.mem.hold(up.File.ID, files.HoldActive)
	h.clock.Advance(25 * time.Hour)
	rep := h.sweep(t)
	for _, e := range rep.Entries {
		if e.FileID == up.File.ID {
			t.Fatalf("a held file was touched: %+v", e)
		}
	}
	h.mem.release(up.File.ID) // the module forgot ReleaseInTx
	rep = h.sweep(t)
	if e := entry(t, rep, up.File.ID, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("entry = %+v, want deleted", e)
	}
	var enqueued bool
	for _, e := range rep.Entries {
		enqueued = enqueued || (e.FileID == up.File.ID && e.Action == FileGCEnqueued)
	}
	if !enqueued {
		t.Fatal("the scan did not queue the file")
	}
}

// T1-Q10: a reference from another tenant - here an identity row pointing at
// an organization file - quarantines the file instead of collecting it, and
// so does a job whose tenant copy disagrees with the file.
func TestFileGCCrossTenantQuarantines(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, 'x@example.com', 'x', 'X')`, t3UserB); err != nil {
		t.Fatal(err)
	}
	crossed := h.claimedAndReleased(t, "cross-tenant", 30*time.Hour)
	if _, err := h.pool.Exec(ctx, `UPDATE users SET avatar_file_id = $1 WHERE id = $2`, string(crossed), t3UserB); err != nil {
		t.Fatal(err)
	}
	jobTenant := h.claimedAndReleased(t, "job-tenant", 30*time.Hour)
	if _, err := h.pool.Exec(ctx, `UPDATE file_jobs SET organization_id = $1 WHERE file_id = $2`, t3OrgB, string(jobTenant)); err != nil {
		t.Fatal(err)
	}
	rep := h.sweep(t)
	for id, reason := range map[files.FileID]string{crossed: "cross_tenant_reference", jobTenant: "tenant_mismatch_job"} {
		if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCQuarantined || e.Reason != reason {
			t.Fatalf("%s entry = %+v, want quarantined %s", id, e, reason)
		}
		row := h.wantStatus(t, id, files.StatusReady)
		if !h.objectExists(t, row) {
			t.Fatal("quarantined object deleted")
		}
		if job := h.liveJob(t, id, fileJobCleanup); job.ErrorCode.String != reason {
			t.Fatalf("job = %+v", job)
		}
	}
}

// Legacy, G0, foreign-storage, someone else's v1 key and a key a legacy
// column still names: none is FileService's to delete. Each is quarantined
// and its object stays.
func TestFileGCNeverDeletesLegacyG0OrSharedObjects(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	old := h.clock.Now().Add(-48 * time.Hour)
	type fixture struct {
		id, org, storage, bucket, key, reason string
	}
	fixtures := []fixture{
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6L01", t3Org, "local", "", "workspaces/" + t3WS + "/attachments/att1/a.txt", "unmanaged_locator"},
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6L02", "", "local", "", "avatars/" + t3User + "/legacy.png", "unmanaged_locator"},
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6L03", t3Org, "local", "", "documents/g0/doc-1/v3.docx", "unmanaged_locator"},
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6L04", t3Org, "local", "", "v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/tasks/attachments/2026/09/01J8ZQ0K7V9W1Y2X3Z4A5B6OTH/original", "unmanaged_locator"},
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6L05", t3Org, "minio", "legacy-bucket", "v1/orgs/" + t3Org + "/x/01J8ZQ0K7V9W1Y2X3Z4A5B6L05/original", "foreign_storage"},
	}
	for _, f := range fixtures {
		if _, err := h.pool.Exec(ctx, `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, status, content_type, size_bytes, ready_at)
			VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, 'legacy.bin', 'ready', 'text/plain', 5, $6)`,
			f.id, f.org, f.storage, f.bucket, f.key, old); err != nil {
			t.Fatalf("seed %s: %v", f.id, err)
		}
		row := h.file(t, files.FileID(f.id))
		if f.storage == "local" {
			if _, err := h.store.ObjectStore.Put(ctx, locator(row), strings.NewReader("old!\n"), storage.WriteInfo{SizeBytes: 5}); err != nil {
				t.Fatalf("put %s: %v", f.key, err)
			}
		}
		if err := h.svc.enqueueJob(ctx, h.svc.q, row, fileJobCleanup, h.clock.Now()); err != nil {
			t.Fatal(err)
		}
	}
	// A managed file whose key a legacy locator column still names.
	shared := h.claimedAndReleased(t, "shared-key", 30*time.Hour)
	if _, err := h.pool.Exec(ctx, `INSERT INTO users (id, email, password_hash, display_name, avatar_url) VALUES ($1, 's@example.com', 'x', 'S', $2)`,
		t3UserB, "https://cdn.example.test/"+h.file(t, shared).ObjectKey); err != nil {
		t.Fatal(err)
	}
	fixtures = append(fixtures, fixture{id: string(shared), storage: "local", reason: "legacy_locator_shared"})

	rep := h.sweep(t)
	if n := rep.Count(FileGCDeleted); n != 0 {
		t.Fatalf("deleted %d legacy/shared files", n)
	}
	for _, f := range fixtures {
		e := entry(t, rep, files.FileID(f.id), fileJobCleanup)
		if e.Action != FileGCQuarantined || e.Reason != f.reason {
			t.Fatalf("%s entry = %+v, want quarantined %s", f.id, e, f.reason)
		}
		row := h.wantStatus(t, files.FileID(f.id), files.StatusReady)
		if f.storage == "local" && !h.objectExists(t, row) {
			t.Fatalf("%s object removed", f.id)
		}
	}
	if h.gcs.deletes != 0 {
		t.Fatalf("storage saw %d deletes", h.gcs.deletes)
	}
}

// The schedule: one slot a day at 03:00 UTC+7, strictly after now.
func TestFileGCNextRun(t *testing.T) {
	cfg, err := FileGCConfig{}.normalized()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ now, want string }{
		{"2026-09-26T08:00:00Z", "2026-09-26T20:00:00Z"}, // 15:00 +7 -> 03:00 +7 next day
		{"2026-09-26T19:59:59Z", "2026-09-26T20:00:00Z"},
		{"2026-09-26T20:00:00Z", "2026-09-27T20:00:00Z"}, // at the slot: the next one
		{"2026-09-26T16:30:00Z", "2026-09-26T20:00:00Z"}, // 23:30 +7
		{"2026-09-26T17:30:00Z", "2026-09-26T20:00:00Z"}, // 00:30 +7 the day after
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		want, _ := time.Parse(time.RFC3339, tc.want)
		if got := cfg.nextRun(now); !got.Equal(want) {
			t.Errorf("nextRun(%s) = %s, want %s", tc.now, got, want)
		}
	}
	if _, err := (FileGCConfig{Mode: "sometimes"}).normalized(); err == nil {
		t.Error("unknown mode accepted")
	}
	if _, err := (FileGCConfig{DailyAt: 25 * time.Hour}).normalized(); err == nil {
		t.Error("time of day past 24h accepted")
	}
}

// The worker sweeps exactly once per daily slot on the service clock and
// stops with its context.
func TestFileGCWorkerRunsOncePerDay(t *testing.T) {
	h := newGCHarness(t, FileGCDryRun)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := h.svc.NewFileGCWorker()
	w.after = func(d time.Duration) <-chan time.Time {
		h.clock.Advance(d)
		ch := make(chan time.Time, 1)
		ch <- h.clock.Now()
		return ch
	}
	var starts []time.Time
	w.swept = func(rep *FileGCReport, err error) {
		if err != nil {
			t.Errorf("sweep: %v", err)
		}
		starts = append(starts, rep.StartedAt)
		if len(starts) == 3 {
			cancel()
		}
	}
	w.Run(ctx)
	if len(starts) != 3 {
		t.Fatalf("sweeps = %d, want 3", len(starts))
	}
	first := time.Date(2026, 9, 26, 20, 0, 0, 0, time.UTC)
	for i, at := range starts {
		if want := first.AddDate(0, 0, i); !at.Equal(want) {
			t.Errorf("sweep %d at %s, want %s", i, at, want)
		}
	}

	h.svc.gc.Mode = FileGCOff
	off := h.svc.NewFileGCWorker()
	off.after = func(time.Duration) <-chan time.Time { t.Fatal("an off worker waited"); return nil }
	off.Run(context.Background())
}

func TestFileGCConfigRejectsDuplicateProviders(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	_, err := NewFileService(FileServiceOptions{
		Pool: h.pool, Store: h.store, Signer: h.svc.signer,
		ReferenceProviders: []files.ReferenceProvider{NewUserAvatarProvider(), NewUserAvatarProvider()},
	})
	if err == nil {
		t.Fatal("duplicate provider accepted")
	}
	_, err = NewFileService(FileServiceOptions{Pool: h.pool, Store: h.store, GC: FileGCConfig{Mode: "always"}})
	if err == nil {
		t.Fatal("unknown GC mode accepted")
	}
}

// A versioned bucket: an unversioned DeleteObject would only plant a delete
// marker, so a file without a recorded object_version is never deleted - the
// job waits with storage_version_required - and a recorded one is deleted by
// exactly that version.
func TestFileGCVersionedBucketDeletesOnlyTheRecordedVersion(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	id := h.claimedAndReleased(t, "versioned", 30*time.Hour)
	h.gcs.setVersioned(true, "")
	rep := h.sweep(t)
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCRetry || e.Reason != "storage_version_required" {
		t.Fatalf("entry = %+v, want retry storage_version_required", e)
	}
	row := h.wantStatus(t, id, files.StatusDeleting)
	if !h.objectExists(t, row) || len(h.gcs.deletedVersions()) != 0 {
		t.Fatal("an unversioned delete reached a versioned bucket")
	}

	if _, err := h.pool.Exec(context.Background(), `UPDATE files SET object_version = 'ver-1' WHERE id = $1`, string(id)); err != nil {
		t.Fatal(err)
	}
	h.until(h.liveJob(t, id, fileJobCleanup).NextAttemptAt.Time)
	rep = h.sweep(t)
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("entry = %+v, want deleted", e)
	}
	if got := h.gcs.deletedVersions(); len(got) != 1 || got[0] != "ver-1" {
		t.Fatalf("deleted versions = %v, want [ver-1]", got)
	}
	h.wantStatus(t, id, files.StatusDeleted)
}
