package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// RETENTION-02 (UNI-1921): the three sweeps that delete closed rows nothing
// reads again. Each table is proven on both sides of the cutoff, on a live or
// open row older than the window, and across two organizations (the sweep is
// system-wide by design). The floors are proven behaviourally: the office_jobs
// window keeps a job whose output is still inside FileService's claim window
// and that output still commits, the break-glass window keeps a late revoke
// answering success, and the multipart window keeps a stored failure answering
// its code.

// retentionRowExists answers whether one row is still there. table is always a
// literal from this file.
func retentionRowExists(t *testing.T, f *docPermFixture, table, id string) bool {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE id = $1`, table), id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

// retentionOfficeJob inserts one office_jobs row in the given state. finishedAt
// is set only for the terminal states (all three close paths set it).
func (f *docPermFixture) retentionOfficeJob(t *testing.T, tn docTenant, state string, finishedAt time.Time) string {
	t.Helper()
	id := util.NewID()
	now := time.Now()
	row := map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": tn.wsA,
		"document_id": util.NewID(), "operation": "serialize", "format": "pdf",
		"base_revision": int64(1), "base_version_id": util.NewID(),
		"idempotency_key": util.NewID(), "payload_fingerprint": util.NewID(),
		"input_checksum": util.NewID(), "input_length": int64(1), "grant_id": util.NewID(),
		"deadline_at": now, "created_by": tn.member.ID, "created_by_kind": "human",
		"state": state,
	}
	if finishedAt.IsZero() {
		row["finished_at"] = nil
	} else {
		row["finished_at"] = finishedAt
	}
	insertRow(t, f.ctx, f.pool, "office_jobs", row)
	return id
}

// retentionMultipartRow inserts one file_multipart_uploads row. closedAt is
// set for the closed statuses (the CHECK requires it) and nil for open ones.
func (f *docPermFixture) retentionMultipartRow(t *testing.T, tn docTenant, status string, closedAt time.Time) string {
	t.Helper()
	id := util.NewID()
	now := time.Now()
	row := map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": tn.wsA,
		"file_id": util.NewID(), "file_upload_session_id": util.NewID(),
		"created_by": tn.member.ID, "created_by_kind": "human", "opened_via": "workspace",
		"storage_upload_id": util.NewID(), "object_key": "rt2/" + id,
		"filename": "rt2.pdf", "size_bytes": int64(1), "part_size": int64(1), "total_parts": 1,
		"probe_head_sha256": util.NewID(), "probe_tail_sha256": util.NewID(),
		"status": status, "expires_at": now,
	}
	if status == "open" || status == "validating" {
		row["closed_at"] = nil
	} else {
		row["closed_at"] = closedAt
	}
	insertRow(t, f.ctx, f.pool, "file_multipart_uploads", row)
	return id
}

// retentionBreakGlassGrant inserts one document_break_glass_grants row on
// documentID. revokedAt is set only for a revoked grant.
func (f *docPermFixture) retentionBreakGlassGrant(t *testing.T, tn docTenant, documentID string, expires, revokedAt time.Time) string {
	t.Helper()
	id := util.NewID()
	row := map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": tn.wsA,
		"document_id": documentID, "actor_id": tn.wsAdmin.ID, "actor_kind": "human",
		"level": "view", "reason": "Kiểm tra tuân thủ định kỳ", "expires_at": expires,
	}
	if revokedAt.IsZero() {
		row["revoked_at"] = nil
	} else {
		row["revoked_at"] = revokedAt
		row["revoked_by"] = tn.wsAdmin.ID
	}
	insertRow(t, f.ctx, f.pool, "document_break_glass_grants", row)
	return id
}

// TestDocumentRetentionSweepOfficeJobs: a terminal row past the window goes, a
// terminal row inside it stays, a live row stays whatever its age, and the
// sweep takes another organization's old row with it (system-wide by design).
func TestDocumentRetentionSweepOfficeJobs(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rt2j")
	other := f.tenant(t, "rt2k")
	now := time.Now()

	old := now.Add(-officeJobRetention - time.Hour)
	fresh := now.Add(-officeJobRetention + time.Hour)

	goneOld := f.retentionOfficeJob(t, tn, "completed", old)
	goneCancelled := f.retentionOfficeJob(t, tn, "cancelled", old)
	goneOtherOrg := f.retentionOfficeJob(t, other, "timed_out", old)
	keptFresh := f.retentionOfficeJob(t, tn, "failed", fresh)
	keptLive := f.retentionOfficeJob(t, tn, "running", time.Time{})

	n, err := f.svc.SweepOfficeJobs(f.ctx, now)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 3 {
		t.Fatalf("swept %d rows, want 3 (two of this org, one of the other)", n)
	}
	for _, id := range []string{goneOld, goneCancelled, goneOtherOrg} {
		if retentionRowExists(t, f, "office_jobs", id) {
			t.Fatalf("terminal row %s past the window survived", id)
		}
	}
	for _, id := range []string{keptFresh, keptLive} {
		if !retentionRowExists(t, f, "office_jobs", id) {
			t.Fatalf("row %s inside the window was deleted", id)
		}
	}
}

// TestDocumentRetentionSweepMultipartRows: a closed row past the window goes,
// one inside it stays, an open row stays whatever its age, and the sweep is
// system-wide.
func TestDocumentRetentionSweepMultipartRows(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rt2m")
	other := f.tenant(t, "rt2n")
	now := time.Now()

	old := now.Add(-multipartRowRetention - time.Hour)
	fresh := now.Add(-multipartRowRetention + time.Hour)

	goneCompleted := f.retentionMultipartRow(t, tn, "completed", old)
	goneAborted := f.retentionMultipartRow(t, tn, "aborted", old)
	goneOtherOrg := f.retentionMultipartRow(t, other, "failed", old)
	keptFresh := f.retentionMultipartRow(t, tn, "expired", fresh)
	keptOpen := f.retentionMultipartRow(t, tn, "open", time.Time{})

	n, err := f.svc.SweepFileMultipartUploads(f.ctx, now)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 3 {
		t.Fatalf("swept %d rows, want 3", n)
	}
	for _, id := range []string{goneCompleted, goneAborted, goneOtherOrg} {
		if retentionRowExists(t, f, "file_multipart_uploads", id) {
			t.Fatalf("closed row %s past the window survived", id)
		}
	}
	for _, id := range []string{keptFresh, keptOpen} {
		if !retentionRowExists(t, f, "file_multipart_uploads", id) {
			t.Fatalf("row %s was deleted", id)
		}
	}
}

// TestDocumentRetentionSweepBreakGlassGrants: an ended grant past the window
// goes (revoked or expired), one inside it stays, a live grant stays whatever
// its age, and the sweep is system-wide.
func TestDocumentRetentionSweepBreakGlassGrants(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rt2b")
	other := f.tenant(t, "rt2c")
	now := time.Now()

	old := now.Add(-breakGlassRetention - time.Hour)
	fresh := now.Add(-breakGlassRetention + time.Hour)

	goneRevoked := f.retentionBreakGlassGrant(t, tn, util.NewID(), now.Add(time.Hour), old)
	goneExpired := f.retentionBreakGlassGrant(t, tn, util.NewID(), old, time.Time{})
	goneOtherOrg := f.retentionBreakGlassGrant(t, other, util.NewID(), old, time.Time{})
	keptFreshRevoked := f.retentionBreakGlassGrant(t, tn, util.NewID(), now.Add(time.Hour), fresh)
	keptLive := f.retentionBreakGlassGrant(t, tn, util.NewID(), now.Add(time.Hour), time.Time{})

	n, err := f.svc.SweepDocumentBreakGlassGrants(f.ctx, now)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 3 {
		t.Fatalf("swept %d rows, want 3", n)
	}
	for _, id := range []string{goneRevoked, goneExpired, goneOtherOrg} {
		if retentionRowExists(t, f, "document_break_glass_grants", id) {
			t.Fatalf("ended grant %s past the window survived", id)
		}
	}
	for _, id := range []string{keptFreshRevoked, keptLive} {
		if !retentionRowExists(t, f, "document_break_glass_grants", id) {
			t.Fatalf("grant %s was deleted", id)
		}
	}
}

// The batching loop stops early when a batch comes back short and never
// deletes a live row, whatever the batch size.
func TestDocumentRetentionSweepBatchesStopEarly(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rt2p")
	now := time.Now()
	old := now.Add(-officeJobRetention - time.Hour)

	ids := make([]string, 0, retentionSweepBatch+1)
	for range int(retentionSweepBatch) + 1 {
		ids = append(ids, f.retentionOfficeJob(t, tn, "completed", old))
	}
	n, err := f.svc.SweepOfficeJobs(f.ctx, now)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != int64(len(ids)) {
		t.Fatalf("swept %d rows, want %d across two batches", n, len(ids))
	}
	for _, id := range ids {
		if retentionRowExists(t, f, "office_jobs", id) {
			t.Fatalf("row %s survived a two-batch sweep", id)
		}
	}
}

// TestDocumentRetentionSweepFloors pins each window above the reader it must
// outlast (spec §6.2 (c)). The constants are the same values the compile-time
// guard converts to uint, so a change here is what a reviewer sees.
func TestDocumentRetentionSweepFloors(t *testing.T) {
	if officeJobRetention <= files.ClaimTTL {
		t.Fatalf("officeJobRetention = %s, want > files.ClaimTTL (%s)", officeJobRetention, files.ClaimTTL)
	}
	uploadFloor := UploadSessionTTL + UploadSessionValidationLeaseTTL
	if multipartRowRetention <= uploadFloor {
		t.Fatalf("multipartRowRetention = %s, want > %s", multipartRowRetention, uploadFloor)
	}
	if breakGlassRetention <= 0 {
		t.Fatalf("breakGlassRetention = %s, want > 0", breakGlassRetention)
	}
}

// The office_jobs floor, behaviourally: a completed job whose output is still
// inside FileService's claim window survives a sweep at that time, and
// committing that output still binds to the job - the version carries the
// server-stamped engine, which only the job row can supply.
func TestDocumentRetentionSweepKeepsACommitableOfficeJob(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		member := human(env.tn.member)
		created := env.createFile(t, member, "rt2-floor.pdf", pdfBody("rt2-floor-v1"))
		job := env.officeJob(t, member, created.Document, pdfBody("rt2-floor-v2"), "completed")

		// The output is still inside its claim window; sweep at the far end of
		// that window (and far inside officeJobRetention).
		at := time.Now().Add(files.ClaimTTL)
		n, err := env.svc.SweepOfficeJobs(context.Background(), at)
		if err != nil {
			t.Fatalf("sweep: %v", err)
		}
		if n != 0 {
			t.Fatalf("swept %d rows, want 0: a job inside files.ClaimTTL must survive", n)
		}
		if !retentionRowExists(t, env.f, "office_jobs", job.ID) {
			t.Fatal("the sweep deleted a job whose output was still claimable")
		}

		res, err := env.commit(member, created.Document.ID, job.OutputFileID.String, created.Document.Revision, util.NewID())
		mustf(t, err, "commit after the sweep")
		if res.Version.EngineVersion.String != office.TrustedEngineVersion ||
			res.Version.ContractVersion.String != office.ContractVersion {
			t.Fatalf("the version lost its server-stamped engine after the sweep: %+v", res.Version)
		}
		if got := env.job(t, job.ID); got.CommittedVersionID.String != res.Version.ID {
			t.Fatalf("the job was not bound to the version: %+v", got)
		}
	})
}

// The break-glass floor, behaviourally: revoking an ended grant inside the
// window still answers success after a sweep ran; past the window the row is
// gone and the same revoke answers not found - the documented consequence.
func TestDocumentRetentionSweepBreakGlassFloor(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rt2bf")
	admin := Human(tn.wsAdmin.ID)
	docR := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	now := time.Now()

	revoked := f.retentionBreakGlassGrant(t, tn, docR.ID, now.Add(time.Hour), now.Add(-time.Hour))
	if _, err := f.svc.SweepDocumentBreakGlassGrants(f.ctx, now); err != nil {
		t.Fatalf("sweep inside the window: %v", err)
	}
	if !retentionRowExists(t, f, "document_break_glass_grants", revoked) {
		t.Fatal("a grant revoked inside the window was swept")
	}
	if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, revoked); err != nil {
		t.Fatalf("revoke inside the window = %v, want success", err)
	}

	expired := f.retentionBreakGlassGrant(t, tn, docR.ID, now.Add(-time.Hour), time.Time{})
	if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, expired); err != nil {
		t.Fatalf("revoke of an expired grant inside the window = %v, want success", err)
	}

	// Past the window the rows are gone and the same revoke is not found.
	after := now.Add(breakGlassRetention + time.Hour)
	if _, err := f.svc.SweepDocumentBreakGlassGrants(f.ctx, after); err != nil {
		t.Fatalf("sweep past the window: %v", err)
	}
	for _, id := range []string{revoked, expired} {
		if retentionRowExists(t, f, "document_break_glass_grants", id) {
			t.Fatalf("ended grant %s survived a sweep past the window", id)
		}
		if err := f.svc.RevokeDocumentBreakGlass(f.ctx, admin, docR.ID, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("revoke after the sweep = %v, want ErrNotFound", err)
		}
	}
}

// The multipart floor, behaviourally: a closed row inside the window survives
// and a stored failure is still answered by complete replay; past the window
// the row is gone and the replay answers not found.
func TestDocumentRetentionSweepMultipartFloor(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	now := time.Now()

	failed := env.f.retentionMultipartRow(t, env.tn, "failed", now.Add(-time.Hour))
	if _, err := env.f.pool.Exec(ctx,
		`UPDATE file_multipart_uploads SET failure_code = 'upload_probe_mismatch' WHERE id = $1`, failed); err != nil {
		t.Fatal(err)
	}

	if n, err := env.svc.SweepFileMultipartUploads(ctx, now); err != nil || n != 0 {
		t.Fatalf("sweep inside the window: n=%d err=%v", n, err)
	}
	if !retentionRowExists(t, env.f, "file_multipart_uploads", failed) {
		t.Fatal("a closed row inside the window was swept")
	}
	// The stored failure is still the answer: the row is what carries it.
	if _, err := env.svc.CompleteUploadSession(ctx, member, failed, CompleteUploadSessionInput{}); err != nil {
		wantCode(t, err, "upload_probe_mismatch")
	} else {
		t.Fatal("complete replay of a stored failure answered success")
	}

	// Past the window the row is gone and the session is not found.
	after := now.Add(multipartRowRetention + time.Hour)
	if _, err := env.svc.SweepFileMultipartUploads(ctx, after); err != nil {
		t.Fatalf("sweep past the window: %v", err)
	}
	if retentionRowExists(t, env.f, "file_multipart_uploads", failed) {
		t.Fatal("the closed row survived a sweep past the window")
	}
	if _, err := env.svc.CompleteUploadSession(ctx, member, failed, CompleteUploadSessionInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("complete replay after the sweep = %v, want ErrNotFound", err)
	}
}

// The worker runs all three sweeps on their ticks and reports each under its
// own label, so a failing table is visible on its own series. The old rows of
// each table are gone after one pass of Run.
func TestDocumentWorkersRunRetentionSweeps(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "rt2w")
	f.svc.SetFiles(&releaseSpy{})
	fixed := time.Now()
	f.svc.SetClock(func() time.Time { return fixed })
	t.Cleanup(func() { f.svc.SetClock(nil) })

	old := fixed.Add(-31 * 24 * time.Hour)
	job := f.retentionOfficeJob(t, tn, "completed", old)
	multipart := f.retentionMultipartRow(t, tn, "completed", old)
	grant := f.retentionBreakGlassGrant(t, tn, util.NewID(), old, time.Time{})

	metrics := &countingDocMetrics{}
	f.svc.SetMetrics(metrics)

	w := f.svc.NewDocumentWorkers()
	// The loops run their first pass immediately, then wait on a channel that
	// never fires; cancel once both ticks have reported.
	ctx, cancel := context.WithCancel(f.ctx)
	defer cancel()
	seen := map[string]bool{}
	w.swept = func(kind string, err error) {
		if err != nil {
			t.Errorf("%s sweep: %v", kind, err)
		}
		seen[kind] = true
		if seen["purge"] && seen["commit_intent"] {
			cancel()
		}
	}
	w.after = func(time.Duration) <-chan time.Time { return make(chan time.Time) }
	w.Run(ctx)

	for _, id := range []struct {
		table, id string
	}{
		{"office_jobs", job},
		{"file_multipart_uploads", multipart},
		{"document_break_glass_grants", grant},
	} {
		if retentionRowExists(t, f, id.table, id.id) {
			t.Fatalf("%s row %s survived one worker pass", id.table, id.id)
		}
	}
	for _, want := range []string{"office_job/ok", "multipart_row/ok", "break_glass/ok"} {
		if !containsString(metrics.sweeps, want) {
			t.Fatalf("worker sweeps %v, want %s", metrics.sweeps, want)
		}
	}
}
