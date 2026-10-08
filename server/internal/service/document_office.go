package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Office engine jobs (G2-02 / UNI-685). Go owns the job: it authorizes the
// actor, reads the base version's bytes through FileService, reserves the
// output file with RegisterProviderOutput, persists the office_jobs row and
// only then dispatches to the engine with a per-job grant. The engine never
// sees a database, a storage key or a credential beyond that grant.
//
// A completed job is NOT a Document version: the output file is verified and
// staged, and the commit path (G1-03) claims it with ClaimOfficeJobOutputInTx
// inside its own transaction. Until that claim a cancel still wins, and a
// cancelled job's output can never be claimed. Job commands write no audit
// row: they change no business object; the version commit that follows is
// the audited command.

// OfficeEngine is the part of office.Client the service uses.
type OfficeEngine interface {
	Sign(office.ServiceGrant) (string, error)
	Submit(ctx context.Context, grant string, env office.Envelope) (office.JobStatus, error)
	Status(ctx context.Context, jobID, grant string) (office.JobStatus, error)
	Cancel(ctx context.Context, jobID, grant string) (office.JobStatus, error)
	Ready(ctx context.Context) (office.Readiness, error)
	// Capability reads the engine's identity and operation rows for one
	// format. The service negotiates that identity and gates an operation on
	// those rows before it mutates anything.
	Capability(ctx context.Context, format office.Format) (office.CapabilityResult, error)
}

// OfficeMetrics is satisfied by metrics.Office.
type OfficeMetrics interface {
	ObserveOfficeJob(operation, outcome string, d time.Duration)
	SetOfficeEngine(ready bool, queueDepth int)
}

// DocumentOfficeOptions wires the service. Documents is the G1-02 gate every
// office command authorizes through (view to open or read status, edit to
// submit other operations or cancel). Engine nil means no engine is deployed:
// office jobs answer office.ErrNotConfigured and nothing else in Documents
// depends on the engine.
type DocumentOfficeOptions struct {
	Pool              *pgxpool.Pool
	Queries           *db.Queries
	Files             files.Service
	Engine            OfficeEngine
	Documents         *DocumentService
	Metrics           OfficeMetrics
	MaxDeadline       time.Duration
	ReconcileInterval time.Duration
	Clock             func() time.Time
	NewID             func() string
	Log               *slog.Logger
}

type DocumentOfficeService struct {
	pool      *pgxpool.Pool
	q         *db.Queries
	files     files.Service
	engine    OfficeEngine
	documents *DocumentService
	metrics   OfficeMetrics
	maxDL     time.Duration
	interval  time.Duration
	now       func() time.Time
	newID     func() string
	log       *slog.Logger
}

const (
	defaultOfficeDeadline = 60 * time.Second
	// officeGrantWindow is how long a grant may start its job; the job itself
	// runs to deadline_at.
	officeGrantWindow = 30 * time.Second
	// officeDeadlineGrace lets a job that is finishing at its deadline report
	// before Go times it out on its own clock.
	officeDeadlineGrace  = 5 * time.Second
	officeReconcileBatch = 100
)

// ErrOfficeJobNotCommittable: the job is not completed, was cancelled, or its
// output was already claimed by another commit.
var ErrOfficeJobNotCommittable = errors.New("office: job output is not committable")

// ErrOfficeJobInvalid: an operation this service does not start, or a
// missing or oversized idempotency key.
var ErrOfficeJobInvalid = errors.New("office_job_invalid")

// The XLSX native recalc sidecar accepts at most this many edit operations per
// request. Keep the server bound below the generic engine envelope bound so a
// malformed or oversized request is rejected before a job/output row exists.
const (
	maxOfficeEditOps   = 10_000
	maxOfficeEditsSize = 8 << 20
)

