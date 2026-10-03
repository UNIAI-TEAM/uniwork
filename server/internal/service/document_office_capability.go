package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

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

// officeBlankPollInterval is how often the blank path re-reads the engine job
// while its serialize runs: blank seeds are tiny, so a request pays a few
// polls in the normal case.
const officeBlankPollInterval = 150 * time.Millisecond

// OfficeCapabilityRow is one capability row on the wire.
type OfficeCapabilityRow struct {
	Operation        string // engine operation, or create_blank
	Runtime          string
	EvidenceLevel    string
	EngineBound      bool
	ProductSupported bool
	Reason           string
	// TargetFormat is the convert row's one output format (Q7); empty on
	// every other row.
	TargetFormat string
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
	var current *db.DocumentVersion
	if doc.Kind == DocumentKindFile {
		if current, err = s.documents.currentFileVersion(ctx, s.q, doc); err != nil {
			return OfficeCapability{}, err
		}
	}
	format, err := s.formatForVersion(ctx, doc, current)
	if err != nil {
		return OfficeCapability{}, err
	}
	res, err := office.Negotiate(ctx, s.engine, format)
	if err != nil {
		return OfficeCapability{}, err
	}
	// Rollback rule: bytes a newer engine build committed are not opened by
	// this one, so every engine row reads unsupported for this version while
	// download and recovery (not engine operations) stay.
	unreadable := current != nil && !office.CanReadEngineVersion(current.EngineVersion.String)
	out := OfficeCapability{Format: format, EngineVersion: res.EngineVersion, Operations: make([]OfficeCapabilityRow, 0, len(res.Capabilities)+1)}
	for _, entry := range res.Capabilities {
		row := OfficeCapabilityRow{
			Operation: entry.Operation, Runtime: string(entry.Runtime), EvidenceLevel: string(entry.EvidenceLevel),
			EngineBound: entry.Supported, ProductSupported: entry.ProductSupported(), Reason: entry.Reason,
		}
		if office.Operation(entry.Operation) == office.OperationConvert {
			row.TargetFormat = string(office.ConvertTargets[format])
		}
		if unreadable {
			row.ProductSupported = false
			row.Reason = "engine_incompatible: version written by " + current.EngineVersion.String
		}
		out.Operations = append(out.Operations, row)
	}
	blank, blankReason := blankSupported(format, res)
	out.Operations = append(out.Operations, OfficeCapabilityRow{
		Operation: officeBlankOperation, Runtime: string(office.RuntimeInternalService),
		EvidenceLevel: string(blankEvidenceLevel(blank)), EngineBound: blank,
		ProductSupported: blank, Reason: blankReason,
	})
	return out, nil
}

// blankSupported: source-text formats and XLSX (G2-07b: a minimal workbook
// seed) have a blank the engine makes. A zero-byte PDF or OOXML package is not
// a document, so the action is absent for DOCX, PPTX and PDF until a format
// lane binds a blank generator.
func blankSupported(format office.Format, res office.CapabilityResult) (bool, string) {
	switch format {
	case office.FormatMD, office.FormatHTML, office.FormatXLSX:
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
	if path.Ext(f.Filename) == "" {
		// The extension decides when the file has one: a markdown upload
		// sniffs as text/plain, so only the name can tell md from txt. A
		// provider output has no extension (it carries the placeholder name
		// "file"), so the version's own mime is authoritative there - the
		// office commit path keeps it the document's format.
		if format, ok := officeFormatFromMime(ver.MimeType.String); ok {
			return format, nil
		}
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
	case ".xls":
		return office.FormatXLS, true
	case ".odt":
		return office.FormatODT, true
	}
	return officeFormatFromMime(f.ContentType)
}

// officeFormatFromMime maps a verified content type to an engine format. Only
// the six formats' own spellings: text/plain stays unmapped (a .txt file is
// not an office document, and office output that sniffs as text/plain is
// resolved from the version's mime instead).
func officeFormatFromMime(contentType string) (office.Format, bool) {
	base, _, _ := strings.Cut(strings.ToLower(contentType), ";")
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
	case "application/vnd.ms-excel":
		return office.FormatXLS, true
	case "application/vnd.oasis.opendocument.text":
		return office.FormatODT, true
	}
	return "", false
}

