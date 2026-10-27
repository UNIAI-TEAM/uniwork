package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// GrantAccess grants read access for the caller after selecting the file in
// Google Picker setFileIds (POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access;
// spec §6.3, §7.4, W4 gaps §3).
func (s *DriveFileService) GrantAccess(ctx context.Context, actor Actor, workspaceID, driveFileID, connectionID string) (DriveFileView, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return DriveFileView{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveFileView{}, errDriveFeatureDisabled()
	}
	driveFileID = strings.TrimSpace(driveFileID)
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return DriveFileView{}, Invalid("connection_id không được để trống")
	}

	fileRow, err := s.requireVisibleDriveFile(ctx, actor.ID, member, ws, driveFileID)
	if err != nil {
		return DriveFileView{}, err
	}

	conn, err := s.requireCallerConnection(ctx, s.q, ws.OrganizationID, actor.ID, connectionID)
	if err != nil {
		return DriveFileView{}, err
	}

	existingAcc, aerr := s.q.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    fileRow.ID,
		UserID:         actor.ID,
	})
	if aerr != nil && !errors.Is(aerr, pgx.ErrNoRows) {
		return DriveFileView{}, aerr
	}
	if aerr == nil && existingAcc.State == "granted" {
		// Already granted -> idempotent 200; row unchanged (W4 gaps §3).
		return s.Get(ctx, actor, workspaceID, driveFileID)
	}

	meta, err := s.api.FilesGetWithConnection(ctx, s.connections, conn, fileRow.ExternalFileID)
	if err != nil {
		s.maybeRecordAccessLost(ctx, actor.ID, ws.OrganizationID, ws.ID, fileRow.ID, conn.ID, err)
		return DriveFileView{}, DriveErrToCodedError(err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DriveFileView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	lockedConn, err := s.requireCallerConnectionForShare(ctx, qtx, ws.OrganizationID, actor.ID, conn.ID)
	if err != nil {
		return DriveFileView{}, err
	}
	conn = lockedConn
	lockedFile, err := qtx.GetActiveDriveFileByIDForUpdate(ctx, db.GetActiveDriveFileByIDForUpdateParams{
		ID:             fileRow.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DriveFileView{}, ErrNotFound
	}
	if err != nil {
		return DriveFileView{}, err
	}

	lockedAcc, lerr := qtx.GetDriveFileAccessByUserForUpdate(ctx, db.GetDriveFileAccessByUserForUpdateParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    lockedFile.ID,
		UserID:         actor.ID,
	})
	if lerr != nil && !errors.Is(lerr, pgx.ErrNoRows) {
		return DriveFileView{}, lerr
	}
	if lerr == nil && lockedAcc.State == "granted" {
		_ = tx.Rollback(ctx)
		return s.Get(ctx, actor, workspaceID, driveFileID)
	}

	params := normalizeMetadataForDB(meta, lockedFile.ExternalFileID, s.nowUTC())
	if lerr == nil && lockedAcc.State == "lost" && lockedFile.BoundBy == actor.ID && lockedFile.ConnectionID != conn.ID {
		if _, err := s.rebindFileInTx(ctx, qtx, actor, ws, lockedFile, conn, params); err != nil {
			return DriveFileView{}, err
		}
	} else {
		if _, err := qtx.UpdateDriveFileMetadata(ctx, db.UpdateDriveFileMetadataParams{
			DriveID:                params.DriveID,
			DriveFolderID:          params.DriveFolderID,
			DriveFolderName:        params.DriveFolderName,
			Name:                   params.Name,
			MimeType:               params.MimeType,
			IconKind:               params.IconKind,
			WebViewLink:            params.WebViewLink,
			OwnerDisplay:           params.OwnerDisplay,
			DriveModifiedAt:        params.DriveModifiedAt,
			DriveModifiedByDisplay: params.DriveModifiedByDisplay,
			SharingState:           params.SharingState,
			SharedUserCount:        params.SharedUserCount,
			MetadataRefreshedAt:    params.MetadataRefreshedAt,
			ID:                     lockedFile.ID,
			OrganizationID:         ws.OrganizationID,
			WorkspaceID:            ws.ID,
		}); err != nil {
			return DriveFileView{}, err
		}
		if _, err := qtx.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
			ID:             util.NewID(),
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			DriveFileID:    lockedFile.ID,
			UserID:         actor.ID,
			ConnectionID:   conn.ID,
		}); err != nil {
			return DriveFileView{}, err
		}
		events := []audit.Event{{
			Topic:   "drive_file.access_changed",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": lockedFile.ID,
				"workspace_id":  ws.ID,
				"user_id":       actor.ID,
			},
		}}
		if lockedFile.ConnectionID == conn.ID && lockedFile.AccessLostAt.Valid {
			if _, cerr := qtx.ClearDriveFileBoundAccessLost(ctx, db.ClearDriveFileBoundAccessLostParams{
				ID:             lockedFile.ID,
				OrganizationID: ws.OrganizationID,
				WorkspaceID:    ws.ID,
				ConnectionID:   conn.ID,
			}); cerr == nil {
				events = append(events, audit.Event{
					Topic:   "drive_file.updated",
					Version: 1,
					Payload: map[string]string{
						"drive_file_id": lockedFile.ID,
						"workspace_id":  ws.ID,
					},
				})
			}
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			Actor:          actor,
			Action:         audit.ActionDriveFileAccessGranted,
			ResourceType:   "drive_file",
			ResourceID:     lockedFile.ID,
			Metadata: map[string]any{
				"connection_id": conn.ID,
				"google_email":  conn.GoogleEmail,
				"google_sub":    conn.GoogleSub,
			},
		}, events...); err != nil {
			return DriveFileView{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return DriveFileView{}, err
	}
	return s.Get(ctx, actor, workspaceID, driveFileID)
}

