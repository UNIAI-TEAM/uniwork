package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-1859 review r2 (R1-2, R1-4): the configured DOCUMENT_MAX_BYTES is the
// one ceiling, and it must reach the source-save preflight and the document
// validation scan, not just the upload.

// fakeDocStorageEnvWithCap wires the storage env's DocumentService to a fake
// whose document_file policy carries a non-default cap.
func fakeDocStorageEnvWithCap(t *testing.T, cap int64) *docStorageEnv {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	env.fake = filesfake.New(filesfake.Options{DocumentMaxBytes: cap})
	env.fs = env.fake
	env.svc.SetFiles(env.fake)
	return env
}

// canSave reads the can_save verdict of one listed row.
func canSave(t *testing.T, svc *DocumentSourceService, ctx context.Context, actor Actor, wsID, sourceID string) bool {
	t.Helper()
	page, err := svc.List(ctx, actor, wsID, DocumentSourceFilter{Source: DocumentSourceTask})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range page.Items {
		if it.ID == sourceID {
			return it.CanSave
		}
	}
	t.Fatalf("%s is not listed", sourceID)
	return false
}

func TestDocumentSourceSaveFollowsTheConfiguredCap(t *testing.T) {
	t.Run("a cap raised past 200 MiB saves a source it accepts", func(t *testing.T) {
		env := fakeDocStorageEnvWithCap(t, 256<<20)
		s := newSourceSceneOn(t, env)
		svc, store := sourceService(t, env)
		tn := env.tn
		taskA := s.task(tn, tn.wsA)
		big := s.attachmentWith(tn, tn.wsA, taskA, "big.pdf", "application/pdf", 201<<20, "")
		over := s.attachmentWith(tn, tn.wsA, taskA, "over.pdf", "application/pdf", 256<<20+1, "")
		store.objects["workspaces/"+tn.wsA+"/attachments/"+big+"/big.pdf"] = pdfBody("raised-cap")

		if !canSave(t, svc, s.ctx, human(tn.member), tn.wsA, "task:"+big) {
			t.Fatal("a 201 MiB source is saveable under a 256 MiB cap")
		}
		if canSave(t, svc, s.ctx, human(tn.member), tn.wsA, "task:"+over) {
			t.Fatal("a source over the configured cap must not be saveable")
		}
		res, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+big,
			SaveSourceFileInput{IdempotencyKey: util.NewID()})
		if err != nil {
			t.Fatalf("save under the configured cap: %v", err)
		}
		if res.Document.Kind != DocumentKindFile {
			t.Fatalf("saved document = %+v", res.Document)
		}
		// The configured cap refuses before the source bytes are opened: no
		// object sits in the store for the refused row.
		_, err = svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+over,
			SaveSourceFileInput{IdempotencyKey: util.NewID()})
		if ce := wantCode(t, err, "source_not_saveable"); ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", ce.Status)
		}
	})

	t.Run("a cap below 200 MiB refuses and hides a source it rejects", func(t *testing.T) {
		env := fakeDocStorageEnvWithCap(t, 1<<20)
		s := newSourceSceneOn(t, env)
		svc, store := sourceService(t, env)
		tn := env.tn
		taskA := s.task(tn, tn.wsA)
		allowed := s.attachmentWith(tn, tn.wsA, taskA, "ok.pdf", "application/pdf", 12, "")
		big := s.attachmentWith(tn, tn.wsA, taskA, "big.pdf", "application/pdf", 2<<20, "")
		store.objects["workspaces/"+tn.wsA+"/attachments/"+allowed+"/ok.pdf"] = pdfBody("lowered-cap")

		if canSave(t, svc, s.ctx, human(tn.member), tn.wsA, "task:"+big) {
			t.Fatal("a 2 MiB source is not saveable under a 1 MiB cap")
		}
		if !canSave(t, svc, s.ctx, human(tn.member), tn.wsA, "task:"+allowed) {
			t.Fatal("a 12 byte pdf is saveable under a 1 MiB cap")
		}
		_, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+big,
			SaveSourceFileInput{IdempotencyKey: util.NewID()})
		if ce := wantCode(t, err, "source_not_saveable"); ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", ce.Status)
		}
		if _, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+allowed,
			SaveSourceFileInput{IdempotencyKey: util.NewID()}); err != nil {
			t.Fatalf("save of an allowed source: %v", err)
		}
	})
}

// generatedText produces `size` bytes of valid text, with `defect` written at
// offset `at` (-1 for none), without holding a buffer. The fake FileService
// sniffs the head as text/plain and validateText scans the rest.
type generatedText struct {
	off, size, at int64
	defect        byte
}

func (r *generatedText) Read(p []byte) (int, error) {
	if r.off >= r.size {
		return 0, io.EOF
	}
	n := int64(len(p))
	if left := r.size - r.off; n > left {
		n = left
	}
	for i := int64(0); i < n; i++ {
		if r.off+i == r.at {
			p[i] = r.defect
		} else {
			p[i] = 'a'
		}
	}
	r.off += n
	return int(n), nil
}

func TestDocumentTextValidationScansPastTheRetiredClamp(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	const pastClamp = 50<<20 + 1

	upload := func(t *testing.T, at int64, defect byte) error {
		t.Helper()
		_, err := env.svc.CreateFileDocument(ctx, member, env.tn.wsA, CreateFileDocumentInput{
			Title: "Log " + util.NewID()[20:], Filename: "log.txt",
			Body:           &generatedText{size: pastClamp, at: at, defect: defect},
			IdempotencyKey: util.NewID(),
		})
		return err
	}

	// A defect that lands after the old 50 MiB scan clamp must still refuse.
	for name, c := range map[string]struct {
		at     int64
		defect byte
		reason string
	}{
		"nul byte":      {at: 50 << 20, defect: 0x00, reason: "text_binary"},
		"invalid utf-8": {at: 50 << 20, defect: 0xFF, reason: "text_not_utf8"},
	} {
		t.Run(name, func(t *testing.T) {
			err := upload(t, c.at, c.defect)
			var ce CodedError
			if !errors.As(err, &ce) || ce.Status != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %v, want 415", err)
			}
			if ce.Fields["reason"] != c.reason {
				t.Fatalf("reason = %v, want %s (%v)", ce.Fields["reason"], c.reason, err)
			}
		})
	}

	// The same-size control of valid text passes the same path.
	if err := upload(t, -1, 0); err != nil {
		t.Fatalf("valid text past the retired clamp: %v", err)
	}
}
