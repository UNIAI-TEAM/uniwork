package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
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

func (m *memStorage) Delete(_ context.Context, key string) {
	delete(m.objects, key)
	delete(m.types, key)
}
func (m *memStorage) DeleteObject(ctx context.Context, key string) error {
	m.Delete(ctx, key)
	return nil
}
func (m *memStorage) DeleteKeys(ctx context.Context, keys []string) {
	for _, k := range keys {
		m.Delete(ctx, k)
	}
}
func (m *memStorage) KeyFromURL(u string) string  { return strings.TrimPrefix(u, "mem://") }
func (m *memStorage) ObjectURL(key string) string { return "mem://" + key }
func (m *memStorage) CdnDomain() string           { return "" }
func (m *memStorage) GetReader(_ context.Context, key string) (io.ReadCloser, error) {
	data, ok := m.objects[key]
	if !ok {
		return nil, errors.New("not found")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
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
		if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc", AllowDuplicate: true}); err != nil {
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

// requestAndRunExport queues an export for organization A and drives the outbox
// consumer over it the way the dispatcher does, returning the finished job and
// the bytes it wrote to storage.
func requestAndRunExport(t *testing.T, f *auditServiceFixture, store *memStorage, format string, from, to time.Time) (db.AuditExport, []byte) {
	t.Helper()
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, format, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if err := NewAuditExportConsumer(f.q, store).Handle(f.ctx, exportRow(exp.ID, f.orgA)); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !done.CompletedAt.Valid || !done.ObjectKey.Valid {
		t.Fatalf("export did not finish: %+v", done)
	}
	return done, store.objects[done.ObjectKey.String]
}

// csvRecords parses a CSV export after its BOM. The three bytes are not part of
// the format; they are what makes Excel on a Vietnamese Windows read the
// accents instead of the code page.
func csvRecords(t *testing.T, body []byte) [][]string {
	t.Helper()
	if !bytes.HasPrefix(body, utf8BOM) {
		t.Fatal("CSV export is missing the UTF-8 BOM")
	}
	recs, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(body, utf8BOM))).ReadAll()
	if err != nil {
		t.Fatalf("CSV export is not parseable: %v", err)
	}
	return recs
}

// The CSV is the artefact a compliance officer opens, so a column that drifts
// or a value written under the wrong header is a silent lie about the log. This
// checks the row the log itself holds against the row the file carries.
func TestAuditExportCSVCarriesTheEventsOwnValues(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc có dấu"}); err != nil {
		t.Fatal(err)
	}
	events, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{Action: audit.ActionTaskCreated})
	if err != nil || len(events) != 1 {
		t.Fatalf("task.created rows: err=%v rows=%d", err, len(events))
	}
	want := events[0]

	done, body := requestAndRunExport(t, f, store, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	recs := csvRecords(t, body)
	if len(recs) == 0 {
		t.Fatal("CSV export has no header row")
	}
	wantHeader := "id,occurred_at,actor_kind,actor_id,action,resource_type,resource_id,workspace_id,changes,metadata,correlation_id"
	if got := strings.Join(recs[0], ","); got != wantHeader {
		t.Fatalf("CSV header = %q, want %q", got, wantHeader)
	}
	if got := int32(len(recs) - 1); got != done.RowCount {
		t.Fatalf("file holds %d data rows but the job reports %d", got, done.RowCount)
	}
	var row []string
	for _, rec := range recs[1:] {
		if rec[0] == want.ID {
			row = rec
			break
		}
	}
	if row == nil {
		t.Fatalf("the export has no row for %s", want.ID)
	}
	// Column order is the contract the header promises above.
	columns := []struct {
		index int
		want  string
	}{
		{0, want.ID},
		{1, tsString(want.OccurredAt)},
		{2, want.ActorKind},
		{3, want.ActorID},
		{4, want.Action},
		{5, want.ResourceType},
		{6, want.ResourceID},
		{7, want.WorkspaceID.String},
		{10, want.CorrelationID},
	}
	for _, c := range columns {
		if row[c.index] != c.want {
			t.Fatalf("CSV column %d = %q, want %q", c.index, row[c.index], c.want)
		}
	}
	// The accented title is the reason the BOM exists: it has to survive.
	if !strings.Contains(string(body), "Việc có dấu") {
		t.Fatal("the export lost the Vietnamese title it was written with")
	}
}

