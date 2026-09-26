package service

// FileService half of the account avatar (UNI-744, FS-C1). The account avatar
// is the one file a person owns outside a tenant: purpose user_avatar, scope
// {UserID} only, so files.organization_id stays NULL and the avatar survives
// every organization move (T1-Q10). AuthService.files selects the path —
// nil keeps the legacy storage pipeline — and avatar readers presign at DTO
// emission because the purpose is ReadPresign, not proxy.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SetFiles selects the FileService path for avatar upload and for the avatar
// URLs every avatar-emitting service resolves. nil keeps the legacy storage
// path byte-identical; once the integrator wires the real service, these
// branches take over. There is no per-request switch and no fallback after a
// files error — one request uses one path.
func (s *AuthService) SetFiles(f files.Service) { s.files = f }

// FilesEnabled reports whether the avatar upload goes through FileService, so
// the handler can pick the branch without touching storage itself.
func (s *AuthService) FilesEnabled() bool { return s.files != nil }

// avatarUploadError keeps the codes the avatar endpoint already publishes:
// the registry cap answers as the 413 and the image allowlist as the 415 the
// legacy path returned, everything else travels through filesError unchanged.
func avatarUploadError(err error) error {
	var fe *files.Error
	if errors.As(err, &fe) {
		switch fe.Code {
		case files.CodeTooLarge:
			return coded(http.StatusRequestEntityTooLarge, "too_large", "avatar vượt quá giới hạn 2 MiB")
		case files.CodeTypeRejected:
			return coded(http.StatusUnsupportedMediaType, "unsupported_media_type", "avatar must be a PNG, JPEG, GIF or WebP image")
		}
	}
	return filesError(err)
}

// UploadAvatar swaps the account avatar to a freshly uploaded file. The claim,
// the previous file's release and the row update share one transaction, so a
// failed commit leaves the previous avatar untouched — and the new file is
// never reachable through a URL the row does not point at.
func (s *AuthService) UploadAvatar(ctx context.Context, userID, filename string, body io.Reader) (db.User, error) {
	if s.files == nil {
		return db.User{}, collaborationUnavailable("avatar_storage_missing", "avatar chưa khả dụng")
	}
	scope := files.Scope{UserID: userID}
	actor := audit.User(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.UserAvatar,
		Scope:          scope,
		IdempotencyKey: "avatar-" + util.NewID(),
		Filename:       filename,
		Body:           body,
	})
	if err != nil {
		return db.User{}, avatarUploadError(err)
	}
	newID := up.File.ID
	cancel := func() {
		_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: newID})
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		cancel()
		return db.User{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	prev, err := q.GetUserAvatarFileIDForUpdate(ctx, userID)
	if err != nil {
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotFound
		}
		return db.User{}, err
	}
	u, err := q.UpdateUserAvatarFile(ctx, db.UpdateUserAvatarFileParams{
		ID:           userID,
		AvatarFileID: pgtype.Text{String: string(newID), Valid: true},
	})
	if err != nil {
		cancel()
		return db.User{}, err
	}
	var replaces []files.FileID
	if prev.Valid && prev.String != "" && prev.String != string(newID) {
		replaces = []files.FileID{files.FileID(prev.String)}
	}
	if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: files.UserAvatar, Scope: scope,
		FileIDs: []files.FileID{newID}, Replaces: replaces,
	}); err != nil {
		cancel()
		return db.User{}, filesError(err)
	}
	if err := releaseFilesInTx(ctx, s.files, q, replaces); err != nil {
		cancel()
		return db.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		cancel()
		return db.User{}, err
	}
	return s.decorateAvatar(ctx, u), nil
}

// decorateAvatar fills AvatarUrl with a presigned URL when the account avatar
// is a FileService file. A refused resolve leaves it empty: an avatar that
// cannot render is worth an initials tile, never a failed request.
func (s *AuthService) decorateAvatar(ctx context.Context, u db.User) db.User {
	if s.files == nil || !u.AvatarFileID.Valid || u.AvatarFileID.String == "" {
		return u
	}
	if url, ok := resolveAvatarURL(ctx, s.files, u.ID, files.FileID(u.AvatarFileID.String)); ok {
		u.AvatarUrl = pgtype.Text{String: url, Valid: true}
	}
	return u
}

// resolveAvatarURL presigns one file-backed avatar.
func resolveAvatarURL(ctx context.Context, f files.Service, userID string, id files.FileID) (string, bool) {
	url, ok := resolveAvatarURLs(ctx, f, map[string]files.FileID{userID: id})[id]
	return url, ok
}

// resolveAvatarURLs presigns file-backed avatars, grouped by owner. The scope
// is the owner's — account avatars are user-scoped, so a batch can only ever
// carry one user's files and the byUser map is the dedupe. A batch-level
// refusal (a mode mismatch is a module bug) is logged and skipped, per-id
// refusals leave the avatar blank.
func resolveAvatarURLs(ctx context.Context, f files.Service, byUser map[string]files.FileID) map[files.FileID]string {
	out := map[files.FileID]string{}
	if f == nil || len(byUser) == 0 {
		return out
	}
	for userID, id := range byUser {
		resolved, err := f.ResolveMany(ctx, files.ResolveInput{
			Scope:       files.Scope{UserID: userID},
			Mode:        files.ReadPresign,
			Disposition: files.DispositionInline,
			FileIDs:     []files.FileID{id},
		})
		if err != nil {
			slog.Warn("avatar resolve", "user", userID, "err", err)
			continue
		}
		for _, r := range resolved {
			if r.Err == nil && r.URL != "" {
				out[r.File.ID] = r.URL
			}
		}
	}
	return out
}

// avatarRow is the avatar-bearing slice of a joined row: who owns the avatar,
// the stored URL and the file id. The six avatar-emitting queries each hand
// one to decorateMemberAvatars.
type avatarRow struct {
	UserID    string
	AvatarURL pgtype.Text
	FileID    pgtype.Text
}

// decorateMemberAvatars presigns the file-backed avatars of a row set. Rows
// that already carry a stored avatar_url keep it; a file-backed row takes the
// presigned URL through set. The fake and the real service both scope avatar
// resolves per owner, which is why the grouping is by user id.
func decorateMemberAvatars[T any](ctx context.Context, f files.Service, rows []T, get func(T) avatarRow, set func(*T, string)) {
	if f == nil || len(rows) == 0 {
		return
	}
	byUser := map[string]files.FileID{}
	for _, r := range rows {
		row := get(r)
		if row.FileID.Valid && row.FileID.String != "" && row.UserID != "" {
			byUser[row.UserID] = files.FileID(row.FileID.String)
		}
	}
	urls := resolveAvatarURLs(ctx, f, byUser)
	for i := range rows {
		row := get(rows[i])
		if row.AvatarURL.Valid || !row.FileID.Valid {
			continue
		}
		if url := urls[files.FileID(row.FileID.String)]; url != "" {
			set(&rows[i], url)
		}
	}
}

// UserAvatarProvider is the reference provider for user_avatar (FS-C1 section
// 6): a live user row pointing at the file is the only hold. Anonymized users
// clear the column in the same transaction that releases the file, so nothing
// here has to special-case deletion.
type UserAvatarProvider struct{}

func NewUserAvatarProvider() UserAvatarProvider { return UserAvatarProvider{} }

func (UserAvatarProvider) Name() string { return "users.avatar" }

func (UserAvatarProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.UserAvatar}
}

func (UserAvatarProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListUserAvatarFileIDs(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, id := range held {
		if id.Valid && id.String != "" {
			out[files.FileID(id.String)] = files.HoldActive
		}
	}
	return out, nil
}
