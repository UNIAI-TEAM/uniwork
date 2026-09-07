package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

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
}

func NewAuditExportConsumer(q *db.Queries, store storage.Storage) *AuditExportConsumer {
	return &AuditExportConsumer{q: q, store: store}
}

func (*AuditExportConsumer) Name() string { return "audit-export" }

func (*AuditExportConsumer) Topics() []string { return []string{"audit.export_requested"} }

// Handle is idempotent by export id: a job that already completed is skipped,
// so a retried row does not upload a second copy.
func (c *AuditExportConsumer) Handle(ctx context.Context, ev outbox.Row) error {
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

func (c *AuditExportConsumer) fail(ctx context.Context, exportID, reason string) error {
	return c.q.FailAuditExport(ctx, db.FailAuditExportParams{
		ID: exportID, Error: pgtype.Text{String: reason, Valid: true},
	})
}

func exportFilename(exp db.AuditExport) string {
	return fmt.Sprintf("audit-%s-%s.%s",
		exp.FromAt.Time.UTC().Format("20060102"),
		exp.ToAt.Time.UTC().Format("20060102"),
		exp.Format)
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