// JSON Lines fidelity: one parsed object per event, oldest first, this
// organization's rows only, with the JSON columns decoded and the address left
// out of every line.
func TestAuditExportJSONLinesAreOneParsedObjectPerEvent(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	task, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc"})
	if err != nil {
		t.Fatal(err)
	}
	status := "in_progress"
	if _, err := f.tasks.Update(f.ctx, Human(f.ownerA.ID), task.ID, UpdateTaskInput{Status: &status}); err != nil {
		t.Fatal(err)
	}
	// A row in the other organization: a file that ignored the tenant would be
	// caught here rather than merely looking empty.
	if _, err := f.svc.SetRetention(f.ctx, f.ownerB.ID, f.orgB, 120); err != nil {
		t.Fatal(err)
	}

	done, body := requestAndRunExport(t, f, store, "json", time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	if len(lines) != int(done.RowCount) {
		t.Fatalf("%d lines for %d exported rows", len(lines), done.RowCount)
	}
	seen := map[string]int{}
	var updated map[string]any
	lastID := ""
	for i, line := range lines {
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("line %d is not a JSON object: %v", i+1, err)
		}
		if rec["organization_id"] != f.orgA {
			t.Fatalf("line %d belongs to %v, not %s", i+1, rec["organization_id"], f.orgA)
		}
		if _, ok := rec["ip_address"]; ok {
			t.Fatal("a JSON export line carries an address")
		}
		id, _ := rec["id"].(string)
		if id <= lastID {
			t.Fatalf("rows are not oldest-first: line %d has %s after %s", i+1, id, lastID)
		}
		lastID = id
		action, _ := rec["action"].(string)
		seen[action]++
		if action == audit.ActionTaskUpdated {
			updated = rec
		}
	}
	if seen[audit.ActionTaskCreated] != 1 || seen[audit.ActionTaskUpdated] != 1 {
		t.Fatalf("exported actions = %v", seen)
	}
	if seen[audit.ActionAuditRetentionSet] != 0 {
		t.Fatal("the export carried another organization's retention row")
	}
	changes, _ := updated["changes"].(map[string]any)
	if _, ok := changes["status"]; !ok {
		t.Fatalf("the task.updated row lost the field that moved: %v", updated)
	}
}

// The window is a filter, not a hint: a range with nothing in it produces the
// header and no data rows rather than the organization's whole history.
func TestAuditExportHonoursTheRequestedWindow(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc"}); err != nil {
		t.Fatal(err)
	}

	// Nobody can have acted in the future, so this window is honestly empty.
	done, body := requestAndRunExport(t, f, store, "csv", time.Now().Add(time.Hour), time.Now().Add(2*time.Hour))

	if done.RowCount != 0 {
		t.Fatalf("an empty window exported %d rows", done.RowCount)
	}
	if recs := csvRecords(t, body); len(recs) != 1 {
		t.Fatalf("an empty window produced %d CSV lines, want the header alone", len(recs))
	}
}

// A retried outbox row has to leave a finished job exactly as it was: same
// object, same row count, same expiry. Moving the expiry would silently extend
// a link the organization was told had already lapsed.
func TestAuditExportRetryDoesNotMoveTheAttachedResult(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	consumer := NewAuditExportConsumer(f.q, store)
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	row := exportRow(exp.ID, f.orgA)
	if err := consumer.Handle(f.ctx, row); err != nil {
		t.Fatal(err)
	}
	first, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}

	// The retry the dispatcher performs after a sibling consumer fails.
	if err := consumer.Handle(f.ctx, row); err != nil {
		t.Fatal(err)
	}
	second, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil {
		t.Fatal(err)
	}

	if len(store.objects) != 1 {
		t.Fatalf("the retry left %d objects, want 1", len(store.objects))
	}
	if second.ObjectKey != first.ObjectKey {
		t.Fatalf("the retry moved the attached result: %q -> %q", first.ObjectKey.String, second.ObjectKey.String)
	}
	if !second.ExpiresAt.Time.Equal(first.ExpiresAt.Time) {
		t.Fatalf("the retry moved the expiry: %s -> %s", first.ExpiresAt.Time, second.ExpiresAt.Time)
	}
	if !second.CompletedAt.Time.Equal(first.CompletedAt.Time) || second.RowCount != first.RowCount {
		t.Fatalf("the retry rewrote the finished job: %+v -> %+v", first, second)
	}
	// The attached result lives under the organization's own prefix, and its
	// link is stamped 24h after the completion that produced it.
	if want := "audit-exports/" + f.orgA + "/" + exp.ID + ".csv"; first.ObjectKey.String != want {
		t.Fatalf("object key = %q, want %q", first.ObjectKey.String, want)
	}
	if window := first.ExpiresAt.Time.Sub(first.CompletedAt.Time); window != 24*time.Hour {
		t.Fatalf("the completion stamped a %s window, want 24h", window)
	}
}

