package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	driveProposalOriginType        = "drive_task_proposal"
	driveProposalMaxTitleRunes     = 200
	driveProposalMaxDescRunes      = 20000
	driveProposalMaxItemsPerCreate = 20
)

// CreateTasksFromProposalItemInput is one edited proposal item submitted to
// POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks (spec §8.5).
type CreateTasksFromProposalItemInput struct {
	Index            int
	Title            string
	Description      string
	AssigneeMemberID *string
	Priority         string
	StartDate        *string
	DueDate          *string
	LabelIDs         []string
	BlockedByIndexes []int
}

// CreateTasksFromProposalInput carries the batch project/parent overrides,
// duplicate override flag, and edited items for CreateTasksFromProposal (spec §8.5).
type CreateTasksFromProposalInput struct {
	ProjectID      *string
	ParentTaskID   *string
	AllowDuplicate bool
	Items          []CreateTasksFromProposalItemInput
}

// CreatedDriveProposalTask maps a 0-based proposal item index to its newly created task ID (spec §8.5).
type CreatedDriveProposalTask struct {
	Index  int
	TaskID string
}

// CreateTasksFromProposalResult is the service-layer result of CreateTasksFromProposal (spec §8.5).
type CreateTasksFromProposalResult struct {
	TaskIDs []string
	Items   []CreatedDriveProposalTask
}