// officeOutputKeepsFormat reports whether an office job output may carry a
// mime spelling different from the document's: only inside the job's own
// format family. A nameless provider output makes markdown text sniff as
// text/plain (FS-C1 §4); nothing else may drift. The commit path calls this
// when it would otherwise refuse a format change.
func officeOutputKeepsFormat(jobFormat, current, incoming string) bool {
	format := office.Format(jobFormat)
	return officeFormatMime(format, current) && officeFormatMime(format, incoming)
}

// officeFormatMime reports whether one storage content type is a valid
// spelling of an engine format.
func officeFormatMime(format office.Format, mime string) bool {
	base, _, _ := strings.Cut(strings.ToLower(mime), ";")
	base = strings.TrimSpace(base)
	switch format {
	case office.FormatMD:
		return base == "text/markdown" || base == "text/plain"
	case office.FormatHTML:
		return base == "text/html"
	case office.FormatPDF:
		return base == "application/pdf"
	case office.FormatDOCX:
		return base == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case office.FormatXLSX:
		return base == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case office.FormatPPTX:
		return base == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case office.FormatXLS:
		return base == "application/vnd.ms-excel"
	case office.FormatODT:
		return base == "application/vnd.oasis.opendocument.text"
	}
	return false
}

// BlankFileInput creates one blank source document (POST
// /workspaces/{workspaceID}/documents/files/blank). Format is the wire
// string; the service parses it against the six-format allowlist.
type BlankFileInput struct {
	Format         string
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
	format, ok := parseOfficeFormat(in.Format)
	if !ok {
		return DocumentFileResult{}, Invalid("format must be one of docx, xlsx, pptx, pdf, md, html")
	}
	title := strings.TrimSpace(in.Title)
	seed, filename, ok := blankSeedFor(format, title)
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
	// A retried key is answered before the engine runs again.
	if res, ok, err := s.replayBlank(ctx, actor, orgID, ws.WorkspaceID, in, title, filename); ok || err != nil {
		return res, err
	}
	res, err := office.Negotiate(ctx, s.engine, format)
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
	// A blank has no base version; the engine's grant contract requires a
	// non-empty base_version_id, and the value binds the payload to the grant.
	blankRef := "blank:" + jobID
	payload, err := json.Marshal(map[string]any{
		"base_revision": 0, "base_version_id": blankRef,
		"input_bytes": base64.StdEncoding.EncodeToString(seed), "input_checksum": checksum, "input_length": len(seed),
		"document_model_ref": "blank:" + jobID,
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	env := office.Envelope{
		RequestID: jobID, ContractVersion: office.ContractVersion, ProtocolVersion: office.ProtocolVersion,
		Operation: office.OperationSerialize, Format: format, DeadlineMs: &remaining,
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
		OrganizationID: orgID, WorkspaceID: ws.WorkspaceID, DocumentID: blankRef,
		Operation: office.OperationSerialize, Format: format,
		BaseVersionID: blankRef,
		Input:         &office.GrantInput{Checksum: checksum, Length: int64(len(seed))},
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
	// The submit answer is accepted/running, never completed: the blank exists
	// only once the engine's bytes exist. Poll the job under the same grant -
	// a status read is not bound by the grant's start window - until it
	// settles or the blank's deadline passes.
	for isLiveOfficeState(string(js.State)) {
		if !s.now().Before(deadline) {
			return DocumentFileResult{}, officeErr("engine_timeout", "blank_deadline")
		}
		select {
		case <-ctx.Done():
			return DocumentFileResult{}, ctx.Err()
		case <-time.After(officeBlankPollInterval):
		}
		if js, err = s.engine.Status(ctx, jobID, grant); err != nil {
			return DocumentFileResult{}, err
		}
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
		engine: officeEngineInfo(),
	})
}

// replayBlank answers a blank-create key that already holds a result without
// a second engine run. The create's own fingerprint covers the engine's
// bytes, which do not exist yet, so the stored document stands in for it: a
// different title, parent or format under the same key is a payload
// mismatch, never someone else's document.
func (s *DocumentOfficeService) replayBlank(ctx context.Context, actor Actor, orgID, workspaceID string, in BlankFileInput, title, filename string) (DocumentFileResult, bool, error) {
	key := strings.TrimSpace(in.IdempotencyKey)
	if key == "" {
		return DocumentFileResult{}, false, nil
	}
	stored, err := PeekIdempotent(ctx, s.q, orgID, workspaceID, idempotencyScopeDocumentFileCreate, key, actor.ID, IdempotencyOptions{})
	if err != nil {
		return DocumentFileResult{}, false, NormalizeIdempotencyError(err)
	}
	if stored == nil {
		return DocumentFileResult{}, false, nil
	}
	prev, err := decodeDocumentFileResult(stored.Body)
	if err != nil {
		return DocumentFileResult{}, false, err
	}
	want := title
	if want == "" {
		want = strings.TrimSpace(files.SanitizeFilename(filename))
	}
	// The key scope is shared with the plain upload route; only a result the
	// blank path wrote carries the engine pin (a request can never set it).
	if prev.Version.EngineName.String != officeEngineInfo().Name ||
		prev.Document.Title != want || prev.Document.ParentID.String != in.ParentID ||
		!strings.EqualFold(path.Ext(prev.File.Filename), path.Ext(filename)) {
		return DocumentFileResult{}, false, errIdempotencyPayloadMismatch()
	}
	res, err := s.documents.replayCreatedFile(ctx, s.q, actor, stored.Body)
	return res, true, err
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
	case office.FormatXLSX:
		// The workbook carries no title: the document row holds it.
		seed := blankXLSXSeed()
		return seed, "untitled.xlsx", seed != nil
	default:
		return nil, "", false
	}
}

// OfficeJobRequest is the HTTP-facing start request: the server resolves the
// document's tenant, current version and format, so a caller never sends a
// version id or a format it could get wrong. Operation is the wire string;
// the service parses it against the allowlist.
type OfficeJobRequest struct {
	Operation string
	// Format, when set, must equal the document's format; it never picks one.
	Format string
	// BaseRevision is the revision the caller saw; HasBaseRevision tells an
	// explicit 0 from "the document's current revision".
	BaseRevision     int64
	HasBaseRevision  bool
	IdempotencyKey   string
	DocumentModelRef string
	// Edits are accepted only for operation=edit and are bounded before any
	// output reservation or office_jobs insert.
	Edits    []office.EditOp
	Deadline time.Duration
	// TargetFormat is a convert job's output format (xlsx for xls, docx for
	// odt); any other operation must leave it empty.
	TargetFormat string
}

// StartOfficeJobForDocument starts one job on the document's current version.
// It authorizes view for open and edit for every other operation, resolves the
// format from the verified file record, and then runs the normal job path
// (negotiation and the operation gate happen there, before any mutation).
func (s *DocumentOfficeService) StartOfficeJobForDocument(ctx context.Context, actor Actor, documentID string, req OfficeJobRequest) (db.OfficeJob, error) {
	if s.engine == nil {
		return db.OfficeJob{}, office.ErrNotConfigured
	}
	if s.documents == nil {
		return db.OfficeJob{}, fmt.Errorf("office: documents service not wired")
	}
	doc, _, err := s.documents.authorizeDocument(ctx, actor, documentID, officeJobRequiredLevel(office.Operation(strings.TrimSpace(req.Operation))))
	if err != nil {
		return db.OfficeJob{}, err
	}
	operation, ok := parseOfficeOperation(req.Operation)
	if !ok {
		return db.OfficeJob{}, ErrOfficeJobInvalid
	}
	if err := validateOfficeJobEdits(operation, req.Edits); err != nil {
		return db.OfficeJob{}, err
	}
	var target office.Format
	if req.TargetFormat != "" {
		if target, ok = parseOfficeFormat(req.TargetFormat); !ok {
			return db.OfficeJob{}, ErrOfficeJobInvalid
		}
	}
	// A retried key replays its own job: once its output is committed the
	// document has moved on, so the base comes from the row, not from the
	// document as it is now. A changed payload still fails the fingerprint.
	if existing, err := s.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, IdempotencyKey: strings.TrimSpace(req.IdempotencyKey),
	}); err == nil && existing.DocumentID == doc.ID {
		if req.Format != "" && req.Format != existing.Format {
			return db.OfficeJob{}, ErrOfficeJobInvalid
		}
		revision := existing.BaseRevision
		if req.HasBaseRevision {
			revision = req.BaseRevision
		}
		return s.StartOfficeJob(ctx, actor, OfficeJobInput{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			BaseVersionID: existing.BaseVersionID, BaseRevision: revision,
			Operation: operation, Format: office.Format(existing.Format), IdempotencyKey: req.IdempotencyKey,
			Deadline: req.Deadline, DocumentModelRef: req.DocumentModelRef, Edits: req.Edits, TargetFormat: target,
		})
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.OfficeJob{}, err
	}
	format, err := s.formatForVersion(ctx, doc, nil)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if req.Format != "" && req.Format != string(format) {
		return db.OfficeJob{}, ErrOfficeJobInvalid
	}
	if req.HasBaseRevision && req.BaseRevision != doc.Revision {
		return db.OfficeJob{}, officeErr("base_version_mismatch", "revision")
	}
	if !doc.FileVersionID.Valid || doc.FileVersionID.String == "" {
		return db.OfficeJob{}, officeErr("unsupported_operation", "no_file_version")
	}
	return s.StartOfficeJob(ctx, actor, OfficeJobInput{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		BaseVersionID: doc.FileVersionID.String, BaseRevision: doc.Revision,
		Operation: operation, Format: format, IdempotencyKey: req.IdempotencyKey,
		Deadline: req.Deadline, DocumentModelRef: req.DocumentModelRef, Edits: req.Edits, TargetFormat: target,
	})
}

