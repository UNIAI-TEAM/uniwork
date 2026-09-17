package service

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var validPriority = map[string]bool{"none": true, "low": true, "medium": true, "high": true, "urgent": true}

// TaskService owns task commands. Each one runs in a transaction that also
// carries its audit row and the events it publishes (ADR 0009), which is why
// the service holds a pool and no longer holds an EventPublisher: realtime
// reaches the client from the outbox, not from here.
type TaskService struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	ws      *WorkspaceService
	storage storage.Storage
	// Chat is optional; when set, CreateProject can provision a linked channel.
	Chat *ChatService
}

func NewTaskService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService, store storage.Storage) *TaskService {
	return &TaskService{pool: pool, q: q, ws: ws, storage: store}
}

type CreateTaskInput struct {
	Title         string
	Description   string
	Status        string
	Priority      string
	AssigneeID    *string
	AssigneeKind  string // "" or human | agent (ADR 0007)
	StartDate     *string
	DueDate       *string
	OriginType    string
	OriginID      *string
	ProjectID     *string // optional; must belong to the same workspace
	ParentTaskID  *string // optional; must belong to the same workspace
	Stage         *int32
	LabelIDs      []string
	AttachmentIDs []string
	Properties    map[string]json.RawMessage
}

// UpdateTaskInput: con trỏ nil = không đổi; với AssigneeID/StartDate/DueDate/ProjectID
// con trỏ kép — con trỏ tới nil = xóa giá trị.
type UpdateTaskInput struct {
	Title        *string
	Description  *string
	Status       *string
	Priority     *string
	Position     *float64
	AssigneeID   **string
	AssigneeKind string // read only when AssigneeID is set; "" means human
	StartDate    **string
	DueDate      **string
	ProjectID    **string
}

// assigneeKind validates the assignee pair: humans and agents must already be
// workspace members; squad assignees are refused until that directory exists.
func (s *TaskService) assigneeKind(ctx context.Context, workspaceID string, assigneeID *string, kind string) (string, error) {
	if kind == "" {
		kind = string(audit.KindHuman)
	}
	if kind == "squad" {
		return "", CodedError{
			Code:   "capability_unavailable",
			Status: http.StatusUnprocessableEntity,
			Msg:    "squad directory chưa khả dụng",
			Fields: map[string]any{"reason_code": "squad_directory_missing"},
		}
	}
	switch audit.Kind(kind) {
	case audit.KindHuman:
		if assigneeID != nil {
			if _, err := s.ws.RequireMember(ctx, workspaceID, *assigneeID); err != nil {
				if errors.Is(err, ErrOrganizationSuspended) {
					return "", err
				}
				return "", coded(http.StatusUnprocessableEntity, "assignee_not_member", "người được gán không phải thành viên workspace")
			}
		}
	case audit.KindAgent:
		if assigneeID != nil {
			if _, err := s.ws.RequireAgentMember(ctx, workspaceID, *assigneeID); err != nil {
				return "", coded(http.StatusUnprocessableEntity, "agent_not_member", "agent không phải thành viên workspace")
			}
		}
	default:
		return "", Invalid("assignee_kind không hợp lệ")
	}
	if assigneeID == nil {
		kind = string(audit.KindHuman)
	}
	return kind, nil
}

func optText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func originTypeText(s string) pgtype.Text {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func optFloat(f *float64) pgtype.Float8 {
	if f == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *f, Valid: true}
}

func optInt4(n *int32) pgtype.Int4 {
	if n == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *n, Valid: true}
}

func nowTz() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
}

// normalizedCreatorType maps ADR 0007 actor kinds onto the Tasks foundation
// creator_type vocabulary (member|agent|system).
func normalizedCreatorType(kind audit.Kind) string {
	switch kind {
	case audit.KindAgent:
		return "agent"
	case audit.KindSystem:
		return "system"
	default:
		return "member"
	}
}

// normalizedAssigneeType maps the legacy assignee pair onto assignee_type.
// Unassigned tasks keep a NULL type.
func normalizedAssigneeType(assigneeID *string, kind string) pgtype.Text {
	if assigneeID == nil {
		return pgtype.Text{}
	}
	if audit.Kind(kind) == audit.KindAgent {
		return pgtype.Text{String: "agent", Valid: true}
	}
	return pgtype.Text{String: "member", Valid: true}
}

