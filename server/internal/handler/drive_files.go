package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) resolveTaskID(r *http.Request, actor service.Actor) string {
	ref := chi.URLParam(r, "taskID")
	if h.Tasks != nil {
		if t, err := h.Tasks.GetByRef(r.Context(), actor, ref); err == nil {
			return t.ID
		}
	}
	return ref
}

// GetDrivePickerToken issues a short-lived Google OAuth access token for one of
// the caller's own active Drive connections so the browser can open Google Picker
// (POST /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token;
// spec §7.1, §17.5). Never returns a refresh token, and refuses native desktop
// sessions.
func (h *handlers) GetDrivePickerToken(w http.ResponseWriter, r *http.Request) {
	if middleware.DeviceSession(r.Context()) {
		respondError(w, http.StatusForbidden, "forbidden", "desktop sessions cannot mint Google Picker tokens")
		return
	}
	if r.ContentLength != 0 {
		var in struct{}
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
	}
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	connID := chi.URLParam(r, "driveConnectionID")
	var (
		tok service.DrivePickerTokenView
		err error
	)
	switch {
	case h.DriveFiles != nil:
		tok, err = h.DriveFiles.PickerToken(r.Context(), actor, wsID, connID)
	case h.DriveConnections != nil:
		tok, err = h.DriveConnections.PickerToken(r.Context(), actor, wsID, connID)
	default:
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	var exp string
	if !tok.ExpiresAt.IsZero() {
		exp = tok.ExpiresAt.UTC().Format(time.RFC3339)
	}
	respondJSON(w, http.StatusOK, sdo.DrivePickerTokenSDO{
		AccessToken:  tok.AccessToken,
		ExpiresAt:    exp,
		DeveloperKey: tok.DeveloperKey,
		AppID:        tok.AppID,
	})
}

// LinkDriveFiles links 1..20 Google Drive files to the workspace (and optionally
// a task) using the caller's active connection
// (POST /api/v1/workspaces/{workspaceID}/drive-files; spec §7.2).
func (h *handlers) LinkDriveFiles(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	var in sdi.LinkDriveFilesSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.DriveFiles.Link(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		service.LinkDriveFilesInput{
			ConnectionID:    in.ConnectionID,
			ExternalFileIDs: in.ExternalFileIDs,
			TaskID:          in.TaskID,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.DriveFileLinkItemDTO, 0, len(res))
	for _, r := range res {
		items = append(items, toDriveFileLinkItemDTO(r))
	}
	respondJSON(w, http.StatusOK, sdo.DriveFileLinkResultsSDO{Results: items})
}

// parseListDriveFilesLimit parses and clamps the optional ?limit= query
// parameter of GET /api/v1/workspaces/{workspaceID}/drive-files before
// narrowing int to int32 (B4b-F06).
func parseListDriveFilesLimit(raw string) (int32, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 0, false
	}
	if n > 100 {
		n = 100
	}
	return int32(n), true
}

// ListDriveFiles lists the caller's own Google Drive file references in the
// workspace (GET /api/v1/workspaces/{workspaceID}/drive-files; spec §7.6).
func (h *handlers) ListDriveFiles(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	q := r.URL.Query()
	limit, ok := parseListDriveFilesLimit(q.Get("limit"))
	if !ok {
		respondError(w, http.StatusBadRequest, "invalid_request", "limit phải là số nguyên dương")
		return
	}
	connID := strings.TrimSpace(q.Get("connection_id"))
	if connID == "" {
		connID = strings.TrimSpace(q.Get("drive_connection_id"))
	}
	res, err := h.DriveFiles.ListMine(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		service.ListDriveFilesFilter{
			ConnectionID:  connID,
			DriveFolderID: q.Get("drive_folder_id"),
			Cursor:        q.Get("cursor"),
			Limit:         limit,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	files := make([]sdo.DriveFileDTO, 0, len(res.Files))
	for _, f := range res.Files {
		files = append(files, toDriveFileDTO(f))
	}
	respondJSON(w, http.StatusOK, sdo.DriveFileListSDO{
		Files:         files,
		TotalCount:    res.TotalCount,
		NextCursor:    res.NextCursor,
		DriveFolderID: res.DriveFolderID,
	})
}

// ListDriveFolders returns the aggregate list of parent Drive folders for the
// caller's Drive library in the workspace
// (GET /api/v1/workspaces/{workspaceID}/drive-folders; UNI-2221).
func (h *handlers) ListDriveFolders(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	connID := strings.TrimSpace(r.URL.Query().Get("drive_connection_id"))
	rows, err := h.DriveFiles.ListFolders(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		connID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	folders := make([]sdo.DriveFolderGroupDTO, 0, len(rows))
	for _, row := range rows {
		folders = append(folders, sdo.DriveFolderGroupDTO{
			ID:        row.ID,
			Name:      row.Name,
			FileCount: row.FileCount,
		})
	}
	respondJSON(w, http.StatusOK, sdo.DriveFolderListSDO{Folders: folders})
}

// GetDriveFile returns the detail of a Drive file reference in the workspace
// (GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}; spec §7.6a, §7.7).
func (h *handlers) GetDriveFile(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	v, err := h.DriveFiles.Get(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFileID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DriveFileSDO{File: toDriveFileDTO(v)})
}

// UnlinkDriveFile soft-deletes a Drive file reference from the workspace and
// removes all of its task links in the same transaction
// (DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}; spec §7.7).
func (h *handlers) UnlinkDriveFile(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	err := h.DriveFiles.Unlink(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFileID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// GrantDriveFileAccess grants read access for the caller after selecting the
// file in Google Picker setFileIds
// (POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access; spec §7.4).
func (h *handlers) GrantDriveFileAccess(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	var in sdi.GrantDriveFileAccessSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.DriveFiles.GrantAccess(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFileID"),
		in.ConnectionID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DriveFileSDO{File: toDriveFileDTO(v)})
}

// ChangeDriveFileReadAccount switches the caller's own reading account on a
// Drive file (PUT /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access;
// spec §6.3, W4 gaps §3).
func (h *handlers) ChangeDriveFileReadAccount(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	var in sdi.GrantDriveFileAccessSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.DriveFiles.ChangeReadAccount(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFileID"),
		in.ConnectionID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DriveFileSDO{File: toDriveFileDTO(v)})
}

// RebindDriveFile rebinds the file's bound connection and bound_by to a
// connection owned by the caller
// (POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind; spec §7.7).
func (h *handlers) RebindDriveFile(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	var in sdi.RebindDriveFileSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.DriveFiles.Rebind(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFileID"),
		in.ConnectionID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DriveFileSDO{File: toDriveFileDTO(v)})
}

// NameDriveFolder resolves a Google Drive folder's name using the caller's own
// active connection and sets drive_folder_name on all active drive_files in the
// workspace with that parent folder ID
// (POST /api/v1/workspaces/{workspaceID}/drive-folders/{driveFolderID}/name; UNI-2221).
func (h *handlers) NameDriveFolder(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	var in sdi.NameDriveFolderSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.DriveFiles.NameFolder(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFolderID"),
		in.DriveConnectionID,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DriveFolderNamedSDO{
		DriveFolder: sdo.DriveFolderRefDTO{
			ID:   res.DriveFolder.ID,
			Name: res.DriveFolder.Name,
		},
		UpdatedCount: res.UpdatedCount,
	})
}

// ListTaskDriveFiles returns the Google Drive file cards attached to a task
// (GET /api/v1/tasks/{taskID}/drive-files; spec §7.3).
func (h *handlers) ListTaskDriveFiles(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	taskID := h.resolveTaskID(r, actor)
	rows, err := h.DriveFiles.ListForTask(r.Context(), actor, taskID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	cards := make([]sdo.DriveTaskFileCardDTO, 0, len(rows))
	for _, row := range rows {
		cards = append(cards, toDriveTaskFileCardDTO(row))
	}
	respondJSON(w, http.StatusOK, sdo.DriveTaskFileListSDO{Files: cards})
}

// RemoveTaskDriveFile detaches a Google Drive file reference from a task
// (DELETE /api/v1/tasks/{taskID}/drive-files/{driveFileID}; spec §7.3).
func (h *handlers) RemoveTaskDriveFile(w http.ResponseWriter, r *http.Request) {
	if h.DriveFiles == nil {
		h.mapServiceError(w, service.ErrDriveNotConfigured)
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	taskID := h.resolveTaskID(r, actor)
	err := h.DriveFiles.RemoveFromTask(
		r.Context(),
		actor,
		taskID,
		chi.URLParam(r, "driveFileID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

func formatOptTime(t *time.Time) *string {
	if t == nil || t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func toDriveLinkedTaskRefDTOs(in []service.DriveLinkedTaskRef) []sdo.DriveLinkedTaskRefDTO {
	out := make([]sdo.DriveLinkedTaskRefDTO, 0, len(in))
	for _, t := range in {
		out = append(out, sdo.DriveLinkedTaskRefDTO{
			TaskID:     t.TaskID,
			Identifier: t.Identifier,
			Title:      t.Title,
			Status:     t.Status,
		})
	}
	return out
}

func toDriveTasksCreatedSummaryDTO(in service.DriveTasksCreatedSummary) sdo.DriveTasksCreatedSummaryDTO {
	return sdo.DriveTasksCreatedSummaryDTO{
		Count:             in.Count,
		LastCreatedAt:     formatOptTime(in.LastCreatedAt),
		LastCreatedByName: in.LastCreatedByName,
	}
}

func toDriveTaskCreationGroupDTOs(in []service.DriveTaskCreationGroup) []sdo.DriveTaskCreationGroupDTO {
	if in == nil {
		return nil
	}
	out := make([]sdo.DriveTaskCreationGroupDTO, 0, len(in))
	for _, g := range in {
		var createdAt string
		if !g.CreatedAt.IsZero() {
			createdAt = g.CreatedAt.UTC().Format(time.RFC3339)
		}
		out = append(out, sdo.DriveTaskCreationGroupDTO{
			ProposalID:    g.ProposalID,
			CreatedAt:     createdAt,
			CreatedByID:   g.CreatedByID,
			CreatedByName: g.CreatedByName,
			Tasks:         toDriveLinkedTaskRefDTOs(g.Tasks),
		})
	}
	return out
}

func toDriveFileDTO(v service.DriveFileView) sdo.DriveFileDTO {
	dto := sdo.DriveFileDTO{
		ID:                     v.ID,
		OrganizationID:         v.OrganizationID,
		WorkspaceID:            v.WorkspaceID,
		ExternalFileID:         v.ExternalFileID,
		DriveID:                v.DriveID,
		DriveFolder:            toDriveFolderRefDTO(v.DriveFolder),
		Name:                   v.Name,
		MimeType:               v.MimeType,
		IconKind:               v.IconKind,
		WebViewLink:            v.WebViewLink,
		OpenURL:                v.OpenURL,
		OwnerDisplay:           v.OwnerDisplay,
		DriveModifiedAt:        formatOptTime(v.DriveModifiedAt),
		DriveModifiedByDisplay: v.DriveModifiedByDisplay,
		SharingState:           v.SharingState,
		SharedUserCount:        v.SharedUserCount,
		ConnectionID:           v.ConnectionID,
		BoundAccountEmail:      v.BoundAccountEmail,
		BoundConnectionLost:    v.BoundConnectionLost,
		AccessLostAt:           formatOptTime(v.AccessLostAt),
		BoundByID:              v.BoundByID,
		BoundByName:            v.BoundByName,
		CreatedBy:              v.CreatedBy,
		CreatedByKind:          v.CreatedByKind,
		CreatedByName:          v.CreatedByName,
		MetadataRefreshedAt:    formatOptTime(v.MetadataRefreshedAt),
		ViewerAccess:           v.ViewerAccess,
		ViewerConnectionID:     v.ViewerConnectionID,
		ViewerAccountEmail:     v.ViewerAccountEmail,
		CanUnlink:              v.CanUnlink,
		CanRebind:              v.CanRebind,
		CanPropose:             v.CanPropose,
		CanAsk:                 v.CanAsk,
		UsedInCount:            v.UsedInCount,
		UsedInTasks:            toDriveLinkedTaskRefDTOs(v.UsedInTasks),
		TasksCreated:           toDriveTasksCreatedSummaryDTO(v.TasksCreated),
		TaskCreations:          toDriveTaskCreationGroupDTOs(v.TaskCreations),
	}
	if !v.CreatedAt.IsZero() {
		dto.CreatedAt = v.CreatedAt.UTC().Format(time.RFC3339)
	}
	if !v.UpdatedAt.IsZero() {
		dto.UpdatedAt = v.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return dto
}

func toDriveFolderRefDTO(v *service.DriveFolderRefView) *sdo.DriveFolderRefDTO {
	if v == nil || v.ID == "" {
		return nil
	}
	return &sdo.DriveFolderRefDTO{
		ID:   v.ID,
		Name: v.Name,
	}
}

func toDriveFileLinkReceiptDTO(v *service.DriveFileLinkReceiptView) *sdo.DriveFileLinkReceiptDTO {
	if v == nil {
		return nil
	}
	return &sdo.DriveFileLinkReceiptDTO{
		ID:                 v.ID,
		WorkspaceID:        v.WorkspaceID,
		ExternalFileID:     v.ExternalFileID,
		DriveID:            v.DriveID,
		Name:               v.Name,
		MimeType:           v.MimeType,
		IconKind:           v.IconKind,
		SharingState:       v.SharingState,
		WebViewLink:        v.WebViewLink,
		OpenURL:            v.OpenURL,
		ViewerAccess:       v.ViewerAccess,
		ViewerConnectionID: v.ViewerConnectionID,
		ViewerAccountEmail: v.ViewerAccountEmail,
	}
}

func toDriveFileLinkItemDTO(v service.DriveFileLinkItemResult) sdo.DriveFileLinkItemDTO {
	return sdo.DriveFileLinkItemDTO{
		ExternalFileID: v.ExternalFileID,
		Outcome:        v.Outcome,
		File:           toDriveFileLinkReceiptDTO(v.File),
		AccountEmail:   v.AccountEmail,
		ErrorCode:      v.ErrorCode,
		ErrorMessage:   v.ErrorMessage,
	}
}

func toDriveTaskFileCardDTO(v service.DriveTaskFileCardView) sdo.DriveTaskFileCardDTO {
	dto := sdo.DriveTaskFileCardDTO{
		ID:                     v.ID,
		TaskID:                 v.TaskID,
		WorkspaceID:            v.WorkspaceID,
		ExternalFileID:         v.ExternalFileID,
		DriveID:                v.DriveID,
		Name:                   v.Name,
		MimeType:               v.MimeType,
		IconKind:               v.IconKind,
		SharingState:           v.SharingState,
		OwnerDisplay:           v.OwnerDisplay,
		DriveModifiedAt:        formatOptTime(v.DriveModifiedAt),
		DriveModifiedByDisplay: v.DriveModifiedByDisplay,
		ConnectionID:           v.ConnectionID,
		BoundAccountEmail:      v.BoundAccountEmail,
		BoundConnectionLost:    v.BoundConnectionLost,
		AccessLostAt:           formatOptTime(v.AccessLostAt),
		BoundByID:              v.BoundByID,
		BoundByName:            v.BoundByName,
		CreatedBy:              v.CreatedBy,
		CreatedByName:          v.CreatedByName,
		ViewerAccess:           v.ViewerAccess,
		ViewerConnectionID:     v.ViewerConnectionID,
		ViewerAccountEmail:     v.ViewerAccountEmail,
		OpenURL:                v.OpenURL,
		CanRemoveFromTask:      v.CanRemoveFromTask,
		CanPropose:             v.CanPropose,
		CanAsk:                 v.CanAsk,
		TasksCreated:           toDriveTasksCreatedSummaryDTO(v.TasksCreated),
	}
	if !v.LinkedAt.IsZero() {
		dto.LinkedAt = v.LinkedAt.UTC().Format(time.RFC3339)
	}
	return dto
}