// validateOfficeJobEdits is the pre-storage gate for one job's edit list. The
// loop-level bounds stay where they were (operation scope, the 10k op count
// and the marshalled-size bound), then every edit's op name must be in the
// bound vocabulary and pass its per-op-kind validator. A name outside the
// table is refused outright: the engine parser would answer unsupported, but
// a job row is never created for a vocabulary this service does not bind.
//
// The bound vocabulary is the xlsx bind set. Edits are the shared,
// format-agnostic envelope field and this gate keys on op name alone, so a
// future non-xlsx edit lane (pdf/docx) that carries its own op names through
// the same jobs API must add a format dimension (the resolved format is in
// scope at both call sites) before those names are accepted.
func validateOfficeJobEdits(operation office.Operation, edits []office.EditOp) error {
	if operation != office.OperationEdit && len(edits) > 0 {
		return ErrOfficeJobInvalid
	}
	if len(edits) > maxOfficeEditOps {
		return ErrOfficeJobInvalid
	}
	if len(edits) == 0 {
		return nil
	}
	raw, err := json.Marshal(edits)
	if err != nil || len(raw) > maxOfficeEditsSize {
		return ErrOfficeJobInvalid
	}
	for _, edit := range edits {
		if strings.TrimSpace(edit.Op) == "" {
			return ErrOfficeJobInvalid
		}
		validate, bound := officeEditValidators[edit.Op]
		if !bound || !validate(edit) {
			return ErrOfficeJobInvalid
		}
	}
	return nil
}

