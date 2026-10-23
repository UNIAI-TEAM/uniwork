package service

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1305 item C, review round 1: seeds and tests for can_save, the
// description-image and email row rules, and the diacritic-insensitive search.
// The byte-path refusal tests are in document_sources_gate_test.go.

// newSourceSceneOn is a scene on the storage env's tenant with a second
// organization beside it.
func newSourceSceneOn(t *testing.T, env *docStorageEnv) *sourceScene {
	t.Helper()
	return &sourceScene{
		t: t, ctx: env.f.ctx, f: env.f, tn: env.tn,
		other: env.f.tenant(t, "srx"+strings.ToLower(util.NewID()[20:])),
	}
}

func (s *sourceScene) emailAccount(tn docTenant, owner db.User) db.EmailHubAccount {
	s.t.Helper()
	acc, err := s.f.q.CreateEmailHubAccount(s.ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: owner.ID, OrganizationID: tn.orgID, EmailAddress: strings.ToLower(util.NewID()) + "@example.com",
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password", PasswordEnc: "x",
	})
	if err != nil {
		s.t.Fatal(err)
	}
	return acc
}

// emailThread seeds one synced message (a thread row is one message of one
// folder); messageID "" leaves the Message-ID unset.
func (s *sourceScene) emailThread(tn docTenant, acc db.EmailHubAccount, folder string, uid int32, messageID string, sentAt time.Time) string {
	s.t.Helper()
	th, err := s.f.q.UpsertEmailHubThread(s.ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: tn.orgID, Folder: folder, ImapUid: uid,
		MessageID: nullableText(messageID), Subject: "Mail", FromAddr: "sender@example.com", ToAddrs: []string{acc.EmailAddress},
		SentAt: pgtype.Timestamptz{Time: sentAt, Valid: true}, HasAttachments: true,
		ImapLabels: []string{}, ConversationKey: "conv-" + util.NewID(),
	})
	if err != nil {
		s.t.Fatal(err)
	}
	return th.ID
}

func nullableText(v string) pgtype.Text { return pgtype.Text{String: v, Valid: v != ""} }

func (s *sourceScene) emailAttachment(tn docTenant, accountID, threadID, filename, part string, size int64) string {
	s.t.Helper()
	att, err := s.f.q.CreateEmailHubAttachment(s.ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: threadID, AccountID: accountID, OrganizationID: tn.orgID,
		Filename: filename, MimeType: "application/pdf", SizeBytes: size, PartID: part,
	})
	if err != nil {
		s.t.Fatal(err)
	}
	return att.ID
}

// attachmentWith seeds a task attachment of the given type and size, with an
// optional upload purpose (NULL for a legacy row).
func (s *sourceScene) attachmentWith(tn docTenant, wsID, taskID, name, mime string, size int64, purpose string) string {
	s.t.Helper()
	id := util.NewID()
	s.exec(`INSERT INTO attachments (id, organization_id, workspace_id, task_id, uploader_type, uploader_id, object_key, filename, content_type, size_bytes, purpose)
		VALUES ($1, $2, $3, $4, 'member', $5, $6, $7, $8, $9, $10)`,
		id, tn.orgID, wsID, taskID, tn.owner.ID, "workspaces/"+wsID+"/attachments/"+id+"/"+name, name, mime, size, nullableText(purpose))
	return id
}

func (s *sourceScene) emailIDs(tn docTenant, viewer db.User) map[string]db.ListDocumentSourceEmailFilesRow {
	s.t.Helper()
	rows, err := s.f.q.ListDocumentSourceEmailFiles(s.ctx, db.ListDocumentSourceEmailFilesParams{
		TypeExts: []string{}, RowLimit: 100, ViewerID: viewer.ID, OrganizationID: tn.orgID,
	})
	if err != nil {
		s.t.Fatal(err)
	}
	out := map[string]db.ListDocumentSourceEmailFilesRow{}
	for _, r := range rows {
		out[r.RowID] = r
	}
	return out
}

