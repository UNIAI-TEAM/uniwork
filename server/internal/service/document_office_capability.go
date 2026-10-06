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
	"unicode/utf8"

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
		if err := s.documents.authorizeParentIn(ctx, actor, in.ParentID, ws.WorkspaceID); err != nil {
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
	if !officeVisualEditsOrdered(edits) {
		return ErrOfficeJobInvalid
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
	// Filters (B4): set_filter is the declarative whole-sheet snapshot,
	// clear_filter removes the autoFilter and unhides the visibility range.
	"set_filter":   officeSetFilterValid,
	"clear_filter": officeClearFilterValid,
	// Page setup (C2): set_page_setup is the declarative whole-sheet
	// page-layout snapshot (orientation, paper, scale/fit, margins, print
	// gridlines/headings, print area/titles, frozen panes, breaks).
	"set_page_setup": officeSetPageSetupValid,
	// Hyperlinks + notes (B6): set_hyperlink is a per-cell link (null target
	// removes it); set_notes is a whole-sheet declarative note snapshot.
	"set_hyperlink": officeSetHyperlinkValid,
	"set_notes":     officeSetNotesValid,
	// Sheet management (B3): add/duplicate/rename/remove/reorder/hide. The
	// applied set folds into ONE workbook-wide SheetEditPlan per save; names
	// follow the upstream validateSheetName and the tab index mirrors the TS
	// parser. The live sheet set (uniqueness, the last-sheet rule) lives with
	// the engine, so these rows validate shape only.
	"add_sheet":        officeAddSheetValid,
	"duplicate_sheet":  officeDuplicateSheetValid,
	"rename_sheet":     officeRenameSheetValid,
	"remove_sheet":     officeRemoveSheetValid,
	"reorder_sheet":    officeReorderSheetValid,
	"set_sheet_hidden": officeSheetHiddenValid,
	// Tables (B9): create_table writes a new table part over a header-inclusive
	// range; remove_table cancels a session add by name (the gateway has no
	// table-removal write path, so a file-native table stays view-only).
	"create_table": officeCreateTableValid,
	"remove_table": officeRemoveTableValid,
	// Sheet protection (B7): set_sheet_protection toggles the worksheet
	// <sheetProtection> element. The flag is a raw boolean.
	"set_sheet_protection": officeSetSheetProtectionValid,
	// Defined names (B7): set_defined_names rewrites the workbook definedNames
	// section from the editor model. Names follow Excel's grammar;
	// preserveNames lists names the editor cannot model and keeps verbatim.
	"set_defined_names": officeSetDefinedNamesValid,
	// Visuals (B8): set_visual adds or replaces one session chart, picture or
	// shape (document_office_visuals.go); remove_visual cancels it by id.
	"set_visual":    officeSetVisualValid,
	"remove_visual": officeRemoveVisualValid,
	// Conditional formatting + data validation (X01): whole-sheet declarative
	// snapshots of the editor's rule model (Univer rule JSON the gateway maps
	// to OOXML); an empty rules list removes every rule on the sheet.
	"set_conditional_formats": officeRuleSetValid(officeCfRuleTypes, true),
	"set_data_validations":    officeRuleSetValid(officeDvRuleTypes, false),
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

// Filters (B4). set_filter / clear_filter carry the declarative filter state;
// the fields ride the existing raw attributes object like the structural ops.
// Bounds mirror ops.ts's parsers and the vendored wire schema (desktop-api.ts
// workbookFilterStateSchema): at most 1000 columns, 10000 values per column
// (32767 characters each), up to two custom conditions per column with the
// OOXML operators, 100000 hidden rows, and every area ordered, inside the grid
// and under the structural span ceiling. set_filter's own range needs a header
// row plus at least one data row, as the pinned filter command requires.
const (
	maxOfficeFilterColumns   = 1_000
	maxOfficeFilterValues    = 10_000
	maxOfficeFilterValueLen  = 32_767
	maxOfficeFilterHiddenRow = 100_000
)

var officeFilterOperators = map[string]bool{
	"equal":              true,
	"notEqual":           true,
	"greaterThan":        true,
	"greaterThanOrEqual": true,
	"lessThan":           true,
	"lessThanOrEqual":    true,
}

// officeFilterArea decodes one 0-based area object (the object spelling only —
// the filter wire never uses an A1 range string): ordered, inside the grid,
// under the span ceiling.
func officeFilterArea(raw json.RawMessage) (startRow, startColumn, endRow, endColumn int, ok bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, 0, 0, false
	}
	var area map[string]json.RawMessage
	if json.Unmarshal(raw, &area) != nil {
		return 0, 0, 0, 0, false
	}
	if startRow, ok = officeGridIndex(area["startRow"], maxOfficeEditRows); !ok {
		return 0, 0, 0, 0, false
	}
	if startColumn, ok = officeGridIndex(area["startColumn"], maxOfficeEditColumns); !ok {
		return 0, 0, 0, 0, false
	}
	if endRow, ok = officeGridIndex(area["endRow"], maxOfficeEditRows); !ok {
		return 0, 0, 0, 0, false
	}
	if endColumn, ok = officeGridIndex(area["endColumn"], maxOfficeEditColumns); !ok {
		return 0, 0, 0, 0, false
	}
	if startRow > endRow || startColumn > endColumn {
		return 0, 0, 0, 0, false
	}
	if endRow-startRow >= maxOfficeStructuralSpan || endColumn-startColumn >= maxOfficeStructuralSpan {
		return 0, 0, 0, 0, false
	}
	return startRow, startColumn, endRow, endColumn, true
}

// officeFilterColumnOK validates one filter column: colId inside the filter
// range, at most one criteria family, values/operators bounded like the wire
// schema. seen guards the duplicate colId the engine parser also refuses.
func officeFilterColumnOK(raw json.RawMessage, width int, seen map[int]bool) bool {
	var column map[string]json.RawMessage
	if json.Unmarshal(raw, &column) != nil {
		return false
	}
	colID, ok := officeGridIndex(column["colId"], maxOfficeEditColumns)
	if !ok || colID >= width || seen[colID] {
		return false
	}
	seen[colID] = true
	criteria := false
	if values, has := column["values"]; has {
		if len(values) == 0 || string(values) == "null" {
			return false
		}
		var list []string
		if json.Unmarshal(values, &list) != nil || len(list) > maxOfficeFilterValues {
			return false
		}
		for _, value := range list {
			if len(value) > maxOfficeFilterValueLen {
				return false
			}
		}
		criteria = true
	}
	if blank, has := column["blank"]; has {
		var flag bool
		if json.Unmarshal(blank, &flag) != nil {
			return false
		}
		criteria = true
	}
	if customs, has := column["customs"]; has {
		if len(customs) == 0 || string(customs) == "null" {
			return false
		}
		var custom map[string]json.RawMessage
		if json.Unmarshal(customs, &custom) != nil {
			return false
		}
		if and, hasAnd := custom["and"]; hasAnd {
			var flag bool
			if json.Unmarshal(and, &flag) != nil {
				return false
			}
		}
		filters := custom["filters"]
		if len(filters) == 0 || string(filters) == "null" {
			return false
		}
		var conditions []map[string]json.RawMessage
		if json.Unmarshal(filters, &conditions) != nil || len(conditions) < 1 || len(conditions) > 2 {
			return false
		}
		for _, condition := range conditions {
			value := condition["val"]
			if len(value) == 0 || string(value) == "null" {
				return false
			}
			var text string
			if json.Unmarshal(value, &text) != nil {
				var number float64
				if json.Unmarshal(value, &number) != nil || math.IsNaN(number) || math.IsInf(number, 0) {
					return false
				}
			} else if len(text) > maxOfficeFilterValueLen {
				return false
			}
			if operator, hasOperator := condition["operator"]; hasOperator {
				var name string
				if json.Unmarshal(operator, &name) != nil || !officeFilterOperators[name] {
					return false
				}
			}
		}
		criteria = true
	}
	return criteria
}

// officeSetFilterValid: set_filter — a sheet-ref target plus
// attributes.filter {range, columns}, attributes.hiddenRows and
// attributes.visibilityRange.
func officeSetFilterValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok {
		return false
	}
	filter := attributes["filter"]
	if len(filter) == 0 || string(filter) == "null" {
		return false
	}
	var decoded map[string]json.RawMessage
	if json.Unmarshal(filter, &decoded) != nil {
		return false
	}
	startRow, startColumn, endRow, endColumn, ok := officeFilterArea(decoded["range"])
	if !ok || endRow == startRow {
		return false
	}
	columns := decoded["columns"]
	if len(columns) == 0 || string(columns) == "null" {
		return false
	}
	var list []json.RawMessage
	if json.Unmarshal(columns, &list) != nil || len(list) > maxOfficeFilterColumns {
		return false
	}
	seen := make(map[int]bool, len(list))
	for _, rawColumn := range list {
		if !officeFilterColumnOK(rawColumn, endColumn-startColumn+1, seen) {
			return false
		}
	}
	hidden := attributes["hiddenRows"]
	if len(hidden) == 0 || string(hidden) == "null" {
		return false
	}
	var rows []json.RawMessage
	if json.Unmarshal(hidden, &rows) != nil || len(rows) > maxOfficeFilterHiddenRow {
		return false
	}
	for _, rawRow := range rows {
		if _, ok := officeGridIndex(rawRow, maxOfficeEditRows); !ok {
			return false
		}
	}
	_, _, _, _, ok = officeFilterArea(attributes["visibilityRange"])
	return ok
}

