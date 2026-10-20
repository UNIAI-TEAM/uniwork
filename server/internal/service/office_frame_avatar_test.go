package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type variantSpyFiles struct {
	files.Service
	lastVariant  files.Variant
	overrides    map[files.FileID]files.Reader
	errOverrides map[files.FileID]error
}

func (v *variantSpyFiles) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	v.lastVariant = in.Variant
	if err, ok := v.errOverrides[in.FileID]; ok {
		return files.Reader{}, err
	}
	if rd, ok := v.overrides[in.FileID]; ok {
		return rd, nil
	}
	return v.Service.Open(ctx, in)
}

type sniffErrReadCloser struct {
	prefix []byte
	err    error
	closed bool
}

func (r *sniffErrReadCloser) Read(p []byte) (int, error) {
	if len(r.prefix) > 0 {
		n := copy(p, r.prefix)
		r.prefix = r.prefix[n:]
		return n, nil
	}
	return 0, r.err
}

func (r *sniffErrReadCloser) Close() error {
	r.closed = true
	return nil
}

func attachTestAvatar(t *testing.T, ctx context.Context, q *db.Queries, fs files.Service, userID string, body []byte) files.FileID {
	t.Helper()
	scope := files.Scope{UserID: userID}
	actor := audit.User(userID)
	up, err := fs.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.UserAvatar,
		Scope:          scope,
		IdempotencyKey: "avatar-" + util.NewID(),
		Filename:       "avatar.png",
		Body:           bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("upload avatar: %v", err)
	}
	if _, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
		Actor:   actor,
		Purpose: files.UserAvatar,
		Scope:   scope,
		FileIDs: []files.FileID{up.File.ID},
	}); err != nil {
		t.Fatalf("claim avatar: %v", err)
	}
	if _, err := q.UpdateUserAvatarFile(ctx, db.UpdateUserAvatarFileParams{
		ID:           userID,
		AvatarFileID: pgtype.Text{String: string(up.File.ID), Valid: true},
	}); err != nil {
		t.Fatalf("update user avatar file: %v", err)
	}
	return up.File.ID
}

