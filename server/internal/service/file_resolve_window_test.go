package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// windowSigner records what presignRead asked the storage for.
type windowSigner struct{ last storage.SignOptions }

func (w *windowSigner) SignRead(_ context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	w.last = opts
	return storage.SignedURL{URL: "https://store.example/" + loc.Key + "?sig", Method: "GET"}, nil
}

func (w *windowSigner) SignWrite(context.Context, storage.ObjectLocator, storage.SignOptions) (storage.SignedURL, error) {
	return storage.SignedURL{}, nil
}

func windowRecord(session db.FileUploadSession) fileRecord {
	return fileRecord{
		file: db.File{
			ID: "f1", Storage: "s3", Bucket: pgtype.Text{String: "b", Valid: true}, ObjectKey: "chat/f1",
			OriginalFilename: "anh.jpg", ContentType: pgtype.Text{String: "image/jpeg", Valid: true},
		},
		session: session,
	}
}

// Chat media signs as of the start of the hour (files.ResolveInput.SigningWindow): every read
// in that hour asks the storage for the same signature, and the URL lives 12h from then.
func TestPresignReadSignsAsOfItsWindow(t *testing.T) {
	ctx := context.Background()
	sg := &windowSigner{}
	s := &FileService{signer: sg}
	now := time.Date(2026, 10, 21, 9, 41, 7, 0, time.UTC)
	hour := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)

	_, expires, err := s.presignRead(ctx, windowRecord(db.FileUploadSession{}), files.DispositionInline, now, time.Hour, 0)
	if err != nil {
		t.Fatalf("presignRead: %v", err)
	}
	if !sg.last.SignedAt.Equal(hour) || sg.last.TTL != files.MaxResolveURLTTL || !expires.Equal(hour.Add(files.MaxResolveURLTTL)) {
		t.Fatalf("windowed: signed at %v for %v, expires %v; want %v for 12h", sg.last.SignedAt, sg.last.TTL, expires, hour)
	}
	first := sg.last
	if _, _, err := s.presignRead(ctx, windowRecord(db.FileUploadSession{}), files.DispositionInline, now.Add(15*time.Minute), time.Hour, 0); err != nil {
		t.Fatalf("presignRead later in the hour: %v", err)
	}
	if sg.last != first {
		t.Fatalf("one hour, two signatures: %+v then %+v", first, sg.last)
	}

	// No window: as of now, as before.
	if _, expires, err = s.presignRead(ctx, windowRecord(db.FileUploadSession{}), files.DispositionInline, now, 0, 0); err != nil {
		t.Fatalf("presignRead: %v", err)
	}
	if !sg.last.SignedAt.IsZero() || sg.last.TTL != files.MaxResolveURLTTL || !expires.Equal(now.Add(files.MaxResolveURLTTL)) {
		t.Fatalf("unwindowed: signed at %v for %v, expires %v", sg.last.SignedAt, sg.last.TTL, expires)
	}

	// A staged file's claim window still caps the URL, counted from the signing instant.
	end := now.Add(2 * time.Hour)
	staged := db.FileUploadSession{Status: string(files.SessionStaged), ClaimExpiresAt: pgtype.Timestamptz{Time: end, Valid: true}}
	if _, expires, err = s.presignRead(ctx, windowRecord(staged), files.DispositionInline, now, time.Hour, 0); err != nil {
		t.Fatalf("presignRead staged: %v", err)
	}
	if !expires.Equal(end) || sg.last.TTL != end.Sub(hour) {
		t.Fatalf("staged: expires %v ttl %v; want %v and %v", expires, sg.last.TTL, end, end.Sub(hour))
	}
}
