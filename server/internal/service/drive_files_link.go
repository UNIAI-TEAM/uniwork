package service

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Link links 1..20 Google Drive files to workspaceID (and optionally a task)
// using the caller's active connection (POST /api/v1/workspaces/{workspaceID}/drive-files;
// spec §7.2, §6.3, R1-1). Each file runs in its own transaction after its
// files.get metadata check so a per-file Drive error is reported in results[]
// without aborting the other files in the batch.
func (s *DriveFileService) Link(ctx context.Context, actor Actor, workspaceID string, in LinkDriveFilesInput) ([]DriveFileLinkItemResult, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return nil, errDriveFeatureDisabled()
	}
	if !s.isNotGuest(member) {
		return nil, ErrForbidden
	}
	connID := strings.TrimSpace(in.ConnectionID)
	if connID == "" {
		return nil, Invalid("connection_id không được để trống")
	}
	if len(in.ExternalFileIDs) == 0 || len(in.ExternalFileIDs) > driveMaxLinkBatch {
		return nil, Invalid("external_file_ids phải từ 1 đến 20")
	}

	conn, err := s.requireCallerConnection(ctx, s.q, ws.OrganizationID, actor.ID, connID)
	if err != nil {
		return nil, err
	}

	var taskID string
	if in.TaskID != nil && strings.TrimSpace(*in.TaskID) != "" {
		taskID = strings.TrimSpace(*in.TaskID)
		task, terr := s.q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
			ID:             taskID,
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
		})
		if errors.Is(terr, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if terr != nil {
			return nil, terr
		}
		if !s.canViewTask(ctx, actor.ID, member, task.ID) {
			return nil, ErrNotFound
		}
		if !s.canEditTask(ctx, actor.ID, member, task.ID) {
			return nil, ErrForbidden
		}
	}

	results := make([]DriveFileLinkItemResult, 0, len(in.ExternalFileIDs))
	for _, rawExtID := range in.ExternalFileIDs {
		extID := strings.TrimSpace(rawExtID)
		if extID == "" {
			ce := DriveErrToCodedError(ErrDriveFileNotAccessible).(CodedError)
			results = append(results, DriveFileLinkItemResult{
				ExternalFileID: rawExtID,
				Outcome:        DriveFileLinkOutcomeError,
				ErrorCode:      ce.Code,
				ErrorMessage:   ce.Msg,
			})
			continue
		}
		meta, ferr := s.api.FilesGetWithConnection(ctx, s.connections, conn, extID)
		if ferr != nil {
			s.maybeRecordAccessLostByExternalID(ctx, actor.ID, ws.OrganizationID, ws.ID, extID, conn.ID, ferr)
			code, msg := driveErrorCodeAndMessage(ferr)
			results = append(results, DriveFileLinkItemResult{
				ExternalFileID: extID,
				Outcome:        DriveFileLinkOutcomeError,
				ErrorCode:      code,
				ErrorMessage:   msg,
			})
			continue
		}

		tx, berr := s.pool.Begin(ctx)
		if berr != nil {
			return nil, berr
		}
		qtx := s.q.WithTx(tx)
		item, lerr := s.linkSingleFileWithMetaInTx(ctx, qtx, actor, ws, conn, extID, meta, taskID)
		if lerr != nil {
			_ = tx.Rollback(ctx)
			return nil, lerr
		}
		if cerr := tx.Commit(ctx); cerr != nil {
			return nil, cerr
		}
		results = append(results, item)
	}
	return results, nil
}

