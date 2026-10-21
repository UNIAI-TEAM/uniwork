package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-2052 w2: the server content route and COMPLETE.

// folderTwoFiles is a plan of two PDFs: one under the root, one in "Hợp đồng".
func folderTwoFiles(root string, a, b []byte) CreateFolderUploadInput {
	return CreateFolderUploadInput{
		RootName: root,
		Folders:  []string{"Hợp đồng"},
		Files: []FolderUploadFileInput{
			{FileKey: "f-1", Path: "", Filename: "một.pdf", SizeBytes: int64(len(a))},
			{FileKey: "f-2", Path: "Hợp đồng", Filename: "hai.pdf", SizeBytes: int64(len(b))},
		},
		IdempotencyKey: "plan-" + util.NewID(),
	}
}

func quotedSHA(b []byte) string {
	sum := sha256.Sum256(b)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

// folderFileRef answers a file row's upload_ref and content_etag.
func (e *docStorageEnv) folderFileRef(t *testing.T, batchID, fileKey string) (ref, etag string) {
	t.Helper()
	var r, tag *string
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT upload_ref, content_etag FROM document_folder_upload_files WHERE batch_id = $1 AND file_key = $2`,
		batchID, fileKey).Scan(&r, &tag); err != nil {
		t.Fatal(err)
	}
	if r != nil {
		ref = *r
	}
	if tag != nil {
		etag = *tag
	}
	return ref, etag
}

// writeSigned stands in for the client's PUT to a presigned target: the fake
// takes the bytes as the provider output of the file's intent.
func (e *docStorageEnv) writeSigned(t *testing.T, batchID, fileKey string, body []byte) {
	t.Helper()
	ref, _ := e.folderFileRef(t, batchID, fileKey)
	if ref == "" {
		t.Fatalf("file %s has no signed target", fileKey)
	}
	if err := e.fake.WriteProviderOutput(files.ProviderOutput{FileID: files.FileID(ref)}, body, "application/pdf"); err != nil {
		t.Fatal(err)
	}
}

func (e *docStorageEnv) batchUploadedEvents(t *testing.T, batchID string) int {
	t.Helper()
	return e.folderUploadCount(t, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'batch_id' = $2`, DocumentBatchUploadedTopic, batchID)
}

func (e *docStorageEnv) batchStatus(t *testing.T, batchID string) string {
	t.Helper()
	var s string
	if err := e.f.pool.QueryRow(context.Background(), `SELECT status FROM document_folder_uploads WHERE id = $1`, batchID).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func resultOf(t *testing.T, res FolderUploadCompleteResult, key string) FolderUploadFileOutcome {
	t.Helper()
	for _, r := range res.Results {
		if r.FileKey == key {
			return r
		}
	}
	t.Fatalf("no result for %s in %+v", key, res.Results)
	return FolderUploadFileOutcome{}
}

func TestFolderUploadContentRouteStoresTheBytesAndAnswersTheETag(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	env.svc.SetFiles(unsignedFolderFiles{env.fake})
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("content-a"), pdfBody("content-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Gốc", a, b))
	if err != nil {
		t.Fatal(err)
	}

	etag, err := env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-1", bytes.NewReader(a))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if etag != quotedSHA(a) {
		t.Fatalf("etag = %s, want %s", etag, quotedSHA(a))
	}
	first, stored := env.folderFileRef(t, batch.ID, "f-1")
	if first == "" || stored != etag {
		t.Fatalf("row ref %q etag %q", first, stored)
	}

	// A second PUT of the still pending file replaces the upload.
	if _, err := env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-1", bytes.NewReader(a)); err != nil {
		t.Fatalf("second put: %v", err)
	}
	if again, _ := env.folderFileRef(t, batch.ID, "f-1"); again == "" || again == first {
		t.Fatalf("second put kept ref %q (first %q)", again, first)
	}

	// More bytes than the plan declared: 413 file_too_large, nothing recorded.
	_, err = env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-2", bytes.NewReader(append(b, 'x')))
	if ce := wantCoded(t, err, "file_too_large"); ce.Status != 413 || ce.Fields["max_bytes"] != int64(len(b)) {
		t.Fatalf("too large = %+v", ce)
	}
	if ref, _ := env.folderFileRef(t, batch.ID, "f-2"); ref != "" {
		t.Fatalf("an over-size PUT recorded %q", ref)
	}

	// Only the creator: another member, a stranger and an unknown key get 404.
	if _, err := env.svc.PutFolderUploadContent(ctx, human(env.tn.creator), env.tn.wsA, batch.ID, "f-2", bytes.NewReader(b)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another member: %v", err)
	}
	if _, err := env.svc.PutFolderUploadContent(ctx, human(env.tn.bMember), env.tn.wsA, batch.ID, "f-2", bytes.NewReader(b)); !isGateRefusal(err) {
		t.Fatalf("a stranger: %v", err)
	}
	if _, err := env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "nope", bytes.NewReader(b)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown key: %v", err)
	}

	// A canceled batch is 409, an expired one 410.
	if _, err := env.f.pool.Exec(ctx, `UPDATE document_folder_uploads SET status = 'canceled' WHERE id = $1`, batch.ID); err != nil {
		t.Fatal(err)
	}
	_, err = env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-2", bytes.NewReader(b))
	if ce := wantCoded(t, err, "folder_upload_canceled"); ce.Status != 409 {
		t.Fatalf("canceled = %+v", ce)
	}
	if _, err := env.f.pool.Exec(ctx, `UPDATE document_folder_uploads SET status = 'open', expires_at = now() - interval '1 second' WHERE id = $1`, batch.ID); err != nil {
		t.Fatal(err)
	}
	_, err = env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-2", bytes.NewReader(b))
	if ce := wantCoded(t, err, "folder_upload_expired"); ce.Status != 410 {
		t.Fatalf("expired = %+v", ce)
	}
}

