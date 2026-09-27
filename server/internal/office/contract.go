// Package office carries the UniWork Office engine boundary contract types:
// the Go mirror of @uniwork/office-contracts (packages/office-contracts).
// These are contract types only - there is no engine client, service code or
// storage access here. The wire schema is owned by
// docs/office/g0/engine-contract.md and scripts/office-g0/engine-contract.mjs;
// the JSON fixtures under packages/office-contracts/fixtures pin parity
// between this file and the TypeScript schemas.
package office

import "encoding/json"

// Contract identity (engine-contract.md SS4.1). Changing either value is a
// contract break: bump the fixtures and the TypeScript mirror in the same
// commit.
const (
	ContractVersion      = "uniwork-office-engine-contract/1"
	ProtocolVersion      = 1
	WireFormat           = "snake_case"
	TrustedEngineVersion = "genoffice@09485f88+uniwork-office.0"
)

// Format is a document format the boundary may be asked about.
type Format string

const (
	FormatDOCX Format = "docx"
	FormatXLSX Format = "xlsx"
	FormatPPTX Format = "pptx"
	FormatPDF  Format = "pdf"
	FormatMD   Format = "md"
	FormatHTML Format = "html"
)

// Operation is a boundary-routed engine operation.
type Operation string

const (
	OperationCapability Operation = "capability"
	OperationOpen       Operation = "open"
	OperationEdit       Operation = "edit"
	OperationSerialize  Operation = "serialize"
	OperationConvert    Operation = "convert"
	OperationExport     Operation = "export"
	OperationCancel     Operation = "cancel"
)

// JobState is a job lifecycle state (engine-contract.md SS6.1). The last five
// are terminal; only JobCompleted may proceed to a version commit.
type JobState string

const (
	JobAccepted  JobState = "accepted"
	JobRunning   JobState = "running"
	JobCompleted JobState = "completed"
	JobFailed    JobState = "failed"
	JobTimedOut  JobState = "timed_out"
	JobCancelled JobState = "cancelled"
	JobCrashed   JobState = "crashed"
)

// Terminal reports whether the state is terminal.
func (s JobState) Terminal() bool {
	switch s {
	case JobCompleted, JobFailed, JobTimedOut, JobCancelled, JobCrashed:
		return true
	}
	return false
}

// ErrorSpec is the boundary error-table entry for a code: the HTTP status Go
// answers with, the class a client branches on, the narrow kind, and whether
// the same key+fingerprint may be retried.
type ErrorSpec struct {
	Status     int
	ErrorClass string
	Kind       string
	Retryable  bool
}

// ErrorCodes mirrors ENGINE_ERROR_CODES exactly. A boundary failure is always
// one of these codes; clients branch on code, never on message text.
var ErrorCodes = map[string]ErrorSpec{
	"grant_expired":                {Status: 401, ErrorClass: "grant", Kind: "grant_ttl", Retryable: false},
	"grant_consumed":               {Status: 409, ErrorClass: "conflict", Kind: "grant_single_use", Retryable: false},
	"grant_scope":                  {Status: 403, ErrorClass: "permission", Kind: "grant_scope", Retryable: false},
	"grant_actor_mismatch":         {Status: 403, ErrorClass: "permission", Kind: "grant_actor", Retryable: false},
	"job_conflict":                 {Status: 409, ErrorClass: "conflict", Kind: "idempotency_actor", Retryable: false},
	"payload_fingerprint_mismatch": {Status: 409, ErrorClass: "conflict", Kind: "idempotency_payload", Retryable: false},
	"in_flight":                    {Status: 409, ErrorClass: "conflict", Kind: "idempotency_in_flight", Retryable: true},
	"invalid_transition":           {Status: 409, ErrorClass: "conflict", Kind: "state_transition", Retryable: false},
	"engine_incompatible":          {Status: 409, ErrorClass: "incompatible", Kind: "engine_version", Retryable: false},
	"protocol_mismatch":            {Status: 409, ErrorClass: "incompatible", Kind: "protocol_version", Retryable: false},
	"contract_mismatch":            {Status: 409, ErrorClass: "incompatible", Kind: "contract_version", Retryable: false},
	"engine_timeout":               {Status: 504, ErrorClass: "engine", Kind: "deadline_exceeded", Retryable: true},
	"engine_cancelled":             {Status: 499, ErrorClass: "engine", Kind: "cancelled", Retryable: false},
	"engine_crashed":               {Status: 502, ErrorClass: "engine", Kind: "engine_unavailable", Retryable: true},
	"engine_overloaded":            {Status: 503, ErrorClass: "engine", Kind: "backpressure", Retryable: true},
	"engine_result_invalid":        {Status: 502, ErrorClass: "engine", Kind: "malformed_result", Retryable: true},
	"engine_checksum_mismatch":     {Status: 502, ErrorClass: "engine", Kind: "output_checksum", Retryable: true},
	"upload_missing":               {Status: 409, ErrorClass: "conflict", Kind: "upload_unknown", Retryable: false},
	"upload_checksum_mismatch":     {Status: 409, ErrorClass: "conflict", Kind: "upload_checksum", Retryable: false},
	"upload_bounds":                {Status: 413, ErrorClass: "quota", Kind: "byte_bound", Retryable: false},
	"upload_already_consumed":      {Status: 409, ErrorClass: "conflict", Kind: "upload_consumed", Retryable: false},
	"commit_failed":                {Status: 409, ErrorClass: "conflict", Kind: "commit_rollback", Retryable: true},
	"base_version_mismatch":        {Status: 409, ErrorClass: "conflict", Kind: "base_version", Retryable: false},
	"object_missing":               {Status: 500, ErrorClass: "storage", Kind: "orphan_ledger", Retryable: true},
	"not_found":                    {Status: 404, ErrorClass: "missing", Kind: "unknown_resource", Retryable: false},
	"unsupported_operation":        {Status: 501, ErrorClass: "incompatible", Kind: "unsupported_operation", Retryable: false},
}

