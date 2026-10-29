package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// BuildDriveOpenURL constructs the Google Drive URL for a viewer (spec §7.8):
// when viewerEmail is non-empty (caller has a drive_file_access row), it appends
// ?authuser=<viewerEmail>; otherwise it returns the base webViewLink (or the
// standard https://drive.google.com/open?id=<externalFileID> fallback).
func BuildDriveOpenURL(webViewLink, externalFileID, viewerEmail string) string {
	base := strings.TrimSpace(webViewLink)
	if base == "" {
		base = "https://drive.google.com/open?id=" + url.QueryEscape(strings.TrimSpace(externalFileID))
	}
	email := strings.TrimSpace(viewerEmail)
	if email == "" {
		return base
	}
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	q := u.Query()
	q.Set("authuser", email)
	u.RawQuery = q.Encode()
	return u.String()
}

type normalizedDriveMetadataParams struct {
	DriveID                pgtype.Text
	DriveFolderID          pgtype.Text
	DriveFolderName        pgtype.Text
	Name                   string
	MimeType               string
	IconKind               string
	WebViewLink            string
	OwnerDisplay           string
	DriveModifiedAt        pgtype.Timestamptz
	DriveModifiedByDisplay string
	SharingState           string
	SharedUserCount        pgtype.Int4
	MetadataRefreshedAt    pgtype.Timestamptz
}

func normalizeMetadataForDB(meta DriveFileMetadata, externalFileID string, refreshedAt time.Time) normalizedDriveMetadataParams {
	name := strings.TrimSpace(meta.Name)
	if name == "" {
		name = externalFileID
	}
	mime := strings.TrimSpace(meta.MimeType)
	if mime == "" {
		mime = "application/octet-stream"
	}
	iconKind := strings.TrimSpace(meta.IconKind)
	if iconKind == "" {
		iconKind = DriveIconKindForMimeType(mime)
	}
	webLink := strings.TrimSpace(meta.WebViewLink)
	if webLink == "" {
		webLink = "https://drive.google.com/open?id=" + url.QueryEscape(strings.TrimSpace(externalFileID))
	}
	driveIDStr := strings.TrimSpace(meta.DriveID)
	var driveID pgtype.Text
	if driveIDStr != "" {
		driveID = pgtype.Text{String: driveIDStr, Valid: true}
	}
	ownerDisplay := strings.TrimSpace(meta.OwnerDisplay)
	if ownerDisplay == "" && driveIDStr != "" {
		ownerDisplay = "Bộ nhớ dùng chung"
	}
	var modifiedAt pgtype.Timestamptz
	if meta.ModifiedAt != nil && !meta.ModifiedAt.IsZero() {
		modifiedAt = pgtype.Timestamptz{Time: meta.ModifiedAt.UTC(), Valid: true}
	}
	sharing := strings.TrimSpace(meta.SharingState)
	switch sharing {
	case DriveSharingStatePrivate, DriveSharingStateShared, DriveSharingStateUnknown:
	default:
		sharing = DriveSharingStateUnknown
	}
	var sharedCount pgtype.Int4
	if meta.SharedUserCount != nil {
		sharedCount = pgtype.Int4{Int32: int32(*meta.SharedUserCount), Valid: true}
	}
	var folderID, folderName pgtype.Text
	if fid := strings.TrimSpace(meta.ParentFolderID); fid != "" {
		folderID = pgtype.Text{String: fid, Valid: true}
		if fname := strings.TrimSpace(meta.ParentFolderName); fname != "" {
			folderName = pgtype.Text{String: fname, Valid: true}
		}
	}
	return normalizedDriveMetadataParams{
		DriveID:                driveID,
		DriveFolderID:          folderID,
		DriveFolderName:        folderName,
		Name:                   name,
		MimeType:               mime,
		IconKind:               iconKind,
		WebViewLink:            webLink,
		OwnerDisplay:           ownerDisplay,
		DriveModifiedAt:        modifiedAt,
		DriveModifiedByDisplay: strings.TrimSpace(meta.ModifiedByDisplay),
		SharingState:           sharing,
		SharedUserCount:        sharedCount,
		MetadataRefreshedAt:    pgtype.Timestamptz{Time: refreshedAt.UTC(), Valid: true},
	}
}