func TestFolderUploadContentRouteRefusesSettledAndSignedFiles(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("signed-a"), pdfBody("signed-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Gốc", a, b))
	if err != nil {
		t.Fatal(err)
	}
	// The store signed a target: the content route does not take it over.
	_, err = env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-1", bytes.NewReader(a))
	if ce := wantCoded(t, err, "folder_upload_target_signed"); ce.Status != 409 {
		t.Fatalf("signed = %+v", ce)
	}
	env.writeSigned(t, batch.ID, "f-1", a)
	if _, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "f-1", ETag: `"x"`}}); err != nil {
		t.Fatal(err)
	}
	_, err = env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-1", bytes.NewReader(a))
	if ce := wantCoded(t, err, "folder_upload_file_settled"); ce.Status != 409 {
		t.Fatalf("settled = %+v", ce)
	}
}

func TestFolderUploadCompleteCreatesDocumentsAuditAndOneEvent(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("complete-a"), pdfBody("complete-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Gốc", a, b))
	if err != nil {
		t.Fatal(err)
	}
	env.writeSigned(t, batch.ID, "f-1", a)
	env.writeSigned(t, batch.ID, "f-2", b)

	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{
		{FileKey: "f-1", ETag: `"etag-1"`}, {FileKey: "f-2", ETag: `"etag-2"`},
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if res.Status != "completed" || res.Counts != (FolderUploadCounts{Total: 2, Done: 2}) {
		t.Fatalf("batch after complete = %s %+v", res.Status, res.Counts)
	}
	folders := map[string]string{}
	for _, f := range batch.Folders {
		folders[f.Path] = f.ID
	}
	for key, folder := range map[string]string{"f-1": folders[""], "f-2": folders["Hợp đồng"]} {
		r := resultOf(t, res, key)
		if r.Status != "done" || r.DocumentID == "" || r.ErrorCode != "" {
			t.Fatalf("%s = %+v", key, r)
		}
		d := env.doc(t, r.DocumentID)
		if d.Kind != DocumentKindFile || d.ParentID.String != folder || d.Visibility != documentVisibilityRestricted || d.CreatedBy != member.ID {
			t.Fatalf("%s document = %+v", key, d)
		}
		if n := env.countOutbox(t, "document.created", r.DocumentID); n != 0 {
			t.Fatalf("%s wrote a document.created event", key)
		}
		if n := env.folderUploadCount(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'batch_id' = $3`,
			audit.ActionDocumentCreated, r.DocumentID, batch.ID); n != 1 {
			t.Fatalf("%s audit rows = %d", key, n)
		}
	}
	if d := env.doc(t, resultOf(t, res, "f-1").DocumentID); d.Title != "một.pdf" {
		t.Fatalf("title = %q", d.Title)
	}
	// One event for the PLAN, one for this call.
	if n := env.batchUploadedEvents(t, batch.ID); n != 2 {
		t.Fatalf("batch_uploaded events = %d, want 2", n)
	}
	if env.batchStatus(t, batch.ID) != "completed" {
		t.Fatal("batch not completed")
	}

	// A replay answers the same documents and writes nothing.
	again, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "f-1", ETag: `"etag-1"`}})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if r := resultOf(t, again, "f-1"); r.Status != "done" || r.DocumentID != resultOf(t, res, "f-1").DocumentID {
		t.Fatalf("replay = %+v", r)
	}
	if n := env.batchUploadedEvents(t, batch.ID); n != 2 {
		t.Fatalf("replay wrote an event: %d", n)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM documents WHERE organization_id = $1 AND kind = 'file'`, env.tn.orgID); n != 2 {
		t.Fatalf("file documents = %d", n)
	}
}

func TestFolderUploadCompleteShareFlagOpensFilesToTheWorkspace(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("share-a"), pdfBody("share-b")
	in := folderTwoFiles("Chung", a, b)
	in.ShareWithWorkspace = true
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatal(err)
	}
	env.writeSigned(t, batch.ID, "f-2", b)
	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "f-2", ETag: `"e"`}})
	if err != nil {
		t.Fatal(err)
	}
	d := env.doc(t, resultOf(t, res, "f-2").DocumentID)
	if d.Visibility != documentVisibilityWorkspace || d.WorkspaceLevel != string(DocumentLevelView) {
		t.Fatalf("shared file = %s/%s", d.Visibility, d.WorkspaceLevel)
	}
	// The folder holding it stays private, and the batch stays open.
	if f := env.doc(t, d.ParentID.String); f.Visibility != documentVisibilityRestricted {
		t.Fatalf("folder visibility = %s", f.Visibility)
	}
	if res.Status != "open" || res.Counts != (FolderUploadCounts{Total: 2, Done: 1, Pending: 1}) {
		t.Fatalf("batch = %s %+v", res.Status, res.Counts)
	}
}

