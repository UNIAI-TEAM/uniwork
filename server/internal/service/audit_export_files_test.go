package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// auditFileSpy wraps the fake to record what the consumer asked FileService to
// do — which files were uploaded, claimed, released and canceled — and to let
// a test fail or interleave inside exactly one call. The contract assertions
// stay in filescontract; here the interesting question is what the audit lane
// does with the answers.
type auditFileSpy struct {
	files.Service
	uploads  []files.UploadInput
	claims   []files.ClaimInput
	releases [][]files.FileID
	cancels  []files.CancelInput

	// failClaim, when non-nil, is returned before the fake sees the next
	// ClaimInTx — the claim never happened, which is what a rolled-back module
	// transaction looks like from the real service's side.
	failClaim error
	// onClaim runs inside ClaimInTx before the fake's own logic. It lets a
	// test commit a sibling transaction against the real pool while the
	// consumer's transaction is still open — the losing-race interleave.
	onClaim func()
}

func (s *auditFileSpy) Upload(ctx context.Context, in files.UploadInput) (files.Upload, error) {
	recorded := in
	recorded.Body = nil // the body is already read; it is not the assertion
	s.uploads = append(s.uploads, recorded)
	return s.Service.Upload(ctx, in)
}

func (s *auditFileSpy) ClaimInTx(ctx context.Context, q *db.Queries, in files.ClaimInput) ([]files.File, error) {
	if s.failClaim != nil {
		err := s.failClaim
		s.failClaim = nil
		return nil, err
	}
	if s.onClaim != nil {
		s.onClaim()
	}
	s.claims = append(s.claims, in)
	return s.Service.ClaimInTx(ctx, q, in)
}

func (s *auditFileSpy) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	s.releases = append(s.releases, ids)
	return s.Service.ReleaseInTx(ctx, q, ids)
}

func (s *auditFileSpy) CancelUpload(ctx context.Context, in files.CancelInput) error {
	s.cancels = append(s.cancels, in)
	return s.Service.CancelUpload(ctx, in)
}

// auditFileFixture is the audit fixture with a filesfake wired into both the
// consumer and the service, the way the integrator's SetFileService calls will.
type auditFileFixture struct {
	*auditServiceFixture
	fake     *filesfake.Fake
	spy      *auditFileSpy
	consumer *AuditExportConsumer
}

func newAuditFileFixture(t *testing.T) *auditFileFixture {
	t.Helper()
	f := newAuditServiceFixture(t)
	fake := filesfake.New(filesfake.Options{})
	spy := &auditFileSpy{Service: fake}
	f.svc.SetFileService(spy)
	consumer := NewAuditExportConsumer(f.q, nil)
	consumer.SetFileService(f.svc.pool, spy)
	return &auditFileFixture{auditServiceFixture: f, fake: fake, spy: spy, consumer: consumer}
}

// requestAndRunExportFiles drives one export to completion on the FileService
// path and returns the finished job plus the bytes FileService now serves.
// The consumer's own upload is what stages the file, so this goes red until
// the shared detector accepts CSV/NDJSON bytes (t1c): today every upload is
// refused file_type_rejected and the job is marked failed instead.
func requestAndRunExportFiles(t *testing.T, f *auditFileFixture, format string, from, to time.Time) (db.AuditExport, []byte) {
	t.Helper()
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, format, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !done.CompletedAt.Valid || !done.FileID.Valid {
		t.Fatalf("export did not finish on the FileService path: %+v", done)
	}
	return done, readFileBody(t, f, done)
}

// zipMagic is a body the shared detector reports as application/zip, which the
// audit_export allowlist already accepts. The export's own CSV/NDJSON bytes
// sniff as text/plain until the detector fix lands (t1c), so tests that need
// a completed FileService-backed row — but not the consumer's upload itself —
// stage one with these bytes instead.
var zipMagic = append([]byte("PK\x03\x04"), bytes.Repeat([]byte{0}, 64)...)