// linkFilesForTaskCreateInTx links each file in driveFiles to task inside the
// caller's task-create transaction (spec §7.2, W4 gaps §1). If any file fails,
// it returns a CodedError carrying fields.drive_files_index and
// fields.external_file_id so the whole task-create transaction rolls back.
func (s *DriveFileService) linkFilesForTaskCreateInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor Actor,
	ws db.Workspace,
	task db.Task,
	driveFiles []CreateTaskDriveFileInput,
) error {
	if len(driveFiles) == 0 {
		return nil
	}
	if len(driveFiles) > driveMaxLinkBatch {
		return Invalid("drive_files tối đa 20")
	}
	if s == nil || !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return errDriveFeatureDisabled()
	}

	for idx, df := range driveFiles {
		extID := strings.TrimSpace(df.ExternalFileID)
		connID := strings.TrimSpace(df.ConnectionID)
		conn, err := s.requireCallerConnection(ctx, qtx, ws.OrganizationID, actor.ID, connID)
		if err != nil {
			return wrapTaskCreateDriveFileError(idx, df.ExternalFileID, err)
		}
		if extID == "" {
			return wrapTaskCreateDriveFileError(idx, df.ExternalFileID, ErrDriveFileNotAccessible)
		}
		meta, err := s.api.FilesGetWithConnection(ctx, s.connections, conn, extID)
		if err != nil {
			return wrapTaskCreateDriveFileError(idx, extID, err)
		}
		if _, err := s.linkSingleFileWithMetaInTx(ctx, qtx, actor, ws, conn, extID, meta, task.ID); err != nil {
			return wrapTaskCreateDriveFileError(idx, extID, err)
		}
	}
	return nil
}

func wrapTaskCreateDriveFileError(index int, externalFileID string, err error) error {
	fields := map[string]any{
		"drive_files_index": index,
		"external_file_id":  externalFileID,
	}
	if errors.Is(err, ErrNotFound) {
		return CodedError{
			Status: http.StatusNotFound,
			Code:   "not_found",
			Msg:    "không tìm thấy kết nối Google Drive",
			Fields: fields,
			Err:    ErrNotFound,
		}
	}
	mapped := DriveErrToCodedError(err)
	var ce CodedError
	if errors.As(mapped, &ce) {
		// Per W4 gaps §1 (contract-note.md line 440), drive_file_not_accessible on
		// task creation uses HTTP 404.
		if ce.Code == "drive_file_not_accessible" {
			ce.Status = http.StatusNotFound
		}
		ce.Fields = fields
		return ce
	}
	return CodedError{
		Status: http.StatusServiceUnavailable,
		Code:   "drive_unavailable",
		Msg:    "Không kết nối được Google Drive lúc này, vui lòng thử lại sau.",
		Fields: fields,
		Err:    err,
	}
}

func (s *DriveFileService) linkSingleFileWithMetaInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor Actor,
	ws db.Workspace,
	conn db.DriveConnection,
	externalFileID string,
	meta DriveFileMetadata,
	taskID string,
) (DriveFileLinkItemResult, error) {
	if err := qtx.LockDriveFileWorkspaceExternal(ctx, db.LockDriveFileWorkspaceExternalParams{
		WorkspaceID:    ws.ID,
		ExternalFileID: externalFileID,
	}); err != nil {
		return DriveFileLinkItemResult{}, err
	}
	if s.testAfterLinkLock != nil {
		s.testAfterLinkLock(ws.ID, externalFileID)
	}

	now := s.nowUTC()
	params := normalizeMetadataForDB(meta, externalFileID, now)

	existing, err := qtx.GetActiveDriveFileByExternalIDForUpdate(ctx, db.GetActiveDriveFileByExternalIDForUpdateParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		ExternalFileID: externalFileID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return DriveFileLinkItemResult{}, err
	}
	hasExisting := err == nil

	var fileRow db.DriveFile
	outcome := DriveFileLinkOutcomeLinked
	viewerConnID := conn.ID
	viewerEmail := conn.GoogleEmail
	accountEmailOnAlreadyLinked := ""

	if !hasExisting {
		fileRow, err = qtx.CreateDriveFile(ctx, db.CreateDriveFileParams{
			ID:                     util.NewID(),
			OrganizationID:         ws.OrganizationID,
			WorkspaceID:            ws.ID,
			ExternalFileID:         externalFileID,
			DriveID:                params.DriveID,
			ConnectionID:           conn.ID,
			BoundBy:                actor.ID,
			CreatedBy:              actor.ID,
			CreatedByKind:          string(actor.Kind),
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
		})
		if err != nil {
			return DriveFileLinkItemResult{}, err
		}
		if _, err := qtx.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
			ID:             util.NewID(),
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			DriveFileID:    fileRow.ID,
			UserID:         actor.ID,
			ConnectionID:   conn.ID,
		}); err != nil {
			return DriveFileLinkItemResult{}, err
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			Actor:          actor,
			Action:         audit.ActionDriveFileLinked,
			ResourceType:   "drive_file",
			ResourceID:     fileRow.ID,
			Metadata: map[string]any{
				"external_file_id": externalFileID,
				"google_email":     conn.GoogleEmail,
				"google_sub":       conn.GoogleSub,
			},
		}, audit.Event{
			Topic:   "drive_file.linked",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": fileRow.ID,
				"workspace_id":  ws.ID,
			},
		}); err != nil {
			return DriveFileLinkItemResult{}, err
		}
	} else {
		fileRow, outcome, viewerConnID, viewerEmail, accountEmailOnAlreadyLinked, err = s.linkExistingFileInTx(
			ctx, qtx, actor, ws, existing, conn, externalFileID, params,
		)
		if err != nil {
			return DriveFileLinkItemResult{}, err
		}
	}

	if taskID != "" {
		if err := s.attachTaskLinkOnLinkInTx(ctx, qtx, actor, ws, fileRow, taskID, viewerEmail); err != nil {
			return DriveFileLinkItemResult{}, err
		}
	}

	receipt := buildDriveFileLinkReceipt(fileRow, viewerConnID, viewerEmail)
	return DriveFileLinkItemResult{
		ExternalFileID: externalFileID,
		Outcome:        outcome,
		File:           &receipt,
		AccountEmail:   accountEmailOnAlreadyLinked,
	}, nil
}

