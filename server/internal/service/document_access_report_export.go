package service

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Access report export (UNI-1643, contract §7): the whole report as one CSV
// or XLSX file, read from one snapshot, carrying the filter in effect and the
// generation time, refused before any byte when it is too large, and recorded
// by one audit row after the bytes are out.

// Export formats.
const (
	AccessReportFormatCSV  = "csv"
	AccessReportFormatXLSX = "xlsx"
)

// accessReportExportMaxRows caps one export (rows, and nodes of a folder
// walk); a var so tests can shrink it.
var accessReportExportMaxRows = 10000

// accessReportExportPage is the candidate page size inside the snapshot.
const accessReportExportPage = 500

func errAccessReportTooLarge() error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "access_report_too_large",
		Msg:    "báo cáo quá lớn để xuất một lần: hãy chọn thư mục nhỏ hơn hoặc thêm bộ lọc",
		Fields: map[string]any{"max_rows": accessReportExportMaxRows},
	}
}

// AccessReportExportStarter is implemented by a writer that needs the
// export's facts (file name, counts) before the first byte: the HTTP handler
// sets its headers from them. The export calls it once, after every check
// passed and before writing.
type AccessReportExportStarter interface {
	StartAccessReportExport(DocumentAccessReportExport)
}

var errXLSXWrite = errors.New("access report: the workbook could not be written")

var accessReportFileSlug = regexp.MustCompile(`[^a-z0-9]+`)

// accessReportFileName is ASCII-only: Content-Disposition carries it as is.
func accessReportFileName(workspaceSlug, folderTitle string, at time.Time, format string) string {
	parts := []string{"access-report"}
	if s := strings.Trim(accessReportFileSlug.ReplaceAllString(strings.ToLower(foldForSearch(workspaceSlug)), "-"), "-"); s != "" {
		parts = append(parts, s)
	}
	if folderTitle != "" {
		if s := strings.Trim(accessReportFileSlug.ReplaceAllString(strings.ToLower(foldForSearch(folderTitle)), "-"), "-"); s != "" {
			if len(s) > 40 {
				s = strings.Trim(s[:40], "-")
			}
			parts = append(parts, s)
		}
	}
	parts = append(parts, at.UTC().Format("20060102T1504Z"))
	return strings.Join(parts, "-") + "." + format
}

// ExportDocumentAccessReport writes the whole report in format to w. Every
// page is read inside one RepeatableRead read-only transaction so the file is
// one snapshot; nothing is written until the row count is known to fit.
func (s *DocumentService) ExportDocumentAccessReport(ctx context.Context, actor Actor, workspaceID string, in DocumentAccessReportQuery, format string, w io.Writer) (DocumentAccessReportExport, error) {
	var out DocumentAccessReportExport
	if format != AccessReportFormatCSV && format != AccessReportFormatXLSX {
		return out, Invalid("format phải là csv hoặc xlsx")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	run, err := s.openAccessReport(ctx, q, actor, workspaceID, in)
	if err != nil {
		return out, err
	}
	if run.folder != nil {
		n, err := q.CountDocumentAccessReportSubtree(ctx, db.CountDocumentAccessReportSubtreeParams{
			OrganizationID: run.scope.organizationID, WorkspaceID: workspaceID, RootID: run.folder.ID,
			MaxLevel: subtreeMaxLevel(), MaxNodes: int32(accessReportExportMaxRows),
		})
		if err != nil {
			return out, err
		}
		if int(n) > accessReportExportMaxRows {
			return out, errAccessReportTooLarge()
		}
		out.FolderTitle = run.folder.Title
	}
	var items []DocumentAccessReportItem
	after := ""
	for {
		res, err := run.page(ctx, after, accessReportExportPage)
		if err != nil {
			return out, err
		}
		items = append(items, res.items...)
		out.Skipped += res.skipped
		for _, it := range res.items {
			out.Rows += len(it.Rows)
		}
		if out.Rows > accessReportExportMaxRows {
			return out, errAccessReportTooLarge()
		}
		if res.nextAfterID == "" {
			break
		}
		after = res.nextAfterID
	}
	out.Documents = len(items)
	ws, err := q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return out, err
	}
	personName := ""
	if in.PersonID != "" {
		infos, err := NewActorService(q).Resolve(ctx, []ActorRef{{Kind: audit.KindHuman, ID: in.PersonID}})
		if err != nil {
			return out, err
		}
		personName = infos[ActorRef{Kind: audit.KindHuman, ID: in.PersonID}].DisplayName
	}
	// The snapshot is complete; release it before the bytes go out.
	_ = tx.Rollback(ctx)

	out.GeneratedAt = s.now().UTC()
	out.Format = format
	out.FileName = accessReportFileName(ws.Slug, out.FolderTitle, out.GeneratedAt, format)
	meta := accessReportMeta{
		generatedAt: out.GeneratedAt.Format(time.RFC3339), workspaceID: workspaceID, in: in,
		folderTitle: out.FolderTitle, personName: personName, rows: out.Rows, skipped: out.Skipped,
	}
	header, lines := accessReportLines(items, in.PersonID != "")
	if starter, ok := w.(AccessReportExportStarter); ok {
		starter.StartAccessReportExport(out)
	}
	if format == AccessReportFormatCSV {
		err = writeAccessReportCSV(w, header, lines, meta)
	} else {
		err = writeAccessReportXLSX(w, header, lines, meta)
	}
	if err != nil {
		return out, err
	}
	// The audit row follows the bytes (the People export pattern): an export
	// that failed halfway is not an export. Ids, filter and counts only.
	atx, err := s.pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer func() { _ = atx.Rollback(ctx) }()
	if err := auditRecorder.Record(ctx, s.q.WithTx(atx), audit.Entry{
		OrganizationID: run.scope.organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionDocumentsAccessReportExported,
		ResourceType: "workspace", ResourceID: workspaceID,
		Metadata: map[string]any{
			"workspace_id": workspaceID, "folder_id": in.FolderID, "person_id": in.PersonID,
			"level": in.Levels, "visibility": in.Visibility, "format": format,
			"row_count": out.Rows, "document_count": out.Documents, "skipped": out.Skipped,
		},
	}); err != nil {
		return out, err
	}
	return out, atx.Commit(ctx)
}