// taskAuditFields is the explicit list of columns an audit row may report on.
// Listing them by hand rather than reflecting over db.Task keeps description
// bodies and internal columns out of a table that can never be edited, and
// makes the set a reviewer reads rather than infers.
func taskAuditFields(t db.Task) map[string]any {
	return map[string]any{
		"title":          t.Title,
		"status":         t.Status,
		"priority":       t.Priority,
		"assignee_id":    audit.Text(t.AssigneeID.Valid, t.AssigneeID.String),
		"assignee_kind":  t.AssigneeKind,
		"start_date":     dateOrNil(t.StartDate),
		"due_date":       dateOrNil(t.DueDate),
		"position":       t.Position,
		"project_id":     audit.Text(t.ProjectID.Valid, t.ProjectID.String),
		"parent_task_id": audit.Text(t.ParentTaskID.Valid, t.ParentTaskID.String),
		"stage":          int4OrNil(t.Stage),
	}
}

func dateOrNil(d pgtype.Date) any {
	if !d.Valid {
		return nil
	}
	return d.Time.Format("2006-01-02")
}

func int4OrNil(n pgtype.Int4) any {
	if !n.Valid {
		return nil
	}
	return n.Int32
}

// taskUpdatedPayload is the task.updated frame of one updateTaskInTx call
// (ADR 0015). revision is the task right after the call (the row the last
// query returned) and revisionBefore the task right before it, as measured
// inside the call under the row lock; never before.Revision, which was read
// before the lock.
//
// The catalogue's Patch fields ride along only when every field the input
// carries is one of them, and the revision pair rides along only beside them:
// a pair without a patch field would let a client take the new revision while
// a field it cannot patch stays stale, so a mixed or empty input sends ids
// only. A field in the input counts as changed even when its value matches
// before: that copy was read before the lock, a concurrent writer may have
// committed in between, and comparing against it could hide a change this
// call made. Values come from the row the last query returned under the lock,
// so each is the task's value at revision.
func taskUpdatedPayload(task db.Task, in UpdateTaskInput, revisionBefore int64) map[string]string {
	payload := map[string]string{"task_id": task.ID, "workspace_id": task.WorkspaceID}
	def, ok := outbox.Lookup("task.updated")
	if !ok || len(def.Patch) == 0 {
		return payload
	}

	// How a field goes on the wire. A Patch field not encoded here is never
	// sent: the frame falls back to ids, and clients refetch.
	due := ""
	if task.DueDate.Valid {
		due = task.DueDate.Time.Format("2006-01-02")
	}
	// Fail closed. Each field is cleared from rest where it is encoded, so
	// anything left over, a field UpdateTaskInput has today or gains later,
	// makes the frame ids-only. A hand-kept list of the other fields could miss
	// one with every test green, and the frame would then carry the revision
	// pair while that field stays stale in other caches. A slice or map field
	// would stop the comparison compiling, which forces that choice.
	rest := in
	patch := make(map[string]string, len(def.Patch))
	if in.Title != nil {
		patch["title"] = task.Title
		rest.Title = nil
	}
	if in.Status != nil {
		patch["status"] = task.Status
		rest.Status = nil
	}
	if in.Priority != nil {
		patch["priority"] = task.Priority
		rest.Priority = nil
	}
	if in.DueDate != nil {
		patch["due_date"] = due
		rest.DueDate = nil
	}
	if rest != (UpdateTaskInput{}) || len(patch) == 0 {
		return payload
	}
	for field := range patch {
		if !slices.Contains(def.Patch, field) {
			return payload
		}
	}
	payload["revision_before"] = strconv.FormatInt(revisionBefore, 10)
	payload["revision"] = strconv.FormatInt(task.Revision, 10)
	maps.Copy(payload, patch)
	return payload
}