// CreateTasksFromProposal converts 1..20 items of a ready, non-expired Drive task
// proposal owned by actor into workspace tasks, attaches task dependencies, links
// the Drive file and durable provenance rows, marks the proposal converted, and
// emits audit/outbox rows in one atomic transaction (UNI-2182, spec §8.5).
func (s *DriveTaskProposalService) CreateTasksFromProposal(
	ctx context.Context,
	actor Actor,
	workspaceID, proposalID string,
	in CreateTasksFromProposalInput,
) (CreateTasksFromProposalResult, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return CreateTasksFromProposalResult{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return CreateTasksFromProposalResult{}, errDriveFeatureDisabled()
	}
	if s.files != nil && !s.files.isNotGuest(member) {
		return CreateTasksFromProposalResult{}, ErrForbidden
	} else if s.files == nil {
		role := strings.ToLower(strings.TrimSpace(member.Role))
		if role != "owner" && role != "admin" && role != "member" {
			return CreateTasksFromProposalResult{}, ErrForbidden
		}
	}
	if s.tasks == nil {
		return CreateTasksFromProposalResult{}, ErrForbidden
	}

	// Ensure the caller owns the proposal in workspaceID before inspecting items or locking.
	preRow, err := s.requireOwnProposalQ(ctx, s.q, actor.ID, ws.ID, proposalID)
	if err != nil {
		return CreateTasksFromProposalResult{}, err
	}
	if preRow.Status != DriveProposalStatusReady {
		return CreateTasksFromProposalResult{}, errDriveProposalNotReady()
	}
	now := s.nowUTC()
	if preRow.ExpiresAt.Valid && !preRow.ExpiresAt.Time.After(now) {
		return CreateTasksFromProposalResult{}, errDriveProposalExpired()
	}

	var storedPreItems []DriveTaskProposalItem
	if len(preRow.Items) > 0 {
		if err := json.Unmarshal(preRow.Items, &storedPreItems); err != nil {
			return CreateTasksFromProposalResult{}, err
		}
	}
	normalizedItems, err := validateAndNormalizeProposalCreateItems(in.Items, len(storedPreItems))
	if err != nil {
		return CreateTasksFromProposalResult{}, err
	}

	var result CreateTasksFromProposalResult
	_, err = s.tasks.CreateManyWith(ctx, actor, ws.ID, normalizedItems.taskInputs, CreateManyOptions{
		KeepOrder: true,
		Before: func(ctx context.Context, q *db.Queries, ws db.Workspace) error {
			p, err := s.requireOwnProposalQ(ctx, q, actor.ID, ws.ID, proposalID)
			if err != nil {
				return err
			}
			locked, err := s.lockSourceForProposalQ(ctx, q, p)
			if err != nil {
				return err
			}
			if locked.Status != DriveProposalStatusReady {
				return errDriveProposalNotReady()
			}
			if locked.ExpiresAt.Valid && !locked.ExpiresAt.Time.After(s.nowUTC()) {
				return errDriveProposalExpired()
			}

			var storedItems []DriveTaskProposalItem
			if len(locked.Items) > 0 {
				if err := json.Unmarshal(locked.Items, &storedItems); err != nil {
					return err
				}
			}
			for _, item := range in.Items {
				if item.Index < 0 || item.Index >= len(storedItems) {
					return Invalid("index mục đề xuất không hợp lệ")
				}
			}

			projectID, err := resolveProposalBatchID(in.ProjectID, locked.ProjectID)
			if err != nil {
				return err
			}
			var validatedProject *string
			var projectPg pgtype.Text
			if projectID != "" {
				pid, _, perr := validateProposalProjectQ(ctx, q, ws.OrganizationID, ws.ID, projectID)
				if perr != nil {
					return perr
				}
				validatedProject = &pid
				projectPg = pgtype.Text{String: pid, Valid: true}
			}

			parentTaskID, err := resolveProposalBatchID(in.ParentTaskID, locked.ParentTaskID)
			if err != nil {
				return err
			}
			var validatedParent *string
			var parentPg pgtype.Text
			if parentTaskID != "" {
				ptid, terr := validateProposalParentTaskQ(ctx, q, ws.OrganizationID, ws.ID, parentTaskID)
				if terr != nil {
					return terr
				}
				validatedParent = &ptid
				parentPg = pgtype.Text{String: ptid, Valid: true}
			}

			originID := locked.ID
			for i := range normalizedItems.taskInputs {
				normalizedItems.taskInputs[i].ProjectID = validatedProject
				normalizedItems.taskInputs[i].ParentTaskID = validatedParent
				normalizedItems.taskInputs[i].OriginType = driveProposalOriginType
				normalizedItems.taskInputs[i].OriginID = &originID
				normalizedItems.taskInputs[i].AllowDuplicate = in.AllowDuplicate
			}

			if !in.AllowDuplicate {
				if err := refuseProposalBatchDuplicates(ctx, q, ws, projectPg, parentPg, normalizedItems.orderedItems); err != nil {
					return err
				}
			}

			normalizedItems.lockedProposal = locked
			return nil
		},
		After: func(ctx context.Context, q *db.Queries, ws db.Workspace, tasks []db.Task) error {
			locked := normalizedItems.lockedProposal

			fileRow, err := q.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
				ID:             locked.DriveFileID,
				OrganizationID: ws.OrganizationID,
				WorkspaceID:    ws.ID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return errDriveSourceChanged()
			}
			if err != nil {
				return err
			}

			var googleEmail, googleSub string
			if conn, cerr := q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
				ID:             locked.ConnectionID,
				OrganizationID: ws.OrganizationID,
				UserID:         locked.RequestedBy,
			}); cerr == nil {
				googleEmail = conn.GoogleEmail
				googleSub = conn.GoogleSub
			}

			taskByItemIndex := make(map[int]db.Task, len(tasks))
			for i, it := range normalizedItems.orderedItems {
				taskByItemIndex[it.Index] = tasks[i]
			}

			// 1. Insert intra-batch dependencies (blocked_by) in the same transaction.
			for i, it := range normalizedItems.orderedItems {
				task := tasks[i]
				for _, depIndex := range it.BlockedByIndexes {
					depTask := taskByItemIndex[depIndex]
					if _, err := s.tasks.setDependencyTx(ctx, q, actor, task, depTask, dependencyTypeBlockedBy); err != nil {
						return err
					}
				}
			}

			// 2. Attach drive_file_task_links (and emit task.drive_file_linked + drive_file.task_linked)
			// plus durable drive_task_proposal_links per created task.
			taskIDs := make([]string, 0, len(tasks))
			itemMappings := make([]CreatedDriveProposalTask, 0, len(tasks))
			itemIndexes := make([]int, 0, len(tasks))
			for i, it := range normalizedItems.orderedItems {
				task := tasks[i]
				if s.files != nil {
					if err := s.files.attachTaskLinkOnLinkInTx(ctx, q, actor, ws, fileRow, task.ID, googleEmail); err != nil {
						return err
					}
				} else {
					if err := attachProposalTaskDriveLinkFallback(ctx, q, actor, ws, fileRow, task.ID, googleEmail); err != nil {
						return err
					}
				}

				if _, err := q.InsertDriveTaskProposalLink(ctx, db.InsertDriveTaskProposalLinkParams{
					ID:             util.NewID(),
					OrganizationID: ws.OrganizationID,
					WorkspaceID:    ws.ID,
					ProposalID:     locked.ID,
					ItemIndex:      int32(it.Index),
					TaskID:         task.ID,
					DriveFileID:    fileRow.ID,
					ExternalFileID: fileRow.ExternalFileID,
					CreatedBy:      actor.ID,
					CreatedByKind:  string(actor.Kind),
				}); err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return errDriveProposalItemAlreadyConverted()
					}
					return err
				}

				taskIDs = append(taskIDs, task.ID)
				itemMappings = append(itemMappings, CreatedDriveProposalTask{
					Index:  it.Index,
					TaskID: task.ID,
				})
				itemIndexes = append(itemIndexes, it.Index)
			}

			// 3. Mark proposal converted and clear items JSONB.
			if _, err := q.SetDriveTaskProposalStatus(ctx, db.SetDriveTaskProposalStatusParams{
				ID:             locked.ID,
				WorkspaceID:    ws.ID,
				OrganizationID: ws.OrganizationID,
				Status:         DriveProposalStatusConverted,
			}); err != nil {
				return err
			}

			// 4. Record drive_task_proposal.tasks_created and emit drive_file.updated in the same transaction.
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: ws.OrganizationID,
				WorkspaceID:    ws.ID,
				Actor:          actor,
				Action:         audit.ActionDriveTaskProposalTasksCreated,
				ResourceType:   "drive_task_proposal",
				ResourceID:     locked.ID,
				Metadata: map[string]any{
					"drive_file_id":   fileRow.ID,
					"drive_file_name": fileRow.Name,
					"connection_id":   locked.ConnectionID,
					"google_email":    googleEmail,
					"google_sub":      googleSub,
					"task_ids":        taskIDs,
					"item_indexes":    itemIndexes,
				},
			}, audit.Event{
				Topic:   "drive_file.updated",
				Version: 1,
				Payload: map[string]string{
					"drive_file_id": fileRow.ID,
					"workspace_id":  ws.ID,
				},
			}); err != nil {
				return err
			}

			result = CreateTasksFromProposalResult{
				TaskIDs: taskIDs,
				Items:   itemMappings,
			}
			return nil
		},
	})
	if err != nil {
		return CreateTasksFromProposalResult{}, err
	}
	return result, nil
}

