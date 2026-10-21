package service

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

// UNI-2052 w3: the batch read (GET), the cancel (DELETE) and the sweep.

// cancelRecorder is the fake FileService that remembers which uploads the
// service revoked, so a cancel or a sweep can be seen releasing them.
type cancelRecorder struct {
	*filesfake.Fake
	mu       sync.Mutex
	canceled []files.FileID
}

func (c *cancelRecorder) CancelUpload(ctx context.Context, in files.CancelInput) error {
	c.mu.Lock()
	c.canceled = append(c.canceled, in.FileID)
	c.mu.Unlock()
	return c.Fake.CancelUpload(ctx, in)
}

func (c *cancelRecorder) canceledCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.canceled)
}

type fileIDSet map[files.FileID]bool

func (s fileIDSet) hasAll(ids []files.FileID) bool {
	for _, id := range ids {
		if !s[id] {
			return false
		}
	}
	return true
}

func (s fileIDSet) hasAny(ids []files.FileID) bool {
	for _, id := range ids {
		if s[id] {
			return true
		}
	}
	return false
}

func (c *cancelRecorder) canceledSet() fileIDSet {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := fileIDSet{}
	for _, id := range c.canceled {
		out[id] = true
	}
	return out
}

// uploadRefs are the FileService file ids a batch's pending files hold.
func (e *docStorageEnv) uploadRefs(t *testing.T, batchID string) []files.FileID {
	t.Helper()
	rows, err := e.f.pool.Query(context.Background(), `SELECT upload_ref FROM document_folder_upload_files WHERE batch_id = $1 AND upload_ref IS NOT NULL`, batchID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []files.FileID
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			t.Fatal(err)
		}
		out = append(out, files.FileID(ref))
	}
	return out
}

func newFolderBatchEnv(t *testing.T) (*docStorageEnv, *cancelRecorder) {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	rec := &cancelRecorder{Fake: env.fake}
	env.svc.SetFiles(rec)
	return env, rec
}

func (e *docStorageEnv) planFolderBatch(t *testing.T) FolderUploadBatch {
	t.Helper()
	b, err := e.svc.CreateFolderUpload(context.Background(), human(e.tn.member), e.tn.wsA, folderPlanInput("Gốc"))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	return b
}

func (e *docStorageEnv) execSQL(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func TestFolderUploadGetAnswersFreshTargetsForPendingFilesOnly(t *testing.T) {
	env, _ := newFolderBatchEnv(t)
	ctx := context.Background()
	b := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_upload_files SET status = 'done', document_id = 'doc-1' WHERE batch_id = $1 AND file_key = 'f-1'`, b.ID)

	got, err := env.svc.GetFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != b.ID || got.Status != "open" || got.Counts != (FolderUploadCounts{Total: 2, Done: 1, Pending: 1}) {
		t.Fatalf("batch = %+v", got)
	}
	byKey := map[string]FolderUploadFile{}
	for _, f := range got.Files {
		byKey[f.FileKey] = f
	}
	if f := byKey["f-1"]; f.Status != "done" || f.DocumentID != "doc-1" || f.Target != nil {
		t.Fatalf("done file = %+v", f)
	}
	if f := byKey["f-2"]; f.Status != "pending" || f.Target == nil || f.Target.Kind != "put" || f.Target.URL == "" {
		t.Fatalf("pending file = %+v", f)
	}
}

func TestFolderUploadGetIsCreatorOnly(t *testing.T) {
	env, _ := newFolderBatchEnv(t)
	ctx := context.Background()
	b := env.planFolderBatch(t)
	// Another member of the same workspace, a member of another workspace, an
	// outsider and an unknown id all get the same refusal.
	for name, actor := range map[string]Actor{
		"workspace member": human(env.tn.creator), "other workspace": human(env.tn.bMember),
		"outsider": human(env.tn.outsider), "owner": human(env.tn.owner),
	} {
		if _, err := env.svc.GetFolderUpload(ctx, actor, env.tn.wsA, b.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: err = %v, want not found", name, err)
		}
	}
	if _, err := env.svc.GetFolderUpload(ctx, human(env.tn.member), env.tn.wsA, "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown id: err = %v", err)
	}
	// The creator, asking through another workspace's path, finds nothing.
	if _, err := env.svc.GetFolderUpload(ctx, human(env.tn.member), env.tn.wsB, b.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other workspace path: err = %v", err)
	}
}

func TestFolderUploadGetExpiredBatchIsGone(t *testing.T) {
	env, _ := newFolderBatchEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	past := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET expires_at = now() - interval '1 hour' WHERE id = $1`, past.ID)
	_, err := env.svc.GetFolderUpload(ctx, member, env.tn.wsA, past.ID)
	if ce := wantCoded(t, err, "folder_upload_expired"); ce.Status != http.StatusGone {
		t.Fatalf("status = %d, want 410", ce.Status)
	}

	// A batch the sweep already closed answers the same.
	swept := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET status = 'expired', finished_at = now() WHERE id = $1`, swept.ID)
	_, err = env.svc.GetFolderUpload(ctx, member, env.tn.wsA, swept.ID)
	wantCoded(t, err, "folder_upload_expired")
}

func TestFolderUploadGetSettledBatchHasNoTargets(t *testing.T) {
	env, _ := newFolderBatchEnv(t)
	ctx := context.Background()
	b := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET status = 'completed', finished_at = now() WHERE id = $1`, b.ID)
	got, err := env.svc.GetFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID)
	if err != nil || got.Status != "completed" {
		t.Fatalf("get = %+v, %v", got, err)
	}
	for _, f := range got.Files {
		if f.Target != nil {
			t.Fatalf("settled batch carries a target: %+v", f)
		}
	}
}