func NewDocumentOfficeService(o DocumentOfficeOptions) *DocumentOfficeService {
	s := &DocumentOfficeService{
		pool: o.Pool, q: o.Queries, files: o.Files, engine: o.Engine, documents: o.Documents, metrics: o.Metrics,
		maxDL: o.MaxDeadline, interval: o.ReconcileInterval, now: o.Clock, newID: o.NewID, log: o.Log,
	}
	if s.maxDL <= 0 {
		s.maxDL = 2 * time.Minute
	}
	if s.interval <= 0 {
		s.interval = 5 * time.Second
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.newID == nil {
		s.newID = util.NewID
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	return s
}

// OfficeJobInput starts one job on a document's base version.
type OfficeJobInput struct {
	OrganizationID   string
	WorkspaceID      string
	DocumentID       string
	BaseVersionID    string
	BaseRevision     int64
	Operation        office.Operation
	Format           office.Format
	IdempotencyKey   string
	Deadline         time.Duration
	DocumentModelRef string
	Edits            []office.EditOp
	// TargetFormat is a convert or export job's output format; it must be
	// the one target office.ConvertTargets (or office.ExportTargets) names for
	// Format. Empty for every other operation.
	TargetFormat office.Format

	// exportBound and input are set only by ExportFramePDF (UNI-1013): the
	// public job route keeps refusing export, and input, when set, replaces
	// the base version's bytes with the frame's unsaved edit of that base.
	exportBound bool
	input       *officeInput
}

// documentFileMaxBytes is the DocumentFile policy cap: the most a base
// version or an output may hold.
func documentFileMaxBytes() int64 {
	for _, spec := range files.DefaultSpecs() {
		if spec.Purpose == files.DocumentFile {
			return spec.Policy.MaxBytes
		}
	}
	return 50 << 20
}

func officeOperationID(jobID string) string { return "office_job:" + jobID }

func officeErr(code, reason string) error { return office.NewEngineError(code, reason) }

// authorize maps an office command onto the document ACL (G1-02): the
// command's document is authorized through authorizeDocument at the required
// level - view to open or read status, edit for other submissions or cancel.
// Only human actors reach an office command: agents write through proposals
// (ADR 0010) and anything else never gets a document.
func (s *DocumentOfficeService) authorize(ctx context.Context, actor Actor, documentID string, required DocumentLevel) error {
	if actor.Kind != audit.KindHuman || actor.ID == "" {
		return ErrForbidden
	}
	if s.documents == nil {
		return fmt.Errorf("office: documents service not wired")
	}
	_, _, err := s.documents.authorizeDocument(ctx, actor, documentID, required)
	return err
}

func validOfficeOperation(op office.Operation) bool {
	switch op {
	case office.OperationOpen, office.OperationEdit, office.OperationSerialize, office.OperationExport, office.OperationConvert:
		return true
	}
	return false
}

// Opening only materializes a read-only model of the authorized base version,
// and an export renders one for a reader (UNI-1013). Every other operation
// retains the document edit gate.
func officeJobRequiredLevel(operation office.Operation) DocumentLevel {
	if operation == office.OperationOpen || operation == office.OperationExport {
		return DocumentLevelView
	}
	return DocumentLevelEdit
}

// StartOfficeJob persists and dispatches one job, or answers the job the same
// idempotency key already started.
func (s *DocumentOfficeService) StartOfficeJob(ctx context.Context, actor Actor, in OfficeJobInput) (db.OfficeJob, error) {
	if s.engine == nil {
		return db.OfficeJob{}, office.ErrNotConfigured
	}
	if in.Operation == office.OperationExport && !in.exportBound {
		// Export is bound only behind the Docs web frame (ExportFramePDF);
		// refuse it here before a row or an output intent exists.
		return db.OfficeJob{}, officeErr("unsupported_operation", "export_not_bound")
	}
	key := strings.TrimSpace(in.IdempotencyKey)
	if !validOfficeOperation(in.Operation) || key == "" || len(key) > 128 {
		return db.OfficeJob{}, ErrOfficeJobInvalid
	}
	if err := validateOfficeJobEdits(in.Operation, in.Edits); err != nil {
		return db.OfficeJob{}, err
	}
	if err := s.authorize(ctx, actor, in.DocumentID, officeJobRequiredLevel(in.Operation)); err != nil {
		return db.OfficeJob{}, err
	}
	// A retried key is answered from its row before anything about the
	// document is re-checked: once the output is committed the base is no
	// longer current, and the retry must still read (or replay) its job.
	if existing, err := s.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{
		OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, IdempotencyKey: key,
	}); err == nil {
		return s.replay(ctx, actor, existing, in)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.OfficeJob{}, err
	}
	input, format, err := s.jobInput(ctx, in)
	if err != nil {
		return db.OfficeJob{}, err
	}
	// Version negotiation and the operation gate run before any mutation: a
	// build, contract or protocol outside the pin, or an operation this build
	// does not bind for the format, is refused while no office_jobs row and no
	// provider-output intent exist.
	capability, err := office.Negotiate(ctx, s.engine, format)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if !capability.Supports(in.Operation) {
		return db.OfficeJob{}, officeErr("unsupported_operation", "not_bound")
	}
	if err := checkConvertPair(in); err != nil {
		return db.OfficeJob{}, err
	}
	fp := officeFingerprint(in, input.checksum, int64(len(input.bytes)))
	scope := files.Scope{OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID}

	deadlineIn := in.Deadline
	if deadlineIn <= 0 {
		deadlineIn = defaultOfficeDeadline
	}
	if deadlineIn > s.maxDL {
		deadlineIn = s.maxDL
	}
	now := s.now()
	deadline := now.Add(deadlineIn)
	jobID := s.newID()
	out, err := s.files.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: actor, Purpose: files.DocumentFile, Scope: scope, OperationID: officeOperationID(jobID), Deadline: deadline,
	})
	if err != nil {
		return db.OfficeJob{}, err
	}
	row, err := s.q.InsertOfficeJob(ctx, db.InsertOfficeJobParams{
		ID: jobID, OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, DocumentID: in.DocumentID,
		Operation: string(in.Operation), Format: string(in.Format),
		BaseRevision: in.BaseRevision, BaseVersionID: in.BaseVersionID,
		IdempotencyKey: key, PayloadFingerprint: fp,
		InputChecksum: input.checksum, InputLength: int64(len(input.bytes)),
		GrantID:      s.newID(),
		TargetFormat: pgtype.Text{String: string(in.TargetFormat), Valid: in.TargetFormat != ""},
		OutputFileID: pgtype.Text{String: string(out.FileID), Valid: true},
		DeadlineAt:   pgtype.Timestamptz{Time: deadline, Valid: true},
		CreatedBy:    actor.ID, CreatedByKind: string(actor.Kind),
		Now: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost a race: the key or the same live work landed first. The output
		// file reserved above is never claimed; FileService collects it.
		return s.afterInsertConflict(ctx, actor, in, input, key, fp)
	}
	if err != nil {
		return db.OfficeJob{}, err
	}
	return s.dispatch(ctx, row, in, input, out.WriteTarget)
}