type normalizedProposalCreateBatch struct {
	orderedItems   []CreateTasksFromProposalItemInput
	taskInputs     []CreateTaskInput
	lockedProposal db.DriveTaskProposal
}

func validateAndNormalizeProposalCreateItems(
	rawItems []CreateTasksFromProposalItemInput,
	storedCount int,
) (*normalizedProposalCreateBatch, error) {
	if len(rawItems) == 0 || len(rawItems) > driveProposalMaxItemsPerCreate {
		return nil, Invalid("items phải có từ 1 đến 20 mục")
	}
	seenIndex := make(map[int]int, len(rawItems)) // proposal item index -> position in rawItems
	ordered := make([]CreateTasksFromProposalItemInput, len(rawItems))
	for pos, raw := range rawItems {
		if raw.Index < 0 || raw.Index >= driveProposalMaxItemsPerCreate || raw.Index >= storedCount {
			return nil, Invalid("index mục đề xuất không hợp lệ")
		}
		if _, dup := seenIndex[raw.Index]; dup {
			return nil, Invalid("index mục đề xuất bị trùng trong cùng yêu cầu")
		}
		seenIndex[raw.Index] = pos

		title := strings.TrimSpace(raw.Title)
		if title == "" {
			return nil, Invalid("tiêu đề không được để trống")
		}
		if utf8.RuneCountInString(title) > driveProposalMaxTitleRunes {
			return nil, Invalid("tiêu đề tối đa 200 ký tự")
		}
		desc := raw.Description
		if utf8.RuneCountInString(desc) > driveProposalMaxDescRunes {
			return nil, Invalid("mô tả tối đa 20000 ký tự")
		}

		prio := strings.ToLower(strings.TrimSpace(raw.Priority))
		if prio == "" {
			prio = "none"
		}
		if !validPriority[prio] {
			return nil, Invalid("priority không hợp lệ")
		}

		var assigneeID *string
		if raw.AssigneeMemberID != nil {
			trimmed := strings.TrimSpace(*raw.AssigneeMemberID)
			if trimmed != "" {
				assigneeID = &trimmed
			}
		}

		var startDate *string
		if raw.StartDate != nil {
			trimmed := strings.TrimSpace(*raw.StartDate)
			if trimmed != "" {
				if _, ok := normalizeDriveProposalDate(trimmed); !ok {
					return nil, Invalid("start_date phải dạng YYYY-MM-DD")
				}
				startDate = &trimmed
			}
		}

		var dueDate *string
		if raw.DueDate != nil {
			trimmed := strings.TrimSpace(*raw.DueDate)
			if trimmed != "" {
				if _, ok := normalizeDriveProposalDate(trimmed); !ok {
					return nil, Invalid("due_date phải dạng YYYY-MM-DD")
				}
				dueDate = &trimmed
			}
		}

		ordered[pos] = CreateTasksFromProposalItemInput{
			Index:            raw.Index,
			Title:            title,
			Description:      desc,
			AssigneeMemberID: assigneeID,
			Priority:         prio,
			StartDate:        startDate,
			DueDate:          dueDate,
			LabelIDs:         raw.LabelIDs,
			BlockedByIndexes: raw.BlockedByIndexes,
		}
	}

	// Validate intra-batch dependency references and check for cycles across the batch.
	adj := make([][]int, len(ordered))
	for pos, it := range ordered {
		seenDep := make(map[int]bool, len(it.BlockedByIndexes))
		cleanedDeps := make([]int, 0, len(it.BlockedByIndexes))
		for _, depIdx := range it.BlockedByIndexes {
			if depIdx == it.Index {
				return nil, coded(http.StatusUnprocessableEntity, "parent_cycle", "phụ thuộc tạo chu trình")
			}
			depPos, ok := seenIndex[depIdx]
			if !ok {
				return nil, Invalid("blocked_by_indexes phải trỏ tới mục được chọn trong cùng yêu cầu")
			}
			if seenDep[depIdx] {
				continue
			}
			if driveProposalReachable(adj, depPos, pos) {
				return nil, coded(http.StatusUnprocessableEntity, "parent_cycle", "phụ thuộc tạo chu trình")
			}
			seenDep[depIdx] = true
			cleanedDeps = append(cleanedDeps, depIdx)
			adj[pos] = append(adj[pos], depPos)
		}
		ordered[pos].BlockedByIndexes = cleanedDeps
	}

	taskInputs := make([]CreateTaskInput, len(ordered))
	for i, it := range ordered {
		taskInputs[i] = CreateTaskInput{
			Title:       it.Title,
			Description: it.Description,
			Status:      "todo",
			Priority:    it.Priority,
			AssigneeID:  it.AssigneeMemberID,
			StartDate:   it.StartDate,
			DueDate:     it.DueDate,
			LabelIDs:    it.LabelIDs,
		}
	}

	return &normalizedProposalCreateBatch{
		orderedItems: ordered,
		taskInputs:   taskInputs,
	}, nil
}