// ChangeReadAccount switches the caller's own reading account on a Drive file
// (PUT /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access;
// spec §6.3, W4 gaps §3). Refuses with 409 use_rebind when the caller is
// currently bound_by.
func (s *DriveFileService) ChangeReadAccount(ctx context.Context, actor Actor, workspaceID, driveFileID, connectionID string) (DriveFileView, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return DriveFileView{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveFileView{}, errDriveFeatureDisabled()
	}
	driveFileID = strings.TrimSpace(driveFileID)
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return DriveFileView{}, Invalid("connection_id không được để trống")
	}

	fileRow, err := s.requireVisibleDriveFile(ctx, actor.ID, member, ws, driveFileID)
	if err != nil {
		return DriveFileView{}, err
	}
	if fileRow.BoundBy == actor.ID {
		return DriveFileView{}, errDriveUseRebind()
	}

	existingAcc, aerr := s.q.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, DriveFileID: fileRow.ID, UserID: actor.ID,
	})
	if aerr != nil || existingAcc.State != "granted" {
		if aerr == nil || errors.Is(aerr, pgx.ErrNoRows) {
			return DriveFileView{}, errDriveUseGrantAccess()
		}
		return DriveFileView{}, aerr
	}

	conn, err := s.requireCallerConnection(ctx, s.q, ws.OrganizationID, actor.ID, connectionID)
	if err != nil {
		return DriveFileView{}, err
	}

	meta, err := s.api.FilesGetWithConnection(ctx, s.connections, conn, fileRow.ExternalFileID)
	if err != nil {
		s.maybeRecordAccessLost(ctx, actor.ID, ws.OrganizationID, ws.ID, fileRow.ID, conn.ID, err)
		return DriveFileView{}, DriveErrToCodedError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DriveFileView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	lockedConn, err := s.requireCallerConnectionForShare(ctx, qtx, ws.OrganizationID, actor.ID, conn.ID)
	if err != nil {
		return DriveFileView{}, err
	}
	conn = lockedConn
	lockedFile, err := qtx.GetActiveDriveFileByIDForUpdate(ctx, db.GetActiveDriveFileByIDForUpdateParams{
		ID:             fileRow.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DriveFileView{}, ErrNotFound
	}
	if err != nil {
		return DriveFileView{}, err
	}
	if lockedFile.BoundBy == actor.ID {
		return DriveFileView{}, errDriveUseRebind()
	}

	prevAcc, perr := qtx.GetDriveFileAccessByUserForUpdate(ctx, db.GetDriveFileAccessByUserForUpdateParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, DriveFileID: lockedFile.ID, UserID: actor.ID,
	})
	if perr != nil || prevAcc.State != "granted" {
		if perr == nil || errors.Is(perr, pgx.ErrNoRows) {
			return DriveFileView{}, errDriveUseGrantAccess()
		}
		return DriveFileView{}, perr
	}
	params := normalizeMetadataForDB(meta, lockedFile.ExternalFileID, s.nowUTC())
	if _, err := qtx.UpdateDriveFileMetadata(ctx, db.UpdateDriveFileMetadataParams{
		DriveID:                params.DriveID,
		DriveFolderID:          params.DriveFolderID,
		DriveFolderName:        params.DriveFolderName,
		Name:                   params.Name,
		MimeType:               params.MimeType,
		IconKind:               params.IconKind,
		WebViewLink:            params.WebViewLink,
		OwnerDisplay:           params.OwnerDisplay,
		DriveModifiedAt:        params.DriveModifiedAt,
		DriveModifiedByDisplay: params.DriveModifiedByDisplay,
		SharingState:           params.SharingState,
		SharedUserCount:        params.SharedUserCount,
		MetadataRefreshedAt:    params.MetadataRefreshedAt,
		ID:                     lockedFile.ID,
		OrganizationID:         ws.OrganizationID,
		WorkspaceID:            ws.ID,
	}); err != nil {
		return DriveFileView{}, err
	}
	if _, err := qtx.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
		ID:             util.NewID(),
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    lockedFile.ID,
		UserID:         actor.ID,
		ConnectionID:   conn.ID,
	}); err != nil {
		return DriveFileView{}, err
	}

	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Action:         audit.ActionDriveFileAccessChanged,
		ResourceType:   "drive_file",
		ResourceID:     lockedFile.ID,
		Metadata: map[string]any{
			"old_connection_id": prevAcc.ConnectionID,
			"connection_id":     conn.ID,
			"google_email":      conn.GoogleEmail,
			"google_sub":        conn.GoogleSub,
		},
	}, audit.Event{
		Topic:   "drive_file.access_changed",
		Version: 1,
		Payload: map[string]string{
			"drive_file_id": lockedFile.ID,
			"workspace_id":  ws.ID,
			"user_id":       actor.ID,
		},
	}); err != nil {
		return DriveFileView{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DriveFileView{}, err
	}
	return s.Get(ctx, actor, workspaceID, driveFileID)
}

