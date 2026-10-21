package service

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

// BE-R2-8 (UNI-2056): a purge whose audience is past documentChangeNoticeCap
// sends no deleted notice, and says so in a debug line that carries ids only.
func TestPurgeAudienceCapIsLogged(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "pcap")
	svc, _ := tracedDocumentService(t, f.pool)

	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	star := func(docID string, people int) {
		t.Helper()
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO document_favorites (id, organization_id, workspace_id, document_id, user_id, created_by, created_by_kind)
			 SELECT 'cap' || $5::text || g, $1, $2, $3, 'cap-user-' || $5::text || g, $4, 'human' FROM generate_series(1, $6::int) g`,
			tn.orgID, tn.wsA, docID, tn.owner.ID, docID, people); err != nil {
			t.Fatal(err)
		}
	}

	wide := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	star(wide.ID, documentChangeNoticeCap+1)
	readers, err := svc.documentChangeReadersQ(f.ctx, f.q, wide, tn.owner.ID)
	if err != nil || len(readers) != 0 {
		t.Fatalf("readers = %v, %v; want none past the cap", readers, err)
	}
	line := buf.String()
	for _, want := range []string{"deleted notice skipped", "document=" + wide.ID, "organization=" + tn.orgID, "workspace=" + tn.wsA, "cap=200"} {
		if !strings.Contains(line, want) {
			t.Fatalf("log %q lacks %q", line, want)
		}
	}
	if strings.Contains(line, "@") {
		t.Fatalf("log line carries an address: %q", line)
	}

	buf.Reset()
	narrow := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	star(narrow.ID, 3)
	if _, err := svc.documentChangeReadersQ(f.ctx, f.q, narrow, tn.owner.ID); err != nil {
		t.Fatal(err)
	}
	if buf.Len() != 0 {
		t.Fatalf("a document within the cap logged: %q", buf.String())
	}
}