func TestOfficeFrameOpenAvatar(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := env.f.ctx
	spy := &variantSpyFiles{
		Service:      env.fake,
		overrides:    map[files.FileID]files.Reader{},
		errOverrides: map[files.FileID]error{},
	}
	env.svc.SetFiles(spy)
	frame := NewOfficeFrameService(env.svc, "office-frame-avatar-test-secret-0123456789")
	tn := env.tn

	doc := env.createFile(t, human(tn.owner), "plan.docx", docxBody(t, "avatar-frame"))
	minted, err := frame.Mint(ctx, Human(tn.owner.ID), doc.Document.ID)
	if err != nil {
		t.Fatalf("mint frame token: %v", err)
	}
	claims := minted.Claims

	// Active member in the document's organization (even outside the workspace)
	// with a file-backed PNG avatar (over 512 bytes so the sniffer head is
	// prepended back to the stream).
	avatarPNG := append(append([]byte(nil), mentionPNG...), bytes.Repeat([]byte{0}, 600)...)
	memberFileID := attachTestAvatar(t, ctx, env.f.q, env.fake, tn.outsider.ID, avatarPNG)
	rd, err := frame.OpenAvatar(ctx, claims, tn.outsider.ID)
	if err != nil {
		t.Fatalf("OpenAvatar active org member = %v", err)
	}
	gotBytes, rerr := io.ReadAll(rd.Body)
	_ = rd.Close()
	if rerr != nil {
		t.Fatalf("read avatar body: %v", rerr)
	}
	if !bytes.Equal(gotBytes, avatarPNG) {
		t.Fatalf("avatar body len = %d, want %d", len(gotBytes), len(avatarPNG))
	}
	if rd.File.ContentType != "image/png" || rd.File.SizeBytes != int64(len(avatarPNG)) || rd.File.ID != memberFileID {
		t.Fatalf("avatar file view = %+v, want image/png %d %s", rd.File, len(avatarPNG), memberFileID)
	}
	if spy.lastVariant != files.VariantThumb {
		t.Fatalf("Open variant = %q, want %q", spy.lastVariant, files.VariantThumb)
	}

	// Deactivated member of the same organization -> ErrNotFound, even when
	// their user row still holds a claimed avatar file.
	_ = attachTestAvatar(t, ctx, env.f.q, env.fake, tn.deact.ID, mentionPNG)
	if _, err := frame.OpenAvatar(ctx, claims, tn.deact.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deactivated member = %v, want ErrNotFound", err)
	}

	// Member of another organization -> ErrNotFound.
	otherTn := env.f.tenant(t, "other"+strings.ToLower(util.NewID()[20:]))
	_ = attachTestAvatar(t, ctx, env.f.q, env.fake, otherTn.owner.ID, mentionPNG)
	if _, err := frame.OpenAvatar(ctx, claims, otherTn.owner.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("other org member = %v, want ErrNotFound", err)
	}

	// Active member whose avatar_file_id points at another user's avatar file:
	// Scope{UserID: tn.creator.ID} makes FileService reject the foreign file.
	if _, err := env.f.q.UpdateUserAvatarFile(ctx, db.UpdateUserAvatarFileParams{
		ID:           tn.creator.ID,
		AvatarFileID: pgtype.Text{String: string(memberFileID), Valid: true},
	}); err != nil {
		t.Fatalf("point creator at outsider's file: %v", err)
	}
	if _, err := frame.OpenAvatar(ctx, claims, tn.creator.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("avatar file of another user = %v, want ErrNotFound", err)
	}

	// Agent IDs of the same organization -> ErrNotFound (agents are out of v1).
	for _, agentID := range []string{tn.agent, tn.agentOut} {
		if _, err := frame.OpenAvatar(ctx, claims, agentID); !errors.Is(err, ErrNotFound) {
			t.Errorf("agent %s = %v, want ErrNotFound", agentID, err)
		}
	}

	// Legacy or foreign avatar_url with avatar_file_id NULL -> ErrNotFound.
	if _, err := env.f.q.UpdateUserAvatar(ctx, db.UpdateUserAvatarParams{
		ID:        tn.member.ID,
		AvatarUrl: pgtype.Text{String: "https://lh3.googleusercontent.com/a/default-user", Valid: true},
	}); err != nil {
		t.Fatalf("set foreign avatar_url: %v", err)
	}
	if _, err := frame.OpenAvatar(ctx, claims, tn.member.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("foreign avatar_url = %v, want ErrNotFound", err)
	}

	// Non-ULID or lowercase ULID -> ErrNotFound.
	for _, badID := range []string{"", "not-a-ulid", strings.ToLower(tn.outsider.ID)} {
		if _, err := frame.OpenAvatar(ctx, claims, badID); !errors.Is(err, ErrNotFound) {
			t.Errorf("non-ULID %q = %v, want ErrNotFound", badID, err)
		}
	}

	// Genuine missing object in storage (storage.ErrNotFound wrapped in
	// files.StorageUnavailable by FileService.Open) -> uniform ErrNotFound.
	spy.errOverrides[memberFileID] = files.StorageUnavailable(fmt.Errorf("local Open: %w", storage.ErrNotFound))
	if _, err := frame.OpenAvatar(ctx, claims, tn.outsider.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing storage object = %v, want ErrNotFound", err)
	}
	delete(spy.errOverrides, memberFileID)

	// Transient storage outage (RBF-01) -> 503 storage_unavailable CodedError,
	// never ErrNotFound (which the frame would negatively cache for 5 minutes).
	// Unauthorized or non-servable targets still return ErrNotFound before
	// reaching FileService.Open.
	env.fake.SetStorageDown(true)
	_, err = frame.OpenAvatar(ctx, claims, tn.outsider.ID)
	if errors.Is(err, ErrNotFound) {
		t.Errorf("OpenAvatar during storage outage = %v, must not be ErrNotFound", err)
	}
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusServiceUnavailable || ce.Code != files.CodeStorageUnavailable {
		t.Errorf("OpenAvatar during storage outage = %v, want 503 %s CodedError", err, files.CodeStorageUnavailable)
	}
	if _, err := frame.OpenAvatar(ctx, claims, tn.deact.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deactivated member during storage outage = %v, want ErrNotFound", err)
	}
	env.fake.SetStorageDown(false)

	// Non-files.Error from Open (DB/context failure) -> propagated so
	// mapServiceError answers 5xx, never ErrNotFound.
	errDB := errors.New("db connection reset during Open")
	spy.errOverrides[memberFileID] = errDB
	if _, err := frame.OpenAvatar(ctx, claims, tn.outsider.ID); !errors.Is(err, errDB) || errors.Is(err, ErrNotFound) {
		t.Errorf("OpenAvatar on DB error = %v, want %v (not ErrNotFound)", err, errDB)
	}
	delete(spy.errOverrides, memberFileID)

	// Sniff-time non-EOF read error inside the first 512 bytes after a valid
	// PNG prefix (RBF-06) -> closes the underlying reader and returns 503
	// storage_unavailable (infrastructure failure, not a cached 404).
	errSniffRead := errors.New("object stream read failed mid-sniff")
	sniffBody := &sniffErrReadCloser{
		prefix: append([]byte(nil), mentionPNG...),
		err:    errSniffRead,
	}
	spy.overrides[memberFileID] = files.Reader{
		File: files.File{
			ID:          memberFileID,
			ContentType: "image/png",
			SizeBytes:   int64(len(avatarPNG)),
		},
		Body: sniffBody,
	}
	_, err = frame.OpenAvatar(ctx, claims, tn.outsider.ID)
	delete(spy.overrides, memberFileID)
	if !sniffBody.closed {
		t.Errorf("OpenAvatar did not close the underlying reader on sniff read error")
	}
	if errors.Is(err, ErrNotFound) {
		t.Errorf("OpenAvatar on sniff read error = %v, must not be ErrNotFound", err)
	}
	var sniffCE CodedError
	if !errors.As(err, &sniffCE) || sniffCE.Status != http.StatusServiceUnavailable || sniffCE.Code != files.CodeStorageUnavailable || !errors.Is(err, errSniffRead) {
		t.Errorf("OpenAvatar on sniff read error = %v, want 503 %s wrapping %v", err, files.CodeStorageUnavailable, errSniffRead)
	}
}