// resolveProposalBatchID resolves the effective batch project_id or parent_task_id:
// nil inherits the stored proposal default; empty string "" explicitly clears to NULL;
// non-empty string overrides.
func resolveProposalBatchID(override *string, stored pgtype.Text) (string, error) {
	if override != nil {
		return strings.TrimSpace(*override), nil
	}
	if stored.Valid {
		return strings.TrimSpace(stored.String), nil
	}
	return "", nil
}

func validateProposalProjectQ(ctx context.Context, q *db.Queries, orgID, workspaceID, projectID string) (string, string, error) {
	p, err := q.GetProject(ctx, db.GetProjectParams{
		ID:             projectID,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", Invalid("project not found in workspace")
	}
	if err != nil {
		return "", "", err
	}
	return p.ID, p.Title, nil
}

func validateProposalParentTaskQ(ctx context.Context, q *db.Queries, orgID, workspaceID, parentTaskID string) (string, error) {
	t, err := q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
		ID:             parentTaskID,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", Invalid("parent task not found in workspace")
	}
	if err != nil {
		return "", err
	}
	return t.ID, nil
}

// refuseProposalBatchDuplicates checks every item in the batch before any insert
// when allow_duplicate is false (spec §8.5, mirroring refuseSummaryDuplicates in meeting_action_items.go):
// it refuses both an open task in the workspace with the same normalized title under
// the same (project_id, parent_task_id) and two items in the same request with the
// same normalized title, returning 409 active_duplicate_task with item_indexes.
func refuseProposalBatchDuplicates(
	ctx context.Context,
	q *db.Queries,
	ws db.Workspace,
	projectID, parentTaskID pgtype.Text,
	items []CreateTasksFromProposalItemInput,
) error {
	keys := make([]string, len(items))
	locks := make([]string, 0, len(items))
	for i, it := range items {
		norm := normalizeTaskTitle(it.Title)
		if norm == "" {
			continue
		}
		keys[i] = activeDuplicateLockKey(ws, projectID, parentTaskID, norm)
		locks = append(locks, keys[i])
	}
	sort.Strings(locks)
	locks = slices.Compact(locks)
	for _, key := range locks {
		if err := q.LockTaskDuplicateKey(ctx, key); err != nil {
			return err
		}
	}

	var firstDup *db.Task
	var firstInBatchTitle string
	var matchedIndexes []int
	seenInBatch := make(map[string]int, len(items)) // normalized title -> first proposal item index
	addedIndex := make(map[int]bool, len(items))
	addIndex := func(idx int) {
		if !addedIndex[idx] {
			addedIndex[idx] = true
			matchedIndexes = append(matchedIndexes, idx)
		}
	}

	for _, it := range items {
		norm := normalizeTaskTitle(it.Title)
		if norm == "" {
			continue
		}
		dup, err := q.FindActiveDuplicateTask(ctx, db.FindActiveDuplicateTaskParams{
			OrganizationID:  ws.OrganizationID,
			WorkspaceID:     ws.ID,
			ProjectID:       projectID,
			ParentTaskID:    parentTaskID,
			NormalizedTitle: norm,
		})
		switch {
		case err == nil:
			if firstDup == nil {
				d := dup
				firstDup = &d
			}
			addIndex(it.Index)
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return err
		}
		if prevIdx, repeated := seenInBatch[norm]; repeated {
			if firstInBatchTitle == "" {
				firstInBatchTitle = strings.TrimSpace(it.Title)
			}
			addIndex(prevIdx)
			addIndex(it.Index)
		} else {
			seenInBatch[norm] = it.Index
		}
	}
	sort.Ints(matchedIndexes)

	if len(matchedIndexes) == 0 {
		return nil
	}
	if firstDup != nil {
		fields := activeDuplicateFields(ws, *firstDup)
		fields["item_indexes"] = matchedIndexes
		return CodedError{
			Code:   "active_duplicate_task",
			Status: http.StatusConflict,
			Msg:    fmt.Sprintf("đã có task đang mở với tiêu đề này: %s-%d — %s", ws.TaskPrefix, firstDup.Number, firstDup.Title),
			Fields: fields,
			Err:    ErrConflict,
		}
	}
	return CodedError{
		Code:   "active_duplicate_task",
		Status: http.StatusConflict,
		Msg:    fmt.Sprintf("các mục được chọn bị trùng tiêu đề với nhau: %s", firstInBatchTitle),
		Fields: map[string]any{
			"title":        firstInBatchTitle,
			"item_indexes": matchedIndexes,
		},
		Err: ErrConflict,
	}
}