// loadBase checks the document and its base version, resolves the format the
// engine must work in, and reads the base bytes.
func (s *DocumentOfficeService) loadBase(ctx context.Context, in OfficeJobInput) (officeInput, office.Format, error) {
	doc, err := s.q.GetDocument(ctx, db.GetDocumentParams{ID: in.DocumentID, OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && doc.ArchivedAt.Valid) {
		return officeInput{}, "", ErrNotFound
	}
	if err != nil {
		return officeInput{}, "", err
	}
	if doc.Revision != in.BaseRevision {
		return officeInput{}, "", officeErr("base_version_mismatch", "revision")
	}
	ver, err := s.q.GetOfficeJobBaseVersion(ctx, db.GetOfficeJobBaseVersionParams{
		ID: in.BaseVersionID, OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, DocumentID: in.DocumentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return officeInput{}, "", officeErr("base_version_mismatch", "version")
	}
	if err != nil {
		return officeInput{}, "", err
	}
	if doc.FileVersionID.String != ver.ID {
		return officeInput{}, "", officeErr("base_version_mismatch", "not_current")
	}
	if ver.Kind != "file" || !ver.FileID.Valid {
		return officeInput{}, "", officeErr("unsupported_operation", "page_version")
	}
	if !office.CanReadEngineVersion(ver.EngineVersion.String) {
		// Rollback rule (G2-07b): a version a newer engine build committed is
		// never opened by this build; download and recovery do not go
		// through here and stay available.
		return officeInput{}, "", officeErr("engine_incompatible", "version_engine:"+ver.EngineVersion.String)
	}
	format, err := s.formatForVersion(ctx, doc, &ver)
	if err != nil {
		return officeInput{}, "", err
	}
	if format != in.Format {
		// The job's format is the document's format: a mismatch is a caller
		// error refused while nothing has been written.
		return officeInput{}, "", officeErr("unsupported_operation", "format_mismatch")
	}
	scope := files.Scope{OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID}
	input, err := s.readBase(ctx, scope, files.FileID(ver.FileID.String), ver.ChecksumSha256)
	if err != nil {
		return officeInput{}, "", err
	}
	return input, format, nil
}

func (s *DocumentOfficeService) afterInsertConflict(ctx context.Context, actor Actor, in OfficeJobInput, input officeInput, key, fp string) (db.OfficeJob, error) {
	existing, err := s.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{
		OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, IdempotencyKey: key,
	})
	if err == nil {
		return s.replay(ctx, actor, existing, in)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.OfficeJob{}, err
	}
	live, err := s.q.GetLiveOfficeJobByFingerprint(ctx, db.GetLiveOfficeJobByFingerprintParams{
		OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, DocumentID: in.DocumentID,
		BaseVersionID: in.BaseVersionID, PayloadFingerprint: fp,
	})
	if err == nil {
		return live, officeErr("in_flight", "same_work_live")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OfficeJob{}, officeErr("in_flight", "retry")
	}
	return db.OfficeJob{}, err
}

// replay answers a retried key: the same actor and payload read the job (and
// its output once completed); anything else is refused, never a second job.
// A job the engine never accepted (a retryable refusal left it accepted and
// undispatched) is dispatched again under the same job and grant ids.
func (s *DocumentOfficeService) replay(ctx context.Context, actor Actor, row db.OfficeJob, in OfficeJobInput) (db.OfficeJob, error) {
	if row.CreatedBy != actor.ID {
		return db.OfficeJob{}, officeErr("job_conflict", "actor")
	}
	// The row's own input digest stands in for the bytes, so a replay never
	// re-reads the base and still refuses a changed payload.
	if officeFingerprint(in, row.InputChecksum, row.InputLength) != row.PayloadFingerprint {
		return db.OfficeJob{}, officeErr("payload_fingerprint_mismatch", "")
	}
	// Supplied bytes are not covered by the base: they must be the ones the
	// key first ran with.
	if in.input != nil && in.input.checksum != row.InputChecksum {
		return db.OfficeJob{}, officeErr("payload_fingerprint_mismatch", "input_changed")
	}
	if row.State == string(office.JobAccepted) && !row.DispatchedAt.Valid && s.now().Before(row.DeadlineAt.Time) {
		input, _, err := s.jobInput(ctx, in)
		if err != nil {
			return row, err
		}
		if input.checksum != row.InputChecksum {
			return row, officeErr("payload_fingerprint_mismatch", "base_changed")
		}
		out, err := s.files.RegisterProviderOutput(ctx, files.ProviderOutputInput{
			Actor: actor, Purpose: files.DocumentFile,
			Scope:       files.Scope{OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID},
			OperationID: officeOperationID(row.ID), Deadline: row.DeadlineAt.Time,
		})
		if err != nil {
			return row, err
		}
		return s.dispatch(ctx, row, in, input, out.WriteTarget)
	}
	return s.Refresh(ctx, row)
}

type officeInput struct {
	bytes    []byte
	checksum string
}

// jobInput checks the base like loadBase and answers the bytes the engine
// works on: the base version's, or the supplied edit of that base.
func (s *DocumentOfficeService) jobInput(ctx context.Context, in OfficeJobInput) (officeInput, office.Format, error) {
	input, format, err := s.loadBase(ctx, in)
	if err != nil || in.input == nil {
		return input, format, err
	}
	return *in.input, format, nil
}

func (s *DocumentOfficeService) readBase(ctx context.Context, scope files.Scope, id files.FileID, want pgtype.Text) (officeInput, error) {
	r, err := s.files.Open(ctx, files.OpenInput{Scope: scope, FileID: id})
	if err != nil {
		return officeInput{}, err
	}
	defer r.Close()
	limit := documentFileMaxBytes()
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return officeInput{}, err
	}
	if int64(len(raw)) > limit {
		return officeInput{}, officeErr("upload_bounds", "base_too_large")
	}
	sum := sha256.Sum256(raw)
	checksum := hex.EncodeToString(sum[:])
	if want.Valid && want.String != "" && !strings.EqualFold(want.String, checksum) {
		return officeInput{}, officeErr("upload_checksum_mismatch", "base_version")
	}
	return officeInput{bytes: raw, checksum: checksum}, nil
}

