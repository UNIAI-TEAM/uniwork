package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-2052 w3 item 6: the files mode of the PLAN, a multi-file upload with no
// folder (API contract AMENDMENT 2 and 3).

func filesModeInput(files ...FolderUploadFileInput) CreateFolderUploadInput {
	if len(files) == 0 {
		files = []FolderUploadFileInput{
			{FileKey: "f-1", Filename: "a.md", SizeBytes: 10},
			{FileKey: "f-2", Filename: "b.pdf", SizeBytes: 20},
		}
	}
	return CreateFolderUploadInput{Files: files, IdempotencyKey: "plan-" + util.NewID()}
}

func (e *docStorageEnv) newFolder(t *testing.T, title string) string {
	t.Helper()
	d, err := e.svc.CreatePage(context.Background(), human(e.tn.member), e.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: title, IdempotencyKey: "f-" + util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	return d.Document.ID
}

func TestFolderUploadFilesModePlansFilesStraightIntoTheParent(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	parent := env.newFolder(t, "Đích")
	docs := env.folderUploadCount(t, `SELECT count(*) FROM documents WHERE organization_id = $1`, env.tn.orgID)
	in := filesModeInput()
	in.ParentID = &parent
	in.ShareWithWorkspace = true

	b, err := env.svc.CreateFolderUpload(ctx, human(env.tn.member), env.tn.wsA, in)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if b.Mode != "files" || b.Status != "open" || b.RootFolderID != "" || b.RootTitle != "" || len(b.Folders) != 0 ||
		b.ParentID != parent || !b.ShareWithWorkspace || b.TotalBytes != 30 {
		t.Fatalf("batch = %+v", b)
	}
	if b.Counts != (FolderUploadCounts{Total: 2, Pending: 2}) {
		t.Fatalf("counts = %+v", b.Counts)
	}
	for _, f := range b.Files {
		if f.Status != "pending" || f.Target == nil || f.Target.Kind != "put" || f.Path != "" {
			t.Fatalf("file = %+v", f)
		}
	}
	// No document was created, and each file row points at the parent.
	if n := env.folderUploadCount(t, `SELECT count(*) FROM documents WHERE organization_id = $1`, env.tn.orgID); n != docs {
		t.Fatalf("documents = %d, want %d", n, docs)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_upload_files WHERE batch_id = $1 AND folder_id = $2 AND path = ''`, b.ID, parent); n != 2 {
		t.Fatalf("file rows in the parent = %d", n)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_uploads WHERE id = $1 AND mode = 'files' AND root_folder_id = '' AND root_title = ''`, b.ID); n != 1 {
		t.Fatalf("batch row not stored as a files batch")
	}
	// One planned row carrying the mode and no folders; no document.created
	// row and no batch_uploaded event until a COMPLETE lands a file.
	var mode string
	var folderIDs int
	if err := env.f.pool.QueryRow(ctx, `SELECT metadata::jsonb->>'mode', jsonb_array_length(metadata::jsonb->'folder_ids') FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentsFolderUploadPlanned, b.ID).Scan(&mode, &folderIDs); err != nil || mode != "files" || folderIDs != 0 {
		t.Fatalf("planned audit mode = %q folder_ids = %d, %v", mode, folderIDs, err)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND metadata::jsonb->>'batch_id' = $2`, audit.ActionDocumentCreated, b.ID); n != 0 {
		t.Fatalf("document.created rows = %d", n)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'batch_id' = $2`, DocumentBatchUploadedTopic, b.ID); n != 0 {
		t.Fatalf("batch_uploaded events on a files-mode PLAN = %d", n)
	}
}

func TestFolderUploadFilesModeAtTheWorkspaceRootAndNoFoldersSpellings(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	for name, folders := range map[string][]string{"absent": nil, "empty": {}} {
		in := filesModeInput()
		in.Folders = folders
		b, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
		if err != nil || b.Mode != "files" || b.ParentID != "" {
			t.Fatalf("%s: %+v, %v", name, b, err)
		}
		if n := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_upload_files WHERE batch_id = $1 AND folder_id IS NULL`, b.ID); n != 2 {
			t.Fatalf("%s: root-level file rows = %d", name, n)
		}
		// Settle it so the next plan does not meet the open-batch cap.
		env.execSQL(t, `UPDATE document_folder_uploads SET status = 'completed', finished_at = now() WHERE id = $1`, b.ID)
	}
}

