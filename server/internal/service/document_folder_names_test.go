package service

// E6 FD-02 (UNI-1462) names: the one normalizer every title write calls, the
// duplicate key of a folder name (case-insensitive, accent-sensitive, over the
// NFC title), the "(n)" auto-rename of a move, and the savepoint retry that
// stands behind the name index of PR 2.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/text/unicode/norm"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// folderNamesEnv is the shared fixture of the FD-02 suites: one workspace and
// helpers that create folders, pages and files through the service.
type folderNamesEnv struct {
	*docStorageEnv
	ctx    context.Context
	member Actor
}

func newFolderNamesEnv(t *testing.T) *folderNamesEnv {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	return &folderNamesEnv{docStorageEnv: env, ctx: context.Background(), member: human(env.tn.member)}
}

func (e *folderNamesEnv) folder(t *testing.T, parent, title string) db.Document {
	t.Helper()
	v, err := e.svc.CreatePage(e.ctx, e.member, e.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, ParentID: parent, Title: title})
	if err != nil {
		t.Fatalf("create folder %q: %v", title, err)
	}
	return v.Document
}

func (e *folderNamesEnv) page(t *testing.T, parent, title string) db.Document {
	t.Helper()
	v, err := e.svc.CreatePage(e.ctx, e.member, e.tn.wsA, CreatePageInput{ParentID: parent, Title: title})
	if err != nil {
		t.Fatalf("create page %q: %v", title, err)
	}
	return v.Document
}

func (e *folderNamesEnv) file(t *testing.T, parent, title, filename, marker string) db.Document {
	t.Helper()
	res, err := e.svc.CreateFileDocument(e.ctx, e.member, e.tn.wsA, CreateFileDocumentInput{
		ParentID: parent, Title: title, Filename: filename, Body: bytes.NewReader(pdfBody(marker)),
	})
	if err != nil {
		t.Fatalf("create file %q: %v", title, err)
	}
	return res.Document
}

func (e *folderNamesEnv) createFolder(t *testing.T, parent, title string) error {
	t.Helper()
	_, err := e.svc.CreatePage(e.ctx, e.member, e.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, ParentID: parent, Title: title})
	return err
}

func (e *folderNamesEnv) rename(t *testing.T, doc db.Document, title string) error {
	t.Helper()
	_, err := e.svc.UpdateDocument(e.ctx, e.member, doc.ID, UpdateDocumentInput{Revision: doc.Revision, Title: &title})
	return err
}

