package service

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const driveFolderFilterNone = "none"

var driveFolderFilterIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{10,256}$`)

func parseDriveFolderFilter(raw string) (pgtype.Text, *string, error) {
	fid := strings.TrimSpace(raw)
	if fid == "" {
		return pgtype.Text{}, nil, nil
	}
	if fid != driveFolderFilterNone && !driveFolderFilterIDPattern.MatchString(fid) {
		return pgtype.Text{}, nil, Invalid("drive_folder_id không hợp lệ")
	}
	echo := fid
	return pgtype.Text{String: fid, Valid: true}, &echo, nil
}

// ListMine returns the paginated list of active Drive files in workspaceID for
// which the caller has a row in drive_file_access
// (GET /api/v1/workspaces/{workspaceID}/drive-files; spec §7.6).
func (s *DriveFileService) ListMine(ctx context.Context, actor Actor, workspaceID string, filter ListDriveFilesFilter) (DriveFileListResult, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return DriveFileListResult{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveFileListResult{}, errDriveFeatureDisabled()
	}

	var connIDFilter pgtype.Text
	if cid := strings.TrimSpace(filter.ConnectionID); cid != "" {
		// Verify connection belongs to caller in this organization (404 otherwise).
		if _, cerr := s.q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
			ID:             cid,
			OrganizationID: ws.OrganizationID,
			UserID:         actor.ID,
		}); cerr != nil {
			if errors.Is(cerr, pgx.ErrNoRows) {
				return DriveFileListResult{}, ErrNotFound
			}
			return DriveFileListResult{}, cerr
		}
		connIDFilter = pgtype.Text{String: cid, Valid: true}
	}

	var cursorCreatedAt pgtype.Timestamptz
	var cursorID pgtype.Text
	if cur := strings.TrimSpace(filter.Cursor); cur != "" {
		ts, id, derr := decodeDriveFilesCursor(cur)
		if derr != nil {
			return DriveFileListResult{}, Invalid("cursor không hợp lệ")
		}
		cursorCreatedAt = pgtype.Timestamptz{Time: ts, Valid: true}
		cursorID = pgtype.Text{String: id, Valid: true}
	}

	folderFilter, appliedFolderID, err := parseDriveFolderFilter(filter.DriveFolderID)
	if err != nil {
		return DriveFileListResult{}, err
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = driveDefaultListLimit
	}
	if limit > driveMaxListLimit {
		limit = driveMaxListLimit
	}

	totalCount, err := s.q.CountMyDriveFiles(ctx, db.CountMyDriveFilesParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		ViewerUserID:   actor.ID,
		ConnectionID:   connIDFilter,
		FolderFilter:   folderFilter,
	})
	if err != nil {
		return DriveFileListResult{}, err
	}

	rows, err := s.q.ListMyDriveFilesEnriched(ctx, db.ListMyDriveFilesEnrichedParams{
		OrganizationID:  ws.OrganizationID,
		WorkspaceID:     ws.ID,
		ViewerUserID:    actor.ID,
		ConnectionID:    connIDFilter,
		FolderFilter:    folderFilter,
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        cursorID,
		LimitN:          limit + 1,
	})
	if err != nil {
		return DriveFileListResult{}, err
	}

	var nextCursor *string
	if int32(len(rows)) > limit {
		last := rows[limit-1]
		encoded := encodeDriveFilesCursor(last.CreatedAt.Time.UTC(), last.ID)
		nextCursor = &encoded
		rows = rows[:limit]
	}

	// Opportunistically refresh stale metadata (> 10 min) using the caller's own connection.
	parentCache := make(map[string]string, len(rows))
	for i := range rows {
		if refreshed, ok := s.maybeRefreshEnrichedRow(ctx, actor.ID, ws, rows[i], parentCache); ok {
			rows[i] = refreshed
		}
	}

	fileIDs := make([]string, 0, len(rows))
	extIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		fileIDs = append(fileIDs, r.ID)
		extIDs = append(extIDs, r.ExternalFileID)
	}

	tasksByFile, err := s.loadVisibleTasksByFileIDs(ctx, actor.ID, member, ws, fileIDs)
	if err != nil {
		return DriveFileListResult{}, err
	}

	var summariesByExt map[string]DriveTasksCreatedSummary
	if s.creations != nil && len(extIDs) > 0 {
		summariesByExt, _ = s.creations.LoadTasksCreatedSummaries(ctx, actor.ID, member, ws, extIDs)
	}

	files := make([]DriveFileView, 0, len(rows))
	for _, r := range rows {
		visibleTasks := tasksByFile[r.ID]
		var summary DriveTasksCreatedSummary
		if summariesByExt != nil {
			summary = summariesByExt[r.ExternalFileID]
		}
		view := s.buildDriveFileViewFromListRow(actor.ID, member, r, visibleTasks, summary, nil)
		files = append(files, view)
	}

	return DriveFileListResult{
		Files:         files,
		TotalCount:    totalCount,
		NextCursor:    nextCursor,
		DriveFolderID: appliedFolderID,
	}, nil
}

// ListFolders returns the aggregate list of parent Drive folders across active
// Drive files in workspaceID for which the caller has a row in drive_file_access
// (GET /api/v1/workspaces/{workspaceID}/drive-folders; UNI-2221).
func (s *DriveFileService) ListFolders(ctx context.Context, actor Actor, workspaceID, connectionID string) ([]DriveFolderGroupView, error) {
	ws, _, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return nil, errDriveFeatureDisabled()
	}

	var connIDFilter pgtype.Text
	if cid := strings.TrimSpace(connectionID); cid != "" {
		if _, cerr := s.q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
			ID:             cid,
			OrganizationID: ws.OrganizationID,
			UserID:         actor.ID,
		}); cerr != nil {
			if errors.Is(cerr, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, cerr
		}
		connIDFilter = pgtype.Text{String: cid, Valid: true}
	}

	rows, err := s.q.ListMyDriveFolders(ctx, db.ListMyDriveFoldersParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		ViewerUserID:   actor.ID,
		ConnectionID:   connIDFilter,
	})
	if err != nil {
		return nil, err
	}

	out := make([]DriveFolderGroupView, 0, len(rows))
	for _, r := range rows {
		var idPtr, namePtr *string
		if r.DriveFolderID.Valid && strings.TrimSpace(r.DriveFolderID.String) != "" {
			fid := strings.TrimSpace(r.DriveFolderID.String)
			idPtr = &fid
			if fname := strings.TrimSpace(r.DriveFolderName); fname != "" {
				namePtr = &fname
			}
		}
		out = append(out, DriveFolderGroupView{
			ID:        idPtr,
			Name:      namePtr,
			FileCount: r.FileCount,
		})
	}
	return out, nil
}

// Get returns the full detail of a Drive file reference in workspaceID
// (GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID};
// spec §7.6a, §7.7, §8.8). Returns 404 when the caller has neither a row in
// drive_file_access nor any visible task linked to the file.
func (s *DriveFileService) Get(ctx context.Context, actor Actor, workspaceID, driveFileID string) (DriveFileView, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return DriveFileView{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveFileView{}, errDriveFeatureDisabled()
	}
	driveFileID = strings.TrimSpace(driveFileID)
	if driveFileID == "" {
		return DriveFileView{}, ErrNotFound
	}

	row, err := s.q.GetDriveFileEnriched(ctx, db.GetDriveFileEnrichedParams{
		ViewerUserID:   actor.ID,
		ID:             driveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DriveFileView{}, ErrNotFound
	}
	if err != nil {
		return DriveFileView{}, err
	}

	tasksByFile, err := s.loadVisibleTasksByFileIDs(ctx, actor.ID, member, ws, []string{row.ID})
	if err != nil {
		return DriveFileView{}, err
	}
	visibleTasks := tasksByFile[row.ID]

	// Read gate (spec §7.6a): caller must either have a drive_file_access row OR
	// be able to view at least one task to which this file is currently linked.
	if !row.ViewerAccessState.Valid && len(visibleTasks) == 0 {
		return DriveFileView{}, ErrNotFound
	}

	if refreshed, ok := s.maybeRefreshDetailRow(ctx, actor.ID, ws, row); ok {
		row = refreshed
	}

	var summary DriveTasksCreatedSummary
	var groups []DriveTaskCreationGroup
	if s.creations != nil {
		if summaries, serr := s.creations.LoadTasksCreatedSummaries(ctx, actor.ID, member, ws, []string{row.ExternalFileID}); serr == nil {
			summary = summaries[row.ExternalFileID]
		}
		if g, gerr := s.creations.LoadTaskCreationGroups(ctx, actor.ID, member, ws, row.ExternalFileID, 5); gerr == nil {
			groups = g
		}
	}
	if groups == nil {
		groups = []DriveTaskCreationGroup{}
	}

	return s.buildDriveFileViewFromDetailRow(actor.ID, member, row, visibleTasks, summary, groups), nil
}

// ListForTask returns the Google Drive file cards attached to taskID
// (GET /api/v1/tasks/{taskID}/drive-files; spec §7.3, §7.6a, §8.8).
func (s *DriveFileService) ListForTask(ctx context.Context, actor Actor, taskID string) ([]DriveTaskFileCardView, error) {
	if actor.Kind != audit.KindHuman {
		return nil, ErrForbidden
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, ErrNotFound
	}
	task, err := s.q.GetTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	member, err := s.ws.RequireMember(ctx, task.WorkspaceID, actor.ID)
	if err != nil {
		return nil, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, task.OrganizationID) {
		return nil, errDriveFeatureDisabled()
	}
	if !s.canViewTask(ctx, actor.ID, member, task.ID) {
		return nil, ErrNotFound
	}
	ws, err := s.q.GetWorkspaceByID(ctx, task.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.q.ListTaskDriveFilesEnriched(ctx, db.ListTaskDriveFilesEnrichedParams{
		ViewerUserID:   actor.ID,
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		TaskID:         task.ID,
	})
	if err != nil {
		return nil, err
	}

	parentCache := make(map[string]string, len(rows))
	for i := range rows {
		if refreshed, ok := s.maybeRefreshTaskCardRow(ctx, actor.ID, ws, rows[i], parentCache); ok {
			rows[i] = refreshed
		}
	}

	extIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		extIDs = append(extIDs, r.ExternalFileID)
	}
	var summariesByExt map[string]DriveTasksCreatedSummary
	if s.creations != nil && len(extIDs) > 0 {
		summariesByExt, _ = s.creations.LoadTasksCreatedSummaries(ctx, actor.ID, member, ws, extIDs)
	}

	canRemove := s.canEditTask(ctx, actor.ID, member, task.ID)
	out := make([]DriveTaskFileCardView, 0, len(rows))
	for _, r := range rows {
		var summary DriveTasksCreatedSummary
		if summariesByExt != nil {
			summary = summariesByExt[r.ExternalFileID]
		}
		out = append(out, s.buildDriveTaskFileCardView(actor.ID, member, r, canRemove, summary))
	}
	return out, nil
}

// PickerToken issues a short-lived Google OAuth access token for the caller's
// own connection to initialize the browser Google Picker
// (POST /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token;
// spec §7.1).
func (s *DriveFileService) PickerToken(ctx context.Context, actor Actor, workspaceID, driveConnectionID string) (DrivePickerTokenView, error) {
	if s == nil || s.connections == nil {
		return DrivePickerTokenView{}, errDriveFeatureDisabled()
	}
	return s.connections.PickerToken(ctx, actor, workspaceID, driveConnectionID)
}

// AuthorizeDriveFileHistory enforces the spec §7.6a read gate on
// GET /api/v1/workspaces/{workspaceID}/audit-events?resource_type=drive_file&resource_id=X:
// caller must be a workspace member and either hold a drive_file_access row on X
// or be able to view at least one task linked to X.
func (s *DriveFileService) AuthorizeDriveFileHistory(ctx context.Context, userID, workspaceID, driveFileID string) error {
	ws, member, err := s.workspaceAndMember(ctx, Human(userID), workspaceID)
	if err != nil {
		return err
	}
	driveFileID = strings.TrimSpace(driveFileID)
	if driveFileID == "" {
		return ErrNotFound
	}
	// If the caller has a drive_file_access row for this file in the workspace,
	// they may read its history even after the file was unlinked.
	if _, aerr := s.q.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    driveFileID,
		UserID:         userID,
	}); aerr == nil {
		return nil
	}
	f, err := s.q.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
		ID:             driveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	tasksByFile, err := s.loadVisibleTasksByFileIDs(ctx, userID, member, ws, []string{f.ID})
	if err != nil {
		return err
	}
	if len(tasksByFile[f.ID]) == 0 {
		return ErrNotFound
	}
	return nil
}

// AuthorizeDriveConnectionHistory enforces the spec §7.6a read gate on
// GET /api/v1/workspaces/{workspaceID}/audit-events?resource_type=drive_connection&resource_id=X:
// caller must own the drive_connection row in the workspace's organization.
func (s *DriveFileService) AuthorizeDriveConnectionHistory(ctx context.Context, userID, workspaceID, driveConnectionID string) error {
	ws, _, err := s.workspaceAndMember(ctx, Human(userID), workspaceID)
	if err != nil {
		return err
	}
	driveConnectionID = strings.TrimSpace(driveConnectionID)
	if driveConnectionID == "" {
		return ErrNotFound
	}
	if _, err := s.q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             driveConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// LookupFileForRead implements driveFileAccessLookup for DriveContentService.ReadForAI
// (spec §6.3, §7.6a, §8.3, ADR 0047). It resolves the Drive file in workspaceID,
// enforces the visibility gate (so a user who cannot see the file gets
// ErrDriveFileNotFound -> 404 before any 409 access error), and returns the
// requester's own drive_file_access state and connection — never another
// member's connection.
func (s *DriveFileService) LookupFileForRead(ctx context.Context, requesterID, workspaceID, driveFileID string) (driveFileAccessRow, error) {
	ws, member, err := s.workspaceAndMember(ctx, Human(requesterID), workspaceID)
	if err != nil {
		if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return driveFileAccessRow{}, ErrDriveFileNotFound
		}
		return driveFileAccessRow{}, err
	}
	if s.connections == nil || !s.connections.Available() || !s.flagEnabledForMember(ctx, requesterID, ws.OrganizationID) {
		return driveFileAccessRow{}, ErrDriveUnavailable
	}
	f, err := s.q.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
		ID:             strings.TrimSpace(driveFileID),
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return driveFileAccessRow{}, ErrDriveFileNotFound
	}
	if err != nil {
		return driveFileAccessRow{}, err
	}

	acc, aerr := s.q.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    f.ID,
		UserID:         requesterID,
	})
	if aerr != nil && !errors.Is(aerr, pgx.ErrNoRows) {
		return driveFileAccessRow{}, aerr
	}
	hasAcc := aerr == nil

	if !hasAcc {
		tasksByFile, terr := s.loadVisibleTasksByFileIDs(ctx, requesterID, member, ws, []string{f.ID})
		if terr != nil {
			return driveFileAccessRow{}, terr
		}
		if len(tasksByFile[f.ID]) == 0 {
			return driveFileAccessRow{}, ErrDriveFileNotFound
		}
		return driveFileAccessRow{
			DriveFileID:    f.ID,
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			ExternalFileID: f.ExternalFileID,
			Name:           f.Name,
			MimeType:       f.MimeType,
			HasAccessRow:   false,
		}, nil
	}

	conn, _ := s.q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             acc.ConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         requesterID,
	})

	return driveFileAccessRow{
		DriveFileID:    f.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		ExternalFileID: f.ExternalFileID,
		Name:           f.Name,
		MimeType:       f.MimeType,
		HasAccessRow:   true,
		AccessState:    acc.State,
		Connection:     conn,
	}, nil
}

// RecordFileAccessLost implements driveFileAccessLostRecorder for DriveContentService
// and metadata/grant/rebind checks (spec §6.2, §6.3, §7.4).
func (s *DriveFileService) RecordFileAccessLost(ctx context.Context, userID, workspaceID, driveFileID, connectionID string) error {
	if s == nil || s.pool == nil || s.q == nil {
		return nil
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil
	}
	s.maybeRecordAccessLost(ctx, userID, ws.OrganizationID, ws.ID, driveFileID, connectionID, ErrDriveFileNotAccessible)
	return nil
}

// RecordFileMetadataRefresh implements driveFileMetadataRecorder for DriveContentService
// so every ReadForAI call also refreshes the file's metadata snapshot.
func (s *DriveFileService) RecordFileMetadataRefresh(ctx context.Context, workspaceID, driveFileID string, meta DriveFileMetadata) error {
	if s == nil || s.q == nil {
		return nil
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil
	}
	params := normalizeMetadataForDB(meta, meta.ExternalFileID, s.nowUTC())
	_, _ = s.q.UpdateDriveFileMetadata(ctx, db.UpdateDriveFileMetadataParams{
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
		ID:                     driveFileID,
		OrganizationID:         ws.OrganizationID,
		WorkspaceID:            ws.ID,
	})
	return nil
}

func (s *DriveFileService) maybeRecordAccessLostByExternalID(ctx context.Context, userID, orgID, workspaceID, externalFileID, connectionID string, err error) {
	if !shouldMarkDriveAccessLost(err) || s == nil || s.pool == nil || s.q == nil {
		return
	}
	txCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), driveAuditTxTimeout)
	defer cancel()
	tx, berr := s.pool.Begin(txCtx)
	if berr != nil {
		return
	}
	qtx := s.q.WithTx(tx)
	f, ferr := qtx.GetActiveDriveFileByExternalIDForUpdate(txCtx, db.GetActiveDriveFileByExternalIDForUpdateParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		ExternalFileID: externalFileID,
	})
	_ = tx.Rollback(txCtx)
	if ferr != nil {
		return
	}
	s.maybeRecordAccessLost(ctx, userID, orgID, workspaceID, f.ID, connectionID, err)
}

func (s *DriveFileService) maybeRecordAccessLost(ctx context.Context, userID, orgID, workspaceID, driveFileID, connectionID string, cause error) {
	if !shouldMarkDriveAccessLost(cause) || s == nil || s.pool == nil || s.q == nil {
		return
	}
	txCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), driveAuditTxTimeout)
	defer cancel()

	tx, err := s.pool.Begin(txCtx)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(txCtx) }()
	qtx := s.q.WithTx(tx)

	lockedFile, err := qtx.GetActiveDriveFileByIDForUpdate(txCtx, db.GetActiveDriveFileByIDForUpdateParams{
		ID:             driveFileID,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
	})
	if err != nil {
		return
	}

	_, aerr := qtx.MarkDriveFileAccessLost(txCtx, db.MarkDriveFileAccessLostParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		DriveFileID:    lockedFile.ID,
		UserID:         userID,
		ConnectionID:   connectionID,
	})
	accessChanged := aerr == nil

	boundChanged := false
	if lockedFile.ConnectionID == connectionID {
		if _, berr := qtx.MarkDriveFileBoundAccessLost(txCtx, db.MarkDriveFileBoundAccessLostParams{
			ID:             lockedFile.ID,
			OrganizationID: orgID,
			WorkspaceID:    workspaceID,
			ConnectionID:   connectionID,
		}); berr == nil {
			boundChanged = true
		}
	}

	if !accessChanged && !boundChanged {
		return
	}

	var googleEmail, googleSub string
	if conn, cerr := qtx.GetDriveConnectionAnyState(txCtx, db.GetDriveConnectionAnyStateParams{
		ID:             connectionID,
		OrganizationID: orgID,
		UserID:         userID,
	}); cerr == nil {
		googleEmail = conn.GoogleEmail
		googleSub = conn.GoogleSub
	}

	var events []audit.Event
	if accessChanged {
		events = append(events, audit.Event{
			Topic:   "drive_file.access_changed",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": lockedFile.ID,
				"workspace_id":  workspaceID,
				"user_id":       userID,
			},
		})
	}
	if boundChanged {
		events = append(events, audit.Event{
			Topic:   "drive_file.updated",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": lockedFile.ID,
				"workspace_id":  workspaceID,
			},
		})
	}

	if err := auditRecorder.Record(txCtx, qtx, audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Actor:          audit.User(userID),
		Action:         audit.ActionDriveFileAccessLost,
		ResourceType:   "drive_file",
		ResourceID:     lockedFile.ID,
		Metadata: map[string]any{
			"user_id":       userID,
			"connection_id": connectionID,
			"google_email":  googleEmail,
			"google_sub":    googleSub,
		},
	}, events...); err != nil {
		return
	}
	_ = tx.Commit(txCtx)
}
