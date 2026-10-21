package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-2052 w1: the folder upload PLAN.

func folderPlanInput(root string) CreateFolderUploadInput {
	return CreateFolderUploadInput{
		RootName: root,
		Folders:  []string{"Hợp đồng", "Hợp đồng/2026"},
		Files: []FolderUploadFileInput{
			{FileKey: "f-1", Path: "", Filename: "đọc tôi.md", SizeBytes: 10},
			{FileKey: "f-2", Path: "Hợp đồng/2026", Filename: "a.pdf", SizeBytes: 20},
		},
		IdempotencyKey: "plan-" + util.NewID(),
	}
}

func (e *docStorageEnv) folderUploadCount(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *docStorageEnv) batchCount(t *testing.T) int {
	t.Helper()
	return e.folderUploadCount(t, `SELECT count(*) FROM document_folder_uploads WHERE organization_id = $1`, e.tn.orgID)
}

func (e *docStorageEnv) folderCount(t *testing.T) int {
	t.Helper()
	return e.folderUploadCount(t, `SELECT count(*) FROM documents WHERE organization_id = $1 AND kind = 'folder'`, e.tn.orgID)
}

func wantCoded(t *testing.T, err error, code string) CodedError {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != code {
		t.Fatalf("err = %v, want code %s", err, code)
	}
	return ce
}

