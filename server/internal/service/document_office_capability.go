package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"path"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Office capability and blank creation (G2-07 / UNI-690). The capability
// answer is the product-facing projection of the engine's own table: Go adds
// only what the engine cannot know - the product rule (a bound operation with
// pending evidence is not a product capability) and the synthesized
// create_blank action, which needs both a blank seed and a bound serialize op
// for the document's format.

// officeBlankOperation is the synthesized capability row for "create a new
// blank document of this format". It is not an engine operation: the bytes
// are the engine's serialize output over a server-chosen seed, so the seed
// format decides whether the action exists at all.
const officeBlankOperation = "create_blank"

// OfficeCapabilityRow is one capability row on the wire.
type OfficeCapabilityRow struct {
	Operation        string // engine operation, or create_blank
	Runtime          string
	EvidenceLevel    string
	EngineBound      bool
	ProductSupported bool
	Reason           string
}

// OfficeCapability is the capability answer for one document's format.
type OfficeCapability struct {
	Format        office.Format
	EngineVersion string
	Operations    []OfficeCapabilityRow
}

// Capability answers the engine rows for the document's format plus the
// create_blank row. It reads through the document ACL (view) and never
// reports the engine's address.
func (s *DocumentOfficeService) Capability(ctx context.Context, actor Actor, documentID string) (OfficeCapability, error) {
	if s.engine == nil {
		return OfficeCapability{}, office.ErrNotConfigured
	}
	if s.documents == nil {
		return OfficeCapability{}, fmt.Errorf("office: documents service not wired")
	}
	doc, _, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return OfficeCapability{}, err
	}
	format, err := s.formatForVersion(ctx, doc, nil)
	if err != nil {
		return OfficeCapability{}, err
	}
	res, err := office.Negotiate(ctx, s.engine, format)
	if err != nil {
		return OfficeCapability{}, err
	}
	out := OfficeCapability{Format: format, EngineVersion: res.EngineVersion, Operations: make([]OfficeCapabilityRow, 0, len(res.Capabilities)+1)}
	for _, entry := range res.Capabilities {
		out.Operations = append(out.Operations, OfficeCapabilityRow{
			Operation: entry.Operation, Runtime: string(entry.Runtime), EvidenceLevel: string(entry.EvidenceLevel),
			EngineBound: entry.Supported, ProductSupported: entry.ProductSupported(), Reason: entry.Reason,
		})
	}
	blank, blankReason := blankSupported(format, res)
	out.Operations = append(out.Operations, OfficeCapabilityRow{
		Operation: officeBlankOperation, Runtime: string(office.RuntimeInternalService),
		EvidenceLevel: string(blankEvidenceLevel(blank)), EngineBound: blank,
		ProductSupported: blank, Reason: blankReason,
	})
	return out, nil
}

// blankSupported: only source-text formats have a blank the engine can make
// from nothing. A zero-byte PDF or OOXML package is not a document, so the
// action is absent for them until a format lane binds a blank generator.
func blankSupported(format office.Format, res office.CapabilityResult) (bool, string) {
	switch format {
	case office.FormatMD, office.FormatHTML:
	default:
		return false, "no blank generator is bound for " + string(format) +
			"; an empty Office package is never created (docs/office/g1-g2-evidence.md)"
	}
	if !res.Supports(office.OperationSerialize) {
		return false, "the engine build binds no serialize for " + string(format)
	}
	return true, "engine serialize over the server's blank seed (G2-07a evidence row create-blank)"
}

func blankEvidenceLevel(supported bool) office.EvidenceLevel {
	if supported {
		return office.EvidenceProven
	}
	return office.EvidencePending
}