func (s *DriveFileService) requireVisibleDriveFile(ctx context.Context, userID string, member db.WorkspaceMember, ws db.Workspace, driveFileID string) (db.DriveFile, error) {
	f, err := s.q.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
		ID:             driveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveFile{}, ErrNotFound
	}
	if err != nil {
		return db.DriveFile{}, err
	}
	if _, aerr := s.q.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    f.ID,
		UserID:         userID,
	}); aerr == nil {
		return f, nil
	}
	tasksByFile, err := s.loadVisibleTasksByFileIDs(ctx, userID, member, ws, []string{f.ID})
	if err != nil {
		return db.DriveFile{}, err
	}
	if len(tasksByFile[f.ID]) == 0 {
		return db.DriveFile{}, ErrNotFound
	}
	return f, nil
}

func (s *DriveFileService) loadVisibleTasksByFileIDs(ctx context.Context, userID string, member db.WorkspaceMember, ws db.Workspace, fileIDs []string) (map[string][]DriveLinkedTaskRef, error) {
	out := make(map[string][]DriveLinkedTaskRef, len(fileIDs))
	if len(fileIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.ListLinkedTasksByDriveFileIDs(ctx, db.ListLinkedTasksByDriveFileIDsParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileIds:   fileIDs,
	})
	if err != nil {
		return nil, err
	}
	prefix := strings.TrimSpace(ws.TaskPrefix)
	if prefix == "" {
		prefix = strings.ToUpper(ws.Slug)
	}
	for _, r := range rows {
		if !s.canViewTask(ctx, userID, member, r.TaskID) {
			continue
		}
		identifier := fmt.Sprintf("%s-%d", prefix, r.TaskNumber)
		out[r.DriveFileID] = append(out[r.DriveFileID], DriveLinkedTaskRef{
			TaskID:     r.TaskID,
			Identifier: identifier,
			Title:      r.TaskTitle,
			Status:     r.TaskStatus,
		})
	}
	return out, nil
}

func (s *DriveFileService) isMetadataStale(refreshedAt pgtype.Timestamptz) bool {
	if !refreshedAt.Valid {
		return true
	}
	return s.nowUTC().Sub(refreshedAt.Time.UTC()) >= driveMetadataRefreshInterval
}

func upsertResolvedDriveFolders(
	ctx context.Context,
	q *db.Queries,
	ws db.Workspace,
	connectionID string,
	actor Actor,
	folders []DriveFolderMetadata,
	refreshedAt time.Time,
) error {
	if q == nil || len(folders) == 0 || strings.TrimSpace(connectionID) == "" || strings.TrimSpace(actor.ID) == "" {
		return nil
	}
	kind := strings.TrimSpace(string(actor.Kind))
	if kind == "" {
		kind = "human"
	}
	ts := pgtype.Timestamptz{Time: refreshedAt.UTC(), Valid: true}
	for _, f := range folders {
		fid := strings.TrimSpace(f.FolderID)
		fname := strings.TrimSpace(f.Name)
		if fid == "" || fname == "" {
			continue
		}
		var parentID pgtype.Text
		if pid := strings.TrimSpace(f.ParentFolderID); pid != "" && pid != fid {
			parentID = pgtype.Text{String: pid, Valid: true}
		}
		if _, err := q.UpsertDriveFolder(ctx, db.UpsertDriveFolderParams{
			ID:             util.NewID(),
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			ConnectionID:   connectionID,
			DriveFolderID:  fid,
			Name:           fname,
			ParentFolderID: parentID,
			RefreshedAt:    ts,
			CreatedBy:      actor.ID,
			CreatedByKind:  kind,
		}); err != nil {
			return err
		}
		if _, err := q.SetDriveFolderNameInWorkspace(ctx, db.SetDriveFolderNameInWorkspaceParams{
			DriveFolderName: fname,
			OrganizationID:  ws.OrganizationID,
			WorkspaceID:     ws.ID,
			DriveFolderID:   fid,
		}); err != nil {
			return err
		}
	}
	return nil
}