func TestFolderUploadCompletePerFileErrorsAndPartialSuccess(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	good, short, late := pdfBody("partial-good"), pdfBody("partial-short"), pdfBody("partial-late")
	broken := append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("x"), 64)...)
	in := CreateFolderUploadInput{
		RootName: "Lỗi",
		Files: []FolderUploadFileInput{
			{FileKey: "good", Filename: "good.pdf", SizeBytes: int64(len(good))},
			{FileKey: "missing", Filename: "missing.pdf", SizeBytes: int64(len(late))},
			{FileKey: "short", Filename: "short.pdf", SizeBytes: int64(len(short)) + 5},
			{FileKey: "broken", Filename: "broken.pdf", SizeBytes: int64(len(broken))},
		},
		IdempotencyKey: "plan-" + util.NewID(),
	}
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatal(err)
	}
	env.writeSigned(t, batch.ID, "good", good)
	env.writeSigned(t, batch.ID, "short", short)
	env.writeSigned(t, batch.ID, "broken", broken)

	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{
		{FileKey: "missing", ETag: `"m"`}, {FileKey: "good", ETag: `"g"`}, {FileKey: "short", ETag: `"s"`},
		{FileKey: "broken", ETag: `"b"`}, {FileKey: "other-batch", ETag: `"o"`}, {FileKey: "good2", ETag: ""},
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	want := map[string]string{"missing": "upload_missing", "short": "size_mismatch", "broken": "unsupported_media", "other-batch": "not_found", "good2": "not_found"}
	for key, code := range want {
		if r := resultOf(t, res, key); r.Status != "failed" || r.ErrorCode != code || r.DocumentID != "" {
			t.Fatalf("%s = %+v, want failed %s", key, r, code)
		}
	}
	if r := resultOf(t, res, "broken"); r.Reason != "pdf_trailer" {
		t.Fatalf("broken reason = %q", r.Reason)
	}
	if r := resultOf(t, res, "good"); r.Status != "done" || r.DocumentID == "" {
		t.Fatalf("good = %+v", r)
	}
	// AMENDMENT 1 (Q11): upload_missing and size_mismatch keep the file
	// pending and retryable; unsupported_media fails it for good; not_found
	// touches nothing.
	for key, retry := range map[string]bool{"missing": true, "short": true, "broken": false, "other-batch": false} {
		if r := resultOf(t, res, key); r.Retryable != retry {
			t.Fatalf("%s retryable = %v, want %v", key, r.Retryable, retry)
		}
	}
	if res.Status != "open" || res.Counts != (FolderUploadCounts{Total: 4, Done: 1, Failed: 1, Pending: 2}) {
		t.Fatalf("batch = %s %+v", res.Status, res.Counts)
	}
	if n := env.batchUploadedEvents(t, batch.ID); n != 2 {
		t.Fatalf("events = %d, want plan + one", n)
	}
	// The wrong-size upload is dropped, so the next target is a fresh intent.
	if ref, _ := env.folderFileRef(t, batch.ID, "short"); ref != "" {
		t.Fatalf("size_mismatch kept the upload %q", ref)
	}

	// A call where every file fails writes no event; a failed file answers its
	// stored code again, not retryable.
	res, err = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "missing", ETag: `"m"`}, {FileKey: "broken", ETag: `"b"`}})
	if err != nil {
		t.Fatal(err)
	}
	if r := resultOf(t, res, "broken"); r.Status != "failed" || r.ErrorCode != "unsupported_media" || r.Reason != "pdf_trailer" || r.Retryable {
		t.Fatalf("broken replay = %+v", r)
	}
	if n := env.batchUploadedEvents(t, batch.ID); n != 2 {
		t.Fatalf("an all-failed call wrote an event: %d", n)
	}

	// The client retries: a fresh target (minted as GET does), the right
	// bytes, and both pending files land; the batch completes.
	if _, err := env.svc.folderUploadView(ctx, member, env.tn.orgID, env.tn.wsA, batch.ID, true); err != nil {
		t.Fatalf("re-mint: %v", err)
	}
	if ref, _ := env.folderFileRef(t, batch.ID, "short"); ref == "" {
		t.Fatal("no fresh target for the dropped file")
	}
	env.writeSigned(t, batch.ID, "short", sizedPDF("retry", len(short)+5))
	env.writeSigned(t, batch.ID, "missing", late)
	res, err = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "missing", ETag: `"m"`}, {FileKey: "short", ETag: `"s"`}})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"missing", "short"} {
		if r := resultOf(t, res, key); r.Status != "done" {
			t.Fatalf("%s retry = %+v", key, r)
		}
	}
	if res.Status != "completed" || env.batchStatus(t, batch.ID) != "completed" {
		t.Fatalf("batch = %s %+v", res.Status, res.Counts)
	}
}