func TestFolderUploadPlanCreatesTreeBatchAuditAndOneEvent(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	in := folderPlanInput("Hồ sơ 2026")
	in.ShareWithWorkspace = true

	b, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if b.Status != "open" || b.RootTitle != "Hồ sơ 2026" || !b.ShareWithWorkspace || b.ParentID != "" || b.TotalBytes != 30 {
		t.Fatalf("batch = %+v", b)
	}
	if len(b.Folders) != 3 || b.Folders[0].Path != "" || b.Folders[0].ID != b.RootFolderID ||
		b.Folders[1].Path != "Hợp đồng" || b.Folders[2].Path != "Hợp đồng/2026" {
		t.Fatalf("folders = %+v", b.Folders)
	}
	if b.Counts != (FolderUploadCounts{Total: 2, Pending: 2}) || len(b.Files) != 2 {
		t.Fatalf("counts = %+v files = %+v", b.Counts, b.Files)
	}
	for _, f := range b.Files {
		if f.Status != "pending" || f.Target == nil || f.Target.Kind != "put" || f.Target.URL == "" || f.Target.Auth != "" {
			t.Fatalf("file = %+v target = %+v", f, f.Target)
		}
	}
	if b.Files[0].FileKey != "f-1" || b.Files[1].FileKey != "f-2" || b.Files[1].Path != "Hợp đồng/2026" {
		t.Fatalf("files out of plan order: %+v", b.Files)
	}

	// The folders are private, nested as planned.
	byPath := map[string]string{}
	for _, f := range b.Folders {
		byPath[f.Path] = f.ID
		d := env.doc(t, f.ID)
		if d.Kind != DocumentKindFolder || d.Visibility != documentVisibilityRestricted || d.CreatedBy != member.ID {
			t.Fatalf("folder %q = %+v", f.Path, d)
		}
	}
	if d := env.doc(t, byPath["Hợp đồng/2026"]); d.ParentID.String != byPath["Hợp đồng"] || d.Title != "2026" {
		t.Fatalf("nested folder = %+v", d)
	}
	if d := env.doc(t, byPath[""]); d.ParentID.Valid {
		t.Fatalf("root folder has a parent: %+v", d)
	}

	// The share flag and the file rows are stored; files point at their folder.
	var share bool
	if err := env.f.pool.QueryRow(ctx, `SELECT share_with_workspace FROM document_folder_uploads WHERE id = $1`, b.ID).Scan(&share); err != nil || !share {
		t.Fatalf("share = %v, %v", share, err)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM document_folder_upload_files WHERE batch_id = $1 AND folder_id = $2 AND upload_ref IS NOT NULL`, b.ID, byPath["Hợp đồng/2026"]); n != 1 {
		t.Fatalf("file rows in the nested folder with a target = %d", n)
	}

	// One planned row, one document.created row per folder (with batch_id),
	// exactly one outbox row of the new topic and no document.created event.
	if n := env.folderUploadCount(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, audit.ActionDocumentsFolderUploadPlanned, b.ID); n != 1 {
		t.Fatalf("planned audit rows = %d", n)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND metadata::jsonb->>'batch_id' = $2`, audit.ActionDocumentCreated, b.ID); n != 3 {
		t.Fatalf("document.created audit rows = %d, want 3", n)
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'batch_id' = $2 AND payload::jsonb->>'root_folder_id' = $3 AND payload::jsonb->>'workspace_id' = $4`,
		DocumentBatchUploadedTopic, b.ID, b.RootFolderID, env.tn.wsA); n != 1 {
		t.Fatalf("batch_uploaded outbox rows = %d", n)
	}
	for _, f := range b.Folders {
		if n := env.countOutbox(t, "document.created", f.ID); n != 0 {
			t.Fatalf("document.created events for folder %q = %d", f.Path, n)
		}
	}
}

func TestFolderUploadRootNameTakesTheNextFreeSuffix(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	if _, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Báo cáo", IdempotencyKey: "f-" + util.NewID()}); err != nil {
		t.Fatal(err)
	}
	// Two plans of the same name at once: the tree lock serializes them.
	actors := []Actor{member, human(env.tn.creator)}
	titles := make([]string, len(actors))
	errs := make([]error, len(actors))
	var wg sync.WaitGroup
	for i, a := range actors {
		wg.Add(1)
		go func() {
			defer wg.Done()
			in := folderPlanInput("báo cáo")
			b, err := env.svc.CreateFolderUpload(ctx, a, env.tn.wsA, in)
			titles[i], errs[i] = b.RootTitle, err
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("plan: %v", err)
		}
	}
	sort.Strings(titles)
	if titles[0] != "báo cáo (1)" || titles[1] != "báo cáo (2)" {
		t.Fatalf("root titles = %q", titles)
	}
}

func TestFolderUploadLimitsRefuseThePlanAndWriteNothing(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	maxFile := env.svc.documentFileMaxBytes()
	manyFolders := make([]string, 500)
	for i := range manyFolders {
		manyFolders[i] = "d" + util.NewID()
	}
	cases := []struct {
		name   string
		limits [2]int64
		edit   func(*CreateFolderUploadInput)
		code   string
		fields map[string]any
	}{
		{"too many files", [2]int64{1, 0}, func(in *CreateFolderUploadInput) {}, "folder_upload_too_many_files", map[string]any{"max": 1, "count": 2}},
		{"too many folders", [2]int64{0, 0}, func(in *CreateFolderUploadInput) { in.Folders = manyFolders; in.Files = nil }, "folder_upload_too_many_folders", map[string]any{"max": 500, "count": 501}}, // the root counts,
		{"too large", [2]int64{0, 25}, func(in *CreateFolderUploadInput) {}, "folder_upload_too_large", map[string]any{"max_bytes": int64(25), "total_bytes": int64(30)}},
		{"file too large", [2]int64{0, 0}, func(in *CreateFolderUploadInput) { in.Files[1].SizeBytes = maxFile + 1 }, "folder_upload_file_too_large",
			map[string]any{"path": "Hợp đồng/2026", "filename": "a.pdf", "max_bytes": maxFile}},
		{"unsupported type", [2]int64{0, 0}, func(in *CreateFolderUploadInput) { in.Files[1].Filename = "setup.exe" }, "folder_upload_unsupported_type",
			map[string]any{"path": "Hợp đồng/2026", "filename": "setup.exe"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env.svc.SetFolderUploadLimits(int(tc.limits[0]), tc.limits[1])
			defer env.svc.SetFolderUploadLimits(0, 0)
			in := folderPlanInput("Gốc")
			tc.edit(&in)
			_, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
			ce := wantCoded(t, err, tc.code)
			if ce.Status != 422 {
				t.Fatalf("status = %d", ce.Status)
			}
			for k, v := range tc.fields {
				if ce.Fields[k] != v {
					t.Fatalf("fields[%s] = %#v, want %#v (all %v)", k, ce.Fields[k], v, ce.Fields)
				}
			}
		})
	}
	if env.batchCount(t) != 0 || env.folderCount(t) != 0 {
		t.Fatalf("a refused plan wrote rows: batches %d folders %d", env.batchCount(t), env.folderCount(t))
	}
}

func TestFolderUploadPathProblemsAreBadRequests(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	cases := []struct {
		name  string
		edit  func(*CreateFolderUploadInput)
		field string
	}{
		{"dot dot", func(in *CreateFolderUploadInput) { in.Folders = append(in.Folders, "Hợp đồng/../x") }, "path"},
		{"absolute", func(in *CreateFolderUploadInput) { in.Folders = append(in.Folders, "/etc") }, "path"},
		{"empty middle", func(in *CreateFolderUploadInput) { in.Folders = append(in.Folders, "Hợp đồng//x") }, "path"},
		{"control character", func(in *CreateFolderUploadInput) { in.Folders = append(in.Folders, "a\x01b") }, "path"},
		{"long segment", func(in *CreateFolderUploadInput) { in.Folders = append(in.Folders, strings.Repeat("a", 256)) }, "path"},
		{"missing parent", func(in *CreateFolderUploadInput) { in.Folders = []string{"Hợp đồng/2026"} }, "path"},
		{"file in unknown folder", func(in *CreateFolderUploadInput) { in.Files[0].Path = "Khác" }, "path"},
		{"duplicate file", func(in *CreateFolderUploadInput) {
			in.Files = append(in.Files, FolderUploadFileInput{FileKey: "f-3", Path: "Hợp đồng/2026", Filename: "a.pdf", SizeBytes: 1})
		}, "path"},
		{"duplicate file key", func(in *CreateFolderUploadInput) { in.Files[1].FileKey = "f-1" }, "file_key"},
		{"bad file key", func(in *CreateFolderUploadInput) { in.Files[1].FileKey = "f 2" }, "file_key"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := folderPlanInput("Gốc")
			tc.edit(&in)
			_, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
			ce := wantCoded(t, err, "invalid_request")
			if ce.Status != 400 || ce.Fields[tc.field] == nil {
				t.Fatalf("err = %+v, want 400 with fields.%s", ce, tc.field)
			}
		})
	}
	// Two sibling folders that differ only in case collide on the folder-name
	// index inside the transaction; the plan is still a 400 and writes nothing.
	in := folderPlanInput("Gốc")
	in.Folders = []string{"Docs", "docs"}
	in.Files = nil
	_, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if ce := wantCoded(t, err, "invalid_request"); ce.Fields["path"] != "docs" {
		t.Fatalf("case clash fields = %v", ce.Fields)
	}
	if _, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, CreateFolderUploadInput{RootName: "x"}); err == nil || !strings.Contains(err.Error(), "Idempotency-Key") {
		t.Fatalf("missing key err = %v", err)
	}
	if env.batchCount(t) != 0 || env.folderCount(t) != 0 {
		t.Fatalf("a refused plan wrote rows: batches %d folders %d", env.batchCount(t), env.folderCount(t))
	}
}

func TestFolderUploadDepthCountsTheParentChain(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	parent := ""
	for i := 0; i < 18; i++ {
		v, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "L", ParentID: parent, IdempotencyKey: "d-" + util.NewID()})
		if err != nil {
			t.Fatal(err)
		}
		parent = v.Document.ID
	}
	// Parent at 18, root folder at 19, "Hợp đồng/2026" at 21.
	in := folderPlanInput("Sâu")
	in.ParentID = &parent
	_, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if ce := wantCoded(t, err, "document_too_deep"); ce.Fields["max_depth"] != maxDocumentDepth {
		t.Fatalf("fields = %v", ce.Fields)
	}
	before := env.folderCount(t)
	// A flat plan (root folder at 19, files at 20) fits.
	in = CreateFolderUploadInput{RootName: "Phẳng", ParentID: &parent, IdempotencyKey: "k-" + util.NewID(),
		Files: []FolderUploadFileInput{{FileKey: "x", Filename: "a.md", SizeBytes: 1}}}
	b, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatalf("flat plan under a deep parent: %v", err)
	}
	if b.ParentID != parent || env.folderCount(t) != before+1 {
		t.Fatalf("batch = %+v", b)
	}
}

func TestFolderUploadParentGates(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	owner := human(env.tn.aclOwner)
	member := human(env.tn.member)
	private, err := env.svc.CreatePage(ctx, owner, env.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Riêng", IdempotencyKey: "p-" + util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	page, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Title: "Trang", IdempotencyKey: "p-" + util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	before := env.folderCount(t)
	in := folderPlanInput("Gốc")
	in.ParentID = &private.Document.ID
	if _, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in); !isGateRefusal(err) {
		t.Fatalf("plan under a folder the caller cannot edit: %v", err)
	}
	in = folderPlanInput("Gốc")
	in.ParentID = &page.Document.ID
	if _, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in); !codedIs(err, "document_parent_kind") {
		t.Fatalf("plan under a page: %v", err)
	}
	if _, err := env.svc.CreateFolderUpload(ctx, human(env.tn.bMember), env.tn.wsA, folderPlanInput("Gốc")); !isGateRefusal(err) {
		t.Fatalf("plan by a non-member: %v", err)
	}
	if _, err := env.svc.CreateFolderUpload(ctx, Actor{Kind: audit.KindAgent, ID: env.tn.agent}, env.tn.wsA, folderPlanInput("Gốc")); !errors.Is(err, ErrForbidden) {
		t.Fatalf("plan by an agent: %v", err)
	}
	if env.batchCount(t) != 0 || env.folderCount(t) != before {
		t.Fatalf("a refused plan wrote rows")
	}
}

func TestFolderUploadBusyAtTwoOpenBatches(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	for i := 0; i < 2; i++ {
		if _, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderPlanInput("Gốc")); err != nil {
			t.Fatal(err)
		}
	}
	_, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderPlanInput("Gốc"))
	if ce := wantCoded(t, err, "folder_uploads_busy"); ce.Status != 429 || ce.Fields["retry_after"] != 30 {
		t.Fatalf("busy = %+v", ce)
	}
	// Another person is not held by the first one's batches.
	if _, err := env.svc.CreateFolderUpload(ctx, human(env.tn.creator), env.tn.wsA, folderPlanInput("Gốc")); err != nil {
		t.Fatalf("another creator: %v", err)
	}
	// An expired batch no longer counts.
	if _, err := env.f.pool.Exec(ctx, `UPDATE document_folder_uploads SET expires_at = now() - interval '1 second' WHERE created_by = $1`, member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, folderPlanInput("Gốc")); err != nil {
		t.Fatalf("after expiry: %v", err)
	}
}

func TestFolderUploadIdempotentReplayAndMismatch(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	in := folderPlanInput("Gốc")
	first, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatal(err)
	}
	folders := env.folderCount(t)
	again, err := env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if again.ID != first.ID || again.RootFolderID != first.RootFolderID || len(again.Files) != 2 || again.Files[0].Target == nil {
		t.Fatalf("replay = %+v", again)
	}
	if env.batchCount(t) != 1 || env.folderCount(t) != folders {
		t.Fatalf("replay wrote rows: batches %d folders %d", env.batchCount(t), env.folderCount(t))
	}
	if n := env.folderUploadCount(t, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'batch_id' = $2`, DocumentBatchUploadedTopic, first.ID); n != 1 {
		t.Fatalf("replay wrote another event: %d", n)
	}
	in.Files[0].SizeBytes++
	_, err = env.svc.CreateFolderUpload(ctx, member, env.tn.wsA, in)
	if ce := wantCoded(t, err, "idempotency_payload_mismatch"); ce.Status != 409 {
		t.Fatalf("mismatch = %+v", ce)
	}
}