func resolveWorkspaceFolderNameFallback(ctx context.Context, q *db.Queries, ws db.Workspace, params *normalizedDriveMetadataParams) {
	if q == nil || params == nil || !params.DriveFolderID.Valid || params.DriveFolderName.Valid {
		return
	}
	if sibName, serr := q.GetWorkspaceDriveFolderName(ctx, db.GetWorkspaceDriveFolderNameParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFolderID:  params.DriveFolderID.String,
	}); serr == nil && strings.TrimSpace(sibName) != "" {
		params.DriveFolderName = pgtype.Text{String: strings.TrimSpace(sibName), Valid: true}
	}
}

func (s *DriveFileService) refreshFileWithViewerConnection(ctx context.Context, viewerID string, ws db.Workspace, driveFileID, externalFileID, viewerConnID string, parentCache driveFolderWalkCache) bool {
	if s == nil || s.api == nil || s.connections == nil || viewerConnID == "" {
		return false
	}
	conn, err := s.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{
		ID:             viewerConnID,
		OrganizationID: ws.OrganizationID,
		UserID:         viewerID,
	})
	if err != nil || conn.AuthFailedAt.Valid {
		return false
	}
	if _, err := s.q.ClaimDriveFileMetadataRefresh(ctx, db.ClaimDriveFileMetadataRefreshParams{
		ID:             driveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	}); err != nil {
		return false
	}
	meta, err := s.api.filesGetWithConnectionAndParentCache(ctx, s.connections, conn, externalFileID, parentCache)
	if err != nil {
		s.maybeRecordAccessLost(ctx, viewerID, ws.OrganizationID, ws.ID, driveFileID, conn.ID, err)
		return true
	}
	now := s.nowUTC()
	_ = upsertResolvedDriveFolders(ctx, s.q, ws, conn.ID, Human(viewerID), meta.ResolvedFolders, now)
	params := normalizeMetadataForDB(meta, externalFileID, now)
	resolveWorkspaceFolderNameFallback(ctx, s.q, ws, &params)
	if _, err := s.q.UpdateDriveFileMetadata(ctx, db.UpdateDriveFileMetadataParams{
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
	}); err != nil {
		return false
	}
	_, _ = s.q.TouchDriveFileAccessCheckedAt(ctx, db.TouchDriveFileAccessCheckedAtParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    driveFileID,
		UserID:         viewerID,
		ConnectionID:   conn.ID,
	})
	return true
}

