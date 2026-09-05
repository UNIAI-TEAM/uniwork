package service

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// memStorage records what was uploaded without touching a disk or a bucket.
type memStorage struct {
	objects map[string][]byte
	types   map[string]string
}

func newMemStorage() *memStorage {
	return &memStorage{objects: map[string][]byte{}, types: map[string]string{}}
}

func (m *memStorage) Upload(_ context.Context, key string, data []byte, contentType, _ string) (string, error) {
	m.objects[key] = data
	m.types[key] = contentType
	return m.ObjectURL(key), nil
}

func (m *memStorage) Delete(context.Context, string)             {}
func (m *memStorage) DeleteObject(context.Context, string) error { return nil }
func (m *memStorage) DeleteKeys(context.Context, []string)       {}
func (m *memStorage) KeyFromURL(u string) string                 { return strings.TrimPrefix(u, "mem://") }
func (m *memStorage) ObjectURL(key string) string                { return "mem://" + key }
func (m *memStorage) CdnDomain() string                          { return "" }
func (m *memStorage) GetReader(context.Context, string) (io.ReadCloser, error) {
	return nil, nil
}

// The CSV has to open in Excel on a Vietnamese Windows install, which means a
// BOM. Without it the accents in an action or a title come out as mojibake and
// the file goes back to us as "corrupted".
func TestAuditExportWritesCSVWithABOM(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	consumer := NewAuditExportConsumer(f.q, store)

	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc có dấu"}); err != nil {
		t.Fatal(err)
	}
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	if err := consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}

	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !done.CompletedAt.Valid || !done.ObjectKey.Valid || done.RowCount == 0 {
		t.Fatalf("export not finished: %+v", done)
	}
	body := store.objects[done.ObjectKey.String]
	if len(body) < 3 || body[0] != 0xEF || body[1] != 0xBB || body[2] != 0xBF {
		t.Fatal("CSV export is missing the UTF-8 BOM Excel needs")
	}
	if !strings.Contains(string(body), "task.created") {
		t.Fatalf("export does not contain the audited action: %s", body)
	}
	// An export leaves the system entirely, so it never carries an address.
	if strings.Contains(string(body), "ip_address") {
		t.Fatal("the export header offers an ip_address column")
	}
}

// A retried row must not upload a second copy — the dispatcher calls every
// consumer again when a sibling fails.
func TestAuditExportIsIdempotent(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	consumer := NewAuditExportConsumer(f.q, store)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "json",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	row := exportRow(exp.ID, f.orgA)
	if err := consumer.Handle(f.ctx, row); err != nil {
		t.Fatal(err)
	}
	before := len(store.objects)
	if err := consumer.Handle(f.ctx, row); err != nil {
		t.Fatal(err)
	}
	if len(store.objects) != before {
		t.Fatalf("a retry uploaded again: %d objects, want %d", len(store.objects), before)
	}
}

func TestAuditExportJSONLinesIsOnePerLine(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	consumer := NewAuditExportConsumer(f.q, store)
	for range 2 {
		if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc"}); err != nil {
			t.Fatal(err)
		}
	}
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "json",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := consumer.Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, _ := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	lines := strings.Split(strings.TrimSpace(string(store.objects[done.ObjectKey.String])), "\n")
	if len(lines) < 2 {
		t.Fatalf("expected one JSON object per line, got %d lines", len(lines))
	}
	// A truncated file must still be parseable up to its last whole line.
	var first map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatalf("line 1 is not a JSON object: %v", err)
	}
	if first["ip_address"] != nil {
		t.Fatal("the JSON export carries an address")
	}
	if first["action"] == "" {
		t.Fatalf("line 1 has no action: %v", first)
	}
}

func TestAuditExportFailsLoudlyWithoutStorage(t *testing.T) {
	f := newAuditServiceFixture(t)
	consumer := NewAuditExportConsumer(f.q, nil)
	if err := consumer.Handle(f.ctx, exportRow("whatever", f.orgA)); err == nil {
		t.Fatal("an export with no storage backend must fail so the row retries")
	}
}

func exportRow(exportID, orgID string) outbox.Row {
	payload, _ := json.Marshal(map[string]string{"export_id": exportID, "organization_id": orgID})
	return db.OutboxEvent{
		ID: "ev-export", Topic: "audit.export_requested", Payload: string(payload),
		OrganizationID: pgtype.Text{String: orgID, Valid: true},
	}
}