// officeEditValidators is the per-op-kind validation table for the edit
// vocabulary this service binds. Each entry checks its op deeply enough to be
// real — target shape and OOXML grid, content/attribute/style shapes, text
// and range bounds — before a job row exists. A later op kind adds one entry
// here (beside its TS parser); nothing else in the gate changes.
//
// Deliberate strictness: these validators are stricter than parseXlsxOps on
// malformed shapes that would otherwise reach the engine verbatim — a
// non-object attributes/style value, a non-boolean styleReset, a malformed
// attributes.style beside a valid top-level style, an A1 range with more than
// one ":", and out-of-grid integer range bounds are refused here even where
// the engine's parser would ignore or coerce them. Nothing valid is refused;
// only malformed input fails earlier.
var officeEditValidators = map[string]func(office.EditOp) bool{
	"set_cell":   officeSetCellValid,
	"clear_cell": officeClearCellValid,
	"set_cells":  officeSetCellsValid,
	// Row/column structure (B1). Each validator mirrors its ops.ts parser; the
	// op's fields ride the existing raw attributes object, so the shared edit
	// envelope needs no format-specific schema change.
	"insert_rows":      officeShiftValid(false),
	"remove_rows":      officeShiftValid(false),
	"insert_cols":      officeShiftValid(true),
	"remove_cols":      officeShiftValid(true),
	"set_row_size":     officeSizeValid(false),
	"set_col_size":     officeSizeValid(true),
	"set_rows_hidden":  officeHiddenValid(false),
	"set_cols_hidden":  officeHiddenValid(true),
	"set_rows_outline": officeOutlineValid(false),
	"set_cols_outline": officeOutlineValid(true),
	// Merge/unmerge (B2). The rectangle rides the shared envelope's own range
	// field (EditOp.Range preserves it), matching the upstream StructuralOp
	// merge branch; merges never shift coordinates.
	"merge_cells":   officeMergeValid,
	"unmerge_cells": officeMergeValid,
}

