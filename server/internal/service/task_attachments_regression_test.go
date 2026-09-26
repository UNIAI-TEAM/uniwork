package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Step 0 regression tests for the task/comment attachment + avatar module
// (UNI-744, plan T6). They pin what the legacy path does today so the
// FileService migration has to keep it green or change the assertion in the
// same PR, on purpose.

// makeRegressionPNG renders a real 1x1 PNG: the description-image case needs
// bytes a browser can load, not a payload that only sniffs as an image.
func makeRegressionPNG(t *testing.T, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, c)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// twoOrgAttachmentFixture: A owns org-alpha/ws-alpha, B owns a second
// organization and shares no workspace with A. That is the "a user of another
// org guesses the id / URL" case the Step 0 contract asks for.
func twoOrgAttachmentFixture(t *testing.T) (*TaskService, *memStorage, db.User, db.User, db.Workspace) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "attach-a@example.com", "A")
	ub := registerVerified(t, q, as, "attach-b@example.com", "B")
	orgA, err := orgs.Create(ctx, ua.ID, "Org Alpha", "org-alpha")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, ua.ID, orgA.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := orgs.Create(ctx, ub.ID, "Org Beta", "org-beta"); err != nil {
		t.Fatal(err)
	}
	store := newMemStorage()
	return NewTaskService(pool, q, ws, store), store, ua, ub, v.Workspace
}

// Removing one of many attachments removes exactly that row and object; the
// siblings keep their rows and their bytes. Pins the legacy per-file delete.
func TestRemoveOneOfManyTaskAttachments(t *testing.T) {
	s, store, _, ua, _, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Nhieu dinh kem"})
	if err != nil {
		t.Fatal(err)
	}

	files := []string{"one.txt", "two.txt", "three.txt"}
	bodies := [][]byte{[]byte("one\n"), []byte("two\n"), []byte("three\n")}
	atts := make([]db.Attachment, 0, len(files))
	for i, name := range files {
		att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, name, "text/plain", int64(len(bodies[i])), bytes.NewReader(bodies[i]))
		if err != nil {
			t.Fatalf("upload %s: %v", name, err)
		}
		atts = append(atts, att)
	}

	if err := s.DeleteAttachment(ctx, Human(ua.ID), atts[1].ID); err != nil {
		t.Fatalf("delete middle attachment: %v", err)
	}
	if _, ok := store.objects[atts[1].ObjectKey]; ok {
		t.Fatal("storage object of the deleted attachment is still present")
	}
	if _, err := s.GetAttachment(ctx, Human(ua.ID), atts[1].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted attachment still readable: %v", err)
	}

	listed, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].ID != atts[0].ID || listed[1].ID != atts[2].ID {
		t.Fatalf("list after removing one of many = %+v", listed)
	}
	for _, i := range []int{0, 2} {
		_, r, err := s.OpenAttachmentContent(ctx, Human(ua.ID), atts[i].ID)
		if err != nil {
			t.Fatalf("open %s after sibling delete: %v", files[i], err)
		}
		got, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil || !bytes.Equal(got, bodies[i]) {
			t.Fatalf("content %s = %q (%v)", files[i], got, err)
		}
	}
}

// A picture embedded in the task description keeps working across a reload:
// the stored body still references the attachment and the bytes still stream.
func TestDescriptionImageAttachmentSurvivesTaskReload(t *testing.T) {
	s, _, _, ua, _, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Anh trong mo ta"})
	if err != nil {
		t.Fatal(err)
	}

	pngBytes := makeRegressionPNG(t, color.NRGBA{R: 0x22, G: 0x66, B: 0xcc, A: 0xff})
	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "shot.png", "image/png", int64(len(pngBytes)), bytes.NewReader(pngBytes))
	if err != nil {
		t.Fatal(err)
	}
	if !att.TaskID.Valid || att.TaskID.String != task.ID {
		t.Fatalf("description upload is not bound to the task: %+v", att)
	}

	desc := "<p>Truoc</p><p><img src=\"/api/v1/attachments/" + att.ID + "/content\" alt=\"shot.png\"></p>"
	if _, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Description: &desc}); err != nil {
		t.Fatalf("update description: %v", err)
	}

	reloaded, err := s.Get(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(reloaded.Description, "/api/v1/attachments/"+att.ID+"/content") {
		t.Fatalf("description lost the image reference: %q", reloaded.Description)
	}
	meta, r, err := s.OpenAttachmentContent(ctx, Human(ua.ID), att.ID)
	if err != nil {
		t.Fatalf("open image after reload: %v", err)
	}
	defer r.Close()
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, pngBytes) {
		t.Fatalf("image bytes after reload = %d bytes, want %d", len(got), len(pngBytes))
	}
	if meta.ContentType != "image/png" {
		t.Fatalf("content type = %q", meta.ContentType)
	}
}

// A comment attachment rides the same task-bound upload today: the composer
// uploads with the task id and the comment body keeps the URL. Pins that the
// reference survives the comment write and that the bytes still stream.
func TestCommentAttachmentStaysReadableAfterCommentSave(t *testing.T) {
	s, _, _, ua, _, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Dinh kem binh luan"})
	if err != nil {
		t.Fatal(err)
	}

	body := []byte("log line\n")
	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "log.txt", "text/plain", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	commentBody := "<p>xem log</p><p><a href=\"/api/v1/attachments/" + att.ID + "/download\">log.txt</a></p>"
	comment, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: commentBody}, "comment-attachment")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.GetComment(ctx, Human(ua.ID), comment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(saved.Body, "/api/v1/attachments/"+att.ID+"/download") {
		t.Fatalf("comment lost the attachment reference: %q", saved.Body)
	}

	_, r, err := s.OpenAttachmentContent(ctx, Human(ua.ID), att.ID)
	if err != nil {
		t.Fatalf("open comment attachment: %v", err)
	}
	defer r.Close()
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("comment attachment bytes = %q", got)
	}

	// Today the row is task-scoped: there is no comment_id binding yet, so the
	// same file also shows in the task attachment list. T6 moves this onto a
	// file_id plus a comment reference provider.
	listed, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != att.ID {
		t.Fatalf("task attachment list = %+v", listed)
	}
}

// Another organization's member guessing the attachment id is refused on every
// read and write path, and nothing they tried changed the attachment.
func TestAttachmentFromAnotherOrganizationIsBlocked(t *testing.T) {
	s, store, ua, ub, w := twoOrgAttachmentFixture(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Tenant"})
	if err != nil {
		t.Fatal(err)
	}
	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "secret.txt", "text/plain", 7, strings.NewReader("secret\n"))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.GetAttachment(ctx, Human(ub.ID), att.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-org metadata read = %v, want forbidden", err)
	}
	if meta, r, err := s.OpenAttachmentContent(ctx, Human(ub.ID), att.ID); !errors.Is(err, ErrForbidden) || r != nil || meta.ID != "" {
		t.Fatalf("cross-org content read = meta %+v reader %v err %v, want forbidden", meta, r, err)
	}
	if err := s.DeleteAttachment(ctx, Human(ub.ID), att.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-org delete = %v, want forbidden", err)
	}
	if _, err := s.ListTaskAttachments(ctx, Human(ub.ID), task.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-org list = %v, want forbidden", err)
	}

	got, err := s.GetAttachment(ctx, Human(ua.ID), att.ID)
	if err != nil || got.ID != att.ID {
		t.Fatalf("owner read after blocked guesses: %+v %v", got, err)
	}
	if _, ok := store.objects[att.ObjectKey]; !ok {
		t.Fatal("blocked cross-org calls changed storage")
	}
}