// officeClearFilterValid: clear_filter — a sheet-ref target plus
// attributes.visibilityRange (the rows the removed filter was hiding).
func officeClearFilterValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok {
		return false
	}
	_, _, _, _, ok = officeFilterArea(attributes["visibilityRange"])
	return ok
}

// Page setup (C2). set_page_setup carries the whole declarative page-layout
// snapshot in the raw attributes object. Bounds mirror ops.ts's parser and the
// vendored wire schema (desktop-api.ts workbookPageSetupStateSchema):
// orientation/margins enums, paperSize 1-118, scale 10-400, fitTo* 0-1000,
// frozen panes in grid, break indexes positive and in-grid, printArea through
// the A1 grammar (<=255 chars) and printTitles through the row-span grammar.
// An unknown attribute is refused so the typed op never silently drops a field.
var officePageSetupFields = map[string]bool{
	"orientation":    true,
	"paperSize":      true,
	"scale":          true,
	"fitToWidth":     true,
	"fitToHeight":    true,
	"fitToPage":      true,
	"margins":        true,
	"printGridlines": true,
	"printHeadings":  true,
	"printArea":      true,
	"printTitles":    true,
	"frozenRows":     true,
	"frozenColumns":  true,
	"rowBreaks":      true,
	"colBreaks":      true,
}

