package service

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
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

// arExportParts unzips a workbook into part name -> body.
func arExportParts(t *testing.T, raw []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
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
	return parts
}

// BEB-1: a person_id of a user of another organization never brings that
// user's name into the page or either export format.
func TestAccessReportPersonOfAnotherOrganizationIsNeverNamed(t *testing.T) {
	f := newDocPermFixture(t)
	tn, in := f.arExportFixture(t, "arx4")
	other := f.tenant(t, "arx4o")
	foreign := registerVerified(t, f.q, f.as, "arx4o-foreign@example.com", "Zforeign Tenantname")
	f.orgMember(t, other.orgID, foreign.ID, OrgRoleMember)
	in.PersonID = foreign.ID
	const name = "Zforeign"

	page := f.report(t, Human(tn.owner.ID), tn.wsA, in)
	if len(page.Items) != 0 {
		t.Fatalf("a foreign person lists %v", arIDs(page))
	}
	if s := fmt.Sprintf("%+v", page); strings.Contains(s, name) {
		t.Fatalf("the page carries the foreign name: %s", s)
	}
	for _, format := range []string{AccessReportFormatCSV, AccessReportFormatXLSX} {
		t.Run(format, func(t *testing.T) {
			var buf bytes.Buffer
			res, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in, format, &buf)
			if err != nil {
				t.Fatal(err)
			}
			if res.Rows != 0 || strings.Contains(fmt.Sprintf("%+v", res), name) {
				t.Fatalf("export facts: %+v", res)
			}
			body := buf.String()
			if format == AccessReportFormatXLSX {
				var all strings.Builder
				for _, p := range arExportParts(t, buf.Bytes()) {
					all.WriteString(p)
				}
				body = all.String()
				if !strings.Contains(body, ">person_name<") {
					t.Fatal("sheet meta lacks the person_name key")
				}
			}
			if strings.Contains(body, name) {
				t.Fatalf("the %s file carries the foreign name", format)
			}
		})
	}
}

// BEB-2, BEB-5: a CSV cell never starts a formula, and records end in CRLF.
// The XLSX keeps the text as is: inline strings are never formulas.
func TestAccessReportExportNeutralisesFormulas(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "arx5")
	evil := registerVerified(t, f.q, f.as, "arx5-evil@example.com", "@SUM(1+1)")
	f.orgMember(t, tn.orgID, evil.ID, OrgRoleMember)
	f.wsMember(t, tn.wsA, evil.ID, "member")
	d := f.arDoc(t, tn, arDocSpec{title: `=HYPERLINK("http://x","y")`, visibility: "restricted"})
	f.share(t, d, DocumentPrincipalUser, evil.ID, DocumentLevelView, tn.owner.ID)
	in := DocumentAccessReportQuery{PersonID: evil.ID}

	var buf bytes.Buffer
	if _, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in, AccessReportFormatCSV, &buf); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()[3:]
	if !bytes.Contains(raw, []byte("\r\n")) || bytes.Count(raw, []byte("\n")) != bytes.Count(raw, []byte("\r\n")) {
		t.Fatalf("records do not end in CRLF: %q", raw)
	}
	lines, err := csv.NewReader(bytes.NewReader(raw)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want header + 1", len(lines))
	}
	for _, line := range lines {
		for i, cell := range line {
			if cell != "" && strings.ContainsRune("=+-@\t\r", []rune(cell)[0]) {
				t.Fatalf("cell %d starts a formula: %q", i, cell)
			}
		}
	}
	if got := lines[1][1]; got != `'=HYPERLINK("http://x","y")` {
		t.Fatalf("title cell = %q", got)
	}
	if got := lines[1][11]; got != "'@SUM(1+1)" {
		t.Fatalf("principal_name cell = %q", got)
	}

	buf.Reset()
	if _, err := f.svc.ExportDocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in, AccessReportFormatXLSX, &buf); err != nil {
		t.Fatal(err)
	}
	sheet := arExportParts(t, buf.Bytes())["xl/worksheets/sheet1.xml"]
	for _, want := range []string{`t="inlineStr"`, `>=HYPERLINK(&#34;http://x&#34;,&#34;y&#34;)<`, ">@SUM(1+1)<"} {
		if !strings.Contains(sheet, want) {
			t.Fatalf("sheet access_report lacks %q", want)
		}
	}
	if strings.Contains(sheet, "<f>") || strings.Contains(sheet, ">'=") || strings.Contains(sheet, ">'@") {
		t.Fatal("the XLSX cells changed: a formula or a quote prefix")
	}
}