// ErrorBody is the public error body inside an error envelope (SS4.7).
// FidelityPreserved states the failure did not damage the committed version.
type ErrorBody struct {
	Code              string `json:"code"`
	Status            int    `json:"status"`
	ErrorClass        string `json:"error_class"`
	Kind              string `json:"kind"`
	Retryable         bool   `json:"retryable"`
	FidelityPreserved bool   `json:"fidelity_preserved"`
}

// ErrorEnvelope is the shared failure result (SS4.7).
type ErrorEnvelope struct {
	RequestID string    `json:"request_id,omitempty"`
	State     JobState  `json:"state"`
	Operation Operation `json:"operation,omitempty"`
	Error     ErrorBody `json:"error"`
}

// Envelope is an inbound engine request (SS4-SS5). Payload is left raw so the
// per-operation structs below unmarshal against the operation allowlist.
type Envelope struct {
	RequestID           string            `json:"request_id"`
	ContractVersion     string            `json:"contract_version"`
	ProtocolVersion     int               `json:"protocol_version"`
	Operation           Operation         `json:"operation"`
	Format              Format            `json:"format"`
	DeadlineMs          *int64            `json:"deadline_ms,omitempty"`
	IdempotencyKey      string            `json:"idempotency_key,omitempty"`
	ClientEngineVersion string            `json:"client_engine_version,omitempty"`
	GrantID             string            `json:"grant_id,omitempty"`
	Payload             json.RawMessage   `json:"payload"`
	DeclaredWarnings    []FidelityWarning `json:"declared_warnings,omitempty"`
}

