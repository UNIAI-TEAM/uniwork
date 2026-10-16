package service

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1305 item C, review round 1: what can_save says, that the byte path
// (Open, Save) refuses exactly what the list refuses and answers it as
// not_found, and the diacritic-insensitive name search.

func TestDocumentSourceSaveable(t *testing.T) {
	const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	cases := []struct {
		name string
		ext  string
		mime string
		size int64
		want bool
	}{
		{"pdf", "pdf", "application/pdf", 1 << 20, true},
		{"docx", "docx", docx, 1, true},
		{"image", "png", "image/png", 5000, true},
		{"markdown", "md", "text/markdown", 10, true},
		{"text", "txt", "text/plain", 10, true},
		{"css stored as text", "css", "text/plain", 10, true},
		{"exactly the cap", "pdf", "application/pdf", 200 << 20, true},
		{"over the cap", "pdf", "application/pdf", 200<<20 + 1, false},
		{"empty", "pdf", "application/pdf", 0, false},
		{"meeting recording", "mp4", "video/mp4", 10 << 20, false},
		{"webm recording", "webm", "video/webm", 10 << 20, false},
		{"zip", "zip", "application/zip", 100, false},
		{"csv", "csv", "text/csv", 100, false},
		{"csv stored as text", "csv", "text/plain", 100, false},
		{"ndjson stored as text", "ndjson", "text/plain", 100, false},
		{"bmp", "bmp", "image/bmp", 100, false},
		{"mail part with a generic type, by extension", "docx", "application/octet-stream", 100, true},
		{"mail part with no type, by extension", "pdf", "", 100, true},
		{"mail part with a generic type and an unknown extension", "bin", "application/octet-stream", 100, false},
		{"parameters are ignored", "pdf", "application/pdf; charset=binary", 100, true},
	}
	for _, c := range cases {
		if got := documentSourceSaveable(documentFilePolicyFor(nil), c.ext, c.mime, c.size); got != c.want {
			t.Errorf("%s: documentSourceSaveable(%q, %q, %d) = %v, want %v", c.name, c.ext, c.mime, c.size, got, c.want)
		}
	}
	if err := errSourceNotSaveable(); !errors.As(err, new(CodedError)) {
		t.Fatalf("not-saveable refusal is not coded: %v", err)
	} else {
		var ce CodedError
		_ = errors.As(err, &ce)
		if ce.Code != "source_not_saveable" || ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("refusal = %s/%d, want source_not_saveable/422", ce.Code, ce.Status)
		}
	}
}

func TestDocumentSizeCapAndTooLargeFields(t *testing.T) {
	// Default DocumentService and DocumentOfficeService read the 200 MiB default.
	docs := &DocumentService{}
	if got := docs.fileLimits().TextScanBytes; got != 200<<20 {
		t.Fatalf("default DocumentService.fileLimits().TextScanBytes = %d, want %d", got, int64(200<<20))
	}
	officeSvc := &DocumentOfficeService{}
	if got := officeSvc.documentFileMaxBytes(); got != 200<<20 {
		t.Fatalf("default DocumentOfficeService.documentFileMaxBytes() = %d, want %d", got, int64(200<<20))
	}

	// Custom DocumentMaxBytes on the files service propagates to both.
	const customCap int64 = 12 << 20
	fake := filesfake.New(filesfake.Options{DocumentMaxBytes: customCap})
	docs.SetFiles(fake)
	officeSvc.files = fake
	if got := docs.fileLimits().TextScanBytes; got != customCap {
		t.Fatalf("configured DocumentService.fileLimits().TextScanBytes = %d, want %d", got, customCap)
	}
	if got := officeSvc.documentFileMaxBytes(); got != customCap {
		t.Fatalf("configured DocumentOfficeService.documentFileMaxBytes() = %d, want %d", got, customCap)
	}

	// documentFileError on CodeTooLarge carries fields.max_bytes.
	err := documentFileError(files.TooLarge(customCap))
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("documentFileError(TooLarge) = %T %v, want CodedError", err, err)
	}
	if ce.Status != http.StatusRequestEntityTooLarge || ce.Code != "file_too_large" || ce.Fields["max_bytes"] != customCap {
		t.Fatalf("documentFileError(TooLarge) = %+v, want 413 file_too_large with max_bytes=%d", ce, customCap)
	}
}

