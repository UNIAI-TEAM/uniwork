package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// PDF export of the Office Docs web frame (UNI-1013). The genoffice Docs
// renderer is the only one that lays a DOCX out the way the editor shows it,
// so the engine renders the PDF with that renderer in a headless browser
// (docs/office/pdf-export-decision.md). The export is an ordinary office job -
// operation export, docx -> pdf - so it inherits the grant, the per-job
// sandbox and limits, the FileService output intent and idempotency. It
// changes no business state: the job row and a document_access_logs "export"
// row are its record, and no domain event is emitted.

// OfficeExportPDFInput is one export request. Bytes, when set, is the frame's
// unsaved edit of the current version; Version, when > 0, is a stored version
// to render instead. Neither exports the current version; both is invalid.
type OfficeExportPDFInput struct {
	IdempotencyKey string
	Bytes          []byte
	Version        int32
}

// OfficeExportPDF is a completed export: the rendered bytes, opened from
// FileService, and the job that produced them. The caller closes Reader.
// Filename is set by exports that name their file (a page's title).
type OfficeExportPDF struct {
	Reader   files.Reader
	Job      db.OfficeJob
	Filename string
}

// officeExportWait is how long one export request waits for its job; past it
// the request answers engine_timeout and the job settles on its own.
const officeExportWait = 90 * time.Second

// ErrOfficeExportInput is a supplied body that cannot be a DOCX.
var ErrOfficeExportInput = errors.New("office_export_input_invalid")

// ExportFramePDF renders the document (or the supplied edit of its current
// version) to PDF and waits for the result. View access is enough: an export
// is a read.
func (s *DocumentOfficeService) ExportFramePDF(ctx context.Context, actor Actor, documentID string, in OfficeExportPDFInput) (OfficeExportPDF, error) {
	if s.engine == nil || s.files == nil || s.documents == nil {
		return OfficeExportPDF{}, office.ErrNotConfigured
	}
	if in.Bytes != nil && in.Version != 0 {
		return OfficeExportPDF{}, ErrOfficeExportInput
	}
	doc, access, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return OfficeExportPDF{}, err
	}
	if doc.Kind != DocumentKindFile || !doc.FileVersionID.Valid {
		return OfficeExportPDF{}, officeErr("unsupported_operation", "no_file_version")
	}
	job := OfficeJobInput{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		BaseVersionID: doc.FileVersionID.String, BaseRevision: doc.Revision,
		Operation: office.OperationExport, Format: office.FormatDOCX, TargetFormat: office.FormatPDF,
		IdempotencyKey: strings.TrimSpace(in.IdempotencyKey), Deadline: officeExportWait,
		exportBound: true,
	}
	if job.IdempotencyKey == "" {
		// The frame need not send a key: a retry then renders again.
		job.IdempotencyKey = "export:" + s.newID()
	}
	var version *int32
	if file, err := s.documents.currentFileInfo(ctx, doc); err == nil && file != nil {
		version = &file.Version
	}
	switch {
	case in.Bytes != nil:
		input, err := officeExportInputWithCap(in.Bytes, s.documentFileMaxBytes())
		if err != nil {
			return OfficeExportPDF{}, err
		}
		job.input = &input
	case in.Version > 0 && (version == nil || in.Version != *version):
		// An older version renders through the same job: its stored bytes
		// stand in for the current version's, as the frame's edit does.
		input, err := s.versionExportInput(ctx, actor, documentID, in.Version)
		if err != nil {
			return OfficeExportPDF{}, err
		}
		defer input.release()
		job.input = &input
		version = &in.Version
	case in.Version < 0:
		return OfficeExportPDF{}, ErrOfficeExportInput
	}
	return s.runExport(ctx, actor, job, doc, access, version)
}

// runExport starts an export job, waits for it, opens its output and records
// the export read: the tail every export route shares (the frame's PDF, a
// page's DOCX or PDF).
func (s *DocumentOfficeService) runExport(ctx context.Context, actor Actor, job OfficeJobInput, doc db.Document, access DocumentAccess, version *int32) (OfficeExportPDF, error) {
	row, err := s.StartOfficeJob(ctx, actor, job)
	if err != nil {
		return OfficeExportPDF{}, err
	}
	row, err = s.awaitOfficeJob(ctx, row)
	if err != nil {
		return OfficeExportPDF{}, err
	}
	if err := officeJobOutcome(row); err != nil {
		return OfficeExportPDF{}, err
	}
	r, err := s.files.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID},
		FileID: files.FileID(row.OutputFileID.String),
	})
	if err != nil {
		return OfficeExportPDF{}, err
	}
	s.documents.RecordDocumentRead(ctx, actor, doc, access, DocumentAccessExport, version)
	return OfficeExportPDF{Reader: r, Job: row}, nil
}

const officeExportZipMagic = "PK\x03\x04"