// OOXML grid bounds (ECMA-376): rows 1..1048576, columns A..XFD, mirroring
// the engine's own parser.
const (
	maxOfficeEditRows    = 1_048_576
	maxOfficeEditColumns = 16_384
	// One cell's text/formula bound (ops.ts MAX_TEXT_LEN).
	maxOfficeEditTextLen = 1 << 20
)

var officeA1Pattern = regexp.MustCompile(`^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$`)

// officeA1Index decodes an A1 address ("B5", "$B$5") into 0-based row/column
// inside the OOXML grid.
func officeA1Index(address string) (int, int, bool) {
	m := officeA1Pattern.FindStringSubmatch(address)
	if m == nil {
		return 0, 0, false
	}
	row, err := strconv.Atoi(m[2])
	if err != nil || row < 1 || row > maxOfficeEditRows {
		return 0, 0, false
	}
	column := 0
	for _, letter := range strings.ToUpper(m[1]) {
		column = column*26 + int(letter-'A') + 1
	}
	column--
	if column < 0 || column >= maxOfficeEditColumns {
		return 0, 0, false
	}
	return row - 1, column, true
}

// officeGridIndex decodes a 0-based row/column JSON number inside [0,size).
func officeGridIndex(raw json.RawMessage, size int) (int, bool) {
	if len(raw) == 0 || (raw[0] != '-' && (raw[0] < '0' || raw[0] > '9')) {
		return 0, false
	}
	value, err := strconv.ParseFloat(string(raw), 64)
	if err != nil || value < 0 || value >= float64(size) || value != math.Trunc(value) {
		return 0, false
	}
	return int(value), true
}

// officeSheetRefOK accepts a present sheet name / gateway sheet id: a
// non-empty string. The workbook's real sheet list lives with the engine, so
// the bound check here is the target shape, not the name's existence.
func officeSheetRefOK(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var name string
	if json.Unmarshal(raw, &name) != nil {
		return false
	}
	return strings.TrimSpace(name) != ""
}

// officeTargetOf decodes a target object; nil when the shape is not one.
func officeTargetOf(raw json.RawMessage) map[string]json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	var target map[string]json.RawMessage
	if json.Unmarshal(raw, &target) != nil {
		return nil
	}
	return target
}

// officeTargetSheetOK checks the sheet ref of a decoded target: sheet wins
// over sheetId when both spellings are present, as parseXlsxOps reads it.
func officeTargetSheetOK(target map[string]json.RawMessage) bool {
	if target == nil {
		return false
	}
	if sheet, ok := target["sheet"]; ok {
		return officeSheetRefOK(sheet)
	}
	return officeSheetRefOK(target["sheetId"])
}

// officeCellTargetOK checks the bound cell target shape: a sheet ref plus
// exactly one cell reference — A1 or 0-based row/column — inside the OOXML
// grid.
func officeCellTargetOK(raw json.RawMessage) bool {
	target := officeTargetOf(raw)
	if !officeTargetSheetOK(target) {
		return false
	}
	if cell, ok := target["cell"]; ok {
		var address string
		if json.Unmarshal(cell, &address) != nil {
			return false
		}
		_, _, ok = officeA1Index(address)
		return ok
	}
	if _, ok := officeGridIndex(target["row"], maxOfficeEditRows); !ok {
		return false
	}
	_, ok := officeGridIndex(target["column"], maxOfficeEditColumns)
	return ok
}