// File expiry is not evidence retention (ADR 0012, T10). When the link lapses
// the job keeps its history, every audit row it exported is still there, and the
// log still refuses an update.
func TestExpiredExportLeavesTheAuditLogUntouched(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc"}); err != nil {
		t.Fatal(err)
	}
	done, _ := requestAndRunExport(t, f, store, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	before, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{})
	if err != nil || len(before) == 0 {
		t.Fatalf("log before expiry: err=%v rows=%d", err, len(before))
	}
	// Move the job's completion a day into the past: its 24h link has lapsed.
	if _, err := f.svc.pool.Exec(f.ctx, `UPDATE audit_exports
		SET completed_at = completed_at - interval '25 hours',
		    expires_at = expires_at - interval '25 hours'
		WHERE id = $1`, done.ID); err != nil {
		t.Fatal(err)
	}

	after, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("the expired export removed rows: %d -> %d", len(before), len(after))
	}
	for i := range before {
		if after[i].ID != before[i].ID || after[i].Action != before[i].Action {
			t.Fatalf("row %d changed: %s/%s -> %s/%s", i,
				before[i].ID, before[i].Action, after[i].ID, after[i].Action)
		}
	}
	// The job's own record stays too: what was sent and to whom is history,
	// even after the bytes are collectable.
	lapsed, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, done.ID)
	if err != nil || lapsed.ObjectKey != done.ObjectKey || !lapsed.ExpiresAt.Valid {
		t.Fatalf("lapsed job: err=%v export=%+v", err, lapsed)
	}
	// LEGACY (Bước 0, pinned on purpose): when the link lapses nothing collects
	// the bytes - the object stays on storage and the job keeps pointing at it.
	// T10 changes this (expiry releases the reference and enqueues cleanup), so
	// this assertion is expected to be rewritten by that PR.
	if len(store.objects[done.ObjectKey.String]) == 0 {
		t.Fatal("the lapsed export's bytes are gone: there is no cleanup job on the legacy path")
	}
	// Still append-only after the whole export lifecycle ran.
	if _, err := f.svc.pool.Exec(f.ctx, `UPDATE audit_events SET action = 'tampered'`); err == nil {
		t.Fatal("UPDATE on audit_events succeeded after an export expired")
	}
	if _, err := f.svc.pool.Exec(f.ctx, `DELETE FROM audit_events`); err == nil {
		t.Fatal("DELETE on audit_events succeeded after an export expired")
	}
}

// Revoked permission reaches the export: once the membership row the gate reads
// is gone, the job, the list and the right to queue another one are all refused,
// and the decision is made again on every read rather than captured when the
// export was requested.
func TestRevokedPermissionLosesTheExportJob(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	done, _ := requestAndRunExport(t, f, store, "csv", time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	if err := f.q.DeleteOrganizationMember(f.ctx, db.DeleteOrganizationMemberParams{
		OrganizationID: f.orgA, UserID: f.ownerA.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, done.ID); err != ErrForbidden {
		t.Fatalf("a removed member still read the export job: %v", err)
	}
	if _, err := f.svc.Exports(f.ctx, f.ownerA.ID, f.orgA); err != ErrForbidden {
		t.Fatalf("a removed member still listed exports: %v", err)
	}
	if _, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{}); err != ErrForbidden {
		t.Fatalf("a removed member still read the log: %v", err)
	}
	if _, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now()); err != ErrForbidden {
		t.Fatalf("a removed member queued another export: %v", err)
	}

	// Restoring the membership is enough, which is what "checked now" means.
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.orgA, UserID: f.ownerA.ID, Role: "owner",
	}); err != nil {
		t.Fatal(err)
	}
	back, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, done.ID)
	if err != nil || back.ObjectKey != done.ObjectKey {
		t.Fatalf("re-added owner: err=%v export=%+v", err, back)
	}
}

// The request is what has to produce the worker's input: the job row, the audit
// row that says who asked, and the outbox row that names the export all commit
// together (ADR 0009), and the consumer is handed that row rather than an id.
func TestRequestExportQueuesTheRowTheWorkerConsumes(t *testing.T) {
	f := newAuditServiceFixture(t)
	store := newMemStorage()
	exp, err := f.svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA, "csv",
		time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	var topic, payload string
	if err := f.svc.pool.QueryRow(f.ctx, `SELECT topic, payload FROM outbox_events
		WHERE organization_id = $1 AND topic = 'audit.export_requested'
		ORDER BY created_at DESC LIMIT 1`, f.orgA).Scan(&topic, &payload); err != nil {
		t.Fatal(err)
	}
	var queued map[string]string
	if err := json.Unmarshal([]byte(payload), &queued); err != nil {
		t.Fatalf("outbox payload %q is not JSON: %v", payload, err)
	}
	if queued["export_id"] != exp.ID || queued["organization_id"] != f.orgA {
		t.Fatalf("queued %v, want export %s of %s", queued, exp.ID, f.orgA)
	}
	events, err := f.svc.List(f.ctx, f.ownerA.ID, f.orgA, AuditFilter{Action: audit.ActionAuditExportRequested})
	if err != nil || len(events) != 1 || events[0].ResourceID != exp.ID {
		t.Fatalf("audit.export_requested rows: err=%v rows=%d", err, len(events))
	}

	// The row the request queued is the row that finishes the job.
	if err := NewAuditExportConsumer(f.q, store).Handle(f.ctx, db.OutboxEvent{
		ID: "ev-from-request", Topic: topic, Payload: payload,
	}); err != nil {
		t.Fatal(err)
	}
	done, err := f.svc.Export(f.ctx, f.ownerA.ID, f.orgA, exp.ID)
	if err != nil || !done.CompletedAt.Valid || !done.ObjectKey.Valid {
		t.Fatalf("export after the queued row: err=%v export=%+v", err, done)
	}
}