// officePageSetupInt decodes a bounded JSON integer in [min,max].
func officePageSetupInt(raw json.RawMessage, min, max int) bool {
	if len(raw) == 0 {
		return false
	}
	value, err := strconv.ParseFloat(string(raw), 64)
	return err == nil && value == math.Trunc(value) && value >= float64(min) && value <= float64(max)
}

// officePageSetupBool requires the raw literal true/false, matching the TS
// parser (pageSetupBool). A JSON null unmarshals into a Go bool as a no-op, so
// decoding into bool would accept null and diverge from the engine.
func officePageSetupBool(raw json.RawMessage) bool {
	switch string(raw) {
	case "true", "false":
		return true
	}
	return false
}

// officePrintAreaOK: an A1 range or single cell ("A1:C10", "$A$1"), <=255
// chars, both endpoints inside the OOXML grid. A JSON null clears the name.
func officePrintAreaOK(raw json.RawMessage) bool {
	if string(raw) == "null" {
		return true
	}
	var value string
	if json.Unmarshal(raw, &value) != nil || value == "" || len(value) > 255 {
		return false
	}
	parts := strings.Split(value, ":")
	if len(parts) > 2 {
		return false
	}
	for _, part := range parts {
		if _, _, ok := officeA1Index(part); !ok {
			return false
		}
	}
	return true
}