func (s *TaskService) Create(ctx context.Context, actor Actor, workspaceID string, in CreateTaskInput) (db.Task, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Task{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.Task{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Task{}, err
	}
	defer tx.Rollback(ctx)
	task, err := s.createTaskInTx(ctx, s.q.WithTx(tx), actor, ws, workspaceID, in)
	if err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

// createTaskInTx inserts a task and its audit/outbox rows using q (caller owns the tx).
func (s *TaskService) createTaskInTx(ctx context.Context, q *db.Queries, actor Actor, ws db.Workspace, workspaceID string, in CreateTaskInput) (db.Task, error) {
	if strings.TrimSpace(in.Title) == "" {
		return db.Task{}, Invalid("tiêu đề không được để trống")
	}
	status, err := normalizeCreateTaskStatus(ctx, q, ws.OrganizationID, workspaceID, in.Status)
	if err != nil {
		return db.Task{}, err
	}
	if in.Priority == "" {
		in.Priority = "none"
	}
	if !validPriority[in.Priority] {
		return db.Task{}, Invalid("priority không hợp lệ")
	}
	start, err := parseDate("start_date", in.StartDate)
	if err != nil {
		return db.Task{}, err
	}
	due, err := parseDate("due_date", in.DueDate)
	if err != nil {
		return db.Task{}, err
	}
	if in.Stage != nil && *in.Stage < 1 {
		return db.Task{}, Invalid("stage phải từ 1 trở lên")
	}
	assigneeKind, err := s.assigneeKind(ctx, workspaceID, in.AssigneeID, in.AssigneeKind)
	if err != nil {
		return db.Task{}, err
	}
	projectID, err := s.normalizeProjectID(ctx, q, ws.OrganizationID, workspaceID, in.ProjectID)
	if err != nil {
		return db.Task{}, err
	}
	parentTaskID, err := normalizeParentTaskID(ctx, q, ws.OrganizationID, workspaceID, in.ParentTaskID)
	if err != nil {
		return db.Task{}, err
	}
	labelIDs, err := normalizeCreateTaskLabelIDs(ctx, q, ws.OrganizationID, workspaceID, in.LabelIDs)
	if err != nil {
		return db.Task{}, err
	}
	properties, err := normalizeCreateTaskProperties(ctx, q, ws.OrganizationID, workspaceID, in.Properties)
	if err != nil {
		return db.Task{}, err
	}
	minPos, err := q.MinTaskPosition(ctx, db.MinTaskPositionParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Status: status,
	})
	if err != nil {
		return db.Task{}, err
	}
	number, err := q.NextTaskNumber(ctx, db.NextTaskNumberParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return db.Task{}, err
	}
	task, err := q.CreateTask(ctx, db.CreateTaskParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Number: number, Title: strings.TrimSpace(in.Title), Description: in.Description,
		Status: status, Priority: in.Priority, AssigneeID: optText(in.AssigneeID), AssigneeKind: assigneeKind,
		AssigneeType: normalizedAssigneeType(in.AssigneeID, assigneeKind), StartDate: start, DueDate: due,
		Position: minPos - 1024, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		CreatorID: actor.ID, CreatorType: normalizedCreatorType(actor.Kind),
		Revision: 1, LastActivityAt: nowTz(),
		OriginType: originTypeText(in.OriginType), OriginID: optText(in.OriginID),
		ProjectID: projectID, ParentTaskID: parentTaskID, Stage: optInt4(in.Stage), Properties: properties,
	})
	if err != nil {
		return db.Task{}, err
	}
	for _, labelID := range labelIDs {
		if _, err := q.AttachTaskLabelOnCreate(ctx, db.AttachTaskLabelOnCreateParams{
			OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, TaskID: task.ID, LabelID: labelID,
		}); err != nil {
			return db.Task{}, err
		}
	}
	attachmentIDs := make([]string, 0, len(in.AttachmentIDs))
	seenAttachmentIDs := make(map[string]struct{}, len(in.AttachmentIDs))
	for _, id := range in.AttachmentIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, exists := seenAttachmentIDs[id]; exists {
			continue
		}
		seenAttachmentIDs[id] = struct{}{}
		attachmentIDs = append(attachmentIDs, id)
	}
	if len(attachmentIDs) > 20 {
		return db.Task{}, Invalid("attachment_ids tối đa 20")
	}
	if len(attachmentIDs) > 0 {
		bound, err := q.BindAttachmentsToTask(ctx, db.BindAttachmentsToTaskParams{
			TaskID: pgtype.Text{String: task.ID, Valid: true}, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
			UploaderType: s.commentActorType(actor.Kind), UploaderID: actor.ID, AttachmentIds: attachmentIDs,
		})
		if err != nil {
			return db.Task{}, err
		}
		if len(bound) != len(attachmentIDs) {
			return db.Task{}, coded(http.StatusUnprocessableEntity, "attachment_not_available", "đính kèm không tồn tại, đã hết hạn hoặc đã được sử dụng")
		}
	}
	autoSubscribed, err := autoSubscribeTaskAssignee(ctx, q, task)
	if err != nil {
		return db.Task{}, err
	}
	emit := []audit.Event{{Topic: "task.created", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": workspaceID,
	}}}
	for _, attachmentID := range attachmentIDs {
		emit = append(emit, audit.Event{Topic: "attachment.uploaded", Payload: map[string]string{
			"attachment_id": attachmentID, "task_id": task.ID, "workspace_id": workspaceID,
		}})
	}
	if autoSubscribed {
		emit = append(emit, taskSubscriptionEvent(task))
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:        actor,
		Action:       audit.ActionTaskCreated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(nil, taskAuditFields(task)),
	}, emit...); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

