package service

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// Access report export (UNI-1643), contract v1 §10 S11.

func (f *docPermFixture) arExportFixture(t *testing.T, slug string) (docTenant, DocumentAccessReportQuery) {
	t.Helper()
	tn := f.tenant(t, slug)
	root := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, title: "Hợp đồng"})
	d := f.arDoc(t, tn, arDocSpec{parent: root.ID, title: "Hợp đồng ABC", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, d, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	f.arLink(t, d, tn.aclOwner.ID, time.Now().Add(time.Hour))
	return tn, DocumentAccessReportQuery{FolderID: root.ID, Levels: []string{"view", "manage"}}
}

// arExportAudit is the one export audit row of a workspace.
func arExportAudit(t *testing.T, f *docPermFixture, ws string) (int, map[string]any) {
	t.Helper()
	n := countAudit(t, f, audit.ActionDocumentsAccessReportExported, ws)
	if n == 0 {
		return 0, nil
	}
	var raw []byte
	if err := f.pool.QueryRow(f.ctx,
		`SELECT metadata FROM audit_events WHERE action = $1 AND resource_id = $2`, audit.ActionDocumentsAccessReportExported, ws,
	).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	return n, meta
}

func TestAccessReportExportCSV(t *testing.T) {
	f := newDocPermFixture(t)
	tn, in := f.arExportFixture(t, "arx1")
	var buf bytes.Buffer
	res, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in, AccessReportFormatCSV, &buf)
	if err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	if !bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("the CSV does not start with a UTF-8 BOM")
	}
	lines, err := csv.NewReader(bytes.NewReader(raw[3:])).ReadAll()
	if err != nil {
		t.Fatalf("not strict CSV: %v", err)
	}
	wantHeader := "document_id,document_title,document_path,document_kind,visibility,acl_owner_name,live_link_count," +
		"source,via,principal_type,principal_id,principal_name,level,effective_level,active,granted_by,granted_by_name,granted_at," +
		"report_generated_at,report_filter"
	if got := strings.Join(lines[0], ","); got != wantHeader {
		t.Fatalf("header:\n got  %s\n want %s", got, wantHeader)
	}
	// acl_owner (manage) and the member share (view); the level filter keeps both.
	if len(lines) != 3 || res.Rows != 2 || res.Documents != 1 {
		t.Fatalf("lines=%d rows=%d documents=%d", len(lines), res.Rows, res.Documents)
	}
	share := lines[2]
	if share[1] != "Hợp đồng ABC" || share[2] != "Hợp đồng" || share[5] != "aclowner" || share[6] != "1" ||
		share[7] != "share" || share[11] != "member" || share[12] != "view" || share[16] != "aclowner" {
		t.Fatalf("share line: %v", share)
	}
	if _, err := time.Parse(time.RFC3339, share[17]); err != nil || !strings.HasSuffix(share[17], "Z") {
		t.Fatalf("granted_at %q is not RFC3339 UTC", share[17])
	}
	if share[18] != res.GeneratedAt.Format(time.RFC3339) {
		t.Fatalf("report_generated_at = %q, want %q", share[18], res.GeneratedAt.Format(time.RFC3339))
	}
	if want := "folder_id=" + in.FolderID + ";person_id=;level=view,manage;visibility="; share[19] != want {
		t.Fatalf("report_filter = %q, want %q", share[19], want)
	}
	if ok, _ := regexp.MatchString(`^access-report-arx1-a-hop-dong-\d{8}T\d{4}Z\.csv$`, res.FileName); !ok {
		t.Fatalf("file name %q", res.FileName)
	}
	n, meta := arExportAudit(t, f, tn.wsA)
	if n != 1 {
		t.Fatalf("audit rows = %d, want 1", n)
	}
	if meta["folder_id"] != in.FolderID || meta["format"] != "csv" || meta["row_count"] != float64(2) || meta["document_count"] != float64(1) {
		t.Fatalf("audit metadata: %v", meta)
	}
	if blob, _ := json.Marshal(meta); bytes.Contains(blob, []byte("aclowner")) || bytes.Contains(blob, []byte("@")) {
		t.Fatalf("audit metadata carries a name or an email: %s", blob)
	}
}

func TestAccessReportExportXLSX(t *testing.T) {
	f := newDocPermFixture(t)
	tn, in := f.arExportFixture(t, "arx2")
	in.PersonID = tn.member.ID
	var buf bytes.Buffer
	res, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in, AccessReportFormatXLSX, &buf)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	parts := map[string]string{}
	for _, file := range zr.File {
		rc, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(rc)
		_ = rc.Close()
		parts[file.Name] = string(body)
	}
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"} {
		if _, ok := parts[name]; !ok {
			t.Fatalf("part %s is missing", name)
		}
	}
	if wb := parts["xl/workbook.xml"]; !strings.Contains(wb, `name="access_report"`) || !strings.Contains(wb, `name="meta"`) {
		t.Fatalf("workbook sheets: %s", wb)
	}
	rows := parts["xl/worksheets/sheet1.xml"]
	for _, want := range []string{">person_level<", ">Hợp đồng ABC<", ">member<", `state="frozen"`} {
		if !strings.Contains(rows, want) {
			t.Fatalf("sheet access_report lacks %q", want)
		}
	}
	if res.Rows != 1 || strings.Contains(rows, ">acl_owner<") {
		t.Fatalf("the person filter keeps only the member's row: rows=%d", res.Rows)
	}
	meta := parts["xl/worksheets/sheet2.xml"]
	for _, want := range []string{">generated_at<", ">" + res.GeneratedAt.Format(time.RFC3339) + "<", ">person_name<", ">level<", ">view,manage<", ">folder_title<"} {
		if !strings.Contains(meta, want) {
			t.Fatalf("sheet meta lacks %q", want)
		}
	}
	if !strings.HasSuffix(res.FileName, ".xlsx") {
		t.Fatalf("file name %q", res.FileName)
	}
}

func TestAccessReportExportTooLarge(t *testing.T) {
	f := newDocPermFixture(t)
	tn, in := f.arExportFixture(t, "arx3")
	prev := accessReportExportMaxRows
	accessReportExportMaxRows = 1
	t.Cleanup(func() { accessReportExportMaxRows = prev })
	for _, c := range []struct {
		name string
		in   DocumentAccessReportQuery
	}{
		{"rows over the cap", DocumentAccessReportQuery{}},
		{"folder walk over the cap", in},
	} {
		t.Run(c.name, func(t *testing.T) {
			var buf bytes.Buffer
			_, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, c.in, AccessReportFormatCSV, &buf)
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != "access_report_too_large" || ce.Status != 422 || ce.Fields["max_rows"] != 1 {
				t.Fatalf("err = %v", err)
			}
			if buf.Len() != 0 {
				t.Fatalf("%d bytes written before the refusal", buf.Len())
			}
		})
	}
	if n, _ := arExportAudit(t, f, tn.wsA); n != 0 {
		t.Fatalf("a refused export wrote %d audit rows", n)
	}
	var ve ValidationError
	if _, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in, "pdf", io.Discard); !errors.As(err, &ve) {
		t.Fatalf("format pdf: err = %v", err)
	}
}