// officePrintTitlesOK: a row span "1:3" (1-based, ascending) or JSON null.
func officePrintTitlesOK(raw json.RawMessage) bool {
	if string(raw) == "null" {
		return true
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	m := officePrintTitlesPattern.FindStringSubmatch(value)
	if m == nil {
		return false
	}
	start, errStart := strconv.Atoi(m[1])
	end, errEnd := strconv.Atoi(m[2])
	return errStart == nil && errEnd == nil && start >= 1 && start <= end && end <= maxOfficeEditRows
}

var officePrintTitlesPattern = regexp.MustCompile(`^(\d{1,7}):(\d{1,7})$`)

// officePageSetupBreaksOK: a JSON array of positive in-grid break indexes.
func officePageSetupBreaksOK(raw json.RawMessage, max int) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	var breaks []json.RawMessage
	if json.Unmarshal(raw, &breaks) != nil || len(breaks) > 1023 {
		return false
	}
	for _, entry := range breaks {
		value, err := strconv.ParseFloat(string(entry), 64)
		if err != nil || value != math.Trunc(value) || value < 1 || value > float64(max) {
			return false
		}
	}
	return true
}

// officeSetPageSetupValid: set_page_setup — a sheet-ref target plus a bounded
// attributes object with at least one recognized setting.
func officeSetPageSetupValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || len(attributes) == 0 {
		return false
	}
	settings := 0
	_, hasFrozenRows := attributes["frozenRows"]
	_, hasFrozenColumns := attributes["frozenColumns"]
	// The pane is one state: the gateway writes `frozenRows ?? 0` /
	// `frozenColumns ?? 0`, so a lone axis would reset the other to 0. The TS
	// parser refuses the half pair too (parseSetPageSetup).
	if hasFrozenRows != hasFrozenColumns {
		return false
	}
	for name, raw := range attributes {
		if !officePageSetupFields[name] {
			return false
		}
		switch name {
		case "orientation":
			var value string
			if json.Unmarshal(raw, &value) != nil || (value != "portrait" && value != "landscape") {
				return false
			}
		case "margins":
			var value string
			if json.Unmarshal(raw, &value) != nil || (value != "normal" && value != "wide" && value != "narrow") {
				return false
			}
		case "paperSize":
			if !officePageSetupInt(raw, 1, 118) {
				return false
			}
		case "scale":
			if !officePageSetupInt(raw, 10, 400) {
				return false
			}
		case "fitToWidth", "fitToHeight":
			if !officePageSetupInt(raw, 0, 1_000) {
				return false
			}
		case "frozenRows":
			if !officePageSetupInt(raw, 0, maxOfficeEditRows-1) {
				return false
			}
		case "frozenColumns":
			if !officePageSetupInt(raw, 0, maxOfficeEditColumns-1) {
				return false
			}
		case "fitToPage", "printGridlines", "printHeadings":
			if !officePageSetupBool(raw) {
				return false
			}
		case "printArea":
			if !officePrintAreaOK(raw) {
				return false
			}
		case "printTitles":
			if !officePrintTitlesOK(raw) {
				return false
			}
		case "rowBreaks":
			if !officePageSetupBreaksOK(raw, maxOfficeEditRows-1) {
				return false
			}
		case "colBreaks":
			if !officePageSetupBreaksOK(raw, maxOfficeEditColumns-1) {
				return false
			}
		}
		settings++
	}
	return settings > 0
}

// Hyperlinks (B6). set_hyperlink carries a per-cell link in the raw
// attributes object: attributes.cell is an A1 address and attributes.target is
// a URL/anchor of 1-2083 characters (the vendored wire schema's bound) or JSON
// null to remove the link. One op kind serves set and clear, mirroring the
// gateway's per-cell last-write list.
func officeSetHyperlinkValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok {
		return false
	}
	var cell string
	if json.Unmarshal(attributes["cell"], &cell) != nil {
		return false
	}
	if _, _, ok := officeA1Index(cell); !ok {
		return false
	}
	target, has := attributes["target"]
	if !has || len(target) == 0 {
		return false
	}
	if string(target) == "null" {
		return true
	}
	var link string
	if json.Unmarshal(target, &link) != nil {
		return false
	}
	return len(link) >= 1 && len(link) <= maxOfficeHyperlinkTargetLen
}