func TestDocumentFolderNameDuplicate(t *testing.T) {
	env := newFolderNamesEnv(t)

	t.Run("a live sibling refuses the name, case-insensitively", func(t *testing.T) {
		env.folder(t, "", "Hợp đồng")
		ce := wantCode(t, env.createFolder(t, "", "HỢP ĐỒNG"), "folder_name_taken")
		if len(ce.Fields) != 0 {
			t.Fatalf("refusal carries details: %v", ce.Fields)
		}
		if strings.Contains(ce.Msg, "Hợp đồng") {
			t.Fatalf("refusal names the holder: %q", ce.Msg)
		}
	})

	t.Run("accents stay significant", func(t *testing.T) {
		root := env.folder(t, "", "Gốc dấu")
		if err := env.createFolder(t, root.ID, "Hop dong"); err != nil {
			t.Fatalf("an unaccented name next to an accented one: %v", err)
		}
		if err := env.createFolder(t, root.ID, "Hợp đồng"); err != nil {
			t.Fatalf("accented next to unaccented: %v", err)
		}
		if err := env.createFolder(t, root.ID, "Ma"); err != nil {
			t.Fatalf("Ma: %v", err)
		}
		if err := env.createFolder(t, root.ID, "Mã"); err != nil {
			t.Fatalf("Mã is another name than Ma: %v", err)
		}
	})

	t.Run("NFD and NFC spellings are one name", func(t *testing.T) {
		root := env.folder(t, "", "Gốc NFC")
		env.folder(t, root.ID, "Hợp đồng")
		wantCode(t, env.createFolder(t, root.ID, norm.NFD.String("Hợp đồng")), "folder_name_taken")
	})

	t.Run("another parent, an archived folder and another kind keep the name free", func(t *testing.T) {
		one := env.folder(t, "", "Cha một")
		two := env.folder(t, "", "Cha hai")
		env.folder(t, one.ID, "Chung")
		if err := env.createFolder(t, two.ID, "Chung"); err != nil {
			t.Fatalf("same name under another parent: %v", err)
		}
		trashed := env.folder(t, "", "Đã xoá")
		if _, err := env.svc.ArchiveDocument(env.ctx, env.member, trashed.ID, ArchiveDocumentInput{}); err != nil {
			t.Fatal(err)
		}
		if err := env.createFolder(t, "", "Đã xoá"); err != nil {
			t.Fatalf("an archived folder holds nothing: %v", err)
		}
		env.page(t, "", "Trang trùng tên")
		if err := env.createFolder(t, "", "Trang trùng tên"); err != nil {
			t.Fatalf("a page is not a folder: %v", err)
		}
	})

	t.Run("a rename to a taken name is refused and changes nothing", func(t *testing.T) {
		env.folder(t, "", "Tên đang có")
		moving := env.folder(t, "", "Tên cũ")
		ce := wantCode(t, env.rename(t, moving, "Tên đang có"), "folder_name_taken")
		if len(ce.Fields) != 0 {
			t.Fatalf("refusal carries details: %v", ce.Fields)
		}
		if got := env.f.live(t, moving.ID); got.Title != "Tên cũ" || got.Revision != moving.Revision {
			t.Fatalf("refused rename changed the row: %q rev %d", got.Title, got.Revision)
		}
	})

	t.Run("a folder the caller cannot read still refuses without its id or name", func(t *testing.T) {
		hidden, err := env.svc.CreatePage(env.ctx, human(env.tn.aclOwner), env.tn.wsA, CreatePageInput{
			Kind: DocumentKindFolder, Title: "Bí mật", Visibility: documentVisibilityRestricted,
		})
		if err != nil {
			t.Fatal(err)
		}
		ce := wantCode(t, env.createFolder(t, "", "Bí mật"), "folder_name_taken")
		if strings.Contains(ce.Msg, hidden.Document.ID) || strings.Contains(ce.Msg, "Bí mật") {
			t.Fatalf("refusal leaks the unreadable holder: %q", ce.Msg)
		}
		if details := fmt.Sprint(ce.Fields); strings.Contains(details, hidden.Document.ID) {
			t.Fatalf("refusal details leak the unreadable holder: %s", details)
		}
	})

	t.Run("the cap is 255 runes for a folder and 500 for a document", func(t *testing.T) {
		if err := env.createFolder(t, "", strings.Repeat("a", maxFolderTitle)); err != nil {
			t.Fatalf("255-rune folder: %v", err)
		}
		if err := env.createFolder(t, "", strings.Repeat("b", maxFolderTitle+1)); !isValidation(err) {
			t.Fatalf("256-rune folder = %v, want a validation error", err)
		}
		long := env.page(t, "", strings.Repeat("c", maxDocumentTitle))
		if err := env.rename(t, long, strings.Repeat("d", maxDocumentTitle)); err != nil {
			t.Fatalf("500-rune document rename: %v", err)
		}
		if err := env.rename(t, long, strings.Repeat("e", maxDocumentTitle+1)); !isValidation(err) {
			t.Fatalf("501-rune document = %v, want a validation error", err)
		}
	})

	t.Run("pages and files may repeat a name (FD-D10)", func(t *testing.T) {
		env.page(t, "", "Trang lặp")
		env.page(t, "", "Trang lặp")
		env.file(t, "", "Trang lặp", "mot.pdf", "dup-one")
		env.file(t, "", "Trang lặp", "hai.pdf", "dup-two")
		first := env.page(t, "", "Trang đổi")
		if err := env.rename(t, first, "Trang lặp"); err != nil {
			t.Fatalf("a page may duplicate a page: %v", err)
		}
	})
}

func TestDocumentFolderNameConcurrentCreate(t *testing.T) {
	env := newFolderNamesEnv(t)
	const racers = 2
	results := make([]error, racers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i] = env.createFolder(t, "", "Đua tên")
		}(i)
	}
	close(start)
	wg.Wait()
	var created, refused int
	for _, err := range results {
		switch {
		case err == nil:
			created++
		case isCode(err, "folder_name_taken"):
			refused++
		default:
			t.Fatalf("unexpected answer: %v", err)
		}
	}
	if created != 1 || refused != 1 {
		t.Fatalf("two concurrent creates = %d created, %d refused; want one of each (%v)", created, refused, results)
	}
}