func TestFolderUploadGetMultipartListsOnlyTheMissingParts(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	seedStoragePlan(t, env, 100<<20)
	body, probe := buildLargePDF(25<<20, "folder-get")
	b, err := env.svc.CreateFolderUpload(ctx, human(env.tn.member), env.tn.wsA, CreateFolderUploadInput{
		RootName: "Lớn", IdempotencyKey: nextIDK(),
		Files: []FolderUploadFileInput{{FileKey: "big", Path: "", Filename: "big.pdf", SizeBytes: 25 << 20, Probe: &probe}},
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	first := b.Files[0].Target
	if first == nil || first.Kind != "multipart" || first.SessionID == "" || len(first.Parts) != 4 {
		t.Fatalf("planned target = %+v", first)
	}
	// Part 1 is in storage already: GET leaves it out.
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, first.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.store.PutPart(row.ObjectKey, row.StorageUploadID, 1, body[:row.PartSize]); err != nil {
		t.Fatal(err)
	}
	got, err := env.svc.GetFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	target := got.Files[0].Target
	if target == nil || target.Kind != "multipart" || target.SessionID != first.SessionID {
		t.Fatalf("target = %+v", target)
	}
	if len(target.Parts) == 0 || len(target.Parts) > 3 {
		t.Fatalf("parts = %d, want only the missing ones", len(target.Parts))
	}
	for _, p := range target.Parts {
		if p.PartNumber == 1 {
			t.Fatalf("part 1 is uploaded but was signed again")
		}
	}
}

func (e *docStorageEnv) folderAuditCount(t *testing.T, action, batchID string) int {
	t.Helper()
	return e.folderUploadCount(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, batchID)
}

func TestFolderUploadCancelClosesTheBatchOnceAndKeepsTheTree(t *testing.T) {
	env, rec := newFolderBatchEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	b := env.planFolderBatch(t)
	folders := env.folderCount(t)

	got, err := env.svc.CancelFolderUpload(ctx, member, env.tn.wsA, b.ID)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got.Status != "canceled" || got.Counts != (FolderUploadCounts{Total: 2, Pending: 2}) {
		t.Fatalf("batch = %+v", got)
	}
	for _, f := range got.Files {
		if f.Target != nil {
			t.Fatalf("canceled batch carries a target: %+v", f)
		}
	}
	if n := rec.canceledCount(); n != 2 {
		t.Fatalf("FileService cancels = %d, want one per pending file", n)
	}
	// The folders the plan created stay.
	if env.folderCount(t) != folders {
		t.Fatalf("folders = %d, want %d", env.folderCount(t), folders)
	}
	if d := env.doc(t, b.RootFolderID); d.ArchivedAt.Valid {
		t.Fatalf("root folder archived: %+v", d)
	}
	var pending int
	if err := env.f.pool.QueryRow(ctx, `SELECT (metadata::jsonb->>'pending_count')::int FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentsFolderUploadCanceled, b.ID).Scan(&pending); err != nil || pending != 2 {
		t.Fatalf("audit pending_count = %d, %v", pending, err)
	}

	// A second cancel answers the same batch and writes nothing more.
	again, err := env.svc.CancelFolderUpload(ctx, member, env.tn.wsA, b.ID)
	if err != nil || again.Status != "canceled" || again.Counts != got.Counts || len(again.Files) != len(got.Files) {
		t.Fatalf("second cancel = %+v, %v", again, err)
	}
	if n := env.folderAuditCount(t, audit.ActionDocumentsFolderUploadCanceled, b.ID); n != 1 {
		t.Fatalf("canceled audit rows = %d, want 1", n)
	}
	if n := rec.canceledCount(); n != 2 {
		t.Fatalf("second cancel released again: %d", n)
	}
	// GET after cancel is the same canceled batch, not a refusal.
	if g, err := env.svc.GetFolderUpload(ctx, member, env.tn.wsA, b.ID); err != nil || g.Status != "canceled" {
		t.Fatalf("get after cancel = %+v, %v", g, err)
	}
}

func TestFolderUploadCancelLeavesDoneFilesAndCountsOnlyPending(t *testing.T) {
	env, rec := newFolderBatchEnv(t)
	ctx := context.Background()
	b := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_upload_files SET status = 'done', document_id = 'doc-1' WHERE batch_id = $1 AND file_key = 'f-1'`, b.ID)

	got, err := env.svc.CancelFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID)
	if err != nil || got.Status != "canceled" || got.Counts != (FolderUploadCounts{Total: 2, Done: 1, Pending: 1}) {
		t.Fatalf("cancel = %+v, %v", got, err)
	}
	if n := rec.canceledCount(); n != 1 {
		t.Fatalf("FileService cancels = %d, want 1", n)
	}
	var pending int
	if err := env.f.pool.QueryRow(ctx, `SELECT (metadata::jsonb->>'pending_count')::int FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentsFolderUploadCanceled, b.ID).Scan(&pending); err != nil || pending != 1 {
		t.Fatalf("audit pending_count = %d, %v", pending, err)
	}
}

func TestFolderUploadCancelOfASettledBatchChangesNothing(t *testing.T) {
	env, rec := newFolderBatchEnv(t)
	ctx := context.Background()
	b := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET status = 'completed', finished_at = now() WHERE id = $1`, b.ID)
	got, err := env.svc.CancelFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID)
	if err != nil || got.Status != "completed" {
		t.Fatalf("cancel = %+v, %v", got, err)
	}
	if n := env.folderAuditCount(t, audit.ActionDocumentsFolderUploadCanceled, b.ID); n != 0 {
		t.Fatalf("canceled audit rows = %d, want 0", n)
	}
	if rec.canceledCount() != 0 {
		t.Fatal("a completed batch released uploads")
	}
}