type peekedReadCloser struct {
	io.Reader
	io.Closer
}

// versionExportInput reads a stored version's bytes for an export. It is the
// version read of the download route without its "download" access row: the
// caller records the export.
func (s *DocumentOfficeService) versionExportInput(ctx context.Context, actor Actor, documentID string, versionNo int32) (officeInput, error) {
	doc, v, _, err := s.documents.authorizeDocumentVersion(ctx, actor, documentID, versionNo, DocumentLevelView)
	if err != nil {
		return officeInput{}, err
	}
	if v.Kind != DocumentKindFile || !v.FileID.Valid {
		return officeInput{}, ErrNotFound
	}
	scope := files.Scope{OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID}
	in, err := s.readBase(ctx, scope, files.FileID(v.FileID.String), v.ChecksumSha256)
	if err != nil {
		var ee *office.EngineError
		if errors.As(err, &ee) && ee.Code == "upload_bounds" && ee.Reason == "base_too_large" {
			return officeInput{}, officeErr("upload_bounds", "input_too_large")
		}
		return officeInput{}, err
	}
	return peekExportZipMagic(in)
}

// peekExportZipMagic checks the 4-byte ZIP magic on the first stream without
// buffering the rest, then hands the full stream (those 4 bytes followed by
// the unread tail) to the first caller of open.
func peekExportZipMagic(in officeInput) (officeInput, error) {
	rc, err := in.open()
	if err != nil {
		in.release()
		return officeInput{}, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = rc.Close()
			in.release()
		}
	}()
	var magic [len(officeExportZipMagic)]byte
	if _, err := io.ReadFull(rc, magic[:]); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return officeInput{}, ErrOfficeExportInput
		}
		return officeInput{}, err
	}
	if string(magic[:]) != officeExportZipMagic {
		return officeInput{}, ErrOfficeExportInput
	}
	keep = true
	var peeked io.ReadCloser = peekedReadCloser{
		Reader: io.MultiReader(bytes.NewReader(magic[:]), rc),
		Closer: rc,
	}
	open, release := in.open, in.release
	released := false
	in.open = func() (io.ReadCloser, error) {
		if peeked != nil {
			body := peeked
			peeked = nil
			return body, nil
		}
		return open()
	}
	in.release = func() {
		if peeked != nil {
			_ = peeked.Close()
			peeked = nil
		}
		if !released {
			released = true
			release()
		}
	}
	return in, nil
}

// officeExportInputWithCap measures supplied bytes. They must fit the
// DocumentFile cap (the caller's own registry, or the default when maxBytes
// is not positive) and start like a ZIP container; the engine validates the
// rest.
func officeExportInputWithCap(raw []byte, maxBytes int64) (officeInput, error) {
	if maxBytes <= 0 {
		maxBytes = documentFileMaxBytesFor(nil)
	}
	if int64(len(raw)) > maxBytes {
		return officeInput{}, officeErr("upload_bounds", "input_too_large")
	}
	if len(raw) < len(officeExportZipMagic) || string(raw[:len(officeExportZipMagic)]) != officeExportZipMagic {
		return officeInput{}, ErrOfficeExportInput
	}
	sum := sha256.Sum256(raw)
	return bytesInput(raw, hex.EncodeToString(sum[:])), nil
}

// officeExportPoll is the status poll interval while a request waits.
var officeExportPoll = 250 * time.Millisecond

// awaitOfficeJob refreshes a live job until it settles, the job's deadline
// (plus grace) passes, or the request goes away.
func (s *DocumentOfficeService) awaitOfficeJob(ctx context.Context, row db.OfficeJob) (db.OfficeJob, error) {
	for isLiveOfficeState(row.State) {
		if s.pastDeadline(row) {
			return s.settle(ctx, row, office.JobTimedOut, "engine_timeout", "deadline")
		}
		t := time.NewTimer(officeExportPoll)
		select {
		case <-ctx.Done():
			t.Stop()
			return row, ctx.Err()
		case <-t.C:
		}
		next, err := s.Refresh(ctx, row)
		if err != nil {
			return row, err
		}
		row = next
	}
	return row, nil
}

// officeJobOutcome maps a settled job onto the error its caller answers.
func officeJobOutcome(row db.OfficeJob) error {
	switch office.JobState(row.State) {
	case office.JobCompleted:
		if !row.OutputFileID.Valid || row.OutputFileID.String == "" {
			return officeErr("engine_result_invalid", "no_output_file")
		}
		return nil
	case office.JobTimedOut:
		return officeErr("engine_timeout", row.ErrorReason.String)
	case office.JobCancelled:
		return officeErr("engine_cancelled", row.ErrorReason.String)
	default:
		code := row.ErrorCode.String
		if code == "" {
			code = "engine_crashed"
		}
		return officeErr(code, row.ErrorReason.String)
	}
}