// can_save is on every listed row and Save refuses what the upload would
// refuse with a coded 422 before it reads a byte.
func TestDocumentSourceSaveRefusesWhatTheUploadWouldRefuse(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, store := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	pdf := s.attachmentWith(tn, tn.wsA, taskA, "ok.pdf", "application/pdf", 12, "")
	video := s.attachmentWith(tn, tn.wsA, taskA, "demo.mp4", "video/mp4", 12, "")
	big := s.attachmentWith(tn, tn.wsA, taskA, "big.pdf", "application/pdf", 200<<20+1, "")
	csv := s.attachmentWith(tn, tn.wsA, taskA, "data.csv", "text/csv", 12, "")
	store.objects["workspaces/"+tn.wsA+"/attachments/"+pdf+"/ok.pdf"] = pdfBody("can-save")

	page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Source: DocumentSourceTask})
	if err != nil {
		t.Fatal(err)
	}
	// Only document kinds are sources (UNI-1967): a video or a csv is not
	// listed at all, so it has no can_save to report.
	want := map[string]bool{"task:" + pdf: true, "task:" + big: false}
	for _, it := range page.Items {
		if w, ok := want[it.ID]; ok {
			if it.CanSave != w {
				t.Errorf("%s (%s, %d bytes): can_save = %v, want %v", it.Name, it.MimeType, it.SizeBytes, it.CanSave, w)
			}
			delete(want, it.ID)
		}
	}
	if len(want) != 0 {
		t.Fatalf("rows missing from the list: %v", want)
	}

	// The bytes of the refused rows do not exist in the store: the 422 came
	// before any read, not from a failed one.
	for _, id := range []string{big} {
		_, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+id, SaveSourceFileInput{IdempotencyKey: util.NewID()})
		if ce := wantCode(t, err, "source_not_saveable"); ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", ce.Status)
		}
	}
	for _, id := range []string{video, csv} {
		_, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+id, SaveSourceFileInput{IdempotencyKey: util.NewID()})
		wantNotFound(t, err)
	}
	var docs int
	if err := env.f.pool.QueryRow(s.ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1`, tn.wsA).Scan(&docs); err != nil {
		t.Fatal(err)
	}
	if docs != 0 {
		t.Fatalf("a refused save created %d documents", docs)
	}
	// Download stays open for everything the member may read.
	f, err := svc.Open(s.ctx, human(tn.member), tn.wsA, "task:"+pdf)
	if err != nil {
		t.Fatal(err)
	}
	_ = f.Body.Close()
	if f.Size != 12 {
		t.Fatalf("size = %d, want the listed 12 bytes", f.Size)
	}
}

// A save names its parent before any byte is read: a parent the caller cannot
// put a document under answers as the upload's pre-flight does. No object
// sits in the store, so a read would fail with something other than not_found.
func TestDocumentSourceSaveChecksTheParentFirst(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	att := s.attachmentWith(tn, tn.wsA, taskA, "ok.pdf", "application/pdf", 12, "")
	_, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+att, SaveSourceFileInput{ParentID: util.NewID(), IdempotencyKey: util.NewID()})
	wantNotFound(t, err)
}

// Description images are part of a task's description, not attached files;
// a legacy row (no purpose) and the file purposes stay listed.
func TestDocumentSourceTaskListSkipsDescriptionImages(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn
	taskA := s.task(tn, tn.wsA)
	file := s.attachmentWith(tn, tn.wsA, taskA, "file.pdf", "application/pdf", 5, "task_attachment")
	legacy := s.attachmentWith(tn, tn.wsA, taskA, "legacy.pdf", "application/pdf", 5, "")
	comment := s.attachmentWith(tn, tn.wsA, taskA, "comment.pdf", "application/pdf", 5, "task_comment_attachment")
	pasted := s.attachmentWith(tn, tn.wsA, taskA, "image.png", "image/png", 5, "task_description_image")
	got := s.taskIDs(tn, tn.wsA)
	for _, id := range []string{file, legacy, comment} {
		if _, ok := got[id]; !ok {
			t.Errorf("attachment %s is not listed", id)
		}
	}
	if _, ok := got[pasted]; ok {
		t.Error("a pasted description image is listed as a file")
	}
}

// Email rows: parts without a name are not listed, a message synced into two
// folders is listed once (the smallest attachment id), a message without a
// Message-ID never collapses, and the date is the message's.
func TestDocumentSourceEmailSkipsNamelessAndDuplicateParts(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn
	acc := s.emailAccount(tn, tn.member)
	sent := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	inbox := s.emailThread(tn, acc, "INBOX", 1, "<same@example.com>", sent)
	archive := s.emailThread(tn, acc, "Archive", 7, "<same@example.com>", sent)
	first := s.emailAttachment(tn, acc.ID, inbox, "contract.pdf", "2", 100)
	copyInArchive := s.emailAttachment(tn, acc.ID, archive, "contract.pdf", "2", 100)
	nameless := s.emailAttachment(tn, acc.ID, inbox, "", "3", 100)
	blank := s.emailAttachment(tn, acc.ID, inbox, "   ", "4", 100)
	// Another message sharing only the part id is not a copy.
	other := s.emailThread(tn, acc, "INBOX", 2, "<other@example.com>", sent.Add(time.Hour))
	distinct := s.emailAttachment(tn, acc.ID, other, "contract.pdf", "2", 100)
	// Rows without a Message-ID can only be told apart by their own ids.
	noIDa := s.emailThread(tn, acc, "INBOX", 3, "", sent.Add(2*time.Hour))
	noIDb := s.emailThread(tn, acc, "Archive", 3, "", sent.Add(2*time.Hour))
	keepA := s.emailAttachment(tn, acc.ID, noIDa, "memo.pdf", "2", 100)
	keepB := s.emailAttachment(tn, acc.ID, noIDb, "memo.pdf", "2", 100)

	got := s.emailIDs(tn, tn.member)
	listed, skipped := first, copyInArchive
	if copyInArchive < first {
		listed, skipped = copyInArchive, first
	}
	if _, ok := got[listed]; !ok {
		t.Errorf("the copy with the smallest id (%s) is not listed", listed)
	}
	for id, why := range map[string]string{skipped: "the other folder's copy", nameless: "a part without a name", blank: "a blank name"} {
		if _, ok := got[id]; ok {
			t.Errorf("%s is listed (%s)", id, why)
		}
	}
	for _, id := range []string{distinct, keepA, keepB} {
		if _, ok := got[id]; !ok {
			t.Errorf("%s is missing: it is not a copy of another row", id)
		}
	}
	if r := got[listed]; !r.SortAt.Time.Equal(sent) {
		t.Errorf("date = %v, want the message's %v", r.SortAt.Time, sent)
	}
}

// "hop dong" finds "Hợp đồng": the term is folded in Go, the name in SQL, and
// the two folds must be the same function.
func TestDocumentSourceFoldAgreesWithGo(t *testing.T) {
	s := newSourceScene(t)
	samples := []string{
		"Hợp đồng", "HỢP ĐỒNG", "Nguyễn Văn Ân", "ĐẶNG THỊ BÍCH NGỌC",
		"àáảãạăằắẳẵặâầấẩẫậ èéẻẽẹêềếểễệ ìíỉĩị òóỏõọôồốổỗộơờớởỡợ ùúủũụưừứửữự ỳýỷỹỵ đ",
		"ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ ÈÉẺẼẸÊỀẾỂỄỆ ÌÍỈĨỊ ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ ÙÚỦŨỤƯỪỨỬỮỰ ỲÝỶỸỴ Đ",
		"Café Müller ñandú Çelik Škoda Žluťoučký", "  Báo   cáo\tquý  4 ", "report-final_v2.PDF", "",
	}
	for _, in := range samples {
		for _, form := range []norm.Form{norm.NFC, norm.NFD} {
			text := form.String(in)
			var got string
			if err := s.f.pool.QueryRow(s.ctx, `SELECT uw_fold_search($1)`, text).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if want := foldForSearch(text); got != want {
				t.Errorf("uw_fold_search(%q) = %q, foldForSearch = %q", text, got, want)
			}
		}
	}
}

func TestDocumentSourceSearchIgnoresDiacritics(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	hit := s.attachmentWith(tn, tn.wsA, taskA, "Hợp đồng thuê nhà.pdf", "application/pdf", 5, "")
	s.attachmentWith(tn, tn.wsA, taskA, "Báo cáo quý.pdf", "application/pdf", 5, "")
	for _, q := range []string{"hop dong", "HỢP ĐỒNG", "hợp đồng", "hop   dong", "dong thue", "Hop Dong Thue Nha.pdf"} {
		page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Source: DocumentSourceTask, Q: q})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].ID != "task:"+hit {
			t.Errorf("q=%q found %d files, want only %s", q, len(page.Items), hit)
		}
	}
	// A literal percent is not a wildcard.
	page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Source: DocumentSourceTask, Q: "%"})
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("q=%% found %d files (err %v), want none", len(page.Items), err)
	}
}

// Only document files are sources (UNI-1967): a png or a zip attached in Chat
// or a task is not listed, a docx / pdf / txt is, the image and other type
// filters are gone, and opening, viewing or saving an image's id answers
// not_found through the same filtered lookup.
func TestDocumentSourceListsDocumentFilesOnly(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)

	docx := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 5, "")
	pdf := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "spec.PDF", "application/pdf", 5, "")
	txt := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "notes.txt", "text/plain", 5, "")
	taskPNG := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "shot.png", "image/png", 5, "")
	taskZip := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "bundle.zip", "application/zip", 5, "")
	chatPDF := "chat:" + s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "brief.pdf", false)
	chatPNG := "chat:" + s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "photo.png", false)
	chatZip := "chat:" + s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "dump.zip", false)

	page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, it := range page.Items {
		got[it.ID] = true
	}
	for _, id := range []string{docx, pdf, txt, chatPDF} {
		if !got[id] {
			t.Errorf("document source %s is not listed", id)
		}
	}
	for _, id := range []string{taskPNG, taskZip, chatPNG, chatZip} {
		if got[id] {
			t.Errorf("non-document source %s is listed", id)
		}
	}

	for _, typ := range []string{"image", "other"} {
		_, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Type: typ})
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("type=%s: err = %v, want a validation error (400)", typ, err)
		}
	}

	for _, id := range []string{taskPNG, taskZip, chatPNG, chatZip} {
		_, err := svc.Open(s.ctx, human(tn.member), tn.wsA, id)
		wantNotFound(t, err)
		_, _, err = svc.ViewSource(s.ctx, human(tn.member), tn.wsA, id)
		wantNotFound(t, err)
		_, err = svc.Save(s.ctx, human(tn.member), tn.wsA, id, SaveSourceFileInput{IdempotencyKey: util.NewID()})
		wantNotFound(t, err)
	}
	if _, _, err := svc.ViewSource(s.ctx, human(tn.member), tn.wsA, docx); err != nil {
		t.Fatalf("ViewSource of a docx source: %v", err)
	}
}