// A full storage quota fails the file for good (AMENDMENT 1, Q11).
func TestFolderUploadCompleteQuotaFailsTheFile(t *testing.T) {
	env := newRealDocStorageEnv(t, localFileBackend())
	env.svc.SetFiles(unsignedFolderFiles{env.real})
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("quota-a"), pdfBody("quota-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Hạn mức", a, b))
	if err != nil {
		t.Fatal(err)
	}
	etag, err := env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-1", bytes.NewReader(a))
	if err != nil {
		t.Fatal(err)
	}
	env.setStorageLimit(t, 1)
	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "f-1", ETag: etag}})
	if err != nil {
		t.Fatal(err)
	}
	if r := resultOf(t, res, "f-1"); r.Status != "failed" || r.ErrorCode != "storage_quota_exceeded" || r.Retryable {
		t.Fatalf("quota = %+v", r)
	}
	if res.Counts != (FolderUploadCounts{Total: 2, Failed: 1, Pending: 1}) {
		t.Fatalf("counts = %+v", res.Counts)
	}
}

func TestFolderUploadCompleteBatchGates(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Cổng", pdfBody("g-a"), pdfBody("g-b")))
	if err != nil {
		t.Fatal(err)
	}
	many := make([]CompleteFolderUploadFileInput, folderUploadCompleteBatch+1)
	for i := range many {
		many[i] = CompleteFolderUploadFileInput{FileKey: "k" + util.NewID()}
	}
	_, err = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, many)
	if ce := wantCoded(t, err, "invalid_request"); ce.Status != 400 || ce.Fields["max"] != folderUploadCompleteBatch {
		t.Fatalf("too many = %+v", ce)
	}
	one := []CompleteFolderUploadFileInput{{FileKey: "f-1", ETag: `"e"`}}
	if _, err := env.svc.CompleteFolderUpload(ctx, human(env.tn.creator), env.tn.wsA, batch.ID, one); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another member: %v", err)
	}
	if _, err := env.svc.CompleteFolderUpload(ctx, human(env.tn.bMember), env.tn.wsA, batch.ID, one); !isGateRefusal(err) {
		t.Fatalf("a stranger: %v", err)
	}
	if _, err := env.f.pool.Exec(ctx, `UPDATE document_folder_uploads SET status = 'canceled' WHERE id = $1`, batch.ID); err != nil {
		t.Fatal(err)
	}
	_, err = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, one)
	if ce := wantCoded(t, err, "folder_upload_canceled"); ce.Status != 409 {
		t.Fatalf("canceled = %+v", ce)
	}
	if _, err := env.f.pool.Exec(ctx, `UPDATE document_folder_uploads SET status = 'expired' WHERE id = $1`, batch.ID); err != nil {
		t.Fatal(err)
	}
	_, err = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, one)
	if ce := wantCoded(t, err, "folder_upload_expired"); ce.Status != 410 {
		t.Fatalf("expired = %+v", ce)
	}
}