// officeFingerprint is the identity of the job's result-deciding inputs: a
// retry of the same work matches, a changed payload does not. The deadline
// is deliberately not part of it.
func officeFingerprint(in OfficeJobInput, checksum string, length int64) string {
	raw, _ := json.Marshal(struct {
		Contract  string           `json:"contract_version"`
		Protocol  int              `json:"protocol_version"`
		Operation office.Operation `json:"operation"`
		Format    office.Format    `json:"format"`
		Document  string           `json:"document_id"`
		Base      string           `json:"base_version_id"`
		Revision  int64            `json:"base_revision"`
		Checksum  string           `json:"input_checksum"`
		Length    int64            `json:"input_length"`
		ModelRef  string           `json:"document_model_ref"`
		Edits     []office.EditOp  `json:"edits"`
		Engine    string           `json:"engine_version"`
		// omitempty keeps every non-convert fingerprint byte-identical to
		// the ones persisted before convert was bound.
		Target office.Format `json:"target_format,omitempty"`
	}{office.ContractVersion, office.ProtocolVersion, in.Operation, in.Format, in.DocumentID, in.BaseVersionID,
		in.BaseRevision, checksum, length, in.DocumentModelRef, in.Edits, office.TrustedEngineVersion, in.TargetFormat})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// checkConvertPair refuses a convert whose target is not the one OOXML copy
// the source converts to, and a target on any other operation. It runs before
// any mutation.
func checkConvertPair(in OfficeJobInput) error {
	if in.Operation == office.OperationExport {
		if want, ok := office.ExportTargets[in.Format]; !ok || in.TargetFormat != want {
			return officeErr("unsupported_operation", "export_pair_not_bound")
		}
		return nil
	}
	if in.Operation != office.OperationConvert {
		if in.TargetFormat != "" {
			return ErrOfficeJobInvalid
		}
		return nil
	}
	want, ok := office.ConvertTargets[in.Format]
	if !ok {
		return officeErr("unsupported_operation", "convert_source_not_bound")
	}
	if in.TargetFormat != want {
		return officeErr("unsupported_operation", "convert_pair_not_bound")
	}
	return nil
}

func millis(t time.Time) int64 { return t.UnixMilli() }

// grantFor builds the job's grant. Dispatch grants carry the input binding
// and the output target; status and cancel grants carry neither - the engine
// only matches their grant and job ids.
func (s *DocumentOfficeService) grantFor(row db.OfficeJob, input *office.GrantInput, output *office.GrantOutput) (string, error) {
	now := s.now()
	window := now.Add(officeGrantWindow)
	if row.DeadlineAt.Time.Before(window) {
		window = row.DeadlineAt.Time
	}
	return s.engine.Sign(office.ServiceGrant{
		V: 1, GrantID: row.GrantID, JobID: row.ID, ActorID: row.CreatedBy, ActorKind: row.CreatedByKind,
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, DocumentID: row.DocumentID,
		Operation: office.Operation(row.Operation), Format: office.Format(row.Format),
		BaseRevision: row.BaseRevision, BaseVersionID: row.BaseVersionID,
		Input: input, Output: output,
		DeadlineAt: millis(row.DeadlineAt.Time), IssuedAt: millis(now), ExpiresAt: millis(window),
	})
}

func (s *DocumentOfficeService) envelope(row db.OfficeJob, in OfficeJobInput, input officeInput) (office.Envelope, error) {
	remaining := row.DeadlineAt.Time.Sub(s.now()).Milliseconds()
	if remaining < 1 {
		remaining = 1
	}
	payload := map[string]any{
		"base_revision":   row.BaseRevision,
		"base_version_id": row.BaseVersionID,
		"input_bytes":     base64.StdEncoding.EncodeToString(input.bytes),
		"input_checksum":  input.checksum,
		"input_length":    len(input.bytes),
	}
	switch office.Operation(row.Operation) {
	case office.OperationConvert, office.OperationExport:
		// The convert allowlist has no base_* keys: the source version id is
		// the grant's base, and the committed source is never overwritten.
		payload = map[string]any{
			"source_version_id": row.BaseVersionID,
			"target_format":     row.TargetFormat.String,
			"overwrite_source":  false,
			"input_bytes":       payload["input_bytes"],
			"input_checksum":    input.checksum,
			"input_length":      len(input.bytes),
		}
	case office.OperationSerialize:
		ref := in.DocumentModelRef
		if ref == "" {
			ref = row.BaseVersionID
		}
		payload["document_model_ref"] = ref
	case office.OperationEdit:
		edits := in.Edits
		if edits == nil {
			edits = []office.EditOp{}
		}
		payload["edits"] = edits
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return office.Envelope{}, err
	}
	return office.Envelope{
		RequestID: row.ID, ContractVersion: office.ContractVersion, ProtocolVersion: office.ProtocolVersion,
		Operation: office.Operation(row.Operation), Format: office.Format(row.Format), DeadlineMs: &remaining,
		IdempotencyKey: row.ID, ClientEngineVersion: office.TrustedEngineVersion, GrantID: row.GrantID, Payload: raw,
	}, nil
}

// dispatch sends a persisted job. A retryable refusal (engine down or
// overloaded) leaves the row accepted, so the same key dispatches again; a
// final refusal settles the row failed with the engine's code.
func (s *DocumentOfficeService) dispatch(ctx context.Context, row db.OfficeJob, in OfficeJobInput, input officeInput, target files.WriteTarget) (db.OfficeJob, error) {
	env, err := s.envelope(row, in, input)
	if err != nil {
		return s.settleWith(ctx, row, err)
	}
	grant, err := s.grantFor(row,
		&office.GrantInput{Checksum: input.checksum, Length: int64(len(input.bytes))},
		&office.GrantOutput{
			FileID: row.OutputFileID.String, URL: target.URL, Method: target.Method, Headers: target.Headers,
			ExpiresAt: millis(target.ExpiresAt), MaxBytes: documentFileMaxBytes(),
		})
	if err != nil {
		return row, err
	}
	js, err := s.engine.Submit(ctx, grant, env)
	if err != nil {
		// Retryable, or a credential the deployment can still fix: keep the
		// row accepted so the same key dispatches it again.
		if office.Retryable(err) || errors.Is(err, office.ErrServiceAuth) {
			return row, err
		}
		return s.settleWith(ctx, row, err)
	}
	return s.apply(ctx, row, js)
}

// settleWith records a final refusal and returns it to the caller.
func (s *DocumentOfficeService) settleWith(ctx context.Context, row db.OfficeJob, cause error) (db.OfficeJob, error) {
	code, reason := "engine_result_invalid", cause.Error()
	var ee *office.EngineError
	if errors.As(cause, &ee) {
		code, reason = ee.Code, ee.Reason
	}
	settled, err := s.settle(ctx, row, office.JobFailed, code, reason)
	if err != nil {
		return row, err
	}
	return settled, cause
}

// Cancel settles the job cancelled unless it already settled or its output
// was committed; then it answers the job as it is. The engine is told
// best-effort - Go's row is the outcome.
func (s *DocumentOfficeService) CancelOfficeJob(ctx context.Context, actor Actor, orgID, wsID, jobID string) (db.OfficeJob, error) {
	row, err := s.get(ctx, orgID, wsID, jobID)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if err := s.authorize(ctx, actor, row.DocumentID, DocumentLevelEdit); err != nil {
		return db.OfficeJob{}, err
	}
	// Only the job's creator discards its work: a cancel can drop staged
	// output before commit, and no other member's say-so is recorded.
	if row.CreatedBy != actor.ID {
		return db.OfficeJob{}, ErrForbidden
	}
	cancelled, err := s.q.CancelOfficeJob(ctx, db.CancelOfficeJobParams{
		ErrorReason: pgtype.Text{String: "cancel_requested", Valid: true}, Now: s.ts(),
		ID: row.ID, OrganizationID: orgID, WorkspaceID: wsID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return s.get(ctx, orgID, wsID, jobID)
	}
	if err != nil {
		return db.OfficeJob{}, err
	}
	if isLiveOfficeState(row.State) {
		// A completed job was already counted when it completed.
		s.observe(cancelled)
	}
	if s.engine != nil && row.State != string(office.JobCompleted) {
		if grant, err := s.grantFor(row, nil, nil); err == nil {
			_, _ = s.engine.Cancel(ctx, row.ID, grant)
		}
	}
	return cancelled, nil
}

// GetOfficeJob reads a job; a live one is refreshed from the engine first.
func (s *DocumentOfficeService) GetOfficeJob(ctx context.Context, actor Actor, orgID, wsID, jobID string) (db.OfficeJob, error) {
	row, err := s.get(ctx, orgID, wsID, jobID)
	if err != nil {
		return db.OfficeJob{}, err
	}
	if err := s.authorize(ctx, actor, row.DocumentID, DocumentLevelView); err != nil {
		return db.OfficeJob{}, err
	}
	return s.Refresh(ctx, row)
}

// OpenOfficeJobOutput opens the staged bytes of a completed office job for
// an authorized document viewer. The output remains a FileService object and is
// never committed by this read; the normal Documents coordinator still owns
// upload+commit.  Keeping this read behind the document ACL prevents a job's
// output_file_id from becoming a bearer capability.
func (s *DocumentOfficeService) OpenOfficeJobOutput(ctx context.Context, actor Actor, documentID, jobID string) (files.Reader, error) {
	if s.files == nil || s.documents == nil {
		return files.Reader{}, office.ErrNotConfigured
	}
	doc, _, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return files.Reader{}, err
	}
	row, err := s.q.GetOfficeJob(ctx, db.GetOfficeJobParams{
		ID: jobID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) || row.DocumentID != documentID {
		return files.Reader{}, ErrNotFound
	}
	if err != nil {
		return files.Reader{}, err
	}
	if row.State != string(office.JobCompleted) || !row.OutputFileID.Valid || row.OutputFileID.String == "" {
		return files.Reader{}, ErrOfficeJobNotCommittable
	}
	return s.files.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID},
		FileID: files.FileID(row.OutputFileID.String),
	})
}