// officeRangeTargetOK is the set_cells target bound: parseRange reads the
// target only for its sheet, so a cell/row/column spelling there is ignored
// by the engine rather than required.
func officeRangeTargetOK(raw json.RawMessage) bool {
	return officeTargetSheetOK(officeTargetOf(raw))
}

// officeEditAttributes is the bound attributes object; RawMessage keeps
// presence (including an explicit null) visible.
type officeEditAttributes struct {
	Value      json.RawMessage `json:"value"`
	Formula    json.RawMessage `json:"formula"`
	StyleReset json.RawMessage `json:"styleReset"`
	Style      json.RawMessage `json:"style"`
}

// officeAttributesOf decodes an op's attributes; absent or JSON null is the
// empty object (parseXlsxOps reads attributes only when it is an object), and
// any other non-object shape is refused as malformed.
func officeAttributesOf(raw json.RawMessage) (officeEditAttributes, bool) {
	var attributes officeEditAttributes
	if len(raw) == 0 || string(raw) == "null" {
		return attributes, true
	}
	if json.Unmarshal(raw, &attributes) != nil {
		return attributes, false
	}
	return attributes, true
}

// officeScalarOK accepts the value shape attributes.value may carry: a JSON
// scalar (string, number, boolean, null).
func officeScalarOK(raw json.RawMessage) bool {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	switch value.(type) {
	case nil, string, float64, bool:
		return true
	}
	return false
}

// officeEditContent is the parseCellValue half of set_cell/set_cells: content
// reports text or attributes.value/formula was supplied; valid reports a
// supplied field was well formed (a formula starts with "=", a value is a
// scalar, text stays inside the bound).
func officeEditContent(edit office.EditOp, attributes officeEditAttributes) (content, valid bool) {
	if attributes.Formula != nil {
		var formula string
		if json.Unmarshal(attributes.Formula, &formula) != nil || formula == "" ||
			!strings.HasPrefix(formula, "=") || len(formula) > maxOfficeEditTextLen {
			return false, false
		}
		return true, true
	}
	if attributes.Value != nil {
		if !officeScalarOK(attributes.Value) {
			return false, false
		}
		return true, true
	}
	if len(edit.Text) > maxOfficeEditTextLen {
		return false, false
	}
	return len(edit.Text) > 0, true
}

// officeStyleOf is the parseStyle half: style reports an object style was
// supplied through either spelling (item.style, attributes.style) and reset
// reports the styleReset key was present (its value must be a boolean).
func officeStyleOf(edit office.EditOp, attributes officeEditAttributes) (style, reset, valid bool) {
	if attributes.StyleReset != nil {
		if raw := string(attributes.StyleReset); raw != "true" && raw != "false" {
			return false, false, false
		}
		reset = true
	}
	for _, raw := range []json.RawMessage{edit.Style, attributes.Style} {
		if len(raw) == 0 || string(raw) == "null" {
			continue
		}
		var object map[string]json.RawMessage
		if json.Unmarshal(raw, &object) != nil {
			return false, false, false
		}
		style = true
	}
	return style, reset, true
}

// officeRangeBounds decodes a range in either wire spelling — "A1:B5" or the
// four 0-based bounds — into its ordered 0-based corners (start <= end, inside
// the OOXML grid). The caller applies its own cell/span budget on top.
func officeRangeBounds(raw json.RawMessage) (startRow, startColumn, endRow, endColumn int, ok bool) {
	if len(raw) == 0 {
		return 0, 0, 0, 0, false
	}
	var address string
	if json.Unmarshal(raw, &address) == nil {
		parts := strings.Split(address, ":")
		if len(parts) != 2 {
			return 0, 0, 0, 0, false
		}
		if startRow, startColumn, ok = officeA1Index(parts[0]); !ok {
			return 0, 0, 0, 0, false
		}
		if endRow, endColumn, ok = officeA1Index(parts[1]); !ok {
			return 0, 0, 0, 0, false
		}
	} else {
		var bounds map[string]json.RawMessage
		if json.Unmarshal(raw, &bounds) != nil {
			return 0, 0, 0, 0, false
		}
		if startRow, ok = officeGridIndex(bounds["startRow"], maxOfficeEditRows); !ok {
			return 0, 0, 0, 0, false
		}
		if startColumn, ok = officeGridIndex(bounds["startColumn"], maxOfficeEditColumns); !ok {
			return 0, 0, 0, 0, false
		}
		if endRow, ok = officeGridIndex(bounds["endRow"], maxOfficeEditRows); !ok {
			return 0, 0, 0, 0, false
		}
		if endColumn, ok = officeGridIndex(bounds["endColumn"], maxOfficeEditColumns); !ok {
			return 0, 0, 0, 0, false
		}
	}
	if startRow > endRow || startColumn > endColumn {
		return 0, 0, 0, 0, false
	}
	return startRow, startColumn, endRow, endColumn, true
}