func TestHideSourceRefusal(t *testing.T) {
	for name, err := range map[string]error{
		"forbidden":   ErrForbidden,
		"coded 403":   CodedError{Code: "chat_forbidden", Status: http.StatusForbidden},
		"coded 404":   CodedError{Code: "x", Status: http.StatusNotFound},
		"not found":   ErrNotFound,
		"wrapped 403": errors.Join(errors.New("ctx"), CodedError{Code: "x", Status: http.StatusForbidden}),
	} {
		if got := hideSourceRefusal(err); !errors.Is(got, ErrNotFound) && name != "not found" {
			t.Errorf("%s: refusal leaks as %v", name, got)
		}
	}
	boom := errors.New("storage down")
	if got := hideSourceRefusal(boom); !errors.Is(got, boom) {
		t.Fatalf("an ordinary failure was rewritten to %v", got)
	}
	if got := hideSourceRefusal(CodedError{Code: "storage_unavailable", Status: http.StatusServiceUnavailable}); errors.Is(got, ErrNotFound) {
		t.Fatal("a 503 was turned into not_found")
	}
}

// The byte path never admits a row the list would not show: every refusal the
// review named answers not_found on Open and on Save, while the people the
// domain admits get through the same lookup.
func TestDocumentSourceByteRefusalsAreNotFound(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn

	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)
	publicMsg := s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "public.pdf", false)
	private := s.room(tn.orgID, tn.wsA, "channel", "private", "", false)
	s.roomMember(tn.orgID, tn.wsA, private, tn.owner.ID, "active")
	privateMsg := s.fileMessage(tn.orgID, tn.wsA, private, tn.owner.ID, "private.pdf", false)
	dm := s.room(tn.orgID, tn.wsA, "dm", "private", tn.owner.ID+"|"+tn.aclOwner.ID, false)
	s.roomMember(tn.orgID, tn.wsA, dm, tn.owner.ID, "active")
	s.roomMember(tn.orgID, tn.wsA, dm, tn.aclOwner.ID, "active")
	// A stray member row outside the DM's member set is not a way in.
	s.roomMember(tn.orgID, tn.wsA, dm, tn.wsAdmin.ID, "active")
	dmMsg := s.fileMessage(tn.orgID, tn.wsA, dm, tn.owner.ID, "dm.pdf", false)
	group := s.room(tn.orgID, tn.wsA, "group", "private", "", false)
	s.roomMember(tn.orgID, tn.wsA, group, tn.member.ID, "active")
	groupMsg := s.fileMessage(tn.orgID, tn.wsA, group, tn.member.ID, "group.pdf", false)
	taskA := s.task(tn, tn.wsA)
	att := s.attachment(tn, tn.wsA, taskA, "", "task.pdf")

	admitted := []struct {
		who   string
		as    db.User
		ws    string
		srcID string
	}{
		{"any member, public channel", tn.member, tn.wsA, "chat:" + publicMsg},
		{"private channel member", tn.owner, tn.wsA, "chat:" + privateMsg},
		{"dm peer", tn.aclOwner, tn.wsA, "chat:" + dmMsg},
		{"group member", tn.member, tn.wsA, "chat:" + groupMsg},
		{"dm member, read from the organization's other workspace", tn.owner, tn.wsB, "chat:" + dmMsg},
		{"workspace member, task file", tn.member, tn.wsA, "task:" + att},
	}
	for _, c := range admitted {
		ws, err := svc.gate(s.ctx, human(c.as), c.ws)
		if err != nil {
			t.Fatalf("%s: gate: %v", c.who, err)
		}
		if _, err := svc.lookup(s.ctx, human(c.as), ws, c.srcID); err != nil {
			t.Errorf("%s: lookup of %s = %v, want the row", c.who, c.srcID, err)
		}
	}

	refused := []struct {
		who   string
		as    db.User
		ws    string
		srcID string
	}{
		{"private channel non-member", tn.member, tn.wsA, "chat:" + privateMsg},
		{"member row outside the dm set", tn.wsAdmin, tn.wsA, "chat:" + dmMsg},
		{"workspace member outside the group", tn.creator, tn.wsA, "chat:" + groupMsg},
		{"organization member in no workspace", tn.outsider, tn.wsA, "chat:" + publicMsg},
		{"workspace B member, workspace A's channel", tn.bMember, tn.wsB, "chat:" + publicMsg},
		{"workspace B member, a dm they are not in", tn.bMember, tn.wsB, "chat:" + dmMsg},
		{"workspace B member, a workspace A task file", tn.bMember, tn.wsB, "task:" + att},
		{"another organization's owner", s.other.owner, s.other.wsA, "chat:" + publicMsg},
		{"unknown source prefix", tn.member, tn.wsA, "drive:" + att},
		{"no row id", tn.member, tn.wsA, "chat:"},
		{"no prefix", tn.member, tn.wsA, att},
		{"a row id of another source", tn.member, tn.wsA, "chat:" + att},
	}
	for _, c := range refused {
		_, err := svc.Open(s.ctx, human(c.as), c.ws, c.srcID)
		if c.as.ID == tn.outsider.ID || c.as.ID == s.other.owner.ID {
			// Not a member of the workspace at all: the workspace gate answers
			// first, which says nothing about any file.
			if err == nil {
				t.Errorf("%s: Open succeeded", c.who)
			}
		} else if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: Open = %v, want not_found", c.who, err)
		}
		_, err = svc.Save(s.ctx, human(c.as), c.ws, c.srcID, SaveSourceFileInput{IdempotencyKey: util.NewID()})
		if c.as.ID == tn.outsider.ID || c.as.ID == s.other.owner.ID {
			if err == nil {
				t.Errorf("%s: Save succeeded", c.who)
			}
		} else if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: Save = %v, want not_found", c.who, err)
		}
	}
}