// unsignedFolderFiles is the fake FileService behind a store that cannot sign a
// write (the local adapter, CI).
type unsignedFolderFiles struct{ files.Service }

func (unsignedFolderFiles) RegisterProviderOutput(context.Context, files.ProviderOutputInput) (files.ProviderOutput, error) {
	return files.ProviderOutput{}, files.StorageUnavailable(storage.ErrCapabilityUnsupported)
}

func TestFolderUploadTargetFallsBackToTheContentRoute(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	env.svc.SetFiles(unsignedFolderFiles{env.fake})
	b, err := env.svc.CreateFolderUpload(context.Background(), human(env.tn.member), env.tn.wsA, folderPlanInput("Gốc"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range b.Files {
		want := "/api/v1/workspaces/" + env.tn.wsA + "/documents/folder-uploads/" + b.ID + "/files/" + f.FileKey + "/content"
		if f.Target == nil || f.Target.Kind != "put" || f.Target.Method != "PUT" || f.Target.URL != want || f.Target.Auth != "session" {
			t.Fatalf("target = %+v, want %s", f.Target, want)
		}
	}
	var refs int
	if err := env.f.pool.QueryRow(context.Background(), `SELECT count(*) FROM document_folder_upload_files WHERE batch_id = $1 AND upload_ref IS NOT NULL`, b.ID).Scan(&refs); err != nil || refs != 0 {
		t.Fatalf("content-route files carry a ref: %d, %v", refs, err)
	}
	raw, _ := json.Marshal(b.Folders)
	if !strings.Contains(string(raw), b.RootFolderID) {
		t.Fatalf("folders = %s", raw)
	}
}
