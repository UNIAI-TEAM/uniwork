package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
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

func TestPrivacyExportOmitsPrivateDriveProposalsAndExportsLinks(t *testing.T) {
	f := newAuditServiceFixture(t)
	const marker = "b5-private-draft"
	proposalID := util.NewID()
	linkID := util.NewID()
	if _, err := f.svc.pool.Exec(f.ctx, `
		INSERT INTO drive_task_proposals
			(id, organization_id, workspace_id, drive_file_id, connection_id, requested_by, requested_by_kind, prompt, items, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, $8, 'ready')`,
		proposalID, f.orgA, f.wsA.ID, util.NewID(), util.NewID(), f.memberA.ID, marker, []byte(`[{"title":"`+marker+`"}]`),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.pool.Exec(f.ctx, `
		INSERT INTO drive_task_proposal_links
			(id, organization_id, workspace_id, proposal_id, item_index, task_id, drive_file_id, external_file_id, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 0, $5, $6, 'ext-b5-export', $7, 'human')`,
		linkID, f.orgA, f.wsA.ID, proposalID, util.NewID(), util.NewID(), f.memberA.ID,
	); err != nil {
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
	ev := outbox.Row{ID: "ev-privacy-drive", Topic: "privacy.export_requested", Payload: `{"request_id":"` + row.ID + `","organization_id":"` + f.orgA + `"}`}
	if err := consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
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
	var linksJSONL string
	var manifest privacyManifest
	var hasManifest bool
	for _, file := range zr.File {
		if file.Name == "tables/drive_task_proposals.jsonl" {
			t.Errorf("unexpected tables/drive_task_proposals.jsonl in archive")
		}
		b, err := readZipFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), marker) {
			t.Errorf("archive entry %s leaked marker %q: %s", file.Name, marker, strings.TrimSpace(string(b)))
		}
		switch file.Name {
		case "tables/drive_task_proposal_links.jsonl":
			linksJSONL = string(b)
		case "manifest.json":
			if err := json.Unmarshal(b, &manifest); err != nil {
				t.Fatalf("unmarshal manifest.json: %v", err)
			}
			hasManifest = true
		}
	}
	if bytes.Contains(body, []byte(marker)) {
		t.Errorf("archive raw bytes leaked marker %q", marker)
	}
	if !hasManifest {
		t.Fatal("manifest.json missing from archive")
	}
	var excludedReason string
	for _, ex := range manifest.Excluded {
		if ex.Name == "drive_task_proposals" {
			excludedReason = ex.Reason
			break
		}
	}
	if strings.TrimSpace(excludedReason) == "" {
		t.Errorf("manifest excluded missing drive_task_proposals reason")
	}
	if !strings.Contains(linksJSONL, linkID) {
		t.Fatalf("tables/drive_task_proposal_links.jsonl = %q, want link id %s", linksJSONL, linkID)
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
