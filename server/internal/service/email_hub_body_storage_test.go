package service

import (
	"context"
	"io"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/emailhub/bodystore"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestEmailHubBodyOnObjectStorageMode(t *testing.T) {
	t.Setenv("EMAIL_HUB_BODY_STORAGE", "s3")
	t.Setenv("STORAGE_BACKEND", "s3")
	svc := &EmailHubService{store: newMemStorage()}
	if !svc.bodyOnObjectStorage() {
		t.Fatal("expected s3 body mode")
	}
}

type memStorageGet struct {
	memStorage
}

func (m *memStorageGet) GetReader(_ context.Context, key string) (io.ReadCloser, error) {
	data, ok := m.objects[key]
	if !ok {
		return nil, io.EOF
	}
	return io.NopCloser(bytesReader(data)), nil
}

type bytesReader []byte

func (b bytesReader) Read(p []byte) (int, error) {
	if len(b) == 0 {
		return 0, io.EOF
	}
	n := copy(p, b)
	return n, io.EOF
}

func TestHydrateThreadBodyFromObject(t *testing.T) {
	mem := &memStorageGet{memStorage: *newMemStorage()}
	key := bodystore.ObjectKey("acc", "thr")
	data, err := bodystore.Encode("text", "<b>x</b>")
	if err != nil {
		t.Fatal(err)
	}
	mem.objects[key] = data

	svc := &EmailHubService{store: mem}
	view := EmailHubThreadView{BodyCached: true}
	row := db.EmailHubThread{BodyObjectKey: key, BodyCached: true}

	if err := svc.hydrateThreadBodyFromObject(context.Background(), &view, row); err != nil {
		t.Fatal(err)
	}
	if view.BodyText != "text" || view.BodyHTML != "<b>x</b>" {
		t.Fatalf("got text=%q html=%q", view.BodyText, view.BodyHTML)
	}
}