// formatForVersion maps the document's current file version to an engine
// format. A page document, a missing version or a type no engine lane owns is
// a typed refusal, never a guess. ver may be nil: the current version is read
// then.
func (s *DocumentOfficeService) formatForVersion(ctx context.Context, doc db.Document, ver *db.DocumentVersion) (office.Format, error) {
	if doc.Kind != DocumentKindFile {
		return "", officeErr("unsupported_operation", "page_document")
	}
	if ver == nil {
		current, err := s.documents.currentFileVersion(ctx, s.q, doc)
		if err != nil {
			return "", err
		}
		ver = current
	}
	if ver == nil || !ver.FileID.Valid || ver.FileID.String == "" {
		return "", officeErr("unsupported_operation", "no_file_version")
	}
	f, err := resolveUpload(ctx, s.files, documentScope(doc.OrganizationID, doc.WorkspaceID), ver.FileID.String)
	if err != nil {
		return "", err
	}
	format, ok := officeFormatForFile(f)
	if !ok {
		return "", officeErr("unsupported_operation", "format_not_supported")
	}
	return format, nil
}

// officeFormatForFile maps a verified file record to an engine format. The
// extension decides first: a markdown upload sniffs as text/plain, so the
// content type alone cannot tell md from txt or csv.
func officeFormatForFile(f files.File) (office.Format, bool) {
	switch strings.ToLower(path.Ext(f.Filename)) {
	case ".docx":
		return office.FormatDOCX, true
	case ".xlsx":
		return office.FormatXLSX, true
	case ".pptx":
		return office.FormatPPTX, true
	case ".pdf":
		return office.FormatPDF, true
	case ".md", ".markdown":
		return office.FormatMD, true
	case ".html", ".htm":
		return office.FormatHTML, true
	}
	base, _, _ := strings.Cut(strings.ToLower(f.ContentType), ";")
	switch strings.TrimSpace(base) {
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return office.FormatDOCX, true
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return office.FormatXLSX, true
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return office.FormatPPTX, true
	case "application/pdf":
		return office.FormatPDF, true
	case "text/markdown":
		return office.FormatMD, true
	case "text/html":
		return office.FormatHTML, true
	}
	return "", false
}

// BlankFileInput creates one blank source document (POST
// /workspaces/{workspaceID}/documents/files/blank).
type BlankFileInput struct {
	Format         office.Format
	Title          string
	ParentID       string
	IdempotencyKey string
}