// A deactivated organization member keeps their workspace row but the gate
// refuses them on every source route before any query runs.
func TestDocumentSourceDeactivatedMemberIsRefused(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)
	msg := s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "public.pdf", false)
	taskA := s.task(tn, tn.wsA)
	att := s.attachment(tn, tn.wsA, taskA, "", "task.pdf")

	if _, err := svc.List(s.ctx, human(tn.deact), tn.wsA, DocumentSourceFilter{}); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("List = %v, want member_deactivated", err)
	}
	for _, id := range []string{"chat:" + msg, "task:" + att} {
		if _, err := svc.Open(s.ctx, human(tn.deact), tn.wsA, id); !errors.Is(err, ErrMemberDeactivated) {
			t.Fatalf("Open %s = %v, want member_deactivated", id, err)
		}
		if _, err := svc.Save(s.ctx, human(tn.deact), tn.wsA, id, SaveSourceFileInput{}); !errors.Is(err, ErrMemberDeactivated) {
			t.Fatalf("Save %s = %v, want member_deactivated", id, err)
		}
	}
	// An agent never reads other domains' files through this surface.
	if _, err := svc.List(s.ctx, agentActor(tn.agent), tn.wsA, DocumentSourceFilter{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent List = %v, want forbidden", err)
	}
}

// Email Hub resolves a source id through its list query with row_id, so a
// lookup is as strict as a list: another person's mailbox and another
// organization are query misses. (The Email Hub service is not wired in the
// service scene, so the query is called directly.)
func TestDocumentSourceRowLookupIsTheGate(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn

	acc := s.emailAccount(tn, tn.member)
	th := s.emailThread(tn, acc, "INBOX", 1, "<one@example.com>", time.Now())
	att := s.emailAttachment(tn, acc.ID, th, "mail.pdf", "2", 4)
	byRow := func(orgID string, viewer db.User) int {
		rows, err := s.f.q.ListDocumentSourceEmailFiles(s.ctx, db.ListDocumentSourceEmailFilesParams{
			TypeExts: []string{}, RowLimit: 1, ViewerID: viewer.ID, OrganizationID: orgID, RowID: nullText(att),
		})
		if err != nil {
			t.Fatal(err)
		}
		return len(rows)
	}
	if byRow(tn.orgID, tn.member) != 1 {
		t.Fatal("the mailbox owner cannot look up their own attachment")
	}
	if byRow(tn.orgID, tn.owner) != 0 || byRow(tn.orgID, tn.wsAdmin) != 0 {
		t.Fatal("someone else's mailbox attachment resolved by id")
	}
	if byRow(s.other.orgID, s.other.owner) != 0 || byRow(s.other.orgID, tn.member) != 0 {
		t.Fatal("an email attachment resolved in another organization")
	}
}