// FidelityWarning is a non-fatal fidelity notice the engine may raise.
type FidelityWarning struct {
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

// InputTuple is the caller-declared input byte description. The boundary
// decodes and measures the real bytes; these fields are never trusted.
type InputTuple struct {
	InputBytes    string `json:"input_bytes"`
	InputChecksum string `json:"input_checksum"`
	InputLength   int64  `json:"input_length"`
}

// OpenPayload is the payload allowlist for operation "open".
type OpenPayload struct {
	InputTuple
	BaseRevision     int64    `json:"base_revision"`
	BaseVersionID    string   `json:"base_version_id"`
	Edits            []EditOp `json:"edits,omitempty"`
	Locale           string   `json:"locale,omitempty"`
	DocumentModelRef string   `json:"document_model_ref,omitempty"`
}

// EditPayload is the payload allowlist for operation "edit".
type EditPayload struct {
	InputTuple       *InputTuple `json:"-"`
	DocumentModelRef string      `json:"document_model_ref,omitempty"`
	BaseRevision     *int64      `json:"base_revision,omitempty"`
	BaseVersionID    string      `json:"base_version_id,omitempty"`
	Edits            []EditOp    `json:"edits"`
	Locale           string      `json:"locale,omitempty"`
}

// SerializePayload is the payload allowlist for operation "serialize".
type SerializePayload struct {
	InputTuple       *InputTuple `json:"-"`
	DocumentModelRef string      `json:"document_model_ref"`
	BaseRevision     *int64      `json:"base_revision,omitempty"`
	BaseVersionID    string      `json:"base_version_id,omitempty"`
}

// ConvertPayload is the payload allowlist for "convert" and "export".
// OverwriteSource may only ever be false (Q7-B): a committed source is never
// overwritten.
type ConvertPayload struct {
	SourceVersionID string          `json:"source_version_id"`
	TargetFormat    Format          `json:"target_format"`
	OverwriteSource *bool           `json:"overwrite_source,omitempty"`
	Options         json.RawMessage `json:"options,omitempty"`
}

// CancelPayload is the payload allowlist for operation "cancel".
type CancelPayload struct {
	JobID  string `json:"job_id"`
	Reason string `json:"reason,omitempty"`
}

// CapabilityPayload is the payload allowlist for operation "capability".
type CapabilityPayload struct {
	MaxInputBytes *int64 `json:"max_input_bytes,omitempty"`
}

// EditOp is one edit operation on the session model.
type EditOp struct {
	Op         string          `json:"op"`
	Target     json.RawMessage `json:"target,omitempty"`
	Text       string          `json:"text,omitempty"`
	Style      json.RawMessage `json:"style,omitempty"`
	Range      json.RawMessage `json:"range,omitempty"`
	Attributes json.RawMessage `json:"attributes,omitempty"`
}

// EvidenceLevel is the proof behind a capability claim
// (module-runtime-map.json evidence_levels). Pending proof never becomes
// Supported=true on the product-facing row.
type EvidenceLevel string

const (
	EvidenceProven     EvidenceLevel = "proven"
	EvidenceSourceRead EvidenceLevel = "source_read"
	EvidencePending    EvidenceLevel = "pending"
)

// RuntimeKind is where a capability may execute.
type RuntimeKind string

const (
	RuntimeBrowser         RuntimeKind = "browser"
	RuntimeWorker          RuntimeKind = "worker"
	RuntimeNativeDesktop   RuntimeKind = "native_desktop"
	RuntimeInternalService RuntimeKind = "internal_service"
	RuntimeNone            RuntimeKind = "none"
)

// CapabilityEntry is one capability row as the engine reports it.
type CapabilityEntry struct {
	Operation     string        `json:"operation"`
	Supported     bool          `json:"supported"`
	Runtime       RuntimeKind   `json:"runtime"`
	EvidenceLevel EvidenceLevel `json:"evidence_level"`
	Reason        string        `json:"reason,omitempty"`
}

// ProductSupported is the UniWork-facing rule: supported implies proven.
func (e CapabilityEntry) ProductSupported() bool {
	return e.Supported && e.EvidenceLevel == EvidenceProven
}

// JobGrant is the scoped, expiring permission Go issues per engine job (SS3).
// InputObjectKey is an authority field: it lives inside the issued grant and
// never inside a caller envelope.
type JobGrant struct {
	GrantID        string    `json:"grant_id"`
	ActorID        string    `json:"actor_id"`
	OrganizationID string    `json:"organization_id"`
	WorkspaceID    string    `json:"workspace_id"`
	DocumentID     string    `json:"document_id"`
	Operation      Operation `json:"operation"`
	Scope          string    `json:"scope"`
	BaseRevision   int64     `json:"base_revision"`
	BaseVersionID  string    `json:"base_version_id"`
	InputObjectKey string    `json:"input_object_key,omitempty"`
	IssuedAt       int64     `json:"issued_at"`
	ExpiresAt      int64     `json:"expires_at"`
	SingleUse      bool      `json:"single_use"`
	Consumed       bool      `json:"consumed"`
	MaxOutputBytes int64     `json:"max_output_bytes"`
}

// OpenFailureClass is the named failure class an adapter reports instead of a
// blank document (port-items P3).
type OpenFailureClass string

const (
	OpenPasswordRequired  OpenFailureClass = "password_required"
	OpenPasswordCancelled OpenFailureClass = "password_cancelled"
	OpenWrongPassword     OpenFailureClass = "wrong_password"
	OpenCorrupted         OpenFailureClass = "corrupted"
	OpenEngineError       OpenFailureClass = "engine_error"
	OpenUnsupported       OpenFailureClass = "unsupported_feature"
	OpenNotOfficeFile     OpenFailureClass = "not_office_file"
	OpenIOError           OpenFailureClass = "io_error"
	OpenTooLarge          OpenFailureClass = "too_large"
)

// OpenFailureReport is the P3 typed failure report: bound to the document id
// so the client keeps a named error visible and never saves a blank over the
// source.
type OpenFailureReport struct {
	Outcome      string           `json:"outcome"` // always "failed"
	DocumentID   string           `json:"document_id"`
	Format       Format           `json:"format"`
	FailureClass OpenFailureClass `json:"failure_class"`
	Message      string           `json:"message,omitempty"`
	EngineError  string           `json:"engine_error,omitempty"`
}
