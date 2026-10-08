package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
// unsaved edit of the current version; nil exports the current version.
type OfficeExportPDFInput struct {
	IdempotencyKey string
	Bytes          []byte
}

// OfficeExportPDF is a completed export: the rendered bytes, opened from
// FileService, and the job that produced them. The caller closes Reader.
type OfficeExportPDF struct {
	Reader files.Reader
	Job    db.OfficeJob
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
	if in.Bytes != nil {
		input, err := officeExportInput(in.Bytes)
		if err != nil {
			return OfficeExportPDF{}, err
		}
		job.input = &input
	}
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
	var version *int32
	if file, err := s.documents.currentFileInfo(ctx, doc); err == nil && file != nil {
		version = &file.Version
	}
	s.documents.RecordDocumentRead(ctx, actor, doc, access, DocumentAccessExport, version)
	return OfficeExportPDF{Reader: r, Job: row}, nil
}

// officeExportInput measures supplied bytes. They must fit the DocumentFile
// cap and start like a ZIP container; the engine validates the rest.
func officeExportInput(raw []byte) (officeInput, error) {
	if int64(len(raw)) > documentFileMaxBytes() {
		return officeInput{}, officeErr("upload_bounds", "input_too_large")
	}
	if len(raw) < 4 || string(raw[:4]) != "PK\x03\x04" {
		return officeInput{}, ErrOfficeExportInput
	}
	sum := sha256.Sum256(raw)
	return officeInput{bytes: raw, checksum: hex.EncodeToString(sum[:])}, nil
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
