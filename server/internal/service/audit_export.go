package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// utf8BOM prefixes the CSV. Excel on a Vietnamese Windows install reads a
// BOM-less UTF-8 file as the system code page and renders every accented
// character as mojibake; the three bytes are the difference between a file a
// compliance officer can open and one they send back.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// AuditExportConsumer turns an export request into a file on storage. It runs
// on the outbox rather than in the request: a year of audit rows takes longer
// than an HTTP request should live, and a crash halfway through leaves a row
// that is retried rather than a download that silently never arrives.
type AuditExportConsumer struct {
	q     *db.Queries
	store storage.Storage

	// pool and files are the FileService pipeline. They arrive together
	// through SetFileService, the wiring-level selector (T10): files == nil
	// runs the legacy storage path byte-identically, a non-nil value switches
	// every export to upload + claim, and an error never falls back across.
	pool  *pgxpool.Pool
	files files.Service
}

func NewAuditExportConsumer(q *db.Queries, store storage.Storage) *AuditExportConsumer {
	return &AuditExportConsumer{q: q, store: store}
}

// SetFileService switches the consumer to the FileService pipeline. Wiring
// calls it once (the integrator owns cmd/server/main.go); it is deliberately
// not a flag a request or an environment can flip.
func (c *AuditExportConsumer) SetFileService(pool *pgxpool.Pool, fs files.Service) {
	c.pool, c.files = pool, fs
}

func (*AuditExportConsumer) Name() string { return "audit-export" }

func (*AuditExportConsumer) Topics() []string { return []string{"audit.export_requested"} }

// Handle is idempotent by export id: a job that already completed is skipped,
// so a retried row does not upload a second copy.
func (c *AuditExportConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.files == nil {
		return c.handleLegacy(ctx, ev)
	}
	return c.handleFile(ctx, ev)
}

// handleLegacy is the pre-migration path, kept byte-identical until the
// integrator cuts the module over (plan §7 step 8): it writes object_key on
// the job row and leaves the bytes on direct storage.
func (c *AuditExportConsumer) handleLegacy(ctx context.Context, ev outbox.Row) error {
	if c.store == nil {
		return fmt.Errorf("audit export: no storage backend configured")
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("audit export: payload of %s: %w", ev.ID, err)
	}
	exportID, orgID := payload["export_id"], payload["organization_id"]
	if exportID == "" || orgID == "" {
		return nil
	}
	exp, err := c.q.GetAuditExport(ctx, db.GetAuditExportParams{ID: exportID, OrganizationID: orgID})
	if err != nil {
		return err
	}
	if exp.CompletedAt.Valid {
		return nil
	}
	if err := c.q.StartAuditExport(ctx, exportID); err != nil {
		return err
	}

	rows, err := c.q.ListAuditEventsForExport(ctx, db.ListAuditEventsForExportParams{
		OrganizationID: orgID,
		OccurredAt:     exp.FromAt,
		OccurredAt_2:   exp.ToAt,
		Limit:          exportMaxRows + 1,
	})
	if err != nil {
		return err
	}
	if int32(len(rows)) > exportMaxRows {
		// Not a retryable failure: no number of attempts makes the range
		// smaller. Record it against the job so the screen can say so.
		return c.fail(ctx, exportID, "khoảng thời gian quá lớn: chia nhỏ và xuất lại")
	}

	body, contentType := encodeAuditExport(rows, exp.Format)
	key := fmt.Sprintf("audit-exports/%s/%s.%s", orgID, exportID, exp.Format)
	if _, err := c.store.Upload(ctx, key, body, contentType, exportFilename(exp)); err != nil {
		return err
	}
	return c.q.CompleteAuditExport(ctx, db.CompleteAuditExportParams{
		ID: exportID, ObjectKey: pgtype.Text{String: key, Valid: true}, RowCount: int32(len(rows)),
	})
}

