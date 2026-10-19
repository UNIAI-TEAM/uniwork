package service

import (
	"bytes"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// SH-S1 T3 (UNI-1780): private by default at create (U-SH2) and the workspace
// home row (SH-S1 step 1, Q-S3). The matrix runs on all three create routes -
// page/folder, file upload and blank file:
//
//   - at the root an empty visibility stores restricted;
//   - under a parent an empty visibility inherits the parent's visibility and
//     workspace level (read off the parent row locked in the transaction);
//   - a named visibility is stored as sent, and the level is the one the
//     document would grant if it were workspace-visible: the parent's level
//     when the parent is workspace-visible, else view (root included);
//   - anything but workspace|restricted is a validation refusal (400);
//   - a named visibility joins the create fingerprint, so the same key with a
//     different one is idempotency_payload_mismatch.

func TestDocumentCreateVisibility(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1t3")
	member := Human(tn.member.ID)
	fake := filesfake.New(filesfake.Options{})
	f.svc.SetFiles(fake)
	f.svc.SetEntitlements(NewEntitlementService(f.pool, f.q))
	f.svc.store.spoolDir = t.TempDir()
	office := NewDocumentOfficeService(DocumentOfficeOptions{
		Pool: f.pool, Queries: f.q, Files: fake, Documents: f.svc,
	})

	createFile := func(t *testing.T, in CreateFileDocumentInput) DocumentFileResult {
		t.Helper()
		res, err := f.svc.CreateFileDocument(f.ctx, member, tn.wsA, in)
		if err != nil {
			t.Fatalf("create file: %v", err)
		}
		return res
	}
	createBlank := func(t *testing.T, in BlankFileInput) DocumentFileResult {
		t.Helper()
		in.Format = "docx" // the embedded-seed path: no engine needed
		res, err := office.CreateBlankFile(f.ctx, member, tn.wsA, in)
		if err != nil {
			t.Fatalf("create blank: %v", err)
		}
		return res
	}
	// setLevel writes the home row level of an existing document: the create
	// path always writes a level of its own, so a fixture parent that grants
	// comment is set here (SH-S1 step 2 reads the column; step 3 only stores
	// it).
	setLevel := func(t *testing.T, id, level string) {
		t.Helper()
		if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = $1 WHERE id = $2`, level, id); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("root create without visibility is private on all three routes", func(t *testing.T) {
		page, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Riêng tư"})
		if err != nil {
			t.Fatal(err)
		}
		if page.Document.Visibility != documentVisibilityRestricted {
			t.Fatalf("page visibility = %q, want restricted", page.Document.Visibility)
		}
		folder, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục riêng"})
		if err != nil {
			t.Fatal(err)
		}
		if folder.Document.Visibility != documentVisibilityRestricted {
			t.Fatalf("folder visibility = %q, want restricted", folder.Document.Visibility)
		}
		file := createFile(t, CreateFileDocumentInput{Title: "Tệp riêng", Filename: "rieng.pdf", Body: bytes.NewReader(pdfBody("t3-private"))})
		if file.Document.Visibility != documentVisibilityRestricted {
			t.Fatalf("file visibility = %q, want restricted", file.Document.Visibility)
		}
		blank := createBlank(t, BlankFileInput{Title: "Trống riêng"})
		if blank.Document.Visibility != documentVisibilityRestricted {
			t.Fatalf("blank visibility = %q, want restricted", blank.Document.Visibility)
		}
	})

	t.Run("root workspace opens the home row at view", func(t *testing.T) {
		page, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Chia sẻ", Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatal(err)
		}
		if page.Document.Visibility != documentVisibilityWorkspace || page.Document.WorkspaceLevel != string(DocumentLevelView) {
			t.Fatalf("page = %q/%q, want workspace/view (Q-S3)", page.Document.Visibility, page.Document.WorkspaceLevel)
		}
		file := createFile(t, CreateFileDocumentInput{Title: "Tệp chia sẻ", Filename: "chia-se.pdf",
			Body: bytes.NewReader(pdfBody("t3-open")), Visibility: documentVisibilityWorkspace})
		if file.Document.Visibility != documentVisibilityWorkspace || file.Document.WorkspaceLevel != string(DocumentLevelView) {
			t.Fatalf("file = %q/%q, want workspace/view", file.Document.Visibility, file.Document.WorkspaceLevel)
		}
		blank := createBlank(t, BlankFileInput{Title: "Trống chia sẻ", Visibility: documentVisibilityWorkspace})
		if blank.Document.Visibility != documentVisibilityWorkspace || blank.Document.WorkspaceLevel != string(DocumentLevelView) {
			t.Fatalf("blank = %q/%q, want workspace/view", blank.Document.Visibility, blank.Document.WorkspaceLevel)
		}
	})

	t.Run("a child inherits the parent home row", func(t *testing.T) {
		// A PAGE parent passes its pair on; a folder never does (UNI-1974,
		// document_folder_share_off_test.go).
		parent, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Trang chia sẻ",
			Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatal(err)
		}
		setLevel(t, parent.Document.ID, string(DocumentLevelComment))

		child, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent.Document.ID, Title: "Con"})
		if err != nil {
			t.Fatal(err)
		}
		if child.Document.Visibility != documentVisibilityWorkspace || child.Document.WorkspaceLevel != string(DocumentLevelComment) {
			t.Fatalf("page child = %q/%q, want workspace/comment", child.Document.Visibility, child.Document.WorkspaceLevel)
		}
		file := createFile(t, CreateFileDocumentInput{Title: "Tệp con", Filename: "con.pdf",
			Body: bytes.NewReader(pdfBody("t3-child")), ParentID: parent.Document.ID})
		if file.Document.Visibility != documentVisibilityWorkspace || file.Document.WorkspaceLevel != string(DocumentLevelComment) {
			t.Fatalf("file child = %q/%q, want workspace/comment", file.Document.Visibility, file.Document.WorkspaceLevel)
		}
		blank := createBlank(t, BlankFileInput{Title: "Trống con", ParentID: parent.Document.ID})
		if blank.Document.Visibility != documentVisibilityWorkspace || blank.Document.WorkspaceLevel != string(DocumentLevelComment) {
			t.Fatalf("blank child = %q/%q, want workspace/comment", blank.Document.Visibility, blank.Document.WorkspaceLevel)
		}
	})

	t.Run("a restricted parent keeps its children private", func(t *testing.T) {
		parent, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục kín",
			Visibility: documentVisibilityRestricted})
		if err != nil {
			t.Fatal(err)
		}
		child, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent.Document.ID, Title: "Con riêng"})
		if err != nil {
			t.Fatal(err)
		}
		if child.Document.Visibility != documentVisibilityRestricted {
			t.Fatalf("child of a restricted parent = %q, want restricted", child.Document.Visibility)
		}
		file := createFile(t, CreateFileDocumentInput{Title: "Tệp riêng", Filename: "rieng-con.pdf",
			Body: bytes.NewReader(pdfBody("t3-private-child")), ParentID: parent.Document.ID})
		if file.Document.Visibility != documentVisibilityRestricted {
			t.Fatalf("file child = %q, want restricted", file.Document.Visibility)
		}
		// A restricted parent has no home row to read (BR-10): an explicit
		// workspace child under it opens at view.
		open, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{ParentID: parent.Document.ID, Title: "Mở",
			Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatal(err)
		}
		if open.Document.Visibility != documentVisibilityWorkspace || open.Document.WorkspaceLevel != string(DocumentLevelView) {
			t.Fatalf("explicit workspace under a restricted parent = %q/%q, want workspace/view",
				open.Document.Visibility, open.Document.WorkspaceLevel)
		}
	})

	t.Run("a value outside the allowlist is refused on all three routes", func(t *testing.T) {
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "x", Visibility: "public"}); !isValidation(err) {
			t.Fatalf("page visibility: %v, want a validation refusal", err)
		}
		if _, err := f.svc.CreateFileDocument(f.ctx, member, tn.wsA, CreateFileDocumentInput{
			Title: "x", Filename: "x.pdf", Body: bytes.NewReader(pdfBody("t3-bad")), Visibility: "public",
		}); !isValidation(err) {
			t.Fatalf("file visibility: %v, want a validation refusal", err)
		}
		if _, err := office.CreateBlankFile(f.ctx, member, tn.wsA, BlankFileInput{
			Format: "docx", Title: "x", Visibility: "public",
		}); !isValidation(err) {
			t.Fatalf("blank visibility: %v, want a validation refusal", err)
		}
	})

	t.Run("idempotency covers the named visibility", func(t *testing.T) {
		pageKey := "t3-" + util.NewID()
		first, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Lặp", IdempotencyKey: pageKey,
			Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatal(err)
		}
		again, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Lặp", IdempotencyKey: pageKey,
			Visibility: documentVisibilityWorkspace})
		if err != nil || again.Document.ID != first.Document.ID {
			t.Fatalf("page replay = %v, %v", again.Document.ID, err)
		}
		if _, err := f.svc.CreatePage(f.ctx, member, tn.wsA, CreatePageInput{Title: "Lặp", IdempotencyKey: pageKey,
			Visibility: documentVisibilityRestricted}); !codedIs(err, "idempotency_payload_mismatch") {
			t.Fatalf("page visibility mismatch = %v", err)
		}

		fileBody := pdfBody("t3-idem-" + util.NewID())
		fileKey := "t3-" + util.NewID()
		firstFile := createFile(t, CreateFileDocumentInput{Title: "Tệp lặp", Filename: "lap.pdf",
			Body: bytes.NewReader(fileBody), Visibility: documentVisibilityWorkspace, IdempotencyKey: fileKey})
		replay := createFile(t, CreateFileDocumentInput{Title: "Tệp lặp", Filename: "lap.pdf",
			Body: bytes.NewReader(fileBody), Visibility: documentVisibilityWorkspace, IdempotencyKey: fileKey})
		if replay.Document.ID != firstFile.Document.ID {
			t.Fatalf("file replay = %s, want %s", replay.Document.ID, firstFile.Document.ID)
		}
		if _, err := f.svc.CreateFileDocument(f.ctx, member, tn.wsA, CreateFileDocumentInput{
			Title: "Tệp lặp", Filename: "lap.pdf", Body: bytes.NewReader(fileBody),
			Visibility: documentVisibilityRestricted, IdempotencyKey: fileKey,
		}); !codedIs(err, "idempotency_payload_mismatch") {
			t.Fatalf("file visibility mismatch = %v", err)
		}

		blankKey := "t3-" + util.NewID()
		firstBlank := createBlank(t, BlankFileInput{Title: "Trống lặp", Visibility: documentVisibilityWorkspace, IdempotencyKey: blankKey})
		blankReplay := createBlank(t, BlankFileInput{Title: "Trống lặp", Visibility: documentVisibilityWorkspace, IdempotencyKey: blankKey})
		if blankReplay.Document.ID != firstBlank.Document.ID {
			t.Fatalf("blank replay = %s, want %s", blankReplay.Document.ID, firstBlank.Document.ID)
		}
		if _, err := office.CreateBlankFile(f.ctx, member, tn.wsA, BlankFileInput{
			Format: "docx", Title: "Trống lặp", Visibility: documentVisibilityRestricted, IdempotencyKey: blankKey,
		}); !codedIs(err, "idempotency_payload_mismatch") {
			t.Fatalf("blank visibility mismatch = %v", err)
		}
	})
}

// TestDocumentCopyKeepsTheHomeRow: a copy carries the source's visibility and
// workspace level (C-01 §14.4), so copying a comment-level workspace document
// does not hand the copier a home row, and a private source stays private.
func TestDocumentCopyKeepsTheHomeRow(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "shs1t3copy")
	member := Human(tn.member.ID)
	f.svc.SetFiles(filesfake.New(filesfake.Options{}))
	f.svc.SetEntitlements(NewEntitlementService(f.pool, f.q))
	f.svc.store.spoolDir = t.TempDir()

	src, err := f.svc.CreateFileDocument(f.ctx, member, tn.wsA, CreateFileDocumentInput{
		Title: "Nguồn", Filename: "nguon.pdf", Body: bytes.NewReader(pdfBody("t3-copy")),
		Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = $1 WHERE id = $2`,
		string(DocumentLevelComment), src.Document.ID); err != nil {
		t.Fatal(err)
	}
	copied, err := f.svc.CopyDocument(f.ctx, member, src.Document.ID, CopyDocumentInput{
		Consent: documentCopyConsent, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if copied.Document.Visibility != documentVisibilityWorkspace || copied.Document.WorkspaceLevel != string(DocumentLevelComment) {
		t.Fatalf("copy = %q/%q, want workspace/comment", copied.Document.Visibility, copied.Document.WorkspaceLevel)
	}

	private, err := f.svc.CreateFileDocument(f.ctx, member, tn.wsA, CreateFileDocumentInput{
		Title: "Nguồn riêng", Filename: "nguon-rieng.pdf", Body: bytes.NewReader(pdfBody("t3-copy-private")),
		Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatal(err)
	}
	copiedPrivate, err := f.svc.CopyDocument(f.ctx, member, private.Document.ID, CopyDocumentInput{
		Consent: documentCopyConsent, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if copiedPrivate.Document.Visibility != documentVisibilityRestricted {
		t.Fatalf("copy of a private source = %q, want restricted", copiedPrivate.Document.Visibility)
	}
}