func TestFolderUploadFilesModeMixedInputIsBadRequest(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	in := filesModeInput()
	in.Folders = []string{"a"}
	_, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if ce := wantCoded(t, err, "invalid_request"); ce.Status != 400 || ce.Fields["path"] == nil {
		t.Fatalf("folders without root_name: %+v", ce)
	}
	in = filesModeInput(FolderUploadFileInput{FileKey: "f-1", Path: "sub", Filename: "a.md", SizeBytes: 1})
	_, err = env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if ce := wantCoded(t, err, "invalid_request"); ce.Status != 400 || ce.Fields["path"] != "sub" {
		t.Fatalf("path without folders: %+v", ce)
	}
	if env.batchCount(t) != 0 {
		t.Fatalf("a refused plan wrote a batch")
	}
	// A root_name without folders is still a folder plan.
	in = filesModeInput()
	in.RootName = "Gốc"
	b, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil || b.Mode != "folder" || b.RootTitle != "Gốc" {
		t.Fatalf("root_name only: %+v, %v", b, err)
	}
}

func TestFolderUploadFilesModeParentMustBeAFolder(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	page, err := env.svc.CreatePage(context.Background(), human(env.tn.member), env.tn.wsA, CreatePageInput{Kind: DocumentKindPage, Title: "Trang", IdempotencyKey: "p-" + util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	in := filesModeInput()
	in.ParentID = &page.Document.ID
	_, err = env.svc.CreateFolderUpload(context.Background(), human(env.tn.member), env.tn.wsA, in)
	wantCoded(t, err, "document_parent_kind")
}

func TestFolderUploadAcceptsTwoFilesOfOneName(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	same := []FolderUploadFileInput{
		{FileKey: "f-1", Filename: "a.md", SizeBytes: 1},
		{FileKey: "f-2", Filename: "a.md", SizeBytes: 2},
	}
	b, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, filesModeInput(same...))
	if err != nil || len(b.Files) != 2 || b.Counts.Pending != 2 {
		t.Fatalf("files mode: %+v, %v", b, err)
	}
	env.execSQL(t, `UPDATE document_folder_uploads SET status = 'completed', finished_at = now() WHERE id = $1`, b.ID)
	// The same in the folder mode, in one folder.
	in := folderPlanInput("Gốc")
	in.Files = []FolderUploadFileInput{
		{FileKey: "f-1", Path: "Hợp đồng", Filename: "a.pdf", SizeBytes: 1},
		{FileKey: "f-2", Path: "Hợp đồng", Filename: "a.pdf", SizeBytes: 2},
	}
	b, err = env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil || len(b.Files) != 2 {
		t.Fatalf("folder mode: %+v, %v", b, err)
	}
}

func TestFolderUploadFilesModeKeepsAnExistingDocumentOfTheSameName(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	parent := env.newFolder(t, "Đích")
	pid := parent
	existing, err := env.svc.CreatePage(ctx, human(env.tn.member), env.tn.wsA, CreatePageInput{Kind: DocumentKindPage, Title: "a.md", ParentID: pid, IdempotencyKey: "p-" + util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	in := filesModeInput(FolderUploadFileInput{FileKey: "f-1", Filename: "a.md", SizeBytes: 1})
	in.ParentID = &pid
	b, err := env.svc.CreateFolderUpload(ctx, human(env.tn.member), env.tn.wsA, in)
	if err != nil || b.Files[0].Filename != "a.md" {
		t.Fatalf("plan: %+v, %v", b, err)
	}
	if d := env.doc(t, existing.Document.ID); d.Title != "a.md" {
		t.Fatalf("existing document renamed to %q", d.Title)
	}
	if _, err := env.svc.GetFolderUpload(ctx, human(env.tn.member), env.tn.wsA, b.ID); errors.Is(err, ErrNotFound) {
		t.Fatalf("the batch is not readable: %v", err)
	}
}