// The local adapter cannot presign, so the whole flow runs through the server
// content route: PLAN, PUT the bytes, COMPLETE with the ETag the PUT answered.
func TestFolderUploadLocalAdapterEndToEnd(t *testing.T) {
	env := newRealDocStorageEnv(t, localFileBackend())
	// The harness signs local writes through its own test server; a store
	// without a signer answers capability_unsupported, which is what this
	// wrapper plays.
	env.svc.SetFiles(unsignedFolderFiles{env.real})
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("local-a"), pdfBody("local-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Cục bộ", a, b))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	for _, f := range batch.Files {
		if f.Target == nil || f.Target.Auth != "session" {
			t.Fatalf("local target = %+v", f.Target)
		}
	}
	etagA, err := env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-1", bytes.NewReader(a))
	if err != nil {
		t.Fatalf("put a: %v", err)
	}
	etagB, err := env.svc.PutFolderUploadContent(ctx, member, env.tn.wsA, batch.ID, "f-2", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("put b: %v", err)
	}
	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{
		{FileKey: "f-1", ETag: etagA}, {FileKey: "f-2", ETag: `"not-the-etag"`},
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if r := resultOf(t, res, "f-2"); r.Status != "failed" || r.ErrorCode != "parts_invalid" {
		t.Fatalf("wrong etag = %+v", r)
	}
	res, err = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "f-2", ETag: etagB}})
	if err != nil {
		t.Fatalf("complete b: %v", err)
	}
	if res.Status != "completed" || res.Counts != (FolderUploadCounts{Total: 2, Done: 2}) {
		t.Fatalf("batch = %s %+v", res.Status, res.Counts)
	}
	docID := resultOf(t, res, "f-2").DocumentID
	f, err := env.svc.OpenDocumentFile(ctx, member, docID, 0, DocumentByteRange{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = f.Reader.Close() }()
	if got := readBytes(t, f.Reader.Body); !bytes.Equal(got, b) {
		t.Fatalf("stored bytes differ")
	}
	if n := env.batchUploadedEvents(t, batch.ID); n != 3 {
		t.Fatalf("events = %d, want plan + two completes", n)
	}
}

