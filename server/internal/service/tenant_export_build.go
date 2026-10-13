package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// tenantExportMaxBytes is the zip cap. Past it the job fails instead of
// retrying a file the worker will build the same way every time.
const tenantExportMaxBytes = 100 << 20

var tenantTableIdent = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// PrivacyExportConsumer builds the organization zip on the slow outbox lane.
type PrivacyExportConsumer struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	files    files.Service
	maxBytes int
}

func NewPrivacyExportConsumer(pool *pgxpool.Pool, q *db.Queries) *PrivacyExportConsumer {
	return &PrivacyExportConsumer{pool: pool, q: q}
}

func (c *PrivacyExportConsumer) SetFileService(fs files.Service) { c.files = fs }

func (*PrivacyExportConsumer) Name() string { return "privacy-export" }

func (*PrivacyExportConsumer) DeliveryTimeout() time.Duration { return 120 * time.Second }

func (*PrivacyExportConsumer) Topics() []string { return []string{"privacy.export_requested"} }

func (c *PrivacyExportConsumer) limit() int {
	if c.maxBytes > 0 {
		return c.maxBytes
	}
	return tenantExportMaxBytes
}

func (c *PrivacyExportConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.files == nil || c.pool == nil {
		return fmt.Errorf("privacy export: file service is not wired")
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("privacy export: payload of %s: %w", ev.ID, err)
	}
	requestID, orgID := payload["request_id"], payload["organization_id"]
	if requestID == "" || orgID == "" {
		return nil
	}
	row, err := c.q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{ID: requestID, OrganizationID: orgID})
	if err != nil {
		return err
	}
	if row.CompletedAt.Valid || row.FailedAt.Valid {
		return nil
	}
	if err := c.q.StartDataSubjectRequest(ctx, requestID); err != nil {
		return c.settleExport(ctx, ev, requestID, err)
	}
	body, rows, err := c.buildZip(ctx, orgID)
	if err != nil {
		if errors.Is(err, errPrivacyExportTooLarge) {
			return c.fail(ctx, requestID, "dữ liệu tổ chức vượt 100 MiB: liên hệ hỗ trợ để xuất theo phần")
		}
		return c.settleExport(ctx, ev, requestID, err)
	}
	scope := files.Scope{OrganizationID: orgID}
	actor := audit.System("privacy-export")
	up, err := c.files.Upload(ctx, files.UploadInput{
		Actor: actor, Purpose: files.TenantExport, Scope: scope,
		IdempotencyKey: "tenant-export:" + requestID,
		Filename:       "organization-data.zip",
		Body:           bytes.NewReader(body),
	})
	if err != nil {
		return c.settleExport(ctx, ev, requestID, c.exportFileError(ctx, requestID, err))
	}
	if err := c.claimAndComplete(ctx, row, scope, actor, up, rows); err != nil {
		if errors.Is(err, errPrivacyExportSettled) {
			if cerr := c.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: up.File.ID}); cerr != nil {
				slog.Warn("privacy export: losing duplicate upload not canceled", "request", requestID, "err", cerr)
			}
			return nil
		}
		return c.settleExport(ctx, ev, requestID, c.exportFileError(ctx, requestID, err))
	}
	return nil
}

// settleExport keeps a transient failure retryable. The last attempt records
// the failure instead, so the one-open privacy request does not stay open
// after the outbox parks the event.
func (c *PrivacyExportConsumer) settleExport(ctx context.Context, ev outbox.Row, requestID string, err error) error {
	if err == nil || errors.Is(err, context.Canceled) {
		return err
	}
	if ev.Attempts+1 < outbox.MaxAttempts {
		return err
	}
	if ferr := c.fail(context.WithoutCancel(ctx), requestID, "xuất dữ liệu không xong sau nhiều lần thử"); ferr != nil {
		return errors.Join(err, ferr)
	}
	return nil
}

var errPrivacyExportTooLarge = errors.New("privacy export: zip exceeds the cap")
var errPrivacyExportSettled = errors.New("privacy export: job already completed")

func (c *PrivacyExportConsumer) claimAndComplete(ctx context.Context, row db.DataSubjectRequest, scope files.Scope, actor audit.Actor, up files.Upload, rowCount int32) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	if _, err := c.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: files.TenantExport, Scope: scope, FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		return err
	}
	if _, err := q.CompleteDataSubjectRequestWithFile(ctx, db.CompleteDataSubjectRequestWithFileParams{
		ID: row.ID, FileID: pgtype.Text{String: string(up.File.ID), Valid: true}, RowCount: rowCount,
	}); errors.Is(err, pgx.ErrNoRows) {
		return errPrivacyExportSettled
	} else if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionPrivacyExported,
		ResourceType:   "data_subject_request", ResourceID: row.ID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (c *PrivacyExportConsumer) exportFileError(ctx context.Context, requestID string, err error) error {
	var fe *files.Error
	if !errors.As(err, &fe) {
		return err
	}
	switch fe.Code {
	case files.CodeStorageUnavailable:
		return err
	default:
		return c.fail(ctx, requestID, "tệp kết quả không gắn được: hãy xuất lại")
	}
}

func (c *PrivacyExportConsumer) fail(ctx context.Context, requestID, reason string) error {
	return c.q.FailDataSubjectRequest(ctx, db.FailDataSubjectRequestParams{
		ID: requestID, Error: pgtype.Text{String: reason, Valid: true},
	})
}