// handleFile is the FileService path (T10): the generated output uploads
// through the shared pipeline under purpose audit_export, then the file is
// claimed and the job marked complete in one transaction. A crash between
// upload and claim leaves a staged file that expires on its own; a replayed
// row uploads nothing twice because the idempotency key is the export id and
// the completion update refuses a job that is already done.
func (c *AuditExportConsumer) handleFile(ctx context.Context, ev outbox.Row) error {
	var payload map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("audit export: payload of %s: %w", ev.ID, err)
	}
	exportID, orgID := payload["export_id"], payload["organization_id"]
	if exportID == "" || orgID == "" {
		return nil
	}
	exp, err := c.q.GetAuditExport(ctx, db.GetAuditExportParams{ID: exportID, OrganizationID: orgID})
	if err != nil {
		return err
	}
	if exp.CompletedAt.Valid || exp.FailedAt.Valid {
		// A redelivered row after the job settled must not write again: the
		// finished result is not overwritten and a failed job is not revived.
		return nil
	}
	if err := c.q.StartAuditExport(ctx, exportID); err != nil {
		return err
	}

	rows, err := c.q.ListAuditEventsForExport(ctx, db.ListAuditEventsForExportParams{
		OrganizationID: orgID,
		OccurredAt:     exp.FromAt,
		OccurredAt_2:   exp.ToAt,
		Limit:          exportMaxRows + 1,
	})
	if err != nil {
		return err
	}
	if int32(len(rows)) > exportMaxRows {
		return c.fail(ctx, exportID, "khoảng thời gian quá lớn: chia nhỏ và xuất lại")
	}

	body, _ := encodeAuditExport(rows, exp.Format)
	scope := files.Scope{OrganizationID: orgID}
	actor := audit.System("audit-export")
	up, err := c.files.Upload(ctx, files.UploadInput{
		Actor:   actor,
		Purpose: files.AuditExport,
		Scope:   scope,
		// The export id is the idempotency key: a crash after the upload and
		// a retried delivery both land on the same staged file instead of a
		// second object.
		IdempotencyKey: "audit-export:" + exportID,
		Filename:       exportFilename(exp),
		Body:           bytes.NewReader(body),
	})
	if err != nil {
		return c.exportFileError(ctx, exportID, err)
	}
	if err := c.claimAndComplete(ctx, exp, scope, actor, up, int32(len(rows))); err != nil {
		if errors.Is(err, errExportSettled) {
			// A sibling delivery completed the job first: rolling the
			// transaction back dropped our claim, and the staged duplicate
			// is canceled so it does not wait a day for the claim window.
			if cerr := c.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: up.File.ID}); cerr != nil {
				slog.Warn("audit export: losing duplicate upload not canceled", "export", exportID, "err", cerr)
			}
			return nil
		}
		return c.exportFileError(ctx, exportID, err)
	}
	return nil
}

// errExportSettled is the inside-transaction signal that the job row was
// already finished when the conditional update ran: the winner is kept and
// the loser's upload is dropped, never attached alongside.
var errExportSettled = errors.New("audit export: job already completed")

// claimAndComplete runs the one transaction that attaches the file and marks
// the job done: the claim first, in the lock order ClaimInTx declares (FS-C1
// §5.4), the conditional completion after it, and the audit.exported audit
// row + outbox event last so the notification only ever fires for a result
// that truly landed — and the audit trail records the moment personal data
// became downloadable (ADR 0009/0012: completion is a business command, so it
// goes through Record, not the provider-scoped Emit).
func (c *AuditExportConsumer) claimAndComplete(ctx context.Context, exp db.AuditExport, scope files.Scope, actor audit.Actor, up files.Upload, rowCount int32) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)

	if _, err := c.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor:   actor,
		Purpose: files.AuditExport,
		Scope:   scope,
		FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		return err
	}
	if _, err := q.CompleteAuditExportWithFile(ctx, db.CompleteAuditExportWithFileParams{
		ID:       exp.ID,
		FileID:   pgtype.Text{String: string(up.File.ID), Valid: true},
		RowCount: rowCount,
	}); errors.Is(err, pgx.ErrNoRows) {
		return errExportSettled
	} else if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: exp.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionAuditExported,
		ResourceType:   "audit_export", ResourceID: exp.ID,
	}, audit.Event{
		Topic:   "audit.exported",
		Version: 1,
		Payload: map[string]string{
			"export_id":       exp.ID,
			"organization_id": exp.OrganizationID,
			"user_id":         exp.RequestedBy,
		},
		OrganizationID: exp.OrganizationID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// exportFileError sorts a FileService refusal into the job's outcome. A
// storage outage retried through the outbox may succeed later; every other
// refusal is final for bytes the encoder will always produce the same way, so
// the job is marked failed and the caller asks for a fresh export.
func (c *AuditExportConsumer) exportFileError(ctx context.Context, exportID string, err error) error {
	var fe *files.Error
	if !errors.As(err, &fe) {
		return err
	}
	switch fe.Code {
	case files.CodeStorageUnavailable:
		return err
	case files.CodeClaimExpired:
		// The staged file's claim window lapsed while earlier attempts kept
		// failing; the idempotency key only ever replays that dead session.
		return c.fail(ctx, exportID, "tệp kết quả hết hạn trước khi gắn: hãy xuất lại")
	default:
		return c.fail(ctx, exportID, "tệp kết quả không gắn được: hãy xuất lại")
	}
}

func (c *AuditExportConsumer) fail(ctx context.Context, exportID, reason string) error {
	return c.q.FailAuditExport(ctx, db.FailAuditExportParams{
		ID: exportID, Error: pgtype.Text{String: reason, Valid: true},
	})
}

// auditExportReferenceProvider is the FS-C1 §6 hook for the audit_export
// purpose: it tells the collector which files a job row still points at.
type auditExportReferenceProvider struct{}

// AuditExportReferenceProvider returns the reference provider the integrator
// registers with FileService when the audit export purpose is enabled.
func AuditExportReferenceProvider() files.ReferenceProvider {
	return auditExportReferenceProvider{}
}

func (auditExportReferenceProvider) Name() string { return "audit.exports" }

func (auditExportReferenceProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.AuditExport}
}