// Notes (B6). set_notes carries the whole-sheet note snapshot: at most 1000
// notes, each a 0-based in-grid cell with an author <=255 chars and text
// <=32767 chars, one note per cell. Bounds mirror the vendored wire schema
// (desktop-api.ts workbookNoteStateSchema) and the ops-notes parser.
const maxOfficeHyperlinkTargetLen = 2_083

const (
	maxOfficeNoteCount     = 1_000
	maxOfficeNoteAuthorLen = 255
	maxOfficeNoteTextLen   = 32_767
)

func officeSetNotesValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok {
		return false
	}
	raw := attributes["notes"]
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	var notes []json.RawMessage
	if json.Unmarshal(raw, &notes) != nil || len(notes) > maxOfficeNoteCount {
		return false
	}
	seen := make(map[string]bool, len(notes))
	for _, entry := range notes {
		var note map[string]json.RawMessage
		if json.Unmarshal(entry, &note) != nil {
			return false
		}
		row, okRow := officeGridIndex(note["row"], maxOfficeEditRows)
		column, okColumn := officeGridIndex(note["column"], maxOfficeEditColumns)
		if !okRow || !okColumn {
			return false
		}
		var author string
		if json.Unmarshal(note["author"], &author) != nil || len(author) > maxOfficeNoteAuthorLen {
			return false
		}
		var text string
		if json.Unmarshal(note["text"], &text) != nil || len(text) > maxOfficeNoteTextLen {
			return false
		}
		key := strconv.Itoa(row) + ":" + strconv.Itoa(column)
		if seen[key] {
			return false
		}
		seen[key] = true
	}
	return true
}

// Sheet management (B3). Names mirror the upstream validateSheetName
// (1-31 characters, no \ / ? * [ ] :, no leading/trailing apostrophe); the tab
// index mirrors the TS parser's 0-9999 bound (an envelope carries at most
// maxOfficeEditOps items, so a larger index is unreachable). Uniqueness, the
// last-sheet rule and the at-least-one-visible rule need the workbook's live
// sheet set and stay with the engine (a typed refusal at edit/save time), the
// same split as officeSheetRefOK.
const (
	maxOfficeSheetNameLen = 31
	maxOfficeSheetIndex   = 9_999
)

// officeSheetNameOK accepts a present, well-formed worksheet name. The rune
// count keeps the Go gate at least as permissive as the engine's UTF-16 length
// check: a name the engine would refuse still reaches it as a typed error.
func officeSheetNameOK(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var name string
	if json.Unmarshal(raw, &name) != nil {
		return false
	}
	if count := utf8.RuneCountInString(name); count < 1 || count > maxOfficeSheetNameLen {
		return false
	}
	if strings.ContainsAny(name, `\/?*[]:`) {
		return false
	}
	return !strings.HasPrefix(name, "'") && !strings.HasSuffix(name, "'")
}

// officeSheetTargetAbsent accepts an absent/JSON-null target or an empty
// object: add_sheet addresses no existing sheet.
func officeSheetTargetAbsent(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	var target map[string]json.RawMessage
	return json.Unmarshal(raw, &target) == nil && len(target) == 0
}

// officeSheetIndexAttr decodes the optional/required tab index, a 0-based
// position in the final tab order.
func officeSheetIndexAttr(attributes map[string]json.RawMessage, required bool) bool {
	if len(attributes["index"]) == 0 {
		return !required
	}
	_, ok := officeStructuralInt(attributes, "index", 0, maxOfficeSheetIndex)
	return ok
}

// officeAddSheetValid: add_sheet — no sheet target, attributes {name} and an
// optional index (omitted = append to the end).
func officeAddSheetValid(edit office.EditOp) bool {
	if !officeSheetTargetAbsent(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || !officeSheetNameOK(attributes["name"]) {
		return false
	}
	return officeSheetIndexAttr(attributes, false)
}

// officeDuplicateSheetValid: duplicate_sheet — the source sheet target plus
// attributes {name} and an optional index (the clone's final position).
func officeDuplicateSheetValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || !officeSheetNameOK(attributes["name"]) {
		return false
	}
	return officeSheetIndexAttr(attributes, false)
}