type privacyManifest struct {
	OrganizationID string               `json:"organization_id"`
	GeneratedAt    string               `json:"generated_at"`
	Tables         []privacyTableCount  `json:"tables"`
	Excluded       []privacyExcluded    `json:"excluded"`
	Files          []privacyFileSummary `json:"files"`
}

type privacyTableCount struct {
	Name string `json:"name"`
	Rows int    `json:"rows"`
}

type privacyExcluded struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

type privacyFileSummary struct {
	FileID    string `json:"file_id"`
	Filename  string `json:"filename"`
	SizeBytes any    `json:"size_bytes"`
	Checksum  any    `json:"checksum_sha256"`
}

func (c *PrivacyExportConsumer) buildZip(ctx context.Context, orgID string) ([]byte, int32, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	var total int32
	counts := make([]privacyTableCount, 0, len(tenantExportIncludedTables))
	var fileSummaries []privacyFileSummary
	for _, table := range tenantExportIncludedTables {
		lines, summaries, err := c.tableJSONL(ctx, table, orgID)
		if err != nil {
			_ = zw.Close()
			return nil, 0, err
		}
		if err := writeZip(zw, "tables/"+table+".jsonl", lines); err != nil {
			_ = zw.Close()
			return nil, 0, err
		}
		n := bytes.Count(lines, []byte("\n"))
		total += int32(n)
		counts = append(counts, privacyTableCount{Name: table, Rows: n})
		fileSummaries = append(fileSummaries, summaries...)
		if buf.Len() > c.limit() {
			_ = zw.Close()
			return nil, 0, errPrivacyExportTooLarge
		}
	}
	orgLine, err := c.organizationJSON(ctx, orgID)
	if err != nil {
		_ = zw.Close()
		return nil, 0, err
	}
	if err := writeZip(zw, "organization.json", orgLine); err != nil {
		_ = zw.Close()
		return nil, 0, err
	}
	excluded := make([]privacyExcluded, 0, len(tenantExportExcluded))
	for name, reason := range tenantExportExcluded {
		excluded = append(excluded, privacyExcluded{Name: name, Reason: reason})
	}
	sortExcluded(excluded)
	manifest, err := json.Marshal(privacyManifest{
		OrganizationID: orgID,
		GeneratedAt:    time.Now().UTC().Format(time.RFC3339),
		Tables:         counts,
		Excluded:       excluded,
		Files:          fileSummaries,
	})
	if err != nil {
		_ = zw.Close()
		return nil, 0, err
	}
	if err := writeZip(zw, "manifest.json", manifest); err != nil {
		_ = zw.Close()
		return nil, 0, err
	}
	if err := zw.Close(); err != nil {
		return nil, 0, err
	}
	if buf.Len() > c.limit() {
		return nil, 0, errPrivacyExportTooLarge
	}
	return buf.Bytes(), total, nil
}

func writeZip(zw *zip.Writer, name string, body []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(body)
	return err
}

func sortExcluded(rows []privacyExcluded) {
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
}

func (c *PrivacyExportConsumer) tableJSONL(ctx context.Context, table, orgID string) ([]byte, []privacyFileSummary, error) {
	if !tenantTableIdent.MatchString(table) || !tenantExportIncludes(table) {
		return nil, nil, fmt.Errorf("privacy export: refused table %q", table)
	}
	// The name is a closed-set identifier, not a request value. sqlc cannot
	// bind a table, so the query is built only after that check.
	q := fmt.Sprintf(`SELECT row_to_json(t)::text FROM %s t WHERE t.organization_id = $1`, table)
	rows, err := c.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var buf bytes.Buffer
	var summaries []privacyFileSummary
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, nil, err
		}
		clean, summary, err := redactTenantRow(table, raw)
		if err != nil {
			return nil, nil, err
		}
		buf.Write(clean)
		buf.WriteByte('\n')
		if summary != nil {
			summaries = append(summaries, *summary)
		}
	}
	return buf.Bytes(), summaries, rows.Err()
}

func (c *PrivacyExportConsumer) organizationJSON(ctx context.Context, orgID string) ([]byte, error) {
	var raw string
	err := c.pool.QueryRow(ctx, `SELECT row_to_json(o)::text FROM organizations o WHERE o.id = $1`, orgID).Scan(&raw)
	if err != nil {
		return nil, err
	}
	clean, _, err := redactTenantRow("organizations", raw)
	return clean, err
}

func redactTenantRow(table, raw string) ([]byte, *privacyFileSummary, error) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return nil, nil, err
	}
	for key := range obj {
		if redactTenantKey(key) {
			delete(obj, key)
		}
	}
	var summary *privacyFileSummary
	if table == "files" {
		summary = &privacyFileSummary{
			FileID:    fmt.Sprint(obj["id"]),
			Filename:  fmt.Sprint(obj["original_filename"]),
			SizeBytes: obj["size_bytes"],
			Checksum:  obj["checksum_sha256"],
		}
	}
	out, err := json.Marshal(obj)
	return out, summary, err
}

func redactTenantKey(key string) bool {
	switch key {
	case "password", "object_key", "bucket", "object_version":
		return true
	}
	return strings.HasSuffix(key, "_enc") || strings.HasSuffix(key, "_hash")
}