// ClaimOfficeJobOutputInTx is the hand-off to the commit path (G1-03): inside
// the commit transaction, mark the completed job committed to versionID and
// get the job row back. Exactly one commit wins; a cancelled, failed or
// already committed job returns ErrOfficeJobNotCommittable and its output is
// never attached. The caller, in the same transaction, must also:
//   - CAS the document on the job's base (documents.revision = BaseRevision and
//     file_version_id = BaseVersionID): two jobs may complete on one base
//     (different keys, or a retry after the first settled), and only the
//     document CAS decides which one becomes the version;
//   - ClaimInTx the job's OutputFileID with FileService, or the staged output
//     expires after files.ClaimTTL while the version points at it.
func (s *DocumentOfficeService) ClaimOfficeJobOutputInTx(ctx context.Context, q *db.Queries, orgID, wsID, jobID, versionID string) (db.OfficeJob, error) {
	return claimOfficeJobOutputInTx(ctx, q, orgID, wsID, jobID, versionID, s.ts())
}

// claimOfficeJobOutputInTx runs the same CAS without a service receiver: the
// commit path in document_commit.go (CommitFileVersion) has no
// DocumentOfficeService handle and stamps its own now.
func claimOfficeJobOutputInTx(ctx context.Context, q *db.Queries, orgID, wsID, jobID, versionID string, now pgtype.Timestamptz) (db.OfficeJob, error) {
	row, err := q.MarkOfficeJobCommitted(ctx, db.MarkOfficeJobCommittedParams{
		CommittedVersionID: pgtype.Text{String: versionID, Valid: true}, Now: now,
		ID: jobID, OrganizationID: orgID, WorkspaceID: wsID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OfficeJob{}, fmt.Errorf("%w: job %s", ErrOfficeJobNotCommittable, jobID)
	}
	return row, err
}

func (s *DocumentOfficeService) get(ctx context.Context, orgID, wsID, jobID string) (db.OfficeJob, error) {
	row, err := s.q.GetOfficeJob(ctx, db.GetOfficeJobParams{ID: jobID, OrganizationID: orgID, WorkspaceID: wsID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OfficeJob{}, ErrNotFound
	}
	return row, err
}

func (s *DocumentOfficeService) ts() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: s.now(), Valid: true}
}