// officeRangeOK is the parseRange half of set_cells: an ordered, in-grid range
// that expands to at most maxOfficeEditOps cells — the job's op budget.
func officeRangeOK(raw json.RawMessage) bool {
	startRow, startColumn, endRow, endColumn, ok := officeRangeBounds(raw)
	if !ok {
		return false
	}
	return (endRow-startRow+1)*(endColumn-startColumn+1) <= maxOfficeEditOps
}

// officeSetCellValid: a cell target plus content, a style, or a style reset.
func officeSetCellValid(edit office.EditOp) bool {
	if !officeCellTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeAttributesOf(edit.Attributes)
	if !ok {
		return false
	}
	content, ok := officeEditContent(edit, attributes)
	if !ok {
		return false
	}
	style, reset, ok := officeStyleOf(edit, attributes)
	if !ok {
		return false
	}
	return content || style || reset
}

// officeClearCellValid: a cell target; content fields are ignored, as the
// engine's own parser ignores them for clear_cell.
func officeClearCellValid(edit office.EditOp) bool {
	return officeCellTargetOK(edit.Target)
}

// officeSetCellsValid: the set_cells grammar as parseRange reads it — a
// sheet-ref target (a cell address on the target is never read), a bounded
// range, and content (style is optional for a range fill).
func officeSetCellsValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) || !officeRangeOK(edit.Range) {
		return false
	}
	attributes, ok := officeAttributesOf(edit.Attributes)
	if !ok {
		return false
	}
	content, ok := officeEditContent(edit, attributes)
	if !ok || !content {
		return false
	}
	_, _, ok = officeStyleOf(edit, attributes)
	return ok
}

// Structural (rows/columns) validation. Field vocabulary mirrors
// packages/office-engine/src/xlsx/ops.ts: positions are 0-based, sizes are
// points for rows / character width for columns, null = the sheet default.

const (
	// Row height (points) / column width (character units) ceiling, mirroring
	// the upstream structural wire schema (desktop-api.ts structuralOps).
	maxOfficeStructuralSize = 500
	// Span ceiling a size/hidden/outline op may address.
	maxOfficeStructuralSpan = 100_000
)

// officeStructuralAttributes decodes a structural op's attributes object;
// unlike the cell ops, a structural op requires the object (its fields live
// there), so an absent or null attributes is malformed.
func officeStructuralAttributes(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false
	}
	var attributes map[string]json.RawMessage
	if json.Unmarshal(raw, &attributes) != nil {
		return nil, false
	}
	return attributes, true
}