func TestFolderUploadCancelIsCreatorOnlyAndExpiredIsGone(t *testing.T) {
	env, _ := newFolderBatchEnv(t)
	ctx := context.Background()
	b := env.planFolderBatch(t)
	for name, actor := range map[string]Actor{"workspace member": human(env.tn.creator), "other workspace": human(env.tn.bMember)} {
		if _, err := env.svc.CancelFolderUpload(ctx, actor, env.tn.wsA, b.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: err = %v, want not found", name, err)
		}
	}
	var status string
	if err := env.f.pool.QueryRow(ctx, `SELECT status FROM document_folder_uploads WHERE id = $1`, b.ID).Scan(&status); err != nil || status != "open" {
		t.Fatalf("a refused cancel changed the batch: %q, %v", status, err)
	}
	env.execSQL(t, `UPDATE document_folder_uploads SET expires_at = now() - interval '1 hour' WHERE id = $1`, b.ID)
	_, err := env.svc.CancelFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID)
	if ce := wantCoded(t, err, "folder_upload_expired"); ce.Status != http.StatusGone {
		t.Fatalf("status = %d", ce.Status)
	}
}

func TestFolderUploadCancelAbortsTheMultipartUpload(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "folder-cancel")
	b, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, CreateFolderUploadInput{
		RootName: "Lớn", IdempotencyKey: nextIDK(),
		Files: []FolderUploadFileInput{{FileKey: "big", Path: "", Filename: "big.pdf", SizeBytes: 25 << 20, Probe: &probe}},
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sessionID := b.Files[0].Target.SessionID
	if used, _ := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID); used == 0 {
		t.Fatal("the plan reserved no storage")
	}
	if _, err := env.svc.CancelFolderUpload(ctx, member, env.tn.wsA, b.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if env.store.multipartAborts == 0 {
		t.Fatal("expected AbortMultipart on storage")
	}
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, sessionID)
	if err != nil || row.Status != "aborted" {
		t.Fatalf("multipart row = %q, %v", row.Status, err)
	}
	if used, _ := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID); used != 0 {
		t.Fatalf("storage after cancel = %d, want 0", used)
	}
	// Only the folder cancel's one audit row: no upload_session_aborted row.
	if n := env.folderUploadCount(t, `SELECT count(*) FROM audit_events WHERE action = $1`, audit.ActionDocumentUploadSessionAborted); n != 0 {
		t.Fatalf("upload_session_aborted rows = %d, want 0", n)
	}
	if n := env.folderAuditCount(t, audit.ActionDocumentsFolderUploadCanceled, b.ID); n != 1 {
		t.Fatalf("canceled audit rows = %d", n)
	}
}

