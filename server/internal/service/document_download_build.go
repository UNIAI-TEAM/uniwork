package service

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentDownloadConsumer builds the zip of a download job on the slow
// outbox lane. It acts as the job's creator: every file goes through
// DocumentService.OpenDocumentFile, the single-file download's own gate and
// access-log side effect, exactly once per file.
type DocumentDownloadConsumer struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	docs  *DocumentService
	files files.Service
}

func NewDocumentDownloadConsumer(pool *pgxpool.Pool, q *db.Queries, docs *DocumentService) *DocumentDownloadConsumer {
	return &DocumentDownloadConsumer{pool: pool, q: q, docs: docs}
}

func (c *DocumentDownloadConsumer) SetFileService(fs files.Service) { c.files = fs }

func (*DocumentDownloadConsumer) Name() string { return "document-download" }

// DeliveryTimeout asks for ten minutes, but the dispatcher caps a delivery at
// its claim lease (outbox maxDeliveryTimeout, 120 s), and that is the real
// budget: read up to 1 GiB, spool the zip, upload it. Entries are stored, not
// deflated (the inputs are already compressed), so the budget is I/O only.
func (*DocumentDownloadConsumer) DeliveryTimeout() time.Duration { return 10 * time.Minute }

func (*DocumentDownloadConsumer) Topics() []string { return []string{DocumentDownloadTopic} }

var (
	errDownloadSettled = errors.New("document download: job already settled")
)