// officeRenameSheetValid: rename_sheet — the target sheet plus attributes
// {newName}.
func officeRenameSheetValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	return ok && officeSheetNameOK(attributes["newName"])
}

// officeRemoveSheetValid: remove_sheet — the target sheet only; the engine
// refuses removing the last remaining sheet.
func officeRemoveSheetValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	if len(edit.Attributes) == 0 || string(edit.Attributes) == "null" {
		return true
	}
	_, ok := officeStructuralAttributes(edit.Attributes)
	return ok
}

// officeReorderSheetValid: reorder_sheet — the target sheet plus a required
// attributes {index}.
func officeReorderSheetValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	return ok && officeSheetIndexAttr(attributes, true)
}

// officeSheetHiddenValid: set_sheet_hidden — the target sheet plus attributes
// {hidden}.
func officeSheetHiddenValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok {
		return false
	}
	_, ok = officeStructuralBool(attributes, "hidden")
	return ok
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

// Tables (B9). create_table carries the table range on the shared envelope's
// own range field (like merge_cells) and its metadata in the raw attributes
// object: name, columnNames, an optional built-in style and bandedRows. Bounds
// mirror ops.ts's parser and the vendored wire schema (desktop-api.ts
// workbookTableAddSchema): the name follows Excel's table-name grammar, the
// range needs a header row plus at least one data row, one non-blank unique
// column name per column (<=255 chars), and the style is a built-in
// TableStyle{Light|Medium|Dark}N name. remove_table carries only a name.

const (
	maxOfficeTableNameLen    = 255
	maxOfficeTableColumns    = 1_000
	maxOfficeTableColumnName = 255
)

var (
	officeTableNamePattern  = regexp.MustCompile(`^[A-Za-z_\\][A-Za-z0-9_.]{0,254}$`)
	officeTableCellRefPat   = regexp.MustCompile(`^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*$`)
	officeTableStylePattern = regexp.MustCompile("^TableStyle(?:Light|Medium|Dark)[1-9][0-9]?$")
)

// Defined names (B7). set_defined_names has no target: the vendored gateway
// rewrites the workbook definedNames section wholesale, so the state is
// workbook-scoped. Names follow the vendored validateName grammar (a letter, _,
// or backslash; then letters/digits/_/./backslash; at most 255 chars; never an
// A1/R1C1 cell reference, TRUE/FALSE, or an _xlnm built-in); each name appears
// once per scope and a name cannot be both modeled and preserved.
const maxOfficeDefinedNames = 10_000

var (
	officeDefinedNamePattern    = regexp.MustCompile(`^[\p{L}_\\][\p{L}\p{N}_.\\]*$`)
	officeDefinedNameCellRefPat = regexp.MustCompile(`^(?:[A-Za-z]{1,3}[0-9]+|[Rr][0-9]*[Cc][0-9]*)$`)
)

// officeDefinedNameOK mirrors the vendored validateName (xlsx-defined-names.ts).
func officeDefinedNameOK(name string) bool {
	if name == "" || len(name) > 255 || !officeDefinedNamePattern.MatchString(name) {
		return false
	}
	if officeDefinedNameCellRefPat.MatchString(name) {
		return false
	}
	lower := strings.ToLower(name)
	return lower != "true" && lower != "false" && !strings.HasPrefix(name, "_xlnm")
}

