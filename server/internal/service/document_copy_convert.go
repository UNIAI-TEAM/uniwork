package service

import (
	"context"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Q7 accept (G2-07b / UNI-690; docs/office/g1g2/q7-blocker.md "Closing
// test"). A legacy or unsupported source (.xls, .odt) is never edited in
// place: a convert job stages an OOXML output plus the change list, and the
// caller either cancels the job (nothing is created, the output is never
// claimed) or accepts it here - POST /documents/{id}/copies with consent
// "copy" and the job id. Accept creates a new document whose first version is
// the job's output, with provenance (source document, version, revision,
// checksum, format, target format, engine pin) on the copy row. The source
// document, its versions and its history are untouched.

const idempotencyScopeDocumentConvert = "documents.convert_copy"

func errConversionNotAccepted(reason string) error {
	return CodedError{Code: "conversion_not_accepted", Status: http.StatusConflict,
		Msg: "job chuyển đổi không thể chấp nhận", Fields: map[string]any{"reason": reason}}
}

// acceptConversion is CopyDocument with a job id. The caller already passed
// consent and the edit gate on the source.
func (s *DocumentService) acceptConversion(ctx context.Context, fs files.Service, actor Actor, src db.Document, access DocumentAccess, in CopyDocumentInput) (DocumentFileResult, error) {
	job, err := s.q.GetOfficeJob(ctx, db.GetOfficeJobParams{ID: in.JobID, OrganizationID: src.OrganizationID, WorkspaceID: src.WorkspaceID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && job.DocumentID != src.ID) {
		// A job of another document is not found on this path.
		return DocumentFileResult{}, ErrNotFound
	}
	if err != nil {
		return DocumentFileResult{}, err
	}
	if job.CreatedBy != actor.ID {
		// Only the member who saw the change list accepts it.
		return DocumentFileResult{}, ErrForbidden
	}
	if job.Operation != string(office.OperationConvert) || !job.OutputFileID.Valid {
		return DocumentFileResult{}, errConversionNotAccepted("not_a_conversion")
	}
	targetMime, ok := officeTargetMime(office.Format(job.TargetFormat.String))
	if !ok {
		return DocumentFileResult{}, errConversionNotAccepted("target_format")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = copyTitle(src.Title)
	}
	if len([]rune(title)) > 500 {
		return DocumentFileResult{}, Invalid("tên tài liệu tối đa 500 ký tự")
	}
	if in.ParentID != "" {
		if _, _, err := s.authorizeDocument(ctx, actor, in.ParentID, DocumentLevelEdit); err != nil {
			return DocumentFileResult{}, err
		}
	}
	scope := documentScope(src.OrganizationID, src.WorkspaceID)
	opts := IdempotencyOptions{
		Fingerprint:        IdempotencyFingerprint(idempotencyScopeDocumentConvert, src.ID, job.ID, title, in.ParentID),
		RequireFingerprint: true,
	}
	replay, err := PeekIdempotent(ctx, s.q, src.OrganizationID, src.WorkspaceID, idempotencyScopeDocumentConvert, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentFileResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return replayWithAccess(replay.Body, access)
	}
	source, err := s.currentFileVersion(ctx, s.q, src)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if source == nil || source.ID != job.BaseVersionID {
		// The change list describes the job's base; a source that moved on
		// is converted again, never accepted from a stale job.
		return DocumentFileResult{}, errDocumentVersionConflict(src.Revision)
	}
	sourceFile, err := resolveUpload(ctx, fs, scope, source.FileID.String)
	if err != nil {
		return DocumentFileResult{}, err
	}
	filename := convertedFilename(sourceFile.Filename, job.TargetFormat.String)

	var res DocumentFileResult
	err = s.withDocumentMutation(ctx, actor, src.ID, DocumentLevelEdit, func(q *db.Queries, locked db.Document, lockedAccess DocumentAccess) error {
		if locked.ArchivedAt.Valid {
			return errDocumentDeleted()
		}
		replay, commit, err := BeginIdempotent(ctx, q, locked.OrganizationID, locked.WorkspaceID, idempotencyScopeDocumentConvert, in.IdempotencyKey, actor.ID, opts)
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			res, err = replayWithAccess(replay.Body, lockedAccess)
			return err
		}
		if locked.FileVersionID.String != job.BaseVersionID {
			return errDocumentVersionConflict(locked.Revision)
		}
		if in.ParentID != "" {
			if _, err := s.lockPageParent(ctx, q, actor, in.ParentID, locked.OrganizationID, locked.WorkspaceID); err != nil {
				return err
			}
		}
		docID, versionID := util.NewID(), util.NewID()
		// Claim the job first: a cancelled, failed or already accepted job
		// matches nothing, and this whole transaction rolls back.
		claimedJob, err := claimOfficeJobOutputInTx(ctx, q, locked.OrganizationID, locked.WorkspaceID, job.ID, versionID,
			pgtype.Timestamptz{Time: time.Now(), Valid: true})
		if errors.Is(err, ErrOfficeJobNotCommittable) {
			// Name the state the job is in now, not the one read before the
			// lock: a cancel or another accept may have won in between.
			return errConversionNotAccepted(conversionJobState(ctx, q, job))
		}
		if err != nil {
			return err
		}
		if len(claimedJob.Result) == 0 {
			return errConversionNotAccepted("change_list_missing")
		}
		claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: files.DocumentFile, Scope: scope,
			FileIDs: []files.FileID{files.FileID(claimedJob.OutputFileID.String)},
		})
		if err != nil {
			return documentFileError(err)
		}
		out := claimed[0]
		if !officeFormatMime(office.Format(claimedJob.TargetFormat.String), out.ContentType) {
			// The staged bytes must be the target the change list names.
			return errConversionNotAccepted("output_type")
		}
		out.ContentType = targetMime
		if err := s.consumeStorage(ctx, q, actor, locked.OrganizationID, locked.WorkspaceID, out); err != nil {
			return err
		}
		doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
			ID: docID, OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID,
			ParentID: nullText(in.ParentID), Kind: DocumentKindFile, Title: title,
			Visibility:     locked.Visibility,
			SearchText:     documentSearchText(title, ""),
			CurrentVersion: 1, FileVersionID: pgtype.Text{String: versionID, Valid: true},
			Revision:   1,
			AclOwnerID: locked.AclOwnerID,
			// Provenance (C-01 §14.3, DOC-005 §7.1): the source tuple the job
			// converted - its checksum is the one Go measured when it read the
			// base for the engine - and the engine build that converted it.
			SourceDocumentID:     pgtype.Text{String: locked.ID, Valid: true},
			SourceVersionID:      pgtype.Text{String: source.ID, Valid: true},
			SourceRevision:       pgtype.Int8{Int64: claimedJob.BaseRevision, Valid: true},
			SourceFormat:         source.MimeType,
			SourceEngine:         pgtype.Text{String: office.TrustedEngineVersion, Valid: true},
			TargetFormat:         pgtype.Text{String: targetMime, Valid: true},
			SourceChecksumSha256: pgtype.Text{String: claimedJob.InputChecksum, Valid: true},
			ConversionReason:     pgtype.Text{String: "convert", Valid: true},
			CreatedBy:            actor.ID, CreatedByKind: string(actor.Kind),
			UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
			LastVersionAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			return err
		}
		version, err := q.InsertDocumentVersion(ctx, fileVersionParams(doc, versionID, 1, "upload", actor, out, officeEngineInfo(), pgtype.Int4{}))
		if err != nil {
			return err
		}
		if err := copyDocumentShares(ctx, q, locked, doc, actor); err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentCreated, ResourceType: "document", ResourceID: doc.ID,
			Changes: audit.Diff(nil, map[string]any{
				"title": doc.Title, "kind": doc.Kind, "version_id": version.ID, "file_id": string(out.ID),
				"source_document_id": locked.ID, "source_version_id": source.ID, "reason": "convert",
				"office_job_id": claimedJob.ID, "target_format": claimedJob.TargetFormat.String,
			}),
		}, audit.Event{Topic: "document.created", Payload: map[string]string{
			"document_id": doc.ID, "workspace_id": locked.WorkspaceID,
		}}); err != nil {
			return err
		}
		access, err := s.effectiveLevel(ctx, q, actor, doc)
		if err != nil {
			return err
		}
		res = DocumentFileResult{Document: doc, Version: version, File: fileInfoOf(version, filename), Access: access}
		return storeDocumentFileResult(commit, http.StatusCreated, res)
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	return res, nil
}

// conversionJobState is the refusal reason for a job whose claim matched
// nothing, read inside the refusing transaction: job_committed once another
// accept won, else job_<state>.
func conversionJobState(ctx context.Context, q *db.Queries, job db.OfficeJob) string {
	now, err := q.GetOfficeJob(ctx, db.GetOfficeJobParams{ID: job.ID, OrganizationID: job.OrganizationID, WorkspaceID: job.WorkspaceID})
	if err != nil {
		return "job_not_committable"
	}
	if now.CommittedVersionID.Valid {
		return "job_committed"
	}
	return "job_" + now.State
}

// officeTargetMime is the storage content type of a Q7 conversion target.
func officeTargetMime(format office.Format) (string, bool) {
	switch format {
	case office.FormatXLSX:
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true
	case office.FormatDOCX:
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", true
	}
	return "", false
}

// convertedFilename names the copy's file after its source with the target
// extension ("budget.xls" -> "budget.xlsx").
func convertedFilename(source, target string) string {
	base := strings.TrimSuffix(source, path.Ext(source))
	if strings.TrimSpace(base) == "" {
		base = "converted"
	}
	return base + "." + target
}