func (c *DocumentDownloadConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.files == nil || c.pool == nil || c.docs == nil {
		return fmt.Errorf("document download: file service is not wired")
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("document download: payload of %s: %w", ev.ID, err)
	}
	jobID, orgID, wsID := payload["job_id"], payload["organization_id"], payload["workspace_id"]
	if jobID == "" || orgID == "" || wsID == "" {
		return nil
	}
	job, err := c.q.GetDocumentDownloadJob(ctx, db.GetDocumentDownloadJobParams{ID: jobID, OrganizationID: orgID, WorkspaceID: wsID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if job.Status == "ready" || job.Status == "failed" {
		return nil
	}
	if n, err := c.q.StartDocumentDownloadJob(ctx, db.StartDocumentDownloadJobParams{ID: jobID, OrganizationID: orgID, WorkspaceID: wsID}); err != nil {
		return c.settle(ctx, ev, job, nil, err)
	} else if n == 0 {
		return nil
	}
	skipped, err := c.build(ctx, job)
	if err != nil {
		return c.settle(ctx, ev, job, skipped, err)
	}
	return nil
}

// settle keeps a transient failure retryable. The last attempt records the
// failure instead, so the job does not stay queued after the outbox parks the
// event.
func (c *DocumentDownloadConsumer) settle(ctx context.Context, ev outbox.Row, job db.DocumentDownloadJob, skipped []DocumentDownloadSkip, err error) error {
	switch {
	case err == nil || errors.Is(err, errDownloadSettled):
		return nil
	case errors.Is(err, context.Canceled):
		return err
	}
	if ev.Attempts+1 < outbox.MaxAttempts {
		return err
	}
	if ferr := c.fail(context.WithoutCancel(ctx), job, downloadErrBuildFails, skipped); ferr != nil {
		return errors.Join(err, ferr)
	}
	return nil
}

func (c *DocumentDownloadConsumer) fail(ctx context.Context, job db.DocumentDownloadJob, reason string, skipped []DocumentDownloadSkip) error {
	raw, err := json.Marshal(nonNilSkips(skipped))
	if err != nil {
		return err
	}
	_, err = c.q.FailDocumentDownloadJob(ctx, db.FailDocumentDownloadJobParams{
		ID: job.ID, OrganizationID: job.OrganizationID, WorkspaceID: job.WorkspaceID,
		Error: pgtype.Text{String: reason, Valid: true}, Skipped: raw,
	})
	return err
}

func nonNilSkips(s []DocumentDownloadSkip) []DocumentDownloadSkip {
	if s == nil {
		return []DocumentDownloadSkip{}
	}
	return s
}

// build zips the files the creator may still download. The plan (which ids go
// in, which are skipped and why) is made first, with no side effect; the
// bytes then stream from storage into the zip writer over a temp file.
func (c *DocumentDownloadConsumer) build(ctx context.Context, job db.DocumentDownloadJob) ([]DocumentDownloadSkip, error) {
	actor := Actor{Kind: audit.Kind(job.CreatedByKind), ID: job.CreatedBy}
	var (
		plan    []downloadTarget
		skipped []DocumentDownloadSkip
		total   int64
	)
	for _, id := range job.DocumentIds {
		t, reason, err := c.docs.classifyDownload(ctx, c.q, actor, job.WorkspaceID, id)
		if err != nil {
			return skipped, err
		}
		if reason == "" && total+t.ver.SizeBytes > documentDownloadMaxBytes {
			reason = downloadSkipTooLarge
		}
		if reason != "" {
			skipped = append(skipped, DocumentDownloadSkip{DocumentID: id, Reason: reason})
			continue
		}
		total += t.ver.SizeBytes
		plan = append(plan, t)
	}
	if len(plan) == 0 {
		return skipped, c.fail(ctx, job, downloadErrNothing, skipped)
	}

	scope := files.Scope{OrganizationID: job.OrganizationID, WorkspaceID: job.WorkspaceID}
	sysActor := audit.System("document-download")
	// The zip is spooled to a temp file, then handed to FileService: reading
	// storage and writing storage never overlap (a FileService may hold its
	// own lock while it reads the body), and no file is held whole in memory.
	spool, err := os.CreateTemp(c.docs.store.spoolDir, "document-download-*.zip")
	if err != nil {
		return skipped, err
	}
	defer func() {
		_ = spool.Close()
		_ = os.Remove(spool.Name())
	}()
	count, late, err := c.writeZip(ctx, spool, actor, plan)
	skipped = append(skipped, late...)
	if err != nil {
		return skipped, err
	}
	if count == 0 {
		// Every planned file was refused at open time (a revoke after the plan).
		return skipped, c.fail(ctx, job, downloadErrNothing, skipped)
	}
	if _, err := spool.Seek(0, io.SeekStart); err != nil {
		return skipped, err
	}
	up, err := c.files.Upload(ctx, files.UploadInput{
		Actor: sysActor, Purpose: files.DocumentDownload, Scope: scope,
		IdempotencyKey: "document-download:" + job.ID,
		Filename:       "documents.zip",
		Body:           spool,
	})
	if err != nil {
		return skipped, c.uploadError(ctx, job, skipped, err)
	}
	if err := c.claimAndComplete(ctx, job, scope, sysActor, up, count, skipped); err != nil {
		if errors.Is(err, errDownloadSettled) {
			if cerr := c.files.CancelUpload(ctx, files.CancelInput{Actor: sysActor, Scope: scope, FileID: up.File.ID}); cerr != nil {
				slog.Warn("document download: losing duplicate upload not canceled", "job", job.ID, "err", cerr)
			}
			return skipped, nil
		}
		return skipped, c.uploadError(ctx, job, skipped, err)
	}
	return skipped, nil
}

// uploadError keeps a storage outage retryable and settles anything else as a
// failed job: the same file would be refused the same way on every retry.
func (c *DocumentDownloadConsumer) uploadError(ctx context.Context, job db.DocumentDownloadJob, skipped []DocumentDownloadSkip, err error) error {
	var fe *files.Error
	if !errors.As(err, &fe) || fe.Code == files.CodeStorageUnavailable {
		return err
	}
	return c.fail(ctx, job, downloadErrBuildFails, skipped)
}

func (c *DocumentDownloadConsumer) claimAndComplete(ctx context.Context, job db.DocumentDownloadJob, scope files.Scope, actor audit.Actor, up files.Upload, count int, skipped []DocumentDownloadSkip) error {
	raw, err := json.Marshal(nonNilSkips(skipped))
	if err != nil {
		return err
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	if _, err := c.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: files.DocumentDownload, Scope: scope, FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		return err
	}
	if _, err := q.CompleteDocumentDownloadJob(ctx, db.CompleteDocumentDownloadJobParams{
		ID: job.ID, OrganizationID: job.OrganizationID, WorkspaceID: job.WorkspaceID,
		FileID:    pgtype.Text{String: string(up.File.ID), Valid: true},
		FileCount: pgtype.Int4{Int32: int32(count), Valid: true},
		Skipped:   raw,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(documentDownloadWindow), Valid: true},
	}); errors.Is(err, pgx.ErrNoRows) {
		return errDownloadSettled
	} else if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// writeZip streams each planned file into the zip. A file the creator lost
// access to between the plan and now is skipped as not_found; the open is the
// call that records the file's download access row.
func (c *DocumentDownloadConsumer) writeZip(ctx context.Context, w io.Writer, actor Actor, plan []downloadTarget) (int, []DocumentDownloadSkip, error) {
	zw := zip.NewWriter(w)
	used := map[string]struct{}{}
	var (
		count int
		late  []DocumentDownloadSkip
	)
	for _, t := range plan {
		f, err := c.docs.OpenDocumentFile(ctx, actor, t.doc.ID, 0, DocumentByteRange{})
		switch {
		case err == nil:
		case isGateRefusal(err):
			late = append(late, DocumentDownloadSkip{DocumentID: t.doc.ID, Reason: downloadSkipNotFound})
			continue
		default:
			_ = zw.Close()
			return count, late, err
		}
		name := uniqueZipEntryName(zipEntryName(f.Document.Title, f.Reader.File.Filename), used)
		hdr := &zip.FileHeader{Name: name, Method: zip.Store, Modified: f.Version.CreatedAt.Time.UTC()}
		ew, err := zw.CreateHeader(hdr)
		if err == nil {
			_, err = io.Copy(ew, f.Reader.Body)
		}
		_ = f.Reader.Close()
		if err != nil {
			_ = zw.Close()
			return count, late, err
		}
		count++
	}
	return count, late, zw.Close()
}

const (
	// Bytes, not runes: ext4 and most unzippers stop at 255 bytes, and a
	// Vietnamese title costs up to three bytes a rune.
	zipEntryBaseMax = 200
	zipEntryExtMax  = 16
)

// windowsReservedStems are device names Windows refuses as a file name with
// any extension.
var windowsReservedStems = map[string]struct{}{
	"con": {}, "prn": {}, "aux": {}, "nul": {},
	"com1": {}, "com2": {}, "com3": {}, "com4": {}, "com5": {}, "com6": {}, "com7": {}, "com8": {}, "com9": {},
	"lpt1": {}, "lpt2": {}, "lpt3": {}, "lpt4": {}, "lpt5": {}, "lpt6": {}, "lpt7": {}, "lpt8": {}, "lpt9": {},
}

// zipEntryName is the document title plus the file's extension, with
// separators, control characters and ".." taken out. A title that already
// ends with the extension is not given it twice.
func zipEntryName(title, filename string) string {
	ext := sanitizeZipPart(path.Ext(strings.ReplaceAll(filename, "\\", "/")))
	ext = strings.ReplaceAll(ext, " ", "")
	if len(ext) > zipEntryExtMax {
		ext = ""
	}
	if ext == "." {
		ext = ""
	}
	base := sanitizeZipPart(title)
	if ext != "" && len(base) >= len(ext) && strings.EqualFold(base[len(base)-len(ext):], ext) {
		base = base[:len(base)-len(ext)]
	}
	base = cutBytesOnRune(strings.Trim(strings.TrimSpace(base), "."), zipEntryBaseMax)
	base = strings.Trim(strings.TrimSpace(base), ".")
	if base == "" {
		base = "document"
	}
	stem, _, _ := strings.Cut(base, ".")
	if _, reserved := windowsReservedStems[strings.ToLower(strings.TrimSpace(stem))]; reserved {
		base = "_" + base
	}
	return base + ext
}

// cutBytesOnRune shortens s to at most n bytes without splitting a rune.
func cutBytesOnRune(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// sanitizeZipPart replaces what an archive tool or file system treats as
// structure and drops what only disguises a name (zero-width and bidi
// controls, which can make "a<RLO>txt.exe" read as another file).
func sanitizeZipPart(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 0x200b && r <= 0x200f, r >= 0x202a && r <= 0x202e, r >= 0x2066 && r <= 0x2069:
		case r < 0x20 || r == 0x7f || r == utf8.RuneError:
			b.WriteRune('_')
		case strings.ContainsRune(`/\:*?"<>|`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := b.String()
	for strings.Contains(out, "..") {
		out = strings.ReplaceAll(out, "..", "_")
	}
	return out
}

// uniqueZipEntryName suffixes a repeat " (2)", " (3)" before the extension.
// Names compare case-insensitively and in NFC: a case-folding or normalising
// file system (APFS, NTFS extractors) would merge two entries that differ only
// in case or in composed vs decomposed accents.
func uniqueZipEntryName(name string, used map[string]struct{}) string {
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	candidate := name
	for n := 2; ; n++ {
		key := norm.NFC.String(strings.ToLower(candidate))
		if _, taken := used[key]; !taken {
			used[key] = struct{}{}
			return candidate
		}
		candidate = fmt.Sprintf("%s (%d)%s", stem, n, ext)
	}
}