func normalizeCreateTaskProperties(
	ctx context.Context,
	q *db.Queries,
	organizationID, workspaceID string,
	values map[string]json.RawMessage,
) ([]byte, error) {
	if len(values) > maxActivePropertiesPerWorkspace {
		return nil, Invalid("properties tối đa 20")
	}
	normalized := make(map[string]json.RawMessage, len(values))
	for rawID, value := range values {
		propertyID := strings.TrimSpace(rawID)
		if propertyID == "" || len(value) == 0 || !json.Valid(value) {
			return nil, Invalid("properties không hợp lệ")
		}
		property, err := q.GetTaskPropertyByID(ctx, db.GetTaskPropertyByIDParams{
			OrganizationID: organizationID, WorkspaceID: workspaceID, ID: propertyID,
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && property.ArchivedAt.Valid) {
			return nil, coded(http.StatusUnprocessableEntity, "property_not_available", "thuộc tính không tồn tại hoặc đã lưu trữ")
		}
		if err != nil {
			return nil, err
		}
		normalized[propertyID] = value
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return nil, Invalid("properties không hợp lệ")
	}
	if len(encoded) > 16*1024 {
		return nil, Invalid("properties vượt quá giới hạn 16 KiB")
	}
	return encoded, nil
}

func (s *TaskService) List(ctx context.Context, userID, workspaceID string) ([]db.Task, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTasksByWorkspace(ctx, db.ListTasksByWorkspaceParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
}

// authorize loads the task then checks membership on the task's own
// workspace — the client-supplied workspace id is never trusted.
func (s *TaskService) authorize(ctx context.Context, userID, taskID string) (db.Task, error) {
	return s.authorizeActor(ctx, Human(userID), taskID)
}

func (s *TaskService) authorizeActor(ctx context.Context, actor Actor, taskID string) (db.Task, error) {
	task, err := s.q.GetTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Task{}, ErrNotFound
	}
	if err != nil {
		return db.Task{}, err
	}
	if err := s.ws.requireActorMember(ctx, task.WorkspaceID, actor); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

func (s *TaskService) Get(ctx context.Context, userID, taskID string) (db.Task, error) {
	return s.authorize(ctx, userID, taskID)
}

func (s *TaskService) Update(ctx context.Context, actor Actor, taskID string, in UpdateTaskInput) (db.Task, error) {
	before, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Task{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, before.WorkspaceID)
	if err != nil {
		return db.Task{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Task{}, err
	}
	defer tx.Rollback(ctx)
	task, err := s.updateTaskInTx(ctx, s.q.WithTx(tx), actor, before, ws, in)
	if err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

// updateTaskInTx applies fields and audit/outbox using q (caller owns the tx).
func (s *TaskService) updateTaskInTx(ctx context.Context, q *db.Queries, actor Actor, before db.Task, ws db.Workspace, in UpdateTaskInput) (db.Task, error) {
	if in.Status != nil && !isBuiltInStatusKey(*in.Status) {
		return db.Task{}, Invalid("status không hợp lệ")
	}
	if in.Priority != nil && !validPriority[*in.Priority] {
		return db.Task{}, Invalid("priority không hợp lệ")
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Task{}, Invalid("tiêu đề không được để trống")
	}
	task, err := q.UpdateTask(ctx, db.UpdateTaskParams{
		ID: before.ID, OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		Title: optText(in.Title), Description: optText(in.Description),
		Status: optText(in.Status), Priority: optText(in.Priority), Position: optFloat(in.Position),
	})
	if err != nil {
		return db.Task{}, err
	}
	// UpdateTask always runs, takes the row lock and bumps revision by exactly
	// one, so the row it returns minus one is where this call started, and the
	// lock keeps it that way until commit. Counting the queries below instead
	// would break silently the day one of them bumps conditionally.
	revisionBefore := task.Revision - 1
	if in.AssigneeID != nil {
		kind, kerr := s.assigneeKind(ctx, before.WorkspaceID, *in.AssigneeID, in.AssigneeKind)
		if kerr != nil {
			return db.Task{}, kerr
		}
		task, err = q.SetTaskAssignee(ctx, db.SetTaskAssigneeParams{
			ID: before.ID, AssigneeID: optText(*in.AssigneeID), AssigneeKind: kind,
			AssigneeType:   normalizedAssigneeType(*in.AssigneeID, kind),
			OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		})
		if err != nil {
			return db.Task{}, err
		}
	}
	if in.StartDate != nil {
		start, serr := parseDate("start_date", *in.StartDate)
		if serr != nil {
			return db.Task{}, serr
		}
		task, err = q.SetTaskStartDate(ctx, db.SetTaskStartDateParams{
			ID: before.ID, StartDate: start,
			OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		})
		if err != nil {
			return db.Task{}, err
		}
	}
	if in.DueDate != nil {
		due, derr := parseDate("due_date", *in.DueDate)
		if derr != nil {
			return db.Task{}, derr
		}
		task, err = q.SetTaskDueDate(ctx, db.SetTaskDueDateParams{
			ID: before.ID, DueDate: due,
			OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		})
		if err != nil {
			return db.Task{}, err
		}
	}
	if in.ProjectID != nil {
		projectID, perr := s.normalizeProjectID(ctx, q, before.OrganizationID, before.WorkspaceID, *in.ProjectID)
		if perr != nil {
			return db.Task{}, perr
		}
		task, err = q.SetTaskProjectID(ctx, db.SetTaskProjectIDParams{
			ID: before.ID, ProjectID: projectID,
			OrganizationID: before.OrganizationID, WorkspaceID: before.WorkspaceID,
		})
		if err != nil {
			return db.Task{}, err
		}
	}
	autoSubscribed, err := autoSubscribeTaskAssignee(ctx, q, task)
	if err != nil {
		return db.Task{}, err
	}
	emit := []audit.Event{{Topic: "task.updated", Payload: taskUpdatedPayload(task, in, revisionBefore)}}
	if autoSubscribed {
		emit = append(emit, taskSubscriptionEvent(task))
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:        actor,
		Action:       audit.ActionTaskUpdated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(taskAuditFields(before), taskAuditFields(task)),
	}, emit...); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

func (s *TaskService) Delete(ctx context.Context, userID, taskID string) error {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, task.WorkspaceID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.deleteTaskInTx(ctx, s.q.WithTx(tx), userID, task, ws); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// deleteTaskInTx removes the task and writes audit/outbox using q (caller owns the tx).
func (s *TaskService) deleteTaskInTx(ctx context.Context, q *db.Queries, userID string, task db.Task, ws db.Workspace) error {
	if err := q.DeleteTask(ctx, db.DeleteTaskParams{
		ID: task.ID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	}); err != nil {
		return err
	}
	// The row is gone, so the audit entry is the only remaining record of what
	// it held: keep the title, which is what a person searching the log reads.
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionTaskDeleted,
		ResourceType: "task", ResourceID: task.ID,
		Metadata: map[string]any{"title": task.Title, "status": task.Status},
	}, audit.Event{Topic: "task.deleted", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}})
}

// AddComment records the author's kind so the client can draw the badge; origin
// ("agent_run:<id>") arrives with A-01 and stays NULL until then. Suite
// threading / idempotency live on AddCommentSuite.
func (s *TaskService) AddComment(ctx context.Context, actor Actor, taskID, body string) (db.TaskComment, error) {
	return s.AddCommentSuite(ctx, actor, taskID, AddCommentInput{Body: body}, "")
}

func (s *TaskService) Comments(ctx context.Context, userID, taskID string) ([]db.ListTaskCommentsRow, error) {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskComments(ctx, db.ListTaskCommentsParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
}

// CommentReactionsForTask returns every reaction on every comment of the task
// in one round trip. Comments stays untouched: six callers depend on its
// signature, and only the detail screen needs the reactions.
func (s *TaskService) CommentReactionsForTask(ctx context.Context, userID, taskID string) ([]db.CommentReaction, error) {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskCommentReactions(ctx, db.ListTaskCommentReactionsParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
}

// parseDate reads an optional YYYY-MM-DD value; field names it in the error.
func parseDate(field string, s *string) (pgtype.Date, error) {
	if s == nil || *s == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", *s)
	if err != nil {
		return pgtype.Date{}, Invalid(field + " phải dạng YYYY-MM-DD")
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

// normalizeProjectID returns a nullable project id after checking it belongs
// to the workspace. A nil / empty input clears (Valid=false).
func (s *TaskService) normalizeProjectID(
	ctx context.Context, q *db.Queries, organizationID, workspaceID string, projectID *string,
) (pgtype.Text, error) {
	if projectID == nil {
		return pgtype.Text{}, nil
	}
	id := strings.TrimSpace(*projectID)
	if id == "" {
		return pgtype.Text{}, nil
	}
	if _, err := q.GetProject(ctx, db.GetProjectParams{
		ID: id, OrganizationID: organizationID, WorkspaceID: workspaceID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.Text{}, ErrNotFound
		}
		return pgtype.Text{}, err
	}
	return pgtype.Text{String: id, Valid: true}, nil
}

func normalizeCreateTaskStatus(
	ctx context.Context, q *db.Queries, organizationID, workspaceID, raw string,
) (string, error) {
	status := strings.TrimSpace(raw)
	if status == "" {
		status = "todo"
	}
	entry, err := q.GetTaskStatusByKey(ctx, db.GetTaskStatusByKeyParams{
		OrganizationID: organizationID, WorkspaceID: workspaceID, Key: status,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && entry.ArchivedAt.Valid) {
		return "", Invalid("status không hợp lệ")
	}
	if err != nil {
		return "", err
	}
	return status, nil
}

func normalizeParentTaskID(
	ctx context.Context, q *db.Queries, organizationID, workspaceID string, parentTaskID *string,
) (pgtype.Text, error) {
	if parentTaskID == nil {
		return pgtype.Text{}, nil
	}
	id := strings.TrimSpace(*parentTaskID)
	if id == "" {
		return pgtype.Text{}, nil
	}
	if _, err := q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
		ID: id, OrganizationID: organizationID, WorkspaceID: workspaceID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return pgtype.Text{}, ErrNotFound
		}
		return pgtype.Text{}, err
	}
	return pgtype.Text{String: id, Valid: true}, nil
}

func normalizeCreateTaskLabelIDs(
	ctx context.Context, q *db.Queries, organizationID, workspaceID string, raw []string,
) ([]string, error) {
	seen := make(map[string]struct{}, len(raw))
	ids := make([]string, 0, len(raw))
	for _, value := range raw {
		id := strings.TrimSpace(value)
		if id == "" {
			return nil, Invalid("label_id không hợp lệ")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		label, err := q.GetTaskLabelByID(ctx, db.GetTaskLabelByIDParams{
			OrganizationID: organizationID, WorkspaceID: workspaceID, ID: id,
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && label.ArchivedAt.Valid) {
			return nil, Invalid("label không hợp lệ")
		}
		if err != nil {
			return nil, err
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}