// officeDefinedNamesListOK validates the names array: each entry is an object
// with a valid name, a non-empty formula and an optional in-grid sheetIndex;
// a (name, scope) pair may not repeat.
func officeDefinedNamesListOK(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var names []map[string]json.RawMessage
	if json.Unmarshal(raw, &names) != nil || len(names) > maxOfficeDefinedNames {
		return false
	}
	seen := make(map[string]bool, len(names))
	for _, entry := range names {
		if entry == nil {
			return false
		}
		var name string
		if json.Unmarshal(entry["name"], &name) != nil || !officeDefinedNameOK(name) {
			return false
		}
		var formula string
		if json.Unmarshal(entry["formula"], &formula) != nil || formula == "" {
			return false
		}
		scope := -1
		if sheetIndex, ok := entry["sheetIndex"]; ok {
			value, valid := officeGridIndex(sheetIndex, maxOfficeEditColumns)
			if !valid {
				return false
			}
			scope = value
		}
		key := name + "\x00" + strconv.Itoa(scope)
		if seen[key] {
			return false
		}
		seen[key] = true
	}
	return true
}

// officeSetDefinedNamesValid: set_defined_names - a workbook-scoped snapshot
// with a bounded names array and optional bounded preserveNames.
func officeSetDefinedNamesValid(edit office.EditOp) bool {
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || len(attributes) == 0 {
		return false
	}
	for name := range attributes {
		if name != "names" && name != "preserveNames" {
			return false
		}
	}
	if !officeDefinedNamesListOK(attributes["names"]) {
		return false
	}
	preserved := make(map[string]bool)
	if raw, present := attributes["preserveNames"]; present {
		var list []string
		if json.Unmarshal(raw, &list) != nil || len(list) > maxOfficeDefinedNames {
			return false
		}
		for _, name := range list {
			if name == "" || len(name) > 255 {
				return false
			}
			preserved[name] = true
		}
	}
	// A name cannot be both modeled and preserved (mirrors ops-names.ts:111-115).
	var modeled []map[string]json.RawMessage
	if json.Unmarshal(attributes["names"], &modeled) == nil {
		for _, entry := range modeled {
			var name string
			if json.Unmarshal(entry["name"], &name) == nil && preserved[name] {
				return false
			}
		}
	}
	return true
}

// officeSetSheetProtectionValid: set_sheet_protection - a sheet-ref target
// plus exactly one raw boolean flag.
func officeSetSheetProtectionValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || len(attributes) != 1 {
		return false
	}
	protected, present := attributes["protected"]
	return present && (string(protected) == "true" || string(protected) == "false")
}

// officeTableNameOK: a present Excel table name (grammar + not a cell ref).
func officeTableNameOK(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var name string
	if json.Unmarshal(raw, &name) != nil || len(name) > maxOfficeTableNameLen {
		return false
	}
	return officeTableNamePattern.MatchString(name) && !officeTableCellRefPat.MatchString(name)
}

// officeTableColumnNamesOK: exactly width non-blank, unique (case-insensitive)
// names, each at most 255 characters.
func officeTableColumnNamesOK(raw json.RawMessage, width int) bool {
	if len(raw) == 0 {
		return false
	}
	var names []string
	if json.Unmarshal(raw, &names) != nil || len(names) != width || width < 1 || width > maxOfficeTableColumns {
		return false
	}
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		trimmed := strings.ToLower(strings.TrimSpace(name))
		if trimmed == "" || len(name) > maxOfficeTableColumnName || seen[trimmed] {
			return false
		}
		seen[trimmed] = true
	}
	return true
}

// officeTableAttributesOK validates the shared metadata of create_table.
func officeTableAttributesOK(attributes map[string]json.RawMessage, width int) bool {
	for name := range attributes {
		switch name {
		case "name", "columnNames", "style", "bandedRows":
		default:
			return false
		}
	}
	if !officeTableNameOK(attributes["name"]) || !officeTableColumnNamesOK(attributes["columnNames"], width) {
		return false
	}
	if raw, ok := attributes["style"]; ok {
		var style string
		if json.Unmarshal(raw, &style) != nil || !officeTableStylePattern.MatchString(style) {
			return false
		}
	}
	if raw, ok := attributes["bandedRows"]; ok {
		if string(raw) != "true" && string(raw) != "false" {
			return false
		}
	}
	return true
}

// officeCreateTableValid: create_table - a sheet-ref target, a header-inclusive
// range with at least one data row, and bounded table metadata.
func officeCreateTableValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	startRow, startColumn, endRow, endColumn, ok := officeRangeBounds(edit.Range)
	if !ok || endRow <= startRow {
		return false
	}
	if endRow-startRow >= maxOfficeStructuralSpan || endColumn-startColumn >= maxOfficeStructuralSpan {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || len(attributes) == 0 {
		return false
	}
	return officeTableAttributesOK(attributes, endColumn-startColumn+1)
}