// accessReportMeta is the filter in effect and the generation time the file
// carries (issue scope 3).
type accessReportMeta struct {
	generatedAt, workspaceID, folderTitle, personName string
	in                                                DocumentAccessReportQuery
	rows, skipped                                     int
}

// filter is the compact key=value form of the CSV report_filter column.
func (m accessReportMeta) filter() string {
	return "folder_id=" + m.in.FolderID + ";person_id=" + m.in.PersonID +
		";level=" + strings.Join(m.in.Levels, ",") + ";visibility=" + m.in.Visibility
}

func (m accessReportMeta) pairs() [][]string {
	return [][]string{
		{"generated_at", m.generatedAt},
		{"workspace_id", m.workspaceID},
		{"folder_id", m.in.FolderID},
		{"folder_title", m.folderTitle},
		{"person_id", m.in.PersonID},
		{"person_name", m.personName},
		{"level", strings.Join(m.in.Levels, ",")},
		{"visibility", m.in.Visibility},
		{"row_count", strconv.Itoa(m.rows)},
		{"skipped", strconv.Itoa(m.skipped)},
	}
}

// accessReportLines flattens the items into one line per row, in the
// contract's stable English column order.
func accessReportLines(items []DocumentAccessReportItem, withPerson bool) ([]string, [][]string) {
	header := []string{
		"document_id", "document_title", "document_path", "document_kind", "visibility", "acl_owner_name", "live_link_count",
		"source", "via", "principal_type", "principal_id", "principal_name", "level", "effective_level", "active",
		"granted_by", "granted_by_name", "granted_at",
	}
	if withPerson {
		header = append(header, "person_level")
	}
	var lines [][]string
	for _, it := range items {
		doc := it.Item.Document
		titles := make([]string, len(it.Item.Path))
		for i, p := range it.Item.Path {
			titles[i] = p.Title
		}
		for _, row := range it.Rows {
			at := ""
			if row.GrantedAt != nil {
				at = row.GrantedAt.UTC().Format(time.RFC3339)
			}
			line := []string{
				doc.ID, doc.Title, strings.Join(titles, " / "), doc.Kind, doc.Visibility, it.ACLOwnerName, strconv.Itoa(it.LiveLinkCount),
				row.Source, row.Via, row.PrincipalType, row.PrincipalID, row.PrincipalName, row.Level, row.EffectiveLevel,
				strconv.FormatBool(row.Active), row.GrantedBy, row.GrantedByName, at,
			}
			if withPerson {
				line = append(line, accessReportLevel(it.PersonLevel))
			}
			lines = append(lines, line)
		}
	}
	return header, lines
}

// writeAccessReportCSV writes strict RFC 4180 with a UTF-8 BOM (Excel on a
// Vietnamese Windows reads BOM-less UTF-8 as Windows-1252). The generation
// time and the filter ride two trailing columns of every line, so no
// preamble breaks a parser and any row-wise import keeps them.
func writeAccessReportCSV(w io.Writer, header []string, lines [][]string, meta accessReportMeta) error {
	if _, err := w.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	filter := meta.filter()
	if err := cw.Write(append(append([]string(nil), header...), "report_generated_at", "report_filter")); err != nil {
		return err
	}
	for _, line := range lines {
		if err := cw.Write(append(append([]string(nil), line...), meta.generatedAt, filter)); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// writeAccessReportXLSX writes the rows on sheet access_report and the filter
// and generation time as key/value lines on sheet meta.
func writeAccessReportXLSX(w io.Writer, header []string, lines [][]string, meta accessReportMeta) error {
	book := buildXLSX([]xlsxSheet{
		{Name: "access_report", Header: header, Rows: lines},
		{Name: "meta", Header: []string{"key", "value"}, Rows: meta.pairs()},
	})
	if book == nil {
		return errXLSXWrite
	}
	_, err := w.Write(book)
	return err
}