// completeExportWithFile stands in for the consumer's finish: it stages one
// file under the export's idempotency command, claims it and completes the
// job row in the same transaction — the exact call sequence
// claimAndComplete runs. It exists so the download and expiry tests prove the
// read/release halves today while the upload half waits on t1c.
func completeExportWithFile(t *testing.T, f *auditFileFixture, format string, from, to time.Time, body []byte) db.AuditExport {
	t.Helper()
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, format, from, to)
	if err != nil {
		t.Fatal(err)
	}
	up, err := f.fake.Upload(f.ctx, files.UploadInput{
		Actor:          audit.System("audit-export"),
		Purpose:        files.AuditExport,
		Scope:          files.Scope{OrganizationID: f.orgA},
		IdempotencyKey: "audit-export:" + exp.ID,
		Filename:       exportFilename(exp),
		Body:           bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("stage upload: %v", err)
	}
	tx, err := f.svc.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	q := f.q.WithTx(tx)
	if _, err := f.fake.ClaimInTx(f.ctx, q, files.ClaimInput{
		Actor:   audit.System("audit-export"),
		Purpose: files.AuditExport,
		Scope:   files.Scope{OrganizationID: f.orgA},
		FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	if _, err := q.CompleteAuditExportWithFile(f.ctx, db.CompleteAuditExportWithFileParams{
		ID:       exp.ID,
		FileID:   pgtype.Text{String: string(up.File.ID), Valid: true},
		RowCount: 1,
	}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func readFileBody(t *testing.T, f *auditFileFixture, done db.AuditExport) []byte {
	t.Helper()
	reader, err := f.fake.Open(f.ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: f.orgA},
		FileID: files.FileID(done.FileID.String),
	})
	if err != nil {
		t.Fatalf("the finished file does not open: %v", err)
	}
	defer reader.Close()
	body, err := io.ReadAll(reader.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

// The FileService path attaches a file_id, never an object_key: the claim runs
// in the completion transaction, the window is still 24 hours, and the
// audit.exported row that notifies the requester lands in the same commit.
func TestAuditExportFilesClaimsTheFileWithTheCompletion(t *testing.T) {
	f := newAuditFileFixture(t)
	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc có dấu"}); err != nil {
		t.Fatal(err)
	}

	done, body := requestAndRunExportFiles(t, f, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	if done.ObjectKey.Valid {
		t.Fatalf("the FileService path wrote a storage key: %q", done.ObjectKey.String)
	}
	if window := done.ExpiresAt.Time.Sub(done.CompletedAt.Time); window != 24*time.Hour {
		t.Fatalf("the completion stamped a %s window, want 24h", window)
	}
	if len(f.spy.claims) != 1 {
		t.Fatalf("claims = %v, want exactly one", f.spy.claims)
	}
	claim := f.spy.claims[0]
	if claim.Purpose != files.AuditExport {
		t.Fatalf("claimed under purpose %s, want %s", claim.Purpose, files.AuditExport)
	}
	if claim.Scope.OrganizationID != f.orgA || claim.Scope.WorkspaceID != "" || claim.Scope.UserID != "" {
		t.Fatalf("claim scope = %+v, want the organization alone", claim.Scope)
	}
	if len(claim.FileIDs) != 1 || string(claim.FileIDs[0]) != done.FileID.String {
		t.Fatalf("claimed files = %v, want the attached %s", claim.FileIDs, done.FileID.String)
	}
	if len(f.spy.uploads) != 1 {
		t.Fatalf("uploads = %v, want exactly one", f.spy.uploads)
	}
	up := f.spy.uploads[0]
	if up.Purpose != files.AuditExport || up.IdempotencyKey != "audit-export:"+done.ID {
		t.Fatalf("upload input = %+v", up)
	}
	if up.Filename != exportFilename(done) {
		t.Fatalf("uploaded as %q, want the export name %q", up.Filename, exportFilename(done))
	}

	// The file carries the same bytes the legacy path wrote: BOM, one CSV row
	// per event, no address column.
	if !bytes.HasPrefix(body, utf8BOM) {
		t.Fatal("the staged CSV lost the UTF-8 BOM")
	}
	recs := csvRecords(t, body)
	if got := int32(len(recs) - 1); got != done.RowCount {
		t.Fatalf("file holds %d data rows but the job reports %d", got, done.RowCount)
	}

	// audit.exported fires once, naming the export, organization and
	// requester — the notification consumer reads exactly these keys.
	var payload string
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT payload FROM outbox_events
		WHERE topic = 'audit.exported' AND organization_id = $1`, f.orgA).Scan(&payload); err != nil {
		t.Fatalf("no audit.exported row: %v", err)
	}
	if !strings.Contains(payload, done.ID) || !strings.Contains(payload, f.orgA) || !strings.Contains(payload, f.ownerA.ID) {
		t.Fatalf("audit.exported payload %q does not name export/org/requester", payload)
	}
}

// A retried delivery must converge on the result the first attempt attached:
// the upload idempotency key replays the staged file rather than making a
// second one, and the finished row is never stamped twice.
func TestAuditExportFilesRetryKeepsTheAttachedResult(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "json",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	row := exportRow(exp.ID, f.orgA)
	if err := f.consumer.Handle(f.ctx, row); err != nil {
		t.Fatal(err)
	}
	first, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.consumer.Handle(f.ctx, row); err != nil {
		t.Fatal(err)
	}
	second, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}

	if len(f.spy.uploads) != 1 {
		t.Fatalf("the retry staged %d uploads, want 1", len(f.spy.uploads))
	}
	if second.FileID != first.FileID {
		t.Fatalf("the retry moved the attachment: %q -> %q", first.FileID.String, second.FileID.String)
	}
	if !second.CompletedAt.Time.Equal(first.CompletedAt.Time) ||
		!second.ExpiresAt.Time.Equal(first.ExpiresAt.Time) {
		t.Fatalf("the retry re-stamped the job: %+v -> %+v", first, second)
	}
}

// A crash after the upload and before the completion leaves the staged file
// behind; the retry's identical idempotency key must replay onto it — same
// file attached, not a sibling object.
func TestAuditExportFilesCrashAfterUploadAttachesTheSameFile(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	// The "crash" is modeled by staging the file outside the consumer with
	// the exact command the consumer will issue, then letting it run.
	staged, err := f.fake.Upload(f.ctx, files.UploadInput{
		Actor:          audit.System("audit-export"),
		Purpose:        files.AuditExport,
		Scope:          files.Scope{OrganizationID: f.orgA},
		IdempotencyKey: "audit-export:" + exp.ID,
		Filename:       exportFilename(exp),
		Body:           bytes.NewReader(append(utf8BOM, []byte("placeholder")...)),
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if done.FileID.String != string(staged.File.ID) {
		t.Fatalf("attached %q, want the pre-staged %q", done.FileID.String, staged.File.ID)
	}
	// The consumer's own Upload call replayed onto the session — it still ran
	// once, but produced no second file.
	if len(f.spy.uploads) != 1 {
		t.Fatalf("uploads = %v, want the replay only", f.spy.uploads)
	}
}

// When the module transaction fails after the claim would have run — here the
// claim itself is made to fail — nothing attaches, the job stays pending, and
// the next delivery completes it on the same staged file.
func TestAuditExportFilesRolledBackCompletionRetriesCleanly(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	f.spy.failClaim = files.StorageUnavailable(errors.New("claim adapter down"))
	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err == nil {
		t.Fatal("the failed claim should surface as an error so the row retries")
	}
	mid, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mid.CompletedAt.Valid || mid.FileID.Valid {
		t.Fatalf("the rolled-back attempt attached a result: %+v", mid)
	}

	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil || !done.CompletedAt.Valid || !done.FileID.Valid {
		t.Fatalf("the retry did not finish the job: err=%v %+v", err, done)
	}
	if len(f.spy.uploads) != 2 {
		t.Fatalf("upload calls = %d; the replay should issue a second call onto the same key", len(f.spy.uploads))
	}
}

// Two deliveries racing to completion must attach exactly one result. The
// loser rolls its transaction back and cancels its staged upload rather than
// leaving a second claim on the row or a stray session behind.
func TestAuditExportFilesLosingDeliveryCancelsItsUpload(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	// The winner: a file the sibling delivery staged and attached in a
	// transaction that commits while the loser's is still open.
	winner, err := f.fake.Upload(f.ctx, files.UploadInput{
		Actor:          audit.System("audit-export"),
		Purpose:        files.AuditExport,
		Scope:          files.Scope{OrganizationID: f.orgA},
		IdempotencyKey: "audit-export:" + exp.ID + ":sibling",
		Filename:       exportFilename(exp),
		Body:           bytes.NewReader(append(utf8BOM, []byte("x")...)),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.spy.onClaim = func() {
		tx, err := f.svc.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		q := f.q.WithTx(tx)
		if _, err := f.fake.ClaimInTx(f.ctx, q, files.ClaimInput{
			Actor:   audit.System("audit-export"),
			Purpose: files.AuditExport,
			Scope:   files.Scope{OrganizationID: f.orgA},
			FileIDs: []files.FileID{winner.File.ID},
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := q.CompleteAuditExportWithFile(f.ctx, db.CompleteAuditExportWithFileParams{
			ID:       exp.ID,
			FileID:   pgtype.Text{String: string(winner.File.ID), Valid: true},
			RowCount: 1,
		}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
	}

	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if done.FileID.String != string(winner.File.ID) {
		t.Fatalf("the winner's attachment moved: %q", done.FileID.String)
	}
	if len(f.spy.cancels) != 1 {
		t.Fatalf("the loser left %d staged sessions behind, want 1 canceled", len(f.spy.cancels))
	}
	// The fake keeps the rolled-back claim in memory (rollback modeling is the
	// contract harness's job), so the CancelUpload itself answers
	// already_claimed here; what matters is the loser tried its own file and
	// not the winner's — the real service's rollback frees it first.
	if f.spy.cancels[0].FileID == winner.File.ID {
		t.Fatal("the loser canceled the winner's file instead of its own")
	}
}

// Failed is as settled as completed: a sibling delivery that marks the job
// failed while this one's claim transaction is still open must not be
// revived by the conditional completion — the loser drops its own staged
// upload and leaves the failure standing.
func TestAuditExportFilesFailedJobIsNotRevived(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	f.spy.onClaim = func() {
		if err := f.q.FailAuditExport(f.ctx, db.FailAuditExportParams{
			ID:    exp.ID,
			Error: pgtype.Text{String: "sibling refused the range", Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !done.FailedAt.Valid || done.CompletedAt.Valid || done.FileID.Valid {
		t.Fatalf("a failed job was revived: %+v", done)
	}
	if len(f.spy.cancels) != 1 {
		t.Fatalf("the loser left %d staged sessions behind, want 1 canceled", len(f.spy.cancels))
	}
}

// The download route checks the permission and the window at read time — the
// API path in download_url is not a standing grant — and serves bytes only
// through FileService's proxy read.
func TestDownloadExportRechecksPermissionAndWindow(t *testing.T) {
	f := newAuditFileFixture(t)
	done := completeExportWithFile(t, f, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour), zipMagic)

	got, err := f.svc.DownloadExport(f.ctx, f.ownerA.ID, f.orgA, done.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer got.Reader.Close()
	if got.Filename != exportFilename(done) {
		t.Fatalf("filename = %q, want %q", got.Filename, exportFilename(done))
	}
	if got.ContentType != auditExportContentType(done.Format) {
		t.Fatalf("content type = %q, want %q", got.ContentType, auditExportContentType(done.Format))
	}
	served, err := io.ReadAll(got.Reader.Body)
	if err != nil || !bytes.Equal(served, zipMagic) {
		t.Fatalf("the route served different bytes: %v", err)
	}

	// An admin reads the audit list but the download still needs the gate —
	// it has it; a plain member and another tenant's owner do not.
	if _, err := f.svc.DownloadExport(f.ctx, f.memberA.ID, f.orgA, done.ID); err != ErrForbidden {
		t.Fatalf("a member downloaded the export: %v", err)
	}
	if _, err := f.svc.DownloadExport(f.ctx, f.ownerB.ID, f.orgA, done.ID); err != ErrForbidden {
		t.Fatalf("another tenant's owner downloaded the export: %v", err)
	}
	if _, err := f.svc.DownloadExport(f.ctx, f.ownerA.ID, f.orgA, "01J8X4NOTHINGATALL0000000"); err != ErrNotFound {
		t.Fatalf("unknown export: %v", err)
	}
	// A row the legacy path completed carries no file_id for this route — same
	// fixture, a second testutil.DB call would truncate this one's members.
	legacyDone, _ := requestAndRunExport(t, f.auditServiceFixture, newMemStorage(), "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if _, err := f.svc.DownloadExport(f.ctx, f.ownerA.ID, f.orgA, legacyDone.ID); err != ErrNotFound {
		t.Fatalf("a legacy row should not resolve on the download route: %v", err)
	}

	// Lapsed window: 410, not the bytes.
	if _, err := f.svc.pool.Exec(f.ctx, `UPDATE audit_exports
		SET expires_at = now() - interval '1 minute' WHERE id = $1`, done.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DownloadExport(f.ctx, f.ownerA.ID, f.orgA, done.ID); !codedIs(err, "audit_export_expired") {
		t.Fatalf("expired download: %v, want audit_export_expired", err)
	}
}

// Revoking the membership closes the download immediately — the check is not
// cached from when the export was requested.
func TestDownloadExportDiesWithThePermission(t *testing.T) {
	f := newAuditFileFixture(t)
	done := completeExportWithFile(t, f, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour), zipMagic)
	if err := f.q.DeleteOrganizationMember(f.ctx, db.DeleteOrganizationMemberParams{
		OrganizationID: f.orgA, UserID: f.ownerA.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DownloadExport(f.ctx, f.ownerA.ID, f.orgA, done.ID); err != ErrForbidden {
		t.Fatalf("a removed owner still downloaded: %v", err)
	}
}

// Expiry ends the business reference, not the audit record: the sweep clears
// file_id in the same transaction that releases the file, the job row keeps
// its history, and a failed release leaves the reference standing for the next
// pass rather than dropping it unannounced.
func TestExpiredExportReleasesItsFile(t *testing.T) {
	f := newAuditFileFixture(t)
	done := completeExportWithFile(t, f, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour), zipMagic)

	logBefore, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.pool.Exec(f.ctx, `UPDATE audit_exports
		SET expires_at = now() - interval '1 minute' WHERE id = $1`, done.ID); err != nil {
		t.Fatal(err)
	}

	// A release that FileService cannot record must not lose the reference:
	// fail-closed, the row keeps file_id for the next pass.
	fail := &failingRelease{Service: f.fake, err: files.StorageUnavailable(errors.New("release adapter down"))}
	f.svc.SetFileService(fail)
	f.svc.releaseExpiredExportFiles(f.ctx)
	kept, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, done.ID)
	if err != nil || !kept.FileID.Valid {
		t.Fatalf("a failed release still cleared file_id: err=%v %+v", err, kept)
	}

	f.svc.SetFileService(f.spy)
	f.svc.releaseExpiredExportFiles(f.ctx)
	released, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, done.ID)
	if err != nil {
		t.Fatal(err)
	}
	if released.FileID.Valid {
		t.Fatalf("the expired export still references %q", released.FileID.String)
	}
	if len(f.spy.releases) == 0 || f.spy.releases[0][0] != files.FileID(done.FileID.String) {
		t.Fatalf("releases = %v, want the expired file", f.spy.releases)
	}
	// The job's history is intact — what ran, when, for whom — only the bytes'
	// lease ended.
	if !released.CompletedAt.Valid || !released.ExpiresAt.Valid {
		t.Fatalf("the release erased the job's history: %+v", released)
	}
	logAfter, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{})
	if err != nil || len(logAfter) != len(logBefore) {
		t.Fatalf("the expiry touched audit_events: %d -> %d", len(logBefore), len(logAfter))
	}
	// Running the sweep again finds nothing — release is one-way.
	n := len(f.spy.releases)
	f.svc.releaseExpiredExportFiles(f.ctx)
	if len(f.spy.releases) != n {
		t.Fatal("the second pass released the same file again")
	}
}

// A storage outage is the one refusal worth retrying: the row stays pending so
// the outbox redelivers it, and once the adapter is back the same attempt
// finishes.
func TestAuditExportFilesStorageOutageRetries(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	f.fake.SetStorageDown(true)
	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err == nil {
		t.Fatal("a storage outage must surface so the outbox retries")
	}
	mid, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil || mid.FailedAt.Valid || mid.CompletedAt.Valid {
		t.Fatalf("the outage changed the job state: err=%v %+v", err, mid)
	}
	f.fake.SetStorageDown(false)
	if err := f.consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil || !done.FileID.Valid {
		t.Fatalf("the post-outage retry did not finish: err=%v %+v", err, done)
	}
}

// A refusal that cannot change on retry — the bytes will always be the same —
// fails the job loudly instead of poisoning the outbox forever.
func TestAuditExportFilesPermanentRefusalFailsTheJob(t *testing.T) {
	f := newAuditFileFixture(t)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	reject := &rejectingUpload{Service: f.fake, err: files.TypeRejected("text/plain")}
	f.svc.SetFileService(reject)
	consumer := NewAuditExportConsumer(f.q, nil)
	consumer.SetFileService(f.svc.pool, reject)
	if err := consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil || !done.FailedAt.Valid || !done.Error.Valid {
		t.Fatalf("a permanent refusal should fail the job: err=%v %+v", err, done)
	}
}

// failingRelease refuses ReleaseInTx; rejectingUpload refuses Upload. Both
// stand in for contract answers the lane must handle without panicking.
type failingRelease struct {
	files.Service
	err error
}

func (f *failingRelease) ReleaseInTx(context.Context, *db.Queries, []files.FileID) error {
	return f.err
}

type rejectingUpload struct {
	files.Service
	err error
}

func (r *rejectingUpload) Upload(context.Context, files.UploadInput) (files.Upload, error) {
	return files.Upload{}, r.err
}