func (s *DriveFileService) linkExistingFileInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor Actor,
	ws db.Workspace,
	existing db.DriveFile,
	conn db.DriveConnection,
	externalFileID string,
	params normalizedDriveMetadataParams,
) (db.DriveFile, string, string, string, string, error) {
	fileRow, err := qtx.UpdateDriveFileMetadata(ctx, db.UpdateDriveFileMetadataParams{
		DriveID:                params.DriveID,
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
		ID:                     existing.ID,
		OrganizationID:         ws.OrganizationID,
		WorkspaceID:            ws.ID,
	})
	if err != nil {
		return db.DriveFile{}, "", "", "", "", err
	}

	outcome := DriveFileLinkOutcomeLinked
	viewerConnID := conn.ID
	viewerEmail := conn.GoogleEmail
	accountEmailOnAlreadyLinked := ""

	acc, aerr := qtx.GetDriveFileAccessByUserForUpdate(ctx, db.GetDriveFileAccessByUserForUpdateParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    existing.ID,
		UserID:         actor.ID,
	})
	if aerr != nil && !errors.Is(aerr, pgx.ErrNoRows) {
		return db.DriveFile{}, "", "", "", "", aerr
	}
	hasAcc := aerr == nil

	if !hasAcc {
		if _, err := qtx.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
			ID:             util.NewID(),
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			DriveFileID:    existing.ID,
			UserID:         actor.ID,
			ConnectionID:   conn.ID,
		}); err != nil {
			return db.DriveFile{}, "", "", "", "", err
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			Actor:          actor,
			Action:         audit.ActionDriveFileLinked,
			ResourceType:   "drive_file",
			ResourceID:     existing.ID,
			Metadata: map[string]any{
				"external_file_id": externalFileID,
				"google_email":     conn.GoogleEmail,
				"google_sub":       conn.GoogleSub,
			},
		}, audit.Event{
			Topic:   "drive_file.linked",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": existing.ID,
				"workspace_id":  ws.ID,
			},
		}, audit.Event{
			Topic:   "drive_file.access_changed",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": existing.ID,
				"workspace_id":  ws.ID,
				"user_id":       actor.ID,
			},
		}); err != nil {
			return db.DriveFile{}, "", "", "", "", err
		}
	} else if acc.State == "granted" {
		outcome = DriveFileLinkOutcomeAlreadyLinked
		if acc.ConnectionID == conn.ID {
			if _, err := qtx.TouchDriveFileAccessCheckedAt(ctx, db.TouchDriveFileAccessCheckedAtParams{
				OrganizationID: ws.OrganizationID,
				WorkspaceID:    ws.ID,
				DriveFileID:    existing.ID,
				UserID:         actor.ID,
				ConnectionID:   conn.ID,
			}); err != nil {
				return db.DriveFile{}, "", "", "", "", err
			}
			viewerConnID = conn.ID
			viewerEmail = conn.GoogleEmail
			accountEmailOnAlreadyLinked = conn.GoogleEmail
		} else {
			keptEmail := conn.GoogleEmail
			if keptConn, kerr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
				ID:             acc.ConnectionID,
				OrganizationID: ws.OrganizationID,
				UserID:         actor.ID,
			}); kerr == nil && keptConn.GoogleEmail != "" {
				keptEmail = keptConn.GoogleEmail
			}
			viewerConnID = acc.ConnectionID
			viewerEmail = keptEmail
			accountEmailOnAlreadyLinked = keptEmail
		}
	} else {
		if existing.BoundBy == actor.ID && existing.ConnectionID != conn.ID {
			fileRow, err = s.rebindFileInTx(ctx, qtx, actor, ws, existing, conn, params)
			if err != nil {
				return db.DriveFile{}, "", "", "", "", err
			}
		} else {
			if _, err := qtx.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
				ID:             util.NewID(),
				OrganizationID: ws.OrganizationID,
				WorkspaceID:    ws.ID,
				DriveFileID:    existing.ID,
				UserID:         actor.ID,
				ConnectionID:   conn.ID,
			}); err != nil {
				return db.DriveFile{}, "", "", "", "", err
			}
			events := []audit.Event{{
				Topic:   "drive_file.access_changed",
				Version: 1,
				Payload: map[string]string{
					"drive_file_id": existing.ID,
					"workspace_id":  ws.ID,
					"user_id":       actor.ID,
				},
			}}
			if existing.ConnectionID == conn.ID && existing.AccessLostAt.Valid {
				if cleared, cerr := qtx.ClearDriveFileBoundAccessLost(ctx, db.ClearDriveFileBoundAccessLostParams{
					ID:             existing.ID,
					OrganizationID: ws.OrganizationID,
					WorkspaceID:    ws.ID,
					ConnectionID:   conn.ID,
				}); cerr == nil {
					fileRow = cleared
					events = append(events, audit.Event{
						Topic:   "drive_file.updated",
						Version: 1,
						Payload: map[string]string{
							"drive_file_id": existing.ID,
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
				ResourceID:     existing.ID,
				Metadata: map[string]any{
					"connection_id": conn.ID,
					"google_email":  conn.GoogleEmail,
					"google_sub":    conn.GoogleSub,
				},
			}, events...); err != nil {
				return db.DriveFile{}, "", "", "", "", err
			}
		}
	}

	return fileRow, outcome, viewerConnID, viewerEmail, accountEmailOnAlreadyLinked, nil
}

func shouldMarkDriveAccessLost(err error) bool {
	if err == nil {
		return false
	}
	var apiErr *DriveAPIError
	if errors.As(err, &apiErr) {
		return apiErr.MarkAccessLost
	}
	return errors.Is(err, ErrDriveFileNotAccessible) || errors.Is(err, ErrDriveGrantRequired)
}

func driveErrorCodeAndMessage(err error) (string, string) {
	mapped := DriveErrToCodedError(err)
	var ce CodedError
	if errors.As(mapped, &ce) {
		return ce.Code, ce.Msg
	}
	return "drive_unavailable", "Không kết nối được Google Drive lúc này, vui lòng thử lại sau."
}

func encodeDriveFilesCursor(createdAt time.Time, id string) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeDriveFilesCursor(cursor string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(cursor))
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return time.Time{}, "", errors.New("invalid cursor")
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return ts.UTC(), strings.TrimSpace(parts[1]), nil
}