// HeldBy reports every id a job row still references. file_id is dropped in
// the same transaction that releases the file, so anything this returns is
// held for real; an answer of nothing is what lets the collector move.
func (auditExportReferenceProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	raw := make([]string, len(ids))
	for i, id := range ids {
		raw[i] = string(id)
	}
	rows, err := q.AuditExportHeldFileIDs(ctx, raw)
	if err != nil {
		return nil, err
	}
	held := make(map[files.FileID]files.HoldReason, len(rows))
	for _, id := range rows {
		if id.Valid {
			held[files.FileID(id.String)] = files.HoldActive
		}
	}
	return held, nil
}

// exportFilename names the file after its format. JSON Lines is .ndjson, not
// .json: FileService proves NDJSON from UTF-8 text named .ndjson (FS-C1
// errata 9.1), and a .json name would verify as text/plain, which the
// AuditExport allowlist refuses.
func exportFilename(exp db.AuditExport) string {
	ext := exp.Format
	if ext == "json" {
		ext = "ndjson"
	}
	return fmt.Sprintf("audit-%s-%s.%s",
		exp.FromAt.Time.UTC().Format("20060102"),
		exp.ToAt.Time.UTC().Format("20060102"),
		ext)
}

// auditExportContentType is the type the download route declares — the
// format's semantic type, not the sniffed one the file record carries.
func auditExportContentType(format string) string {
	if format == "json" {
		return "application/x-ndjson"
	}
	return "text/csv; charset=utf-8"
}

// encodeAuditExport writes CSV or JSON Lines. JSON Lines rather than one big
// array so a reader can stream it and a truncated file is still parseable up
// to its last complete line.
func encodeAuditExport(rows []db.AuditEvent, format string) ([]byte, string) {
	if format == "json" {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		for _, r := range rows {
			_ = enc.Encode(auditExportRecord(r))
		}
		return buf.Bytes(), "application/x-ndjson"
	}
	var buf bytes.Buffer
	buf.Write(utf8BOM)
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{
		"id", "occurred_at", "actor_kind", "actor_id", "action",
		"resource_type", "resource_id", "workspace_id", "changes", "metadata", "correlation_id",
	})
	for _, r := range rows {
		_ = w.Write([]string{
			r.ID, tsString(r.OccurredAt), r.ActorKind, r.ActorID, r.Action,
			r.ResourceType, r.ResourceID, r.WorkspaceID.String, r.Changes, r.Metadata, r.CorrelationID,
		})
	}
	w.Flush()
	return buf.Bytes(), "text/csv; charset=utf-8"
}

// auditExportRecord is the exported shape. The IP address is left out of every
// export: it is personal data, and an export leaves the system entirely.
func auditExportRecord(r db.AuditEvent) map[string]any {
	return map[string]any{
		"id":              r.ID,
		"occurred_at":     tsString(r.OccurredAt),
		"actor_kind":      r.ActorKind,
		"actor_id":        r.ActorID,
		"action":          r.Action,
		"resource_type":   r.ResourceType,
		"resource_id":     r.ResourceID,
		"workspace_id":    r.WorkspaceID.String,
		"changes":         parseJSONObject(r.Changes),
		"metadata":        parseJSONObject(r.Metadata),
		"correlation_id":  r.CorrelationID,
		"organization_id": r.OrganizationID,
	}
}

func tsString(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}
