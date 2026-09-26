package service

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// webmHead sniffs as video/webm, a recording type.
var webmHead = append([]byte{0x1a, 0x45, 0xdf, 0xa3}, make([]byte, 60)...)

// crashedIntent records an upload intent the way Upload does and then
// "crashes": the object may be written, the finalize never runs.
func crashedIntent(t *testing.T, h *gcHarness, key string, putObject bool) uploadAttempt {
	t.Helper()
	ctx := context.Background()
	spec, err := h.svc.registry.Lookup(files.TaskAttachment)
	if err != nil {
		t.Fatal(err)
	}
	in := files.UploadInput{Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope, IdempotencyKey: key, Filename: "a.txt"}
	var att uploadAttempt
	if err := h.inTx(t, func(q *db.Queries) error {
		var err error
		att, err = h.svc.recordIntent(ctx, q, spec, in, uploadFingerprint(in), h.clock.Now())
		return err
	}); err != nil {
		t.Fatalf("intent: %v", err)
	}
	if putObject {
		h.putAt(t, att.file, []byte("hello\n"))
	}
	return att
}

func (h *gcHarness) putAt(t *testing.T, row db.File, body []byte) {
	t.Helper()
	loc := locator(row)
	loc.Version = "" // the local adapter has no versions (see gcStore)
	if _, err := h.store.ObjectStore.Put(context.Background(), loc, bytes.NewReader(body), storage.WriteInfo{SizeBytes: int64(len(body))}); err != nil {
		t.Fatalf("put: %v", err)
	}
}

// Intent before Put, writer gone: after the lease the attempt is abandoned -
// lease withdrawn, file failed and collected - a late finalize cannot
// resurrect it, a late Put at the tombstone's key is removed the next day,
// and the user's retry with the same key still works.
func TestFileReconcileAbandonedUploadIntent(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	att := crashedIntent(t, h, "abandoned", true)
	id := files.FileID(att.file.ID)

	h.clock.Advance(10 * time.Minute) // lease still running
	rep := h.sweep(t)
	for _, e := range rep.Entries {
		if e.FileID == id {
			t.Fatalf("touched a live writer: %+v", e)
		}
	}
	h.clock.Advance(6 * time.Minute)
	rep = h.sweep(t)
	if e := entry(t, rep, id, fileJobReconcile); e.Action != FileGCDone || e.Reason != "abandoned_intent" {
		t.Fatalf("reconcile entry = %+v", e)
	}
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("cleanup entry = %+v, want the failed attempt collected in the same sweep", e)
	}
	row := h.wantStatus(t, id, files.StatusDeleted)
	if h.objectExists(t, row) {
		t.Fatal("abandoned object survived")
	}
	sess, err := h.svc.q.GetUploadSessionByID(ctx, att.session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sess.LeaseOwner.Valid {
		t.Fatal("the lapsed lease was not withdrawn")
	}

	// A late Put lands at the tombstone's key; the next day's reconcile
	// removes it.
	h.putAt(t, row, []byte("late!\n"))
	h.toNextSlot()
	rep = h.sweep(t)
	if e := entry(t, rep, id, fileJobReconcile); e.Action != FileGCDeleted || e.Reason != "late_object" {
		t.Fatalf("tombstone entry = %+v", e)
	}
	if h.objectExists(t, row) {
		t.Fatal("late object survived the tombstone check")
	}

	// The original writer wakes up and tries to finalize: refused, and the
	// file stays a tombstone. Its give-up cancels any reconcile job and
	// queues a cleanup, which re-checks the tombstone's key.
	_, err = h.svc.publishUpload(ctx, att, "text/plain", 6, "", "")
	t3Code(t, err, files.CodeUploadCanceled)
	h.wantStatus(t, id, files.StatusDeleted)
	h.putAt(t, row, []byte("later\n"))
	rep = h.sweep(t)
	if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCDeleted || e.Reason != "tombstone_recheck" {
		t.Fatalf("recheck entry = %+v", e)
	}
	if h.objectExists(t, row) {
		t.Fatal("second late object survived")
	}
	h.wantStatus(t, id, files.StatusDeleted)

	// The user retries the same logical upload.
	up, err := t3Upload(t, h.fileHarness, files.TaskAttachment, t3Scope, "abandoned", "a.txt", []byte("hello\n"))
	if err != nil {
		t.Fatalf("retry after abandon: %v", err)
	}
	if up.File.ID == id || up.File.Status != files.StatusReady {
		t.Fatalf("retry = %+v", up.File)
	}
}