// officeStructuralInt decodes a bounded integer attribute (inclusive bounds),
// refusing fractional, non-numeric and out-of-range values.
func officeStructuralInt(attributes map[string]json.RawMessage, name string, min, max int) (int, bool) {
	raw := attributes[name]
	if len(raw) == 0 || (raw[0] != '-' && (raw[0] < '0' || raw[0] > '9')) {
		return 0, false
	}
	value, err := strconv.ParseFloat(string(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value != math.Trunc(value) ||
		value < float64(min) || value > float64(max) {
		return 0, false
	}
	return int(value), true
}

// officeStructuralBool requires a present boolean attribute.
func officeStructuralBool(attributes map[string]json.RawMessage, name string) (bool, bool) {
	switch string(attributes[name]) {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	return false, false
}

// officeAxisLimit is the grid bound of the op's axis.
func officeAxisLimit(columns bool) int {
	if columns {
		return maxOfficeEditColumns
	}
	return maxOfficeEditRows
}

// officeAxisSpan decodes start/end and enforces start <= end, inside the grid
// and under the span ceiling.
func officeAxisSpan(attributes map[string]json.RawMessage, columns bool) bool {
	limit := officeAxisLimit(columns)
	start, ok := officeStructuralInt(attributes, "start", 0, limit-1)
	if !ok {
		return false
	}
	end, ok := officeStructuralInt(attributes, "end", 0, limit-1)
	return ok && end >= start && end-start < maxOfficeStructuralSpan
}

// officeShiftValid: insert_rows/remove_rows/insert_cols/remove_cols —
// {index, count}, count >= 1, index+count inside the axis grid.
func officeShiftValid(columns bool) func(office.EditOp) bool {
	return func(edit office.EditOp) bool {
		if !officeRangeTargetOK(edit.Target) {
			return false
		}
		attributes, ok := officeStructuralAttributes(edit.Attributes)
		if !ok {
			return false
		}
		limit := officeAxisLimit(columns)
		index, ok := officeStructuralInt(attributes, "index", 0, limit-1)
		if !ok {
			return false
		}
		count, ok := officeStructuralInt(attributes, "count", 1, limit)
		if !ok || index+count > limit {
			return false
		}
		return true
	}
}

// officeSizeValid: set_row_size/set_col_size — {start, end, size}; size is
// null (sheet default) or a number in (0, maxOfficeStructuralSize].
func officeSizeValid(columns bool) func(office.EditOp) bool {
	return func(edit office.EditOp) bool {
		if !officeRangeTargetOK(edit.Target) {
			return false
		}
		attributes, ok := officeStructuralAttributes(edit.Attributes)
		if !ok || !officeAxisSpan(attributes, columns) {
			return false
		}
		raw := attributes["size"]
		if string(raw) == "null" {
			return true
		}
		value, err := strconv.ParseFloat(string(raw), 64)
		return err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) &&
			value > 0 && value <= maxOfficeStructuralSize
	}
}

// officeHiddenValid: set_rows_hidden/set_cols_hidden — {start, end, hidden}.
func officeHiddenValid(columns bool) func(office.EditOp) bool {
	return func(edit office.EditOp) bool {
		if !officeRangeTargetOK(edit.Target) {
			return false
		}
		attributes, ok := officeStructuralAttributes(edit.Attributes)
		if !ok || !officeAxisSpan(attributes, columns) {
			return false
		}
		_, ok = officeStructuralBool(attributes, "hidden")
		return ok
	}
}

// officeOutlineValid: set_rows_outline/set_cols_outline — {start, end, level,
// collapsed?}; level is absolute 0-7 (0 removes the attribute).
func officeOutlineValid(columns bool) func(office.EditOp) bool {
	return func(edit office.EditOp) bool {
		if !officeRangeTargetOK(edit.Target) {
			return false
		}
		attributes, ok := officeStructuralAttributes(edit.Attributes)
		if !ok || !officeAxisSpan(attributes, columns) {
			return false
		}
		if _, ok := officeStructuralInt(attributes, "level", 0, 7); !ok {
			return false
		}
		if _, present := attributes["collapsed"]; present {
			if _, ok := officeStructuralBool(attributes, "collapsed"); !ok {
				return false
			}
		}
		return true
	}
}

// officeMergeValid: merge_cells/unmerge_cells — a sheet-ref target plus a
// bounded rectangle, mirroring ops.ts parseMergeArea: the shared envelope's
// range field ("A1:B2" or the four 0-based bounds), ordered, inside the grid,
// under the structural span ceiling and at least two cells (a single-cell
// merge is not a merge Excel would write).
func officeMergeValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	startRow, startColumn, endRow, endColumn, ok := officeRangeBounds(edit.Range)
	if !ok {
		return false
	}
	if endRow-startRow >= maxOfficeStructuralSpan || endColumn-startColumn >= maxOfficeStructuralSpan {
		return false
	}
	return endRow > startRow || endColumn > startColumn
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
	// The job must belong to this document before anything is cancelled: a
	// job id of another document is not found here and stays live.
	row, err := s.get(ctx, doc.OrganizationID, doc.WorkspaceID, jobID)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if row.DocumentID != doc.ID {
		return db.OfficeJob{}, ErrNotFound
	}
	return s.CancelOfficeJob(ctx, actor, doc.OrganizationID, doc.WorkspaceID, jobID)
}