// Rebind rebinds the file's bound connection and bound_by to connectionID
// owned by the caller, updating only the caller's own drive_file_access row
// while leaving every other member's drive_file_access row intact
// (POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind;
// spec §6.2, §6.3, §7.6a, §7.7, §13).
func (s *DriveFileService) Rebind(ctx context.Context, actor Actor, workspaceID, driveFileID, connectionID string) (DriveFileView, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return DriveFileView{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveFileView{}, errDriveFeatureDisabled()
	}
	driveFileID = strings.TrimSpace(driveFileID)
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return DriveFileView{}, Invalid("connection_id không được để trống")
	}

	fileRow, err := s.requireVisibleDriveFile(ctx, actor.ID, member, ws, driveFileID)
	if err != nil {
		return DriveFileView{}, err
	}
	if !canManageDriveFile(actor.ID, member, fileRow) {
		return DriveFileView{}, ErrForbidden
	}

	conn, err := s.requireCallerConnection(ctx, s.q, ws.OrganizationID, actor.ID, connectionID)
	if err != nil {
		return DriveFileView{}, err
	}

	meta, err := s.api.FilesGetWithConnection(ctx, s.connections, conn, fileRow.ExternalFileID)
	if err != nil {
		s.maybeRecordAccessLost(ctx, actor.ID, ws.OrganizationID, ws.ID, fileRow.ID, conn.ID, err)
		return DriveFileView{}, DriveErrToCodedError(err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DriveFileView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	lockedConn, err := s.requireCallerConnectionForShare(ctx, qtx, ws.OrganizationID, actor.ID, conn.ID)
	if err != nil {
		return DriveFileView{}, err
	}
	conn = lockedConn
	lockedFile, err := qtx.GetActiveDriveFileByIDForUpdate(ctx, db.GetActiveDriveFileByIDForUpdateParams{
		ID:             fileRow.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DriveFileView{}, ErrNotFound
	}
	if err != nil {
		return DriveFileView{}, err
	}
	if !canManageDriveFile(actor.ID, member, lockedFile) {
		return DriveFileView{}, ErrForbidden
	}

	params := normalizeMetadataForDB(meta, lockedFile.ExternalFileID, s.nowUTC())
	if _, err := s.rebindFileInTx(ctx, qtx, actor, ws, lockedFile, conn, params); err != nil {
		return DriveFileView{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DriveFileView{}, err
	}
	return s.Get(ctx, actor, workspaceID, driveFileID)
}

func (s *DriveFileService) rebindFileInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor Actor,
	ws db.Workspace,
	lockedFile db.DriveFile,
	conn db.DriveConnection,
	params normalizedDriveMetadataParams,
) (db.DriveFile, error) {
	var oldEmail string
	if oldConn, err := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             lockedFile.ConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         lockedFile.BoundBy,
	}); err == nil {
		oldEmail = oldConn.GoogleEmail
	}

	rebound, err := qtx.RebindDriveFile(ctx, db.RebindDriveFileParams{
		ConnectionID:           conn.ID,
		BoundBy:                actor.ID,
		DriveID:                params.DriveID,
		DriveFolderID:          params.DriveFolderID,
		DriveFolderName:        params.DriveFolderName,
		Name:                   params.Name,
		MimeType:               params.MimeType,
		IconKind:               params.IconKind,
		WebViewLink:            params.WebViewLink,
		OwnerDisplay:           params.OwnerDisplay,
		DriveModifiedAt:        params.DriveModifiedAt,
		DriveModifiedByDisplay: params.DriveModifiedByDisplay,
		SharingState:           params.SharingState,
		SharedUserCount:        params.SharedUserCount,
		MetadataRefreshedAt:    params.MetadataRefreshedAt,
		ID:                     lockedFile.ID,
		OrganizationID:         ws.OrganizationID,
		WorkspaceID:            ws.ID,
	})
	if err != nil {
		return db.DriveFile{}, err
	}
	if _, err := qtx.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
		ID:             util.NewID(),
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    lockedFile.ID,
		UserID:         actor.ID,
		ConnectionID:   conn.ID,
	}); err != nil {
		return db.DriveFile{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Action:         audit.ActionDriveFileRebound,
		ResourceType:   "drive_file",
		ResourceID:     lockedFile.ID,
		Metadata: map[string]any{
			"old_connection_id": lockedFile.ConnectionID,
			"new_connection_id": conn.ID,
			"old_google_email":  oldEmail,
			"google_email":      conn.GoogleEmail,
			"google_sub":        conn.GoogleSub,
			"old_bound_by":      lockedFile.BoundBy,
			"bound_by":          actor.ID,
		},
	}, audit.Event{
		Topic:   "drive_file.updated",
		Version: 1,
		Payload: map[string]string{
			"drive_file_id": lockedFile.ID,
			"workspace_id":  ws.ID,
		},
	}, audit.Event{
		Topic:   "drive_file.access_changed",
		Version: 1,
		Payload: map[string]string{
			"drive_file_id": lockedFile.ID,
			"workspace_id":  ws.ID,
			"user_id":       actor.ID,
		},
	}); err != nil {
		return db.DriveFile{}, err
	}
	return rebound, nil
}