func attachProposalTaskDriveLinkFallback(
	ctx context.Context,
	qtx *db.Queries,
	actor Actor,
	ws db.Workspace,
	fileRow db.DriveFile,
	taskID, viewerEmail string,
) error {
	_, lerr := qtx.CreateDriveFileTaskLink(ctx, db.CreateDriveFileTaskLinkParams{
		ID:             util.NewID(),
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    fileRow.ID,
		TaskID:         taskID,
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
	})
	if lerr != nil && !errors.Is(lerr, pgx.ErrNoRows) {
		return lerr
	}
	if lerr == nil {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			Actor:          actor,
			Action:         audit.ActionTaskDriveFileLinked,
			ResourceType:   "task",
			ResourceID:     taskID,
			Metadata: map[string]any{
				"drive_file_id":   fileRow.ID,
				"drive_file_name": fileRow.Name,
				"google_email":    viewerEmail,
			},
		}, audit.Event{
			Topic:   "drive_file.task_linked",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": fileRow.ID,
				"task_id":       taskID,
				"workspace_id":  ws.ID,
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

func errDriveProposalNotReady() error {
	return CodedError{
		Code:   "proposal_not_ready",
		Status: http.StatusConflict,
		Msg:    "Đề xuất công việc này đã được xử lý hoặc đã hủy.",
		Err:    ErrDriveProposalNotReady,
	}
}

func errDriveProposalExpired() error {
	return CodedError{
		Code:   "proposal_expired",
		Status: http.StatusConflict,
		Msg:    "Đề xuất công việc này đã hết hạn. Vui lòng tạo đề xuất mới.",
		Err:    ErrDriveProposalExpired,
	}
}

func errDriveProposalItemAlreadyConverted() error {
	return CodedError{
		Code:   "proposal_item_already_converted",
		Status: http.StatusConflict,
		Msg:    "Mục đề xuất này đã được tạo thành công việc.",
		Err:    ErrDriveProposalItemAlreadyConverted,
	}
}

// LoadTasksCreatedSummaries implements DriveTaskCreationsLoader (spec §8.8, seam A2).
// It loads all drive_task_proposal_links joined with existing tasks for externalFileIDs
// in ws, filters them through DriveFileService.canViewTask for viewerID, and computes
// {count, last_created_at, last_created_by_name} per external_file_id.
func (s *DriveFileService) LoadTasksCreatedSummaries(
	ctx context.Context,
	viewerID string,
	member db.WorkspaceMember,
	ws db.Workspace,
	externalFileIDs []string,
) (map[string]DriveTasksCreatedSummary, error) {
	out := make(map[string]DriveTasksCreatedSummary, len(externalFileIDs))
	if s == nil || s.q == nil || len(externalFileIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.ListDriveTaskProposalLinksByExternalFileIDs(ctx, db.ListDriveTaskProposalLinksByExternalFileIDsParams{
		OrganizationID:  ws.OrganizationID,
		WorkspaceID:     ws.ID,
		ExternalFileIds: externalFileIDs,
	})
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		if !s.canViewTask(ctx, viewerID, member, r.TaskID) {
			continue
		}
		cur := out[r.ExternalFileID]
		cur.Count++
		if r.CreatedAt.Valid {
			ts := r.CreatedAt.Time.UTC()
			if cur.LastCreatedAt == nil || ts.After(*cur.LastCreatedAt) {
				tsCopy := ts
				cur.LastCreatedAt = &tsCopy
				name := strings.TrimSpace(r.CreatedByName)
				cur.LastCreatedByName = &name
			}
		}
		out[r.ExternalFileID] = cur
	}
	return out, nil
}

// LoadTaskCreationGroups implements DriveTaskCreationsLoader (spec §8.8, seam A2).
// It loads proposal conversion batches for externalFileID in ws, filters each linked
// task through DriveFileService.canViewTask for viewerID, drops groups with no visible
// tasks, and returns at most limit groups ordered newest first.
func (s *DriveFileService) LoadTaskCreationGroups(
	ctx context.Context,
	viewerID string,
	member db.WorkspaceMember,
	ws db.Workspace,
	externalFileID string,
	limit int,
) ([]DriveTaskCreationGroup, error) {
	if s == nil || s.q == nil || strings.TrimSpace(externalFileID) == "" || limit <= 0 {
		return []DriveTaskCreationGroup{}, nil
	}
	rows, err := s.q.ListDriveTaskCreationLinksByExternalFileID(ctx, db.ListDriveTaskCreationLinksByExternalFileIDParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		ExternalFileID: strings.TrimSpace(externalFileID),
	})
	if err != nil {
		return []DriveTaskCreationGroup{}, err
	}

	prefix := strings.TrimSpace(ws.TaskPrefix)
	if prefix == "" {
		prefix = strings.ToUpper(ws.Slug)
	}
	if prefix == "" {
		prefix = "TASK"
	}

	groups := make([]DriveTaskCreationGroup, 0)
	groupIndexByProposal := make(map[string]int)

	for _, r := range rows {
		if !s.canViewTask(ctx, viewerID, member, r.TaskID) {
			continue
		}
		idx, exists := groupIndexByProposal[r.ProposalID]
		if !exists {
			if len(groups) >= limit {
				continue
			}
			var createdAt time.Time
			if r.CreatedAt.Valid {
				createdAt = r.CreatedAt.Time.UTC()
			}
			idx = len(groups)
			groupIndexByProposal[r.ProposalID] = idx
			groups = append(groups, DriveTaskCreationGroup{
				ProposalID:    r.ProposalID,
				CreatedAt:     createdAt,
				CreatedByID:   r.CreatedBy,
				CreatedByName: strings.TrimSpace(r.CreatedByName),
				Tasks:         []DriveLinkedTaskRef{},
			})
		}
		groups[idx].Tasks = append(groups[idx].Tasks, DriveLinkedTaskRef{
			TaskID:     r.TaskID,
			Identifier: fmt.Sprintf("%s-%d", prefix, r.TaskNumber),
			Title:      r.TaskTitle,
			Status:     r.TaskStatus,
		})
	}
	return groups, nil
}