func (s *DriveFileService) maybeRefreshEnrichedRow(ctx context.Context, viewerID string, ws db.Workspace, r db.ListMyDriveFilesEnrichedRow, parentCache driveFolderWalkCache) (db.ListMyDriveFilesEnrichedRow, bool) {
	if r.ViewerAccessState != "granted" || !r.ViewerConnectionActive || !s.isMetadataStale(r.MetadataRefreshedAt) {
		return r, false
	}
	if !s.refreshFileWithViewerConnection(ctx, viewerID, ws, r.ID, r.ExternalFileID, r.ViewerConnectionID, parentCache) {
		return r, false
	}
	detail, err := s.q.GetDriveFileEnriched(ctx, db.GetDriveFileEnrichedParams{
		ViewerUserID:   viewerID,
		ID:             r.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if err != nil {
		return r, false
	}
	return detailRowToListRow(detail), true
}

func (s *DriveFileService) maybeRefreshDetailRow(ctx context.Context, viewerID string, ws db.Workspace, r db.GetDriveFileEnrichedRow) (db.GetDriveFileEnrichedRow, bool) {
	if r.ViewerAccessState.String != "granted" || !r.ViewerConnectionActive || !s.isMetadataStale(r.MetadataRefreshedAt) {
		return r, false
	}
	if !s.refreshFileWithViewerConnection(ctx, viewerID, ws, r.ID, r.ExternalFileID, r.ViewerConnectionID.String, nil) {
		return r, false
	}
	detail, err := s.q.GetDriveFileEnriched(ctx, db.GetDriveFileEnrichedParams{
		ViewerUserID:   viewerID,
		ID:             r.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if err != nil {
		return r, false
	}
	return detail, true
}

func (s *DriveFileService) maybeRefreshTaskCardRow(ctx context.Context, viewerID string, ws db.Workspace, r db.ListTaskDriveFilesEnrichedRow, parentCache driveFolderWalkCache) (db.ListTaskDriveFilesEnrichedRow, bool) {
	if r.ViewerAccessState.String != "granted" || !r.ViewerConnectionActive || !s.isMetadataStale(r.MetadataRefreshedAt) {
		return r, false
	}
	if !s.refreshFileWithViewerConnection(ctx, viewerID, ws, r.ID, r.ExternalFileID, r.ViewerConnectionID.String, parentCache) {
		return r, false
	}
	detail, err := s.q.GetDriveFileEnriched(ctx, db.GetDriveFileEnrichedParams{
		ViewerUserID:   viewerID,
		ID:             r.ID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if err != nil {
		return r, false
	}
	r.DriveID = detail.DriveID
	r.DriveFolderID = detail.DriveFolderID
	r.DriveFolderName = detail.DriveFolderName
	r.Name = detail.Name
	r.MimeType = detail.MimeType
	r.IconKind = detail.IconKind
	r.WebViewLink = detail.WebViewLink
	r.OwnerDisplay = detail.OwnerDisplay
	r.DriveModifiedAt = detail.DriveModifiedAt
	r.DriveModifiedByDisplay = detail.DriveModifiedByDisplay
	r.SharingState = detail.SharingState
	r.SharedUserCount = detail.SharedUserCount
	r.AccessLostAt = detail.AccessLostAt
	r.MetadataRefreshedAt = detail.MetadataRefreshedAt
	r.ViewerAccessState = detail.ViewerAccessState
	r.ViewerConnectionID = detail.ViewerConnectionID
	r.ViewerAccountEmail = detail.ViewerAccountEmail
	r.ViewerConnectionActive = detail.ViewerConnectionActive
	return r, true
}

func detailRowToListRow(d db.GetDriveFileEnrichedRow) db.ListMyDriveFilesEnrichedRow {
	return db.ListMyDriveFilesEnrichedRow{
		ID:                     d.ID,
		OrganizationID:         d.OrganizationID,
		WorkspaceID:            d.WorkspaceID,
		ExternalFileID:         d.ExternalFileID,
		DriveID:                d.DriveID,
		ConnectionID:           d.ConnectionID,
		BoundBy:                d.BoundBy,
		CreatedBy:              d.CreatedBy,
		CreatedByKind:          d.CreatedByKind,
		Name:                   d.Name,
		MimeType:               d.MimeType,
		IconKind:               d.IconKind,
		WebViewLink:            d.WebViewLink,
		OwnerDisplay:           d.OwnerDisplay,
		DriveModifiedAt:        d.DriveModifiedAt,
		DriveModifiedByDisplay: d.DriveModifiedByDisplay,
		SharingState:           d.SharingState,
		SharedUserCount:        d.SharedUserCount,
		MetadataRefreshedAt:    d.MetadataRefreshedAt,
		AccessLostAt:           d.AccessLostAt,
		CreatedAt:              d.CreatedAt,
		UpdatedAt:              d.UpdatedAt,
		UnlinkedAt:             d.UnlinkedAt,
		UnlinkedBy:             d.UnlinkedBy,
		UnlinkedByKind:         d.UnlinkedByKind,
		DriveFolderID:          d.DriveFolderID,
		DriveFolderName:        d.DriveFolderName,
		BoundAccountEmail:      d.BoundAccountEmail,
		BoundConnectionLost:    d.BoundConnectionLost,
		BoundByName:            d.BoundByName,
		CreatedByName:          d.CreatedByName,
		ViewerAccessID:         d.ViewerAccessID.String,
		ViewerConnectionID:     d.ViewerConnectionID.String,
		ViewerAccessState:      d.ViewerAccessState.String,
		ViewerAccountEmail:     d.ViewerAccountEmail,
		ViewerConnectionActive: d.ViewerConnectionActive,
	}
}

func computeViewerAccess(accessState, viewerConnID, viewerEmail string, connDisconnected, connAuthFailed bool) (string, *string, string) {
	switch accessState {
	case "granted":
		cid := viewerConnID
		if connDisconnected || connAuthFailed {
			return DriveViewerAccessConnectionLost, &cid, viewerEmail
		}
		return DriveViewerAccessGranted, &cid, viewerEmail
	case "lost":
		cid := viewerConnID
		return DriveViewerAccessLost, &cid, viewerEmail
	default:
		return DriveViewerAccessUnknown, nil, ""
	}
}

func (s *DriveFileService) buildDriveFileViewFromDetailRow(
	viewerID string,
	member db.WorkspaceMember,
	r db.GetDriveFileEnrichedRow,
	visibleTasks []DriveLinkedTaskRef,
	tasksCreated DriveTasksCreatedSummary,
	taskCreations []DriveTaskCreationGroup,
) DriveFileView {
	viewerAccess, viewerConnID, viewerEmail := computeViewerAccess(
		r.ViewerAccessState.String,
		r.ViewerConnectionID.String,
		r.ViewerAccountEmail,
		!r.ViewerConnectionActive,
		!r.ViewerConnectionActive,
	)

	var driveID *string
	if r.DriveID.Valid && r.DriveID.String != "" {
		v := r.DriveID.String
		driveID = &v
	}
	var driveFolder *DriveFolderRefView
	if r.DriveFolderID.Valid && strings.TrimSpace(r.DriveFolderID.String) != "" {
		ref := &DriveFolderRefView{
			ID: strings.TrimSpace(r.DriveFolderID.String),
		}
		if r.DriveFolderName.Valid && strings.TrimSpace(r.DriveFolderName.String) != "" {
			fname := strings.TrimSpace(r.DriveFolderName.String)
			ref.Name = &fname
		}
		driveFolder = ref
	}
	var modifiedAt *time.Time
	if r.DriveModifiedAt.Valid {
		t := r.DriveModifiedAt.Time.UTC()
		modifiedAt = &t
	}
	var sharedCount *int
	if r.SharedUserCount.Valid {
		n := int(r.SharedUserCount.Int32)
		sharedCount = &n
	}
	var accessLostAt *time.Time
	if r.AccessLostAt.Valid {
		t := r.AccessLostAt.Time.UTC()
		accessLostAt = &t
	}
	var refreshedAt *time.Time
	if r.MetadataRefreshedAt.Valid {
		t := r.MetadataRefreshedAt.Time.UTC()
		refreshedAt = &t
	}

	canManage := canManageDriveFile(viewerID, member, db.DriveFile{
		ID:        r.ID,
		BoundBy:   r.BoundBy,
		CreatedBy: r.CreatedBy,
	})
	canAI := viewerAccess == DriveViewerAccessGranted && s.isNotGuest(member) && s.isAIEnabled()

	if visibleTasks == nil {
		visibleTasks = []DriveLinkedTaskRef{}
	}

	return DriveFileView{
		ID:                     r.ID,
		OrganizationID:         r.OrganizationID,
		WorkspaceID:            r.WorkspaceID,
		ExternalFileID:         r.ExternalFileID,
		DriveID:                driveID,
		DriveFolder:            driveFolder,
		Name:                   r.Name,
		MimeType:               r.MimeType,
		IconKind:               r.IconKind,
		WebViewLink:            r.WebViewLink,
		OpenURL:                BuildDriveOpenURL(r.WebViewLink, r.ExternalFileID, viewerEmail),
		OwnerDisplay:           r.OwnerDisplay,
		DriveModifiedAt:        modifiedAt,
		DriveModifiedByDisplay: r.DriveModifiedByDisplay,
		SharingState:           r.SharingState,
		SharedUserCount:        sharedCount,
		ConnectionID:           r.ConnectionID,
		BoundAccountEmail:      r.BoundAccountEmail,
		BoundConnectionLost:    r.BoundConnectionLost,
		AccessLostAt:           accessLostAt,
		BoundByID:              r.BoundBy,
		BoundByName:            r.BoundByName,
		CreatedBy:              r.CreatedBy,
		CreatedByKind:          r.CreatedByKind,
		CreatedByName:          r.CreatedByName,
		CreatedAt:              r.CreatedAt.Time.UTC(),
		UpdatedAt:              r.UpdatedAt.Time.UTC(),
		MetadataRefreshedAt:    refreshedAt,
		ViewerAccess:           viewerAccess,
		ViewerConnectionID:     viewerConnID,
		ViewerAccountEmail:     viewerEmail,
		CanUnlink:              canManage,
		CanRebind:              canManage,
		CanPropose:             canAI,
		CanAsk:                 canAI,
		UsedInCount:            int64(len(visibleTasks)),
		UsedInTasks:            visibleTasks,
		TasksCreated:           tasksCreated,
		TaskCreations:          taskCreations,
	}
}

func (s *DriveFileService) buildDriveFileViewFromListRow(
	viewerID string,
	member db.WorkspaceMember,
	r db.ListMyDriveFilesEnrichedRow,
	visibleTasks []DriveLinkedTaskRef,
	tasksCreated DriveTasksCreatedSummary,
	taskCreations []DriveTaskCreationGroup,
) DriveFileView {
	return s.buildDriveFileViewFromDetailRow(viewerID, member, db.GetDriveFileEnrichedRow{
		ID:                     r.ID,
		OrganizationID:         r.OrganizationID,
		WorkspaceID:            r.WorkspaceID,
		ExternalFileID:         r.ExternalFileID,
		DriveID:                r.DriveID,
		ConnectionID:           r.ConnectionID,
		BoundBy:                r.BoundBy,
		CreatedBy:              r.CreatedBy,
		CreatedByKind:          r.CreatedByKind,
		Name:                   r.Name,
		MimeType:               r.MimeType,
		IconKind:               r.IconKind,
		WebViewLink:            r.WebViewLink,
		OwnerDisplay:           r.OwnerDisplay,
		DriveModifiedAt:        r.DriveModifiedAt,
		DriveModifiedByDisplay: r.DriveModifiedByDisplay,
		SharingState:           r.SharingState,
		SharedUserCount:        r.SharedUserCount,
		MetadataRefreshedAt:    r.MetadataRefreshedAt,
		AccessLostAt:           r.AccessLostAt,
		CreatedAt:              r.CreatedAt,
		UpdatedAt:              r.UpdatedAt,
		UnlinkedAt:             r.UnlinkedAt,
		UnlinkedBy:             r.UnlinkedBy,
		UnlinkedByKind:         r.UnlinkedByKind,
		DriveFolderID:          r.DriveFolderID,
		DriveFolderName:        r.DriveFolderName,
		BoundAccountEmail:      r.BoundAccountEmail,
		BoundConnectionLost:    r.BoundConnectionLost,
		BoundByName:            r.BoundByName,
		CreatedByName:          r.CreatedByName,
		ViewerAccessID:         pgtype.Text{String: r.ViewerAccessID, Valid: r.ViewerAccessID != ""},
		ViewerConnectionID:     pgtype.Text{String: r.ViewerConnectionID, Valid: r.ViewerConnectionID != ""},
		ViewerAccessState:      pgtype.Text{String: r.ViewerAccessState, Valid: r.ViewerAccessState != ""},
		ViewerAccountEmail:     r.ViewerAccountEmail,
		ViewerConnectionActive: r.ViewerConnectionActive,
	}, visibleTasks, tasksCreated, taskCreations)
}

func (s *DriveFileService) buildDriveTaskFileCardView(
	viewerID string,
	member db.WorkspaceMember,
	r db.ListTaskDriveFilesEnrichedRow,
	canRemoveFromTask bool,
	tasksCreated DriveTasksCreatedSummary,
) DriveTaskFileCardView {
	viewerAccess, viewerConnID, viewerEmail := computeViewerAccess(
		r.ViewerAccessState.String,
		r.ViewerConnectionID.String,
		r.ViewerAccountEmail,
		!r.ViewerConnectionActive,
		!r.ViewerConnectionActive,
	)

	var driveID *string
	if r.DriveID.Valid && r.DriveID.String != "" {
		v := r.DriveID.String
		driveID = &v
	}
	var modifiedAt *time.Time
	if r.DriveModifiedAt.Valid {
		t := r.DriveModifiedAt.Time.UTC()
		modifiedAt = &t
	}
	var accessLostAt *time.Time
	if r.AccessLostAt.Valid {
		t := r.AccessLostAt.Time.UTC()
		accessLostAt = &t
	}
	canAI := viewerAccess == DriveViewerAccessGranted && s.isNotGuest(member) && s.isAIEnabled()

	return DriveTaskFileCardView{
		ID:                     r.ID,
		TaskID:                 r.LinkedTaskID,
		WorkspaceID:            r.WorkspaceID,
		ExternalFileID:         r.ExternalFileID,
		DriveID:                driveID,
		Name:                   r.Name,
		MimeType:               r.MimeType,
		IconKind:               r.IconKind,
		SharingState:           r.SharingState,
		OwnerDisplay:           r.OwnerDisplay,
		DriveModifiedAt:        modifiedAt,
		DriveModifiedByDisplay: r.DriveModifiedByDisplay,
		ConnectionID:           r.ConnectionID,
		BoundAccountEmail:      r.BoundAccountEmail,
		BoundConnectionLost:    r.BoundConnectionLost,
		AccessLostAt:           accessLostAt,
		BoundByID:              r.BoundBy,
		BoundByName:            r.BoundByName,
		CreatedBy:              r.CreatedBy,
		CreatedByName:          r.CreatedByName,
		LinkedAt:               r.LinkedAt.Time.UTC(),
		ViewerAccess:           viewerAccess,
		ViewerConnectionID:     viewerConnID,
		ViewerAccountEmail:     viewerEmail,
		OpenURL:                BuildDriveOpenURL(r.WebViewLink, r.ExternalFileID, viewerEmail),
		CanRemoveFromTask:      canRemoveFromTask,
		CanPropose:             canAI,
		CanAsk:                 canAI,
		TasksCreated:           tasksCreated,
	}
}

func buildDriveFileLinkReceipt(f db.DriveFile, viewerAccess, viewerConnID, viewerEmail string) DriveFileLinkReceiptView {
	var driveID *string
	if f.DriveID.Valid && f.DriveID.String != "" {
		v := f.DriveID.String
		driveID = &v
	}
	var driveFolder *DriveFolderRefView
	if f.DriveFolderID.Valid && strings.TrimSpace(f.DriveFolderID.String) != "" {
		ref := &DriveFolderRefView{
			ID: strings.TrimSpace(f.DriveFolderID.String),
		}
		if f.DriveFolderName.Valid && strings.TrimSpace(f.DriveFolderName.String) != "" {
			fname := strings.TrimSpace(f.DriveFolderName.String)
			ref.Name = &fname
		}
		driveFolder = ref
	}
	if viewerAccess == "" {
		viewerAccess = DriveViewerAccessGranted
	}
	cid := viewerConnID
	return DriveFileLinkReceiptView{
		ID:                 f.ID,
		WorkspaceID:        f.WorkspaceID,
		ExternalFileID:     f.ExternalFileID,
		DriveID:            driveID,
		DriveFolder:        driveFolder,
		Name:               f.Name,
		MimeType:           f.MimeType,
		IconKind:           f.IconKind,
		SharingState:       f.SharingState,
		WebViewLink:        f.WebViewLink,
		OpenURL:            BuildDriveOpenURL(f.WebViewLink, f.ExternalFileID, viewerEmail),
		ViewerAccess:       viewerAccess,
		ViewerConnectionID: &cid,
		ViewerAccountEmail: viewerEmail,
	}
}