// officeRemoveTableValid: remove_table - a sheet-ref target plus a name.
func officeRemoveTableValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeStructuralAttributes(edit.Attributes)
	if !ok || len(attributes) != 1 {
		return false
	}
	return officeTableNameOK(attributes["name"])
}

// Conditional formatting + data validation (X01). set_conditional_formats and
// set_data_validations carry the whole-sheet rule snapshot: at most 1000
// rules, each with 1..1000 ordered in-grid areas and a Univer rule object of a
// type the gateway can write, at most 64 KiB serialized, and the whole op at
// most 512 KiB. Bounds mirror the ops-cf-dv.ts parser; the gateway stays the
// authority on the rule's inner shape.
const (
	maxOfficeRuleSetRules     = 1_000
	maxOfficeRuleSetAreas     = 1_000
	maxOfficeRuleSetRuleBytes = 64 << 10
	maxOfficeRuleSetBytes     = 512 << 10
)

var (
	officeCfRuleTypes = map[string]bool{"highlightCell": true, "colorScale": true, "dataBar": true, "iconSet": true}
	officeDvRuleTypes = map[string]bool{
		"any": true, "none": true, "whole": true, "decimal": true, "list": true,
		"date": true, "time": true, "textLength": true, "custom": true, "checkbox": true,
	}
)

// officeRuleSetValid builds the validator for one rule-set op: a sheet-ref
// target plus exactly one `rules` array. withStopIfTrue admits the CF rule's
// optional boolean stopIfTrue.
func officeRuleSetValid(types map[string]bool, withStopIfTrue bool) func(office.EditOp) bool {
	return func(edit office.EditOp) bool {
		if !officeRangeTargetOK(edit.Target) || len(edit.Attributes) > maxOfficeRuleSetBytes {
			return false
		}
		attributes, ok := officeStructuralAttributes(edit.Attributes)
		if !ok || len(attributes) != 1 {
			return false
		}
		var rules []map[string]json.RawMessage
		if json.Unmarshal(attributes["rules"], &rules) != nil || rules == nil || len(rules) > maxOfficeRuleSetRules {
			return false
		}
		for _, rule := range rules {
			if !officeRuleSetRuleOK(rule, types, withStopIfTrue) {
				return false
			}
		}
		return true
	}
}

func officeRuleSetRuleOK(rule map[string]json.RawMessage, types map[string]bool, withStopIfTrue bool) bool {
	for name := range rule {
		if name != "ranges" && name != "rule" && (name != "stopIfTrue" || !withStopIfTrue) {
			return false
		}
	}
	if raw, present := rule["stopIfTrue"]; present && string(raw) != "true" && string(raw) != "false" {
		return false
	}
	var areas []map[string]json.RawMessage
	if json.Unmarshal(rule["ranges"], &areas) != nil || len(areas) < 1 || len(areas) > maxOfficeRuleSetAreas {
		return false
	}
	for _, area := range areas {
		startRow, okStartRow := officeGridIndex(area["startRow"], maxOfficeEditRows)
		endRow, okEndRow := officeGridIndex(area["endRow"], maxOfficeEditRows)
		startColumn, okStartColumn := officeGridIndex(area["startColumn"], maxOfficeEditColumns)
		endColumn, okEndColumn := officeGridIndex(area["endColumn"], maxOfficeEditColumns)
		if !okStartRow || !okEndRow || !okStartColumn || !okEndColumn || startRow > endRow || startColumn > endColumn {
			return false
		}
	}
	body := rule["rule"]
	if len(body) == 0 || len(body) > maxOfficeRuleSetRuleBytes {
		return false
	}
	var shape map[string]json.RawMessage
	if json.Unmarshal(body, &shape) != nil || shape == nil {
		return false
	}
	var ruleType string
	return json.Unmarshal(shape["type"], &ruleType) == nil && types[ruleType]
}
