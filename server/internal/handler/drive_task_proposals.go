package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// CreateDriveTaskProposal reads a linked Google Drive file through the caller's
// own Drive connection, invokes the AI Gateway to extract proposed tasks, and
// stores a 7-day ready proposal batch (POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals, spec §8.1–§8.3).
func (h *handlers) CreateDriveTaskProposal(w http.ResponseWriter, r *http.Request) {
	if h.DriveTaskProposals == nil {
		respondError(w, http.StatusServiceUnavailable, sdo.DriveErrUnavailable, "Tính năng Google Drive đang tạm thời không khả dụng.")
		return
	}
	var in sdi.CreateDriveTaskProposalSDI
	if r.ContentLength != 0 {
		if !decode(w, r, &in, maxJSONBody) {
			return
		}
	}
	locale := "vi"
	if c, err := r.Cookie("uniwork-locale"); err == nil && c.Value != "" {
		locale = summaryLocale(c.Value)
	}
	v, err := h.DriveTaskProposals.Propose(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "driveFileID"),
		service.ProposeDriveTasksInput{
			Prompt:        in.Prompt,
			ProjectID:     in.ProjectID,
			ParentTaskID:  in.ParentTaskID,
			ContextTaskID: in.ContextTaskID,
			Locale:        locale,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, toDriveTaskProposalSDO(v))
}

// GetDriveTaskProposal returns a ready, non-expired Google Drive task proposal
// batch owned by the caller (GET /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}, spec §8.3).
func (h *handlers) GetDriveTaskProposal(w http.ResponseWriter, r *http.Request) {
	if h.DriveTaskProposals == nil {
		respondError(w, http.StatusServiceUnavailable, sdo.DriveErrUnavailable, "Tính năng Google Drive đang tạm thời không khả dụng.")
		return
	}
	v, err := h.DriveTaskProposals.Get(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "proposalID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toDriveTaskProposalSDO(v))
}

// DiscardDriveTaskProposal discards a Google Drive task proposal batch owned by
// the caller (DELETE /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}, spec §8.3).
func (h *handlers) DiscardDriveTaskProposal(w http.ResponseWriter, r *http.Request) {
	if h.DriveTaskProposals == nil {
		respondError(w, http.StatusServiceUnavailable, sdo.DriveErrUnavailable, "Tính năng Google Drive đang tạm thời không khả dụng.")
		return
	}
	if err := h.DriveTaskProposals.Discard(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "proposalID"),
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CheckDriveTaskProposalDuplicates re-checks open task duplicate matches when
// the user edits proposal titles or changes the target project / parent task in
// the review modal (POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/duplicates, spec §8.4).
func (h *handlers) CheckDriveTaskProposalDuplicates(w http.ResponseWriter, r *http.Request) {
	if h.DriveTaskProposals == nil {
		respondError(w, http.StatusServiceUnavailable, sdo.DriveErrUnavailable, "Tính năng Google Drive đang tạm thời không khả dụng.")
		return
	}
	var in sdi.CheckDriveTaskProposalDuplicatesSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	dups, err := h.DriveTaskProposals.Duplicates(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "proposalID"),
		service.CheckDriveProposalDuplicatesInput{
			ProjectID:    in.ProjectID,
			ParentTaskID: in.ParentTaskID,
			Titles:       in.Titles,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toDriveProposalDuplicatesSDO(dups))
}

func toDriveTaskProposalSDO(v service.DriveTaskProposalView) sdo.DriveTaskProposalSDO {
	items := make([]sdo.DriveTaskProposalItemDTO, 0, len(v.Items))
	for _, it := range v.Items {
		labelIDs := it.LabelIDs
		if labelIDs == nil {
			labelIDs = []string{}
		}
		checklist := it.Checklist
		if checklist == nil {
			checklist = []string{}
		}
		blockedBy := it.BlockedByIndexes
		if blockedBy == nil {
			blockedBy = []int{}
		}
		var dup *sdo.DriveDuplicateTaskDTO
		if it.PossibleDuplicate != nil {
			dup = &sdo.DriveDuplicateTaskDTO{
				TaskID:     it.PossibleDuplicate.TaskID,
				Identifier: it.PossibleDuplicate.Identifier,
				Title:      it.PossibleDuplicate.Title,
			}
		}
		items = append(items, sdo.DriveTaskProposalItemDTO{
			Index:               it.Index,
			Title:               it.Title,
			AssigneeMemberID:    it.AssigneeMemberID,
			AssigneeBasis:       it.AssigneeBasis,
			AssigneeDriveAccess: it.AssigneeDriveAccess,
			Priority:            it.Priority,
			PriorityBasis:       it.PriorityBasis,
			StartDate:           it.StartDate,
			StartBasis:          it.StartBasis,
			DueDate:             it.DueDate,
			DueBasis:            it.DueBasis,
			LabelIDs:            labelIDs,
			LabelBasis:          it.LabelBasis,
			Goal:                it.Goal,
			Checklist:           checklist,
			Excerpt: sdo.DriveProposalExcerptDTO{
				Section: it.Excerpt.Section,
				Quote:   it.Excerpt.Quote,
			},
			BlockedByIndexes:  blockedBy,
			PossibleDuplicate: dup,
		})
	}
	return sdo.DriveTaskProposalSDO{
		Proposal: sdo.DriveTaskProposalDTO{
			ID:                 v.ID,
			WorkspaceID:        v.WorkspaceID,
			DriveFileID:        v.DriveFileID,
			DriveFileName:      v.DriveFileName,
			DriveFileMimeType:  v.DriveFileMimeType,
			DriveFileIconKind:  v.DriveFileIconKind,
			SharingState:       v.SharingState,
			ConnectionID:       v.ConnectionID,
			ReaderAccountEmail: v.ReaderAccountEmail,
			RequestedBy:        v.RequestedBy,
			Prompt:             v.Prompt,
			ProjectID:          v.ProjectID,
			ParentTaskID:       v.ParentTaskID,
			ContextTaskID:      v.ContextTaskID,
			Truncated:          v.Truncated,
			Status:             v.Status,
			Items:              items,
			TasksCreated:       toDriveTasksCreatedSummaryDTO(v.TasksCreated),
			PriorCreations:     toDriveTaskCreationGroupDTOs(v.PriorCreations),
			CreatedAt:          v.CreatedAt.UTC().Format(time.RFC3339),
			ExpiresAt:          v.ExpiresAt.UTC().Format(time.RFC3339),
		},
	}
}

func toDriveProposalDuplicatesSDO(in []service.DriveProposalDuplicateItem) sdo.DriveProposalDuplicatesSDO {
	out := make([]sdo.DriveProposalDuplicateItemDTO, 0, len(in))
	for _, it := range in {
		var dup *sdo.DriveDuplicateTaskDTO
		if it.PossibleDuplicate != nil {
			dup = &sdo.DriveDuplicateTaskDTO{
				TaskID:     it.PossibleDuplicate.TaskID,
				Identifier: it.PossibleDuplicate.Identifier,
				Title:      it.PossibleDuplicate.Title,
			}
		}
		out = append(out, sdo.DriveProposalDuplicateItemDTO{
			Index:             it.Index,
			PossibleDuplicate: dup,
		})
	}
	return sdo.DriveProposalDuplicatesSDO{Duplicates: out}
}
