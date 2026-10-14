package service

// Workspace icon file half (spec 2026-10-14 §5.4): the image a workspace
// shows in place of its initial. It mirrors the account avatar
// (avatar_fs.go): upload outside the transaction, claim and release inside
// it, presign when a view is read.

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

// UploadIcon makes an image the workspace icon and drops its emoji. Any
// failure after the upload cancels it, so no claim is left behind.
func (s *WorkspaceService) UploadIcon(ctx context.Context, userID, workspaceID, filename string, body io.Reader) (WorkspaceView, error) {
	before, err := s.requireWorkspaceAdmin(ctx, userID, workspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if s.files == nil {
		return WorkspaceView{}, collaborationUnavailable("workspace_icon_storage_missing", "icon workspace chưa khả dụng")
	}
	scope := files.Scope{OrganizationID: before.OrganizationID, WorkspaceID: workspaceID}
	actor := audit.User(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.WorkspaceIcon,
		Scope:          scope,
		IdempotencyKey: "workspace-icon-" + util.NewID(),
		Filename:       filename,
		Body:           body,
	})
	if err != nil {
		return WorkspaceView{}, workspaceIconUploadError(err)
	}
	newID := up.File.ID
	cancel := func() {
		_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: newID})
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// As for the avatar, claim and release lock files rows before this
	// transaction locks the workspace row: the first read is plain, and the
	// FOR UPDATE re-read after the files calls serializes a concurrent swap.
	prev, err := q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkspaceView{}, ErrNotFound
		}
		return WorkspaceView{}, err
	}
	var replaces []files.FileID
	if prev.IconFileID.Valid && prev.IconFileID.String != "" {
		replaces = []files.FileID{files.FileID(prev.IconFileID.String)}
	}
	if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: files.WorkspaceIcon, Scope: scope,
		FileIDs: []files.FileID{newID}, Replaces: replaces,
	}); err != nil {
		cancel()
		return WorkspaceView{}, filesError(err)
	}
	if err := releaseFilesInTx(ctx, s.files, q, replaces); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	cur, err := q.GetWorkspaceIconFileIDForUpdate(ctx, db.GetWorkspaceIconFileIDForUpdateParams{ID: workspaceID, OrganizationID: prev.OrganizationID})
	if err != nil {
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkspaceView{}, ErrNotFound
		}
		return WorkspaceView{}, err
	}
	if cur != prev.IconFileID {
		cancel()
		return WorkspaceView{}, ErrConflict
	}
	if _, err := q.SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{
		ID: workspaceID, OrganizationID: prev.OrganizationID,
		IconFileID: pgtype.Text{String: string(newID), Valid: true},
	}); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	if err := recordWorkspaceUpdated(ctx, q, userID, prev,
		map[string]any{"icon": workspaceIconLabel(prev)}, map[string]any{"icon": "file:" + string(newID)},
	); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		cancel()
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, workspaceID)
}

// RemoveIcon drops the emoji or the file, so the workspace shows its initial
// again. A workspace with no icon is left alone and nothing is recorded.
func (s *WorkspaceService) RemoveIcon(ctx context.Context, userID, workspaceID string) (WorkspaceView, error) {
	before, err := s.requireWorkspaceAdmin(ctx, userID, workspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if !before.IconEmoji.Valid && !before.IconFileID.Valid {
		return s.GetView(ctx, userID, workspaceID)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	cur, err := s.releaseIconFileInTx(ctx, q, before.ID, before.OrganizationID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if _, err := q.SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{ID: before.ID, OrganizationID: before.OrganizationID}); err != nil {
		return WorkspaceView{}, err
	}
	if err := recordWorkspaceUpdated(ctx, q, userID, cur,
		map[string]any{"icon": workspaceIconLabel(cur)}, map[string]any{"icon": ""},
	); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, workspaceID)
}

// releaseIconFileInTx releases the uploaded icon that is current inside the
// caller's transaction and returns the row it saw, so a swap that committed
// after the caller's own read is not released twice and its new file is not
// orphaned. Order matches UploadIcon: a plain read, the files rows, then the
// workspace row FOR UPDATE; a row that changed in between is a conflict.
func (s *WorkspaceService) releaseIconFileInTx(ctx context.Context, q *db.Queries, workspaceID, orgID string) (db.Workspace, error) {
	prev, err := q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Workspace{}, ErrNotFound
		}
		return db.Workspace{}, err
	}
	if prev.IconFileID.Valid && prev.IconFileID.String != "" {
		if err := releaseFilesInTx(ctx, s.files, q, []files.FileID{files.FileID(prev.IconFileID.String)}); err != nil {
			return db.Workspace{}, err
		}
	}
	cur, err := q.GetWorkspaceIconFileIDForUpdate(ctx, db.GetWorkspaceIconFileIDForUpdateParams{ID: workspaceID, OrganizationID: orgID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Workspace{}, ErrNotFound
		}
		return db.Workspace{}, err
	}
	if cur != prev.IconFileID {
		return db.Workspace{}, ErrConflict
	}
	return prev, nil
}

// workspaceIconLabel names the icon in an audit diff: the emoji, the file id,
// or "" for the initial.
func workspaceIconLabel(w db.Workspace) string {
	switch {
	case w.IconFileID.Valid:
		return "file:" + w.IconFileID.String
	case w.IconEmoji.Valid:
		return w.IconEmoji.String
	default:
		return ""
	}
}

// workspaceIconUploadError keeps the codes the avatar endpoint publishes, so
// the client reads one vocabulary for both images.
func workspaceIconUploadError(err error) error {
	var fe *files.Error
	if errors.As(err, &fe) {
		switch fe.Code {
		case files.CodeTooLarge:
			return coded(http.StatusRequestEntityTooLarge, "too_large", "icon workspace vượt quá giới hạn 2 MiB")
		case files.CodeTypeRejected:
			return coded(http.StatusUnsupportedMediaType, "unsupported_media_type", "icon must be a PNG, JPEG, GIF or WebP image")
		}
	}
	return filesError(err)
}

// withIconURL presigns the uploaded icon, if any. A failure leaves IconURL
// empty and the client falls back to the emoji or the initial (spec §7.5).
func (s *WorkspaceService) withIconURL(ctx context.Context, v WorkspaceView) WorkspaceView {
	if s.files == nil || !v.IconFileID.Valid || v.IconFileID.String == "" {
		return v
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       files.Scope{OrganizationID: v.OrganizationID, WorkspaceID: v.ID},
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     []files.FileID{files.FileID(v.IconFileID.String)},
	})
	if err != nil {
		slog.Warn("workspace icon resolve", "workspace_id", v.ID, "err", err)
		return v
	}
	for _, r := range resolved {
		if r.Err == nil && r.URL != "" {
			v.IconURL = r.URL
		}
	}
	return v
}

// WorkspaceIconProvider tells FileService which workspace_icon files a
// workspace still shows.
type WorkspaceIconProvider struct{}

func (WorkspaceIconProvider) Name() string { return "workspaces.icon" }

func (WorkspaceIconProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.WorkspaceIcon}
}

func (WorkspaceIconProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListWorkspaceIconFileIDs(ctx, raw)
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
