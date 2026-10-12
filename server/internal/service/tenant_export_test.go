package service

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/outbox"
)

func TestPrivacyExportOwnerOnlyAndOneAtATime(t *testing.T) {
	f := newAuditServiceFixture(t)
	svc := NewPrivacyExportService(f.svc.pool, f.q, f.svc.orgs)
	if _, err := svc.RequestExport(f.ctx, f.memberA.ID, f.orgA); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member: %v", err)
	}
	if _, err := svc.RequestExport(f.ctx, f.adminA.ID, f.orgA); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin: %v", err)
	}
	first, err := svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA); !codedIs(err, "privacy_export_in_flight") {
		t.Fatalf("second request: %v", err)
	}
	if _, err := svc.Export(f.ctx, f.ownerB.ID, f.orgB, first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other org: %v", err)
	}
}

func TestPrivacyExportZipOmitsSecretsAndReplays(t *testing.T) {
	f := newAuditServiceFixture(t)
	if _, err := f.tasks.Create(f.ctx, Human(f.ownerA.ID), f.wsA.ID, CreateTaskInput{Title: "Việc xuất"}); err != nil {
		t.Fatal(err)
	}
	svc := NewPrivacyExportService(f.svc.pool, f.q, f.svc.orgs)
	fake := filesfake.New(filesfake.Options{})
	svc.SetFileService(fake)
	row, err := svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	consumer := NewPrivacyExportConsumer(f.svc.pool, f.q)
	consumer.SetFileService(fake)
	ev := outbox.Row{ID: "ev-privacy", Topic: "privacy.export_requested", Payload: `{"request_id":"` + row.ID + `","organization_id":"` + f.orgA + `"}`}
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	done, err := svc.Export(f.ctx, f.ownerA.ID, f.orgA, row.ID)
	if err != nil || !done.CompletedAt.Valid || !done.FileID.Valid {
		t.Fatalf("export = %+v err %v", done, err)
	}
	got, err := svc.DownloadExport(f.ctx, f.ownerA.ID, f.orgA, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer got.Reader.Close()
	body, err := io.ReadAll(got.Reader.Body)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	var tasks, manifest string
	for _, file := range zr.File {
		b, err := readZipFile(file)
		if err != nil {
			t.Fatal(err)
		}
		switch file.Name {
		case "tables/tasks.jsonl":
			tasks = string(b)
		case "manifest.json":
			manifest = string(b)
		case "tables/files.jsonl":
			if strings.Contains(string(b), "object_key") {
				t.Fatalf("files jsonl leaked a storage key: %s", b)
			}
		}
	}
	if !strings.Contains(tasks, "Việc xuất") {
		t.Fatalf("tasks jsonl = %s", tasks)
	}
	if !strings.Contains(manifest, "audit_events") || !strings.Contains(manifest, "invoices") {
		t.Fatalf("manifest = %s", manifest)
	}
}

func readZipFile(f *zip.File) ([]byte, error) {
	r, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func TestPrivacyExportLastAttemptReleasesTheOpenRequest(t *testing.T) {
	f := newAuditServiceFixture(t)
	svc := NewPrivacyExportService(f.svc.pool, f.q, f.svc.orgs)
	row, err := svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	consumer := NewPrivacyExportConsumer(f.svc.pool, f.q)
	if err := consumer.settleExport(f.ctx, outbox.Row{}, row.ID, errors.New("storage down")); err == nil {
		t.Fatal("an early failure was recorded as done")
	}
	if _, err := svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA); !codedIs(err, "privacy_export_in_flight") {
		t.Fatalf("early failure released the request: %v", err)
	}
	ev := outbox.Row{Attempts: outbox.MaxAttempts - 1}
	if err := consumer.settleExport(f.ctx, ev, row.ID, errors.New("storage down")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RequestExport(f.ctx, f.ownerA.ID, f.orgA); err != nil {
		t.Fatalf("last failure left the request open: %v", err)
	}
}