func TestFolderUploadSweepExpiresOpenBatchesAndDeletesSettledOnes(t *testing.T) {
	env, rec := newFolderBatchEnv(t)
	ctx := context.Background()

	// Settled batches first (a creator holds two open ones at most): one past
	// the week, one inside it.
	old := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET status = 'completed', finished_at = now() - interval '8 days' WHERE id = $1`, old.ID)
	recent := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET status = 'canceled', finished_at = now() - interval '1 day' WHERE id = $1`, recent.ID)
	// Two open batches, one past its expiry; the other stays.
	stale := env.planFolderBatch(t)
	live := env.planFolderBatch(t)
	env.execSQL(t, `UPDATE document_folder_uploads SET expires_at = now() - interval '1 minute' WHERE id = $1`, stale.ID)
	folders := env.folderCount(t)

	n, err := env.svc.SweepFolderUploads(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n == 0 {
		t.Fatal("sweep reported no work")
	}
	var status string
	if err := env.f.pool.QueryRow(ctx, `SELECT status FROM document_folder_uploads WHERE id = $1`, stale.ID).Scan(&status); err != nil || status != "expired" {
		t.Fatalf("stale batch = %q, %v", status, err)
	}
	if err := env.f.pool.QueryRow(ctx, `SELECT status FROM document_folder_uploads WHERE id = $1`, live.ID).Scan(&status); err != nil || status != "open" {
		t.Fatalf("live batch = %q, %v", status, err)
	}
	// The stale batch's two FileService intents were revoked, the live batch's
	// were not. (Other tests leave expired open batches in the shared test
	// database, so the count is read by file id, not in total.)
	if got, want := rec.canceledSet(), env.uploadRefs(t, stale.ID); len(want) != 2 || !got.hasAll(want) {
		t.Fatalf("released uploads = %v, want the stale batch's %v", got, want)
	}
	if got := rec.canceledSet(); got.hasAny(env.uploadRefs(t, live.ID)) {
		t.Fatalf("the live batch's uploads were released: %v", got)
	}
	releasedOnce := rec.canceledCount()
	// One system audit row for the expired batch, carrying the pending count.
	var actorKind string
	var pending int
	if err := env.f.pool.QueryRow(ctx, `SELECT actor_kind, (metadata::jsonb->>'pending_count')::int FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentsFolderUploadExpired, stale.ID).Scan(&actorKind, &pending); err != nil || actorKind != string(audit.KindSystem) || pending != 2 {
		t.Fatalf("expired audit = %q %d, %v", actorKind, pending, err)
	}
	// The old settled batch and its file rows are gone; the recent one stays.
	if c := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_uploads WHERE id = $1`, old.ID); c != 0 {
		t.Fatalf("old settled batch rows = %d", c)
	}
	if c := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_upload_files WHERE batch_id = $1`, old.ID); c != 0 {
		t.Fatalf("old settled batch file rows = %d", c)
	}
	if c := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_upload_files WHERE batch_id = $1`, recent.ID); c != 2 {
		t.Fatalf("recent settled batch file rows = %d", c)
	}
	// The folders the plans created stay.
	if env.folderCount(t) != folders {
		t.Fatalf("folders = %d, want %d", env.folderCount(t), folders)
	}

	// A second pass has nothing to expire: no second audit row, no release.
	if _, err := env.svc.SweepFolderUploads(ctx); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if c := env.folderAuditCount(t, audit.ActionDocumentsFolderUploadExpired, stale.ID); c != 1 {
		t.Fatalf("expired audit rows = %d, want 1", c)
	}
	if got := rec.canceledCount(); got != releasedOnce {
		t.Fatalf("second sweep released again: %d, was %d", got, releasedOnce)
	}
}

func TestFolderUploadSweepAbortsTheMultipartUploadOfAnExpiredBatch(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "folder-sweep")
	b, err := env.svc.CreateFolderUpload(ctx, human(env.tn.member), env.tn.wsA, CreateFolderUploadInput{
		RootName: "Lớn", IdempotencyKey: nextIDK(),
		Files: []FolderUploadFileInput{{FileKey: "big", Path: "", Filename: "big.pdf", SizeBytes: 25 << 20, Probe: &probe}},
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sessionID := b.Files[0].Target.SessionID
	env.execSQL(t, `UPDATE document_folder_uploads SET expires_at = now() - interval '1 minute' WHERE id = $1`, b.ID)
	if _, err := env.svc.SweepFolderUploads(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if env.store.multipartAborts == 0 {
		t.Fatal("expected AbortMultipart on storage")
	}
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, sessionID)
	if err != nil || row.Status != "aborted" {
		t.Fatalf("multipart row = %q, %v", row.Status, err)
	}
	if used, _ := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID); used != 0 {
		t.Fatalf("storage after sweep = %d, want 0", used)
	}
}