// CreateBlankFile makes a new document whose first version holds bytes the
// engine produced: Go submits a serialize job over a small server-chosen seed
// (an empty file is not a document - the file validator refuses zero bytes),
// verifies the engine's output through FileService and creates the document
// through the one create path, uploading the verified bytes. The intermediate
// provider output is never claimed; FileService collects it after the claim
// window, and a failure before the create leaves nothing but that staged file.
func (s *DocumentOfficeService) CreateBlankFile(ctx context.Context, actor Actor, workspaceID string, in BlankFileInput) (DocumentFileResult, error) {
	if s.engine == nil {
		return DocumentFileResult{}, office.ErrNotConfigured
	}
	if s.documents == nil {
		return DocumentFileResult{}, fmt.Errorf("office: documents service not wired")
	}
	if actor.Kind != audit.KindHuman || actor.ID == "" {
		return DocumentFileResult{}, ErrForbidden
	}
	title := strings.TrimSpace(in.Title)
	seed, filename, ok := blankSeedFor(in.Format, title)
	if !ok {
		// Nothing is registered and nothing is uploaded for a format with no
		// blank generator.
		return DocumentFileResult{}, officeErr("unsupported_operation", "blank_not_bound")
	}
	ws, err := s.documents.ws.RequireMember(ctx, workspaceID, actor.ID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if in.ParentID != "" {
		if _, _, err := s.documents.authorizeDocument(ctx, actor, in.ParentID, DocumentLevelEdit); err != nil {
			return DocumentFileResult{}, err
		}
	}
	orgID, err := s.documents.workspaceOrganization(ctx, ws.WorkspaceID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	res, err := office.Negotiate(ctx, s.engine, in.Format)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if !res.Supports(office.OperationSerialize) {
		return DocumentFileResult{}, officeErr("unsupported_operation", "blank_not_bound")
	}
	scope := files.Scope{OrganizationID: orgID, WorkspaceID: ws.WorkspaceID}
	now := s.now()
	deadline := now.Add(defaultOfficeDeadline)
	if s.maxDL > 0 && deadline.After(now.Add(s.maxDL)) {
		deadline = now.Add(s.maxDL)
	}
	jobID, grantID := s.newID(), s.newID()
	out, err := s.files.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: actor, Purpose: files.DocumentFile, Scope: scope,
		OperationID: officeOperationID(jobID), Deadline: deadline,
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	sum := sha256.Sum256(seed)
	checksum := hex.EncodeToString(sum[:])
	remaining := deadline.Sub(now).Milliseconds()
	if remaining < 1 {
		remaining = 1
	}
	payload, err := json.Marshal(map[string]any{
		"base_revision": 0, "base_version_id": "",
		"input_bytes": base64.StdEncoding.EncodeToString(seed), "input_checksum": checksum, "input_length": len(seed),
		"document_model_ref": "blank:" + jobID,
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	env := office.Envelope{
		RequestID: jobID, ContractVersion: office.ContractVersion, ProtocolVersion: office.ProtocolVersion,
		Operation: office.OperationSerialize, Format: in.Format, DeadlineMs: &remaining,
		IdempotencyKey: jobID, ClientEngineVersion: office.TrustedEngineVersion, GrantID: grantID, Payload: payload,
	}
	window := now.Add(officeGrantWindow)
	if deadline.Before(window) {
		window = deadline
	}
	// The grant's document id names the pending blank, not a document row:
	// the document is created only after the engine's bytes verify.
	grant, err := s.engine.Sign(office.ServiceGrant{
		V: 1, GrantID: grantID, JobID: jobID, ActorID: actor.ID, ActorKind: string(actor.Kind),
		OrganizationID: orgID, WorkspaceID: ws.WorkspaceID, DocumentID: "blank:" + jobID,
		Operation: office.OperationSerialize, Format: in.Format,
		Input: &office.GrantInput{Checksum: checksum, Length: int64(len(seed))},
		Output: &office.GrantOutput{
			FileID: string(out.FileID), URL: out.WriteTarget.URL, Method: out.WriteTarget.Method,
			Headers: out.WriteTarget.Headers, ExpiresAt: millis(out.WriteTarget.ExpiresAt), MaxBytes: documentFileMaxBytes(),
		},
		DeadlineAt: millis(deadline), IssuedAt: millis(now), ExpiresAt: millis(window),
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	js, err := s.engine.Submit(ctx, grant, env)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if js.State != office.JobCompleted {
		return DocumentFileResult{}, blankFailure(js)
	}
	if _, err := s.files.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor: actor, Scope: scope, FileID: out.FileID,
		OperationID: officeOperationID(jobID), ChecksumSHA256: js.OutputChecksum,
	}); err != nil {
		return DocumentFileResult{}, documentFileError(err)
	}
	body, err := s.readVerifiedOutput(ctx, scope, out.FileID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	return s.documents.CreateFileDocument(ctx, actor, ws.WorkspaceID, CreateFileDocumentInput{
		ParentID: in.ParentID, Title: title, Filename: filename,
		Body: bytes.NewReader(body), IdempotencyKey: in.IdempotencyKey,
	})
}

func blankFailure(js office.JobStatus) error {
	if js.Error != nil {
		return officeErr(js.Error.Code, js.Error.Reason)
	}
	return officeErr("engine_result_invalid", "blank_"+string(js.State))
}

// readVerifiedOutput reads a completed provider output back through
// FileService (proxy mode) so the create path uploads the verified bytes.
func (s *DocumentOfficeService) readVerifiedOutput(ctx context.Context, scope files.Scope, id files.FileID) ([]byte, error) {
	r, err := s.files.Open(ctx, files.OpenInput{Scope: scope, FileID: id})
	if err != nil {
		return nil, documentFileError(err)
	}
	defer func() { _ = r.Close() }()
	limit := documentFileMaxBytes()
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, officeErr("upload_bounds", "blank_too_large")
	}
	if len(raw) == 0 {
		return nil, officeErr("engine_result_invalid", "blank_empty_output")
	}
	return raw, nil
}

// blankSeedFor is the starter source the engine serializes into a new blank
// document. It is deliberately non-empty: the file validator refuses a
// zero-byte upload, and the seed is what the engine proves is valid UTF-8 of
// the right type before the first version exists.
func blankSeedFor(format office.Format, title string) ([]byte, string, bool) {
	name := title
	if name == "" {
		name = "Untitled"
	}
	switch format {
	case office.FormatMD:
		return []byte("# " + name + "\n"), "untitled.md", true
	case office.FormatHTML:
		escaped := html.EscapeString(name)
		return []byte("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>" + escaped +
			"</title></head>\n<body>\n<h1>" + escaped + "</h1>\n</body></html>\n"), "untitled.html", true
	default:
		return nil, "", false
	}
}

// OfficeJobRequest is the HTTP-facing start request: the server resolves the
// document's tenant, current version and format, so a caller never sends a
// version id or a format it could get wrong.
type OfficeJobRequest struct {
	Operation        office.Operation
	BaseRevision     int64 // 0 = the document's current revision
	IdempotencyKey   string
	DocumentModelRef string
	Deadline         time.Duration
}

// StartOfficeJobForDocument starts one job on the document's current version.
// It authorizes edit on the document, resolves the format from the verified
// file record, and then runs the normal job path (negotiation and the
// operation gate happen there, before any mutation).
func (s *DocumentOfficeService) StartOfficeJobForDocument(ctx context.Context, actor Actor, documentID string, req OfficeJobRequest) (db.OfficeJob, error) {
	if s.engine == nil {
		return db.OfficeJob{}, office.ErrNotConfigured
	}
	if s.documents == nil {
		return db.OfficeJob{}, fmt.Errorf("office: documents service not wired")
	}
	doc, _, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelEdit)
	if err != nil {
		return db.OfficeJob{}, err
	}
	format, err := s.formatForVersion(ctx, doc, nil)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if req.BaseRevision != 0 && req.BaseRevision != doc.Revision {
		return db.OfficeJob{}, officeErr("base_version_mismatch", "revision")
	}
	if !doc.FileVersionID.Valid || doc.FileVersionID.String == "" {
		return db.OfficeJob{}, officeErr("unsupported_operation", "no_file_version")
	}
	return s.StartOfficeJob(ctx, actor, OfficeJobInput{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		BaseVersionID: doc.FileVersionID.String, BaseRevision: doc.Revision,
		Operation: req.Operation, Format: format, IdempotencyKey: req.IdempotencyKey,
		Deadline: req.Deadline, DocumentModelRef: req.DocumentModelRef,
	})
}

// OfficeJob answers one job of one document: a job id that belongs to another
// document is not found on this path, whatever its tenant.
func (s *DocumentOfficeService) OfficeJob(ctx context.Context, actor Actor, documentID, jobID string) (db.OfficeJob, error) {
	if s.documents == nil {
		return db.OfficeJob{}, fmt.Errorf("office: documents service not wired")
	}
	doc, _, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return db.OfficeJob{}, err
	}
	row, err := s.GetOfficeJob(ctx, actor, doc.OrganizationID, doc.WorkspaceID, jobID)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if row.DocumentID != doc.ID {
		return db.OfficeJob{}, ErrNotFound
	}
	return row, nil
}

// CancelOfficeJobForDocument cancels one job of one document; only the job's
// creator may cancel (the service enforces that).
func (s *DocumentOfficeService) CancelOfficeJobForDocument(ctx context.Context, actor Actor, documentID, jobID string) (db.OfficeJob, error) {
	if s.documents == nil {
		return db.OfficeJob{}, fmt.Errorf("office: documents service not wired")
	}
	doc, _, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelEdit)
	if err != nil {
		return db.OfficeJob{}, err
	}
	row, err := s.CancelOfficeJob(ctx, actor, doc.OrganizationID, doc.WorkspaceID, jobID)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if row.DocumentID != doc.ID {
		return db.OfficeJob{}, ErrNotFound
	}
	return row, nil
}