func isCode(err error, code string) bool {
	var ce CodedError
	return errors.As(err, &ce) && ce.Code == code
}

// seedNumberedPages fills one parent with the bare "base" (n = 1) and every
// "base (n)" up to to, so the "(n)" allocator runs out of numbers the way a
// parent holding all of them would. One statement, through the same table the
// fixtures use.
func seedNumberedPages(t *testing.T, env *folderNamesEnv, parent, base string, from, to int) {
	t.Helper()
	if _, err := env.f.pool.Exec(env.ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility, parent_id,
		  created_by, created_by_kind, updated_by, updated_by_kind)
		SELECT '01FDUPSUFFIX' || lpad(n::text, 13, '0'), $1, $2, 'page',
		  CASE WHEN n = 1 THEN $3 ELSE $3 || ' (' || n || ')' END, 'workspace', $4,
		  $5, 'human', $5, 'human'
		FROM generate_series($6::int, $7::int) AS n`,
		env.tn.orgID, env.tn.wsA, base, parent, env.tn.member.ID, from, to); err != nil {
		t.Fatal(err)
	}
}

// contentRevisionOf reads the column a content save compares against: a
// metadata write must leave it where it was.
func contentRevisionOf(t *testing.T, env *folderNamesEnv, id string) int64 {
	t.Helper()
	var rev int64
	if err := env.f.pool.QueryRow(env.ctx, `SELECT content_revision FROM documents WHERE id = $1`, id).Scan(&rev); err != nil {
		t.Fatal(err)
	}
	return rev
}

func TestDocumentMoveAutoRename(t *testing.T) {
	env := newFolderNamesEnv(t)

	t.Run("a folder joins a parent that already holds its name", func(t *testing.T) {
		dst := env.folder(t, "", "Đích ba")
		env.folder(t, dst.ID, "A")
		env.folder(t, dst.ID, "A (2)")
		moving := env.folder(t, "", "A")
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Document.Title != "A (3)" {
			t.Fatalf("title = %q, want A (3)", moved.Document.Title)
		}
		// The audit row names the rename the command performed.
		var changes string
		if err := env.f.pool.QueryRow(env.ctx,
			`SELECT changes::text FROM audit_events WHERE action = $1 AND resource_id = $2`,
			string(audit.ActionDocumentMoved), moving.ID).Scan(&changes); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(changes, "A (3)") {
			t.Fatalf("audit diff does not carry the new title: %s", changes)
		}
	})

	t.Run("a file keeps its extension outside the suffix", func(t *testing.T) {
		dst := env.folder(t, "", "Đích tệp")
		env.file(t, dst.ID, "Báo cáo.docx", "bao-cao-mot.docx", "ext-one")
		moving := env.file(t, "", "Báo cáo.docx", "bao-cao-hai.docx", "ext-two")
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Document.Title != "Báo cáo (2).docx" {
			t.Fatalf("title = %q, want Báo cáo (2).docx", moved.Document.Title)
		}
	})

	t.Run("a multi-digit suffix is the smallest free number", func(t *testing.T) {
		dst := env.folder(t, "", "Đích nhiều số")
		for n := 1; n <= 10; n++ {
			title := "Số"
			if n > 1 {
				title = "Số (" + strconv.Itoa(n) + ")"
			}
			env.folder(t, dst.ID, title)
		}
		moving := env.folder(t, "", "Số")
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Document.Title != "Số (11)" {
			t.Fatalf("title = %q, want Số (11)", moved.Document.Title)
		}
	})

	t.Run("the base is trimmed to the cap and the suffix survives", func(t *testing.T) {
		dst := env.folder(t, "", "Đích dài")
		long := strings.Repeat("x", maxFolderTitle)
		env.folder(t, dst.ID, long)
		moving := env.folder(t, "", long)
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		title := moved.Document.Title
		if len([]rune(title)) != maxFolderTitle {
			t.Fatalf("title is %d runes, want the cap filled exactly", len([]rune(title)))
		}
		if !strings.HasSuffix(title, " (2)") {
			t.Fatalf("title = %q, want a (2) suffix", title)
		}
	})

	t.Run("a file whose extension alone fills the cap still fits it", func(t *testing.T) {
		// A 500-rune file title "a." + 498 x: the extension is 499 runes, so
		// the suffix cannot fit beside it. The name the move writes must stay
		// within the cap - the extension gives way, the suffix does not - or
		// the row lands above the frozen FD-D3 limit the SDI advertises.
		dst := env.folder(t, "", "Đích đuôi dài")
		title := "a." + strings.Repeat("x", maxDocumentTitle-2)
		if got := len([]rune(title)); got != maxDocumentTitle {
			t.Fatalf("fixture title is %d runes, want %d", got, maxDocumentTitle)
		}
		env.file(t, dst.ID, title, "ext-heavy-one.txt", "ext-heavy-one")
		moving := env.file(t, "", title, "ext-heavy-two.txt", "ext-heavy-two")
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		got := moved.Document.Title
		if n := utf8.RuneCountInString(got); n > maxDocumentTitle {
			t.Fatalf("auto-renamed title is %d runes, over the %d cap: %q", n, maxDocumentTitle, got)
		}
		if !strings.HasSuffix(got, " (2)") {
			t.Fatalf("title = %q, want the (2) suffix kept", got)
		}
	})

	t.Run("a combining mark is never left dangling at the cut", func(t *testing.T) {
		// 253 base runes, then "e" with a composing accent: the cut may not
		// keep the base letter and drop the mark.
		base := strings.Repeat("y", maxFolderTitle-3) + "e" + "\u0301" + "z"
		dst := env.folder(t, "", "Đích dấu")
		env.folder(t, dst.ID, base)
		moving := env.folder(t, "", base)
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		title := moved.Document.Title
		if !norm.NFC.IsNormalString(title) {
			t.Fatalf("title is not NFC: %q", title)
		}
		if len([]rune(title)) > maxFolderTitle {
			t.Fatalf("title is %d runes, past the cap", len([]rune(title)))
		}
		if !strings.HasSuffix(title, " (2)") {
			t.Fatalf("title = %q", title)
		}
		if strings.ContainsRune(title, '\u0301') && strings.HasSuffix(strings.TrimSuffix(title, " (2)"), "e") {
			t.Fatalf("the cut kept a bare base letter and dropped its mark: %q", title)
		}
	})

	t.Run("a same-name document of another kind keeps its name", func(t *testing.T) {
		dst := env.folder(t, "", "Đích khác loại")
		env.folder(t, dst.ID, "Tài liệu")
		moving := env.page(t, "", "Tài liệu")
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Document.Title != "Tài liệu" {
			t.Fatalf("page title = %q, want the name kept", moved.Document.Title)
		}
	})

	t.Run("moving inside the same parent does not rename against itself", func(t *testing.T) {
		parent := env.folder(t, "", "Đích tự thân")
		stay := env.folder(t, parent.ID, "Ở lại")
		moved, err := env.svc.MoveDocument(env.ctx, env.member, stay.ID, MoveDocumentInput{ParentID: parent.ID, Revision: stay.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Document.Title != "Ở lại" {
			t.Fatalf("title = %q, want the name kept", moved.Document.Title)
		}
	})

	t.Run("a destination holding every number answers a coded conflict", func(t *testing.T) {
		dst := env.folder(t, "", "Đích đầy số")
		// The bare name and every number the allocator can try are taken.
		seedNumberedPages(t, env, dst.ID, "Tên", 1, maxTitleSuffix)
		moving := env.page(t, "", "Tên")
		_, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		// A page never carries folder_name_taken (FD-D10); the exhausted
		// allocator answers a coded conflict, never an uncoded 500.
		ce := wantCode(t, err, "conflict")
		if ce.Status != 409 {
			t.Fatalf("status = %d, want 409", ce.Status)
		}
		if after := env.f.live(t, moving.ID); after.ParentID.Valid || after.Title != "Tên" {
			t.Fatalf("the refused move left the page as %q under %v", after.Title, after.ParentID)
		}
	})

	t.Run("a rename moves the revision and never the content revision", func(t *testing.T) {
		dst := env.folder(t, "", "Đích nội dung")
		env.page(t, dst.ID, "Trang nội dung")
		moving, err := env.svc.CreatePage(env.ctx, env.member, env.tn.wsA, CreatePageInput{
			Title: "Trang nội dung", Content: pageJSON("nội dung ban đầu"),
		})
		if err != nil {
			t.Fatal(err)
		}
		before := contentRevisionOf(t, env, moving.Document.ID)
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.Document.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Document.Revision})
		if err != nil {
			t.Fatal(err)
		}
		if moved.Document.Title != "Trang nội dung (2)" {
			t.Fatalf("title = %q, want Trang nội dung (2)", moved.Document.Title)
		}
		// G5 contentBaseCurrent: the auto-rename is metadata, so the content
		// base a client held stays current and a save after it is not a
		// conflict.
		if got := contentRevisionOf(t, env, moving.Document.ID); got != before {
			t.Fatalf("the auto-rename moved content_revision: %d -> %d", before, got)
		}
		if _, err := env.svc.UpdateDocument(env.ctx, env.member, moving.Document.ID, UpdateDocumentInput{
			Revision: moved.Document.Revision, Content: pageJSON("nội dung mới"),
		}); err != nil {
			t.Fatalf("a content save on the renamed document: %v", err)
		}
	})

	t.Run("the renamed document is found by its new name", func(t *testing.T) {
		dst := env.folder(t, "", "Đích tìm")
		env.folder(t, dst.ID, "Tìm kiếm")
		moving := env.folder(t, "", "Tìm kiếm")
		if _, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision}); err != nil {
			t.Fatal(err)
		}
		found, err := env.svc.ListDocuments(env.ctx, env.member, env.tn.wsA, ListDocumentsInput{Query: "Tìm kiếm (2)"})
		if err != nil {
			t.Fatal(err)
		}
		var hit bool
		for _, item := range found.Items {
			if item.Document.ID == moving.ID && item.Document.Title == "Tìm kiếm (2)" {
				hit = true
			}
		}
		if !hit {
			t.Fatalf("the new name does not find the document: %+v", found.Items)
		}
	})
}

func TestDocumentTitleRetrySavepoint(t *testing.T) {
	env := newFolderNamesEnv(t)

	t.Run("a first-attempt 23505 is retried and leaves one audit and one outbox row", func(t *testing.T) {
		dst := env.folder(t, "", "Đích thử lại")
		env.folder(t, dst.ID, "Trùng")
		moving := env.folder(t, "", "Trùng")
		env.svc.titleWriteErr = func(attempt int) error {
			if attempt == 1 {
				return &pgconn.PgError{Code: "23505", ConstraintName: "idx_documents_folder_name_uidx"}
			}
			return nil
		}
		defer func() { env.svc.titleWriteErr = nil }()
		moved, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{
			ParentID: dst.ID, Revision: moving.Revision, IdempotencyKey: util.NewID(),
		})
		if err != nil {
			t.Fatalf("retried move: %v", err)
		}
		if moved.Document.Title != "Trùng (2)" {
			t.Fatalf("title = %q, want Trùng (2)", moved.Document.Title)
		}
		if n := countAudit(t, env.f, string(audit.ActionDocumentMoved), moving.ID); n != 1 {
			t.Fatalf("audit rows = %d, want exactly 1", n)
		}
		if n := countOutbox(t, env.f, "document.moved", moving.ID); n != 1 {
			t.Fatalf("document.moved outbox rows = %d, want exactly 1", n)
		}
	})

	t.Run("running out of attempts answers 409 and writes nothing", func(t *testing.T) {
		dst := env.folder(t, "", "Đích hết lượt")
		env.folder(t, dst.ID, "Cứng")
		moving := env.folder(t, "", "Cứng")
		env.svc.titleWriteErr = func(int) error {
			return &pgconn.PgError{Code: "23505", ConstraintName: "idx_documents_folder_name_uidx"}
		}
		defer func() { env.svc.titleWriteErr = nil }()
		key := util.NewID()
		_, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{
			ParentID: dst.ID, Revision: moving.Revision, IdempotencyKey: key,
		})
		ce := wantCode(t, err, "folder_name_taken")
		if ce.Status != 409 {
			t.Fatalf("status = %d, want 409", ce.Status)
		}
		// The whole command rolled back: the row is where it was, with no
		// audit, outbox or idempotency row. 25P02 would have surfaced here
		// instead of the coded answer if a statement had run on the aborted
		// savepoint.
		after := env.f.live(t, moving.ID)
		if after.ParentID.Valid || after.Title != "Cứng" || after.Revision != moving.Revision {
			t.Fatalf("half-written row: %+v", after)
		}
		if n := countAudit(t, env.f, string(audit.ActionDocumentMoved), moving.ID); n != 0 {
			t.Fatalf("audit rows = %d, want none", n)
		}
		if n := countOutbox(t, env.f, "document.moved", moving.ID); n != 0 {
			t.Fatalf("outbox rows = %d, want none", n)
		}
		var claims int
		if err := env.f.pool.QueryRow(env.ctx,
			`SELECT count(*) FROM idempotency_keys WHERE actor_id = $1 AND scope = $2 AND key = $3`,
			env.member.ID, idempotencyScopeDocumentMove, key).Scan(&claims); err != nil {
			t.Fatal(err)
		}
		if claims != 0 {
			t.Fatalf("idempotency rows = %d, want none", claims)
		}
	})

	t.Run("a page out of attempts answers a coded conflict, not a 500", func(t *testing.T) {
		dst := env.folder(t, "", "Đích trang hết lượt")
		env.page(t, dst.ID, "Trang cứng")
		moving := env.page(t, "", "Trang cứng")
		env.svc.titleWriteErr = func(int) error {
			return &pgconn.PgError{Code: "23505", ConstraintName: "idx_documents_folder_name_uidx"}
		}
		defer func() { env.svc.titleWriteErr = nil }()
		_, err := env.svc.MoveDocument(env.ctx, env.member, moving.ID, MoveDocumentInput{ParentID: dst.ID, Revision: moving.Revision})
		ce := wantCode(t, err, "conflict")
		if ce.Status != 409 {
			t.Fatalf("status = %d, want 409", ce.Status)
		}
		if after := env.f.live(t, moving.ID); after.ParentID.Valid {
			t.Fatalf("the refused move left the page under %v", after.ParentID)
		}
	})
}

func TestDocumentTitleNormalization(t *testing.T) {
	env := newFolderNamesEnv(t)
	decomposed := norm.NFD.String("Kế hoạch Q4")
	composed := norm.NFC.String("Kế hoạch Q4")

	t.Run("create trims and composes", func(t *testing.T) {
		page := env.page(t, "", "  "+decomposed+"  ")
		if page.Title != composed {
			t.Fatalf("title = %q, want the trimmed NFC form", page.Title)
		}
		folder := env.folder(t, "", decomposed)
		if folder.Title != composed {
			t.Fatalf("folder title = %q, want the NFC form", folder.Title)
		}
	})

	t.Run("a file title is normalized too, and falls back to the filename", func(t *testing.T) {
		f := env.file(t, "", " ", "bao-cao.pdf", "norm-file")
		if f.Title != "bao-cao.pdf" {
			t.Fatalf("title = %q, want the sanitized filename", f.Title)
		}
		explicit := env.file(t, "", decomposed, "khac.pdf", "norm-file-2")
		if explicit.Title != composed {
			t.Fatalf("explicit file title = %q, want NFC", explicit.Title)
		}
	})

	t.Run("a rename is normalized", func(t *testing.T) {
		page := env.page(t, "", "Trang đổi tên")
		if err := env.rename(t, page, " "+decomposed+" "); err != nil {
			t.Fatal(err)
		}
		if got := env.f.live(t, page.ID); got.Title != composed {
			t.Fatalf("renamed title = %q, want NFC", got.Title)
		}
	})

	t.Run("a copy title is normalized", func(t *testing.T) {
		src := env.file(t, "", "Nguồn sao chép", "nguon.pdf", "copy-src")
		res, err := env.svc.CopyDocument(env.ctx, env.member, src.ID, CopyDocumentInput{
			Consent: documentCopyConsent, Title: " " + decomposed + " ",
		})
		if err != nil {
			t.Fatal(err)
		}
		if res.Document.Title != composed {
			t.Fatalf("copy title = %q, want NFC", res.Document.Title)
		}
	})
}

// titleWriteCalls are the statements that write documents.title. A new one
// joins this list and the guard below it, or the write path is a bypass.
var titleWriteCalls = []string{
	"q.InsertDocument(",
	"q.UpdateDocumentFields(",
	"q.MoveDocument(",
	"q.DetachDocumentToRoot(",
	"q.RenameArchivedDocument(",
}

// titleNamingHelpers are the functions a title write may take its title from:
// the normalizer itself, and the two name deciders of a move and a restore,
// which normalize the title and allocate the "(n)" name.
var titleNamingHelpers = []string{
	"normalizeDocumentTitle(",
	"availableMoveTitle(",
	"restoreNames(",
}

// TestDocumentTitleWritePathsUseTheNormalizer is the guard the appendix asks
// for (§3.3): no non-test file may run one of the title-writing statements from
// a function that does not go through a naming helper. It is textual on
// purpose - a bypass is a line a reviewer can see, and the guard fails when a
// new statement joins the list without a call site.
func TestDocumentTitleWritePathsUseTheNormalizer(t *testing.T) {
	files, err := filepath.Glob("document*.go")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no document*.go files found: the guard would pass on nothing")
	}
	seen := map[string]bool{}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, site := range titleWriteSites(string(raw)) {
			seen[site.call] = true
			if !mentionsAny(site.body, titleNamingHelpers) {
				t.Errorf("%s: %s runs outside a naming helper:\n%s", name, site.call, site.function)
			}
		}
	}
	for _, call := range titleWriteCalls {
		if !seen[call] {
			t.Errorf("no call site found for %s: the guard needs updating with the statement", call)
		}
	}
}

type titleWriteSite struct {
	call     string
	function string // the top-level function name the call sits in
	body     string
}

// titleWriteSites splits a Go source file at its top-level functions and
// reports every title-writing statement inside one, with the whole function
// body to judge it by.
func titleWriteSites(text string) []titleWriteSite {
	var out []titleWriteSite
	var body strings.Builder
	name := ""
	flush := func() {
		if body.Len() == 0 {
			return
		}
		for _, call := range titleWriteCalls {
			if strings.Contains(body.String(), call) {
				out = append(out, titleWriteSite{call: call, function: name, body: body.String()})
			}
		}
		body.Reset()
	}
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "func ") {
			flush()
			name = line
		}
		body.WriteString(line)
		body.WriteString("\n")
	}
	flush()
	return out
}

func mentionsAny(text string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(text, n) {
			return true
		}
	}
	return false
}

// TestSuffixedTitleNeverExceedsTheCap pins the "(n)" rule at the boundary the
// review found open: a file whose extension is nearly the whole cap used to
// push the result past it, because the one-rune floor of trimTitleRunes kept a
// base rune beside a suffix and an extension that already filled the budget.
// Every extension length must yield a name within the kind's cap with the
// suffix intact.
func TestSuffixedTitleNeverExceedsTheCap(t *testing.T) {
	for _, tc := range []struct {
		name     string
		kind     string
		extRunes int
	}{
		{name: "no extension", kind: DocumentKindPage, extRunes: 0},
		{name: "extension well inside the cap", kind: DocumentKindFile, extRunes: 4},
		{name: "extension at cap minus the suffix", kind: DocumentKindFile, extRunes: maxDocumentTitle - 5},
		{name: "extension one short of the cap", kind: DocumentKindFile, extRunes: maxDocumentTitle - 2},
		{name: "extension at the cap", kind: DocumentKindFile, extRunes: maxDocumentTitle},
		{name: "extension over the cap", kind: DocumentKindFile, extRunes: maxDocumentTitle + 40},
		{name: "a folder has no extension", kind: DocumentKindFolder, extRunes: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cap := documentTitleLimit(tc.kind)
			ext := ""
			if tc.extRunes > 0 {
				ext = "." + strings.Repeat("x", tc.extRunes-1)
			}
			base := strings.Repeat("b", cap) + ext
			out := suffixedTitle(tc.kind, base, 2)
			if n := utf8.RuneCountInString(out); n > cap {
				t.Errorf("suffixedTitle(%s, %d-rune extension) = %d runes, over the %d cap: %q",
					tc.kind, tc.extRunes, n, cap, out)
			}
			// The suffix is never cut; a file keeps whatever of its extension
			// fits after it, so the name ends in the extension only when the
			// extension was kept.
			if at := strings.Index(out, " (2)"); at < 0 {
				t.Errorf("suffixedTitle(%s, %d-rune extension) = %q, want the suffix kept",
					tc.kind, tc.extRunes, out)
			} else if rest := out[at+len(" (2)"):]; rest != "" && rest != ext {
				t.Errorf("suffixedTitle(%s, %d-rune extension) = %q, want only the extension after the suffix",
					tc.kind, tc.extRunes, out)
			}
		})
	}
}
