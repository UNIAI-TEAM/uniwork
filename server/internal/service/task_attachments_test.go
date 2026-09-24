package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestUploadListGetOpenDeleteAttachment(t *testing.T) {
	s, store, events, ua, ub, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Với đính kèm"})
	if err != nil {
		t.Fatal(err)
	}

	body := []byte("# hello\n")
	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "note.md", "text/markdown", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if att.ID == "" || att.Filename != "note.md" || att.ContentType != "text/markdown" || att.SizeBytes != int64(len(body)) {
		t.Fatalf("upload = %+v", att)
	}
	wantKey := "workspaces/" + w.ID + "/attachments/" + att.ID + "/note.md"
	if att.ObjectKey != wantKey {
		t.Fatalf("object_key = %q, want %q", att.ObjectKey, wantKey)
	}
	if !bytes.Equal(store.objects[att.ObjectKey], body) {
		t.Fatalf("stored body = %q", store.objects[att.ObjectKey])
	}

	listed, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != att.ID {
		t.Fatalf("list = %+v", listed)
	}

	got, err := s.GetAttachment(ctx, Human(ua.ID), att.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != att.ID {
		t.Fatalf("get = %+v", got)
	}

	meta, r, err := s.OpenAttachmentContent(ctx, Human(ua.ID), att.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if meta.ID != att.ID {
		t.Fatalf("open meta = %+v", meta)
	}
	read, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(read, body) {
		t.Fatalf("content = %q", read)
	}

	if _, err := s.GetAttachment(ctx, Human(ub.ID), att.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member get: %v", err)
	}
	if _, err := s.ListTaskAttachments(ctx, Human(ub.ID), task.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member list: %v", err)
	}

	if err := s.DeleteAttachment(ctx, Human(ua.ID), att.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.objects[att.ObjectKey]; ok {
		t.Fatal("storage object still present after delete")
	}
	if _, err := s.GetAttachment(ctx, Human(ua.ID), att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}

	drained := events.drain(t)
	want := map[string]bool{"attachment.uploaded": true, "attachment.deleted": true}
	for _, e := range drained {
		delete(want, e.Type)
	}
	for topic := range want {
		t.Fatalf("missing outbox topic %s in %#v", topic, drained)
	}
}

func TestUploadAttachmentRejectsOversizeAndBadMIME(t *testing.T) {
	s, _, _, ua, _, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Cap"})
	if err != nil {
		t.Fatal(err)
	}

	over := int64(MaxAttachmentBytes + 1)
	_, err = s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "big.bin", "application/pdf", over, strings.NewReader("x"))
	var coded CodedError
	if !errors.As(err, &coded) || coded.Status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize: %v", err)
	}

	_, err = s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "evil.exe", "application/x-msdownload", 4, strings.NewReader("MZ\x00\x00"))
	if !errors.As(err, &coded) || coded.Status != http.StatusBadRequest {
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("bad mime: %v", err)
		}
	}
}

func TestStageAttachmentAndBindAtomicallyOnTaskCreate(t *testing.T) {
	s, _, _, ua, _, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	body := []byte("# draft\n")

	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "draft.md", "text/markdown", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if att.TaskID.Valid {
		t.Fatalf("staged attachment unexpectedly bound to %q", att.TaskID.String)
	}

	task, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{
		Title: "With staged file", AttachmentIDs: []string{att.ID},
	}, "create-with-attachment")
	if err != nil {
		t.Fatal(err)
	}
	listed, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != att.ID || listed[0].TaskID.String != task.ID {
		t.Fatalf("bound attachments = %+v", listed)
	}
}

func TestCreateTaskRejectsForeignOrAlreadyBoundAttachment(t *testing.T) {
	s, _, _, ua, _, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	body := []byte("x")
	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "one.txt", "text/plain", 1, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "First", AttachmentIDs: []string{att.ID}}, "first-with-attachment")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Second", AttachmentIDs: []string{att.ID}}, "second-with-attachment")
	if err == nil {
		t.Fatalf("already-bound attachment from %s was accepted", first.ID)
	}
}

func TestStagedAttachmentIsPrivateToUploader(t *testing.T) {
	s, _, _, ua, ub, w := taskFixtureWithStorage(t)
	ctx := context.Background()
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: ub.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "private.txt", "text/plain", 1, strings.NewReader("x"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetAttachment(ctx, Human(ub.ID), att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other member read staged attachment: %v", err)
	}
	if err := s.DeleteAttachment(ctx, Human(ub.ID), att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other member deleted staged attachment: %v", err)
	}
}