// Dry-run reconcile reports and leaves the intent exactly as it was.
func TestFileReconcileDryRunWritesNothing(t *testing.T) {
	h := newGCHarness(t, FileGCDryRun)
	att := crashedIntent(t, h, "dry-abandon", true)
	h.clock.Advance(20 * time.Minute)
	rep := h.sweep(t)
	if e := entry(t, rep, files.FileID(att.file.ID), fileJobReconcile); e.Reason != "abandoned_intent" {
		t.Fatalf("entry = %+v", e)
	}
	h.wantStatus(t, files.FileID(att.file.ID), files.StatusPending)
	sess, err := h.svc.q.GetUploadSessionByID(context.Background(), att.session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sess.LeaseOwner.String != att.leaseOwner {
		t.Fatal("dry-run withdrew the lease")
	}
}

// A provider output past its deadline without an object is quarantined, not
// deleted - the provider may still be writing - and a late object is
// verified and finished on a later sweep.
func TestFileReconcileProviderOutputLateCompletion(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	out, err := h.svc.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: audit.System("meetings.egress"), Purpose: files.MeetingRecording, Scope: t3Scope,
		OperationID: "EG_late", Deadline: h.clock.Now().Add(2 * time.Hour),
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	h.clock.Advance(3 * time.Hour)
	rep := h.sweep(t)
	if e := entry(t, rep, out.FileID, fileJobReconcile); e.Action != FileGCQuarantined || e.Reason != "writer_unconfirmed" {
		t.Fatalf("entry = %+v", e)
	}
	row := h.wantStatus(t, out.FileID, files.StatusPending)

	h.putAt(t, row, webmHead)
	h.until(h.liveJob(t, out.FileID, fileJobReconcile).NextAttemptAt.Time)
	rep = h.sweep(t)
	if e := entry(t, rep, out.FileID, fileJobReconcile); e.Action != FileGCConfirmed {
		t.Fatalf("entry = %+v, want confirmed", e)
	}
	h.wantStatus(t, out.FileID, files.StatusReady)
	sess, err := h.svc.q.GetUploadSessionByFile(ctx, string(out.FileID))
	if err != nil {
		t.Fatal(err)
	}
	if files.SessionStatus(sess.Status) != files.SessionStaged {
		t.Fatalf("session = %s, want staged for the module's claim", sess.Status)
	}
}

// A recording still inside its provider deadline is an active writer, not a
// staged upload: 25 hours in, nothing touches it.
func TestFileReconcileActiveRecordingIsNotExpired(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	out, err := h.svc.RegisterProviderOutput(context.Background(), files.ProviderOutputInput{
		Actor: audit.System("meetings.egress"), Purpose: files.MeetingRecording, Scope: t3Scope,
		OperationID: "EG_long", Deadline: h.clock.Now().Add(30 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	h.clock.Advance(25 * time.Hour)
	rep := h.sweep(t)
	for _, e := range rep.Entries {
		if e.FileID == out.FileID {
			t.Fatalf("active recording touched: %+v", e)
		}
	}
	h.wantStatus(t, out.FileID, files.StatusPending)
}

// A ready, referenced file whose object vanished is reported and kept: a lost
// object is a recovery case, never a reason to drop the reference.
func TestFileReconcileMissingObjectKeepsReference(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	up := t3UploadOK(t, h.fileHarness, "lost-object")
	if _, err := t3Claim(t, h.fileHarness, up.File.ID); err != nil {
		t.Fatal(err)
	}
	h.mem.hold(up.File.ID, files.HoldActive)
	row := h.file(t, up.File.ID)
	if err := h.store.ObjectStore.Delete(ctx, locator(row)); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.enqueueJob(ctx, h.svc.q, row, fileJobReconcile, h.clock.Now()); err != nil {
		t.Fatal(err)
	}
	rep := h.sweep(t)
	if e := entry(t, rep, up.File.ID, fileJobReconcile); e.Action != FileGCQuarantined || e.Reason != "object_missing" {
		t.Fatalf("entry = %+v", e)
	}
	h.wantStatus(t, up.File.ID, files.StatusReady)
}

// Multipart abort intent is kept with a code: no adapter can abort a
// multipart upload yet, and dropping the job would leak the parts silently.
func TestFileReconcileKeepsAbortMultipartIntent(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	up := t3UploadOK(t, h.fileHarness, "multipart")
	row := h.file(t, up.File.ID)
	if err := h.svc.enqueueJob(ctx, h.svc.q, row, "abort_multipart", h.clock.Now()); err != nil {
		t.Fatal(err)
	}
	rep := h.sweep(t)
	if e := entry(t, rep, up.File.ID, "abort_multipart"); e.Action != FileGCQuarantined || e.Reason != "abort_multipart_unsupported" {
		t.Fatalf("entry = %+v", e)
	}
	if job := h.liveJob(t, up.File.ID, "abort_multipart"); job.Status != "pending" {
		t.Fatalf("job = %+v", job)
	}
}

// The spool sweep removes only day-old upload spool files, and only when
// destructive.
func TestFileGCSweepsStaleSpoolFiles(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	dir := h.svc.spoolDir
	stale, fresh := dir+"/uniwork-upload-stale", dir+"/uniwork-upload-fresh"
	other := dir + "/not-ours"
	for _, p := range []string{stale, fresh, other} {
		if err := writeFileAt(p, h.clock.Now().Add(-48*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := touchAt(fresh, h.clock.Now()); err != nil {
		t.Fatal(err)
	}
	rep := h.sweep(t)
	if rep.SpoolFilesRemoved != 1 {
		t.Fatalf("spool removed = %d, want 1", rep.SpoolFilesRemoved)
	}
	for p, want := range map[string]bool{stale: false, fresh: true, other: true} {
		if got := fileExists(p); got != want {
			t.Errorf("%s exists = %v, want %v", strings.TrimPrefix(p, dir), got, want)
		}
	}
}

// On a versioned bucket a late write at a tombstone's key is a new version:
// reconcile deletes exactly the version Stat reports, never the key blindly.
func TestFileReconcileTombstoneDeletesTheLateVersion(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	id := h.claimedAndReleased(t, "late-version", 30*time.Hour)
	if _, err := h.pool.Exec(ctx, `UPDATE files SET object_version = 'ver-1' WHERE id = $1`, string(id)); err != nil {
		t.Fatal(err)
	}
	h.gcs.setVersioned(true, "ver-1")
	h.sweep(t)
	row := h.wantStatus(t, id, files.StatusDeleted)

	h.putAt(t, row, []byte("late!\n"))
	h.gcs.setVersioned(true, "ver-late")
	if err := h.svc.enqueueJob(ctx, h.svc.q, row, fileJobReconcile, h.clock.Now()); err != nil {
		t.Fatal(err)
	}
	rep := h.sweep(t)
	if e := entry(t, rep, id, fileJobReconcile); e.Action != FileGCDeleted || e.Reason != "late_object" {
		t.Fatalf("entry = %+v, want late_object deleted", e)
	}
	got := h.gcs.deletedVersions()
	if len(got) != 2 || got[0] != "ver-1" || got[1] != "ver-late" {
		t.Fatalf("deleted versions = %v, want [ver-1 ver-late]", got)
	}
	if h.objectExists(t, row) {
		t.Fatal("late version survived")
	}
}