// The real FileService with a signed write target: the client PUTs to the URL
// the PLAN answered and COMPLETE verifies the provider output.
func TestFolderUploadSignedTargetEndToEnd(t *testing.T) {
	env := newRealDocStorageEnv(t, localFileBackend())
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("signed-e2e-a"), pdfBody("signed-e2e-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Ký", a, b))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	for _, f := range batch.Files {
		if f.FileKey != "f-1" {
			continue
		}
		req, err := http.NewRequest(f.Target.Method, f.Target.URL, bytes.NewReader(a))
		if err != nil {
			t.Fatal(err)
		}
		for k, v := range f.Target.Headers {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode/100 != 2 {
			t.Fatalf("signed PUT = %d", resp.StatusCode)
		}
	}
	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{
		{FileKey: "f-1", ETag: `"s3-etag"`}, {FileKey: "f-2", ETag: `"s3-etag"`},
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if r := resultOf(t, res, "f-1"); r.Status != "done" || r.DocumentID == "" {
		t.Fatalf("f-1 = %+v", r)
	}
	if r := resultOf(t, res, "f-2"); r.Status != "failed" || r.ErrorCode != "upload_missing" {
		t.Fatalf("f-2 = %+v", r)
	}
	if res.Status != "open" || res.Counts.Pending != 1 {
		t.Fatalf("batch = %s %+v", res.Status, res.Counts)
	}
}

// Four COMPLETE calls of the same signed files at once: the file one call
// finished is never reported failed by another, and every call names the same
// document.
func TestFolderUploadConcurrentCompleteOfSignedFilesAnswersDone(t *testing.T) {
	env := newRealDocStorageEnv(t, localFileBackend())
	ctx := context.Background()
	member := human(env.tn.member)
	a, b := pdfBody("conc-a"), pdfBody("conc-b")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderTwoFiles("Song song", a, b))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	for _, f := range batch.Files {
		body := a
		if f.FileKey == "f-2" {
			body = b
		}
		req, err := http.NewRequest(f.Target.Method, f.Target.URL, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		for k, v := range f.Target.Headers {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode/100 != 2 {
			t.Fatalf("signed PUT = %d", resp.StatusCode)
		}
	}
	const calls = 4
	results := make([]FolderUploadCompleteResult, calls)
	errs := make([]error, calls)
	var wg sync.WaitGroup
	for i := 0; i < calls; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{
				{FileKey: "f-1", ETag: `"s3-etag"`}, {FileKey: "f-2", ETag: `"s3-etag"`},
			})
		}()
	}
	wg.Wait()
	for _, key := range []string{"f-1", "f-2"} {
		var id string
		for i := 0; i < calls; i++ {
			if errs[i] != nil {
				t.Fatalf("call %d: %v", i, errs[i])
			}
			r := resultOf(t, results[i], key)
			if r.Status != "done" || r.DocumentID == "" {
				t.Fatalf("call %d %s = %+v, want done", i, key, r)
			}
			if id == "" {
				id = r.DocumentID
			} else if r.DocumentID != id {
				t.Fatalf("%s answered two documents: %s and %s", key, id, r.DocumentID)
			}
		}
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM documents WHERE organization_id = $1 AND kind <> 'folder'`, env.tn.orgID); n != 2 {
		t.Fatalf("documents = %d, want 2", n)
	}
}

// A multipart file that fails for good (its folder was archived while it
// uploaded) frees its session and reservation instead of leaving them to the
// 24 h expiry.
func TestFolderUploadFinalFailureAbortsTheMultipartSession(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	seedStoragePlan(t, env, 100<<20)
	body, probe := buildLargePDF(25<<20, "folder-final-fail")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, CreateFolderUploadInput{
		RootName: "Lớn", IdempotencyKey: nextIDK(),
		Files: []FolderUploadFileInput{{FileKey: "big", Path: "", Filename: "big.pdf", SizeBytes: 25 << 20, Probe: &probe}},
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sessionID := batch.Files[0].Target.SessionID
	parts := uploadAllParts(t, env, sessionID, body)
	if _, err := env.svc.ArchiveDocument(ctx, member, batch.RootFolderID, ArchiveDocumentInput{IdempotencyKey: nextIDK()}); err != nil {
		t.Fatalf("archive root: %v", err)
	}
	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "big", Parts: parts}})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if r := resultOf(t, res, "big"); r.Status != "failed" || r.ErrorCode != "not_found" || r.Retryable {
		t.Fatalf("big = %+v, want a final not_found", r)
	}
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, sessionID)
	if err != nil || row.Status == "open" {
		t.Fatalf("session after a final failure = %q, %v, want it closed", row.Status, err)
	}
	if used, _ := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID); used != 0 {
		t.Fatalf("storage after a final failure = %d, want 0", used)
	}
}

// A multipart file another COMPLETE is validating answers a retryable
// per-file result; the call itself is a 200 and the file stays pending.
func TestFolderUploadCompleteAnswersBusyPerFile(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	seedStoragePlan(t, env, 100<<20)
	body, probe := buildLargePDF(25<<20, "folder-busy")
	batch, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, CreateFolderUploadInput{
		RootName: "Lớn", IdempotencyKey: nextIDK(),
		Files: []FolderUploadFileInput{{FileKey: "big", Path: "", Filename: "big.pdf", SizeBytes: 25 << 20, Probe: &probe}},
	})
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	sessionID := batch.Files[0].Target.SessionID
	parts := uploadAllParts(t, env, sessionID, body)
	env.execSQL(t, `UPDATE file_multipart_uploads SET status = 'validating', lease_owner = 'other-call',
		lease_expires_at = now() + interval '5 minutes' WHERE id = $1`, sessionID)
	res, err := env.svc.CompleteFolderUpload(ctx, member, env.tn.wsA, batch.ID, []CompleteFolderUploadFileInput{{FileKey: "big", Parts: parts}})
	if err != nil {
		t.Fatalf("complete: %v, want a per-file result", err)
	}
	if r := resultOf(t, res, "big"); r.Status != "failed" || r.ErrorCode != "upload_session_busy" || !r.Retryable {
		t.Fatalf("big = %+v, want a retryable upload_session_busy", r)
	}
	if res.Status != "open" || res.Counts.Pending != 1 || res.Counts.Failed != 0 {
		t.Fatalf("batch = %s %+v, want the file still pending", res.Status, res.Counts)
	}
}