// Unlink soft-deletes a Drive file reference from the workspace and removes all
// of its task links in the same transaction
// (DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID};
// spec §6.2, §6.4, §7.6a, §7.7, §11, §13).
func (s *DriveFileService) Unlink(ctx context.Context, actor Actor, workspaceID, driveFileID string) error {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return errDriveFeatureDisabled()
	}
	driveFileID = strings.TrimSpace(driveFileID)
	fileRow, err := s.requireVisibleDriveFile(ctx, actor.ID, member, ws, driveFileID)
	if err != nil {
		return err
	}
	if !canManageDriveFile(actor.ID, member, fileRow) {
		return ErrForbidden
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	lockedFile, err := qtx.GetActiveDriveFileByIDForUpdate(ctx, db.GetActiveDriveFileByIDForUpdateParams{
		ID:             fileRow.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !canManageDriveFile(actor.ID, member, lockedFile) {
		return ErrForbidden
	}

	var boundEmail, boundSub string
	if boundConn, berr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             lockedFile.ConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         lockedFile.BoundBy,
	}); berr == nil {
		boundEmail = boundConn.GoogleEmail
		boundSub = boundConn.GoogleSub
	}

	if _, err := qtx.DeleteDriveFileTaskLinksByFile(ctx, db.DeleteDriveFileTaskLinksByFileParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    lockedFile.ID,
	}); err != nil {
		return err
	}

	if _, err := qtx.UnlinkDriveFile(ctx, db.UnlinkDriveFileParams{
		UnlinkedBy:     pgtype.Text{String: actor.ID, Valid: true},
		UnlinkedByKind: pgtype.Text{String: string(actor.Kind), Valid: true},
		ID:             lockedFile.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	}); err != nil {
		return err
	}
	if err := discardReadyProposalsForFileInTx(ctx, qtx, actor, lockedFile.ID, boundEmail, boundSub); err != nil {
		return err
	}

	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Action:         audit.ActionDriveFileUnlinked,
		ResourceType:   "drive_file",
		ResourceID:     lockedFile.ID,
		Metadata: map[string]any{
			"external_file_id": lockedFile.ExternalFileID,
			"drive_file_name":  lockedFile.Name,
			"google_email":     boundEmail,
			"google_sub":       boundSub,
		},
	}, audit.Event{
		Topic:   "drive_file.unlinked",
		Version: 1,
		Payload: map[string]string{
			"drive_file_id": lockedFile.ID,
			"workspace_id":  ws.ID,
		},
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func errDriveUseRebind() error {
	return CodedError{
		Status: http.StatusConflict, Code: "use_rebind",
		Msg: "Bạn đang giữ tài khoản gắn của tệp này; hãy dùng thao tác liên kết lại bằng tài khoản khác.", Err: ErrConflict,
	}
}

func errDriveUseGrantAccess() error {
	return CodedError{
		Status: http.StatusConflict, Code: "use_grant_access",
		Msg: "Bạn chưa cấp quyền đọc tệp này; hãy dùng thao tác cấp quyền đọc trước khi đổi tài khoản.", Err: ErrConflict,
	}
}
