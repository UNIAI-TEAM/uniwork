package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var validStatus = map[string]bool{"todo": true, "in_progress": true, "done": true, "cancelled": true}
var validPriority = map[string]bool{"low": true, "medium": true, "high": true, "urgent": true}

// TaskService owns task commands. Each one runs in a transaction that also
// carries its audit row and the events it publishes (ADR 0009), which is why
// the service holds a pool and no longer holds an EventPublisher: realtime
// reaches the client from the outbox, not from here.
type TaskService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	ws   *WorkspaceService
}

func NewTaskService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService) *TaskService {
	return &TaskService{pool: pool, q: q, ws: ws}
}

type CreateTaskInput struct {
	Title        string
	Description  string
	Priority     string
	AssigneeID   *string
	AssigneeKind string // "" or human | agent (ADR 0007)
	DueDate      *string
}

// UpdateTaskInput: con trỏ nil = không đổi; với AssigneeID/DueDate con trỏ
// kép — con trỏ tới nil = xóa giá trị.
type UpdateTaskInput struct {
	Title        *string
	Description  *string
	Status       *string
	Priority     *string
	Position     *float64
	AssigneeID   **string
	AssigneeKind string // read only when AssigneeID is set; "" means human
	DueDate      **string
}

// assigneeKind validates the assignee pair: a human assignee is any id (the
// old behaviour), an agent assignee must be a member of the task's workspace.
func (s *TaskService) assigneeKind(ctx context.Context, workspaceID string, assigneeID *string, kind string) (string, error) {
	if kind == "" {
		kind = string(audit.KindHuman)
	}
	switch audit.Kind(kind) {
	case audit.KindHuman:
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

func optFloat(f *float64) pgtype.Float8 {
	if f == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *f, Valid: true}
}

// taskAuditFields is the explicit list of columns an audit row may report on.
// Listing them by hand rather than reflecting over db.Task keeps description
// bodies and internal columns out of a table that can never be edited, and
// makes the set a reviewer reads rather than infers.
func taskAuditFields(t db.Task) map[string]any {
	return map[string]any{
		"title":         t.Title,
		"status":        t.Status,
		"priority":      t.Priority,
		"assignee_id":   audit.Text(t.AssigneeID.Valid, t.AssigneeID.String),
		"assignee_kind": t.AssigneeKind,
		"due_date":      dateOrNil(t.DueDate),
		"position":      t.Position,
	}
}

func dateOrNil(d pgtype.Date) any {
	if !d.Valid {
		return nil
	}
	return d.Time.Format("2006-01-02")
}

func (s *TaskService) Create(ctx context.Context, actor Actor, workspaceID string, in CreateTaskInput) (db.Task, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Task{}, err
	}
	if strings.TrimSpace(in.Title) == "" {
		return db.Task{}, Invalid("tiêu đề không được để trống")
	}
	if in.Priority == "" {
		in.Priority = "medium"
	}
	if !validPriority[in.Priority] {
		return db.Task{}, Invalid("priority không hợp lệ")
	}
	due, err := parseDate(in.DueDate)
	if err != nil {
		return db.Task{}, err
	}
	assigneeKind, err := s.assigneeKind(ctx, workspaceID, in.AssigneeID, in.AssigneeKind)
	if err != nil {
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
	q := s.q.WithTx(tx)

	maxPos, err := q.MaxTaskPosition(ctx, db.MaxTaskPositionParams{WorkspaceID: workspaceID, Status: "todo"})
	if err != nil {
		return db.Task{}, err
	}
	task, err := q.CreateTask(ctx, db.CreateTaskParams{
		ID: util.NewID(), WorkspaceID: workspaceID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		Priority: in.Priority, AssigneeID: optText(in.AssigneeID), AssigneeKind: assigneeKind, DueDate: due,
		Position: maxPos + 1024, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		return db.Task{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:        actor,
		Action:       audit.ActionTaskCreated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(nil, taskAuditFields(task)),
	}, audit.Event{Topic: "task.created", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

func (s *TaskService) List(ctx context.Context, userID, workspaceID string) ([]db.Task, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListTasksByWorkspace(ctx, workspaceID)
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
	if in.Status != nil && !validStatus[*in.Status] {
		return db.Task{}, Invalid("status không hợp lệ")
	}
	if in.Priority != nil && !validPriority[*in.Priority] {
		return db.Task{}, Invalid("priority không hợp lệ")
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Task{}, Invalid("tiêu đề không được để trống")
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
	q := s.q.WithTx(tx)

	task, err := q.UpdateTask(ctx, db.UpdateTaskParams{
		ID: taskID, Title: optText(in.Title), Description: optText(in.Description),
		Status: optText(in.Status), Priority: optText(in.Priority), Position: optFloat(in.Position),
	})
	if err != nil {
		return db.Task{}, err
	}
	if in.AssigneeID != nil {
		kind, kerr := s.assigneeKind(ctx, before.WorkspaceID, *in.AssigneeID, in.AssigneeKind)
		if kerr != nil {
			return db.Task{}, kerr
		}
		task, err = q.SetTaskAssignee(ctx, db.SetTaskAssigneeParams{ID: taskID, AssigneeID: optText(*in.AssigneeID), AssigneeKind: kind})
		if err != nil {
			return db.Task{}, err
		}
	}
	if in.DueDate != nil {
		due, derr := parseDate(*in.DueDate)
		if derr != nil {
			return db.Task{}, derr
		}
		task, err = q.SetTaskDueDate(ctx, db.SetTaskDueDateParams{ID: taskID, DueDate: due})
		if err != nil {
			return db.Task{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:        actor,
		Action:       audit.ActionTaskUpdated,
		ResourceType: "task", ResourceID: task.ID,
		Changes: audit.Diff(taskAuditFields(before), taskAuditFields(task)),
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
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
	q := s.q.WithTx(tx)

	if err := q.DeleteTask(ctx, taskID); err != nil {
		return err
	}
	// The row is gone, so the audit entry is the only remaining record of what
	// it held: keep the title, which is what a person searching the log reads.
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionTaskDeleted,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"title": task.Title, "status": task.Status},
	}, audit.Event{Topic: "task.deleted", Payload: map[string]string{
		"task_id": taskID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AddComment records the author's kind so the client can draw the badge; origin
// ("agent_run:<id>") arrives with A-01 and stays NULL until then.
func (s *TaskService) AddComment(ctx context.Context, actor Actor, taskID, body string) (db.TaskComment, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.TaskComment{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.TaskComment{}, Invalid("nội dung không được để trống")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, task.WorkspaceID)
	if err != nil {
		return db.TaskComment{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskComment{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	c, err := q.CreateTaskComment(ctx, db.CreateTaskCommentParams{
		ID: util.NewID(), TaskID: taskID, AuthorID: actor.ID, AuthorKind: string(actor.Kind), Body: body,
	})
	if err != nil {
		return db.TaskComment{}, err
	}
	// The comment body is not audited: it is user content that already lives
	// in task_comments, and audit_events cannot be edited if it must be removed.
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:        actor,
		Action:       audit.ActionTaskCommentAdded,
		ResourceType: "task", ResourceID: taskID,
		Metadata: map[string]any{"comment_id": c.ID},
	}, audit.Event{Topic: "task.comment_added", Payload: map[string]string{
		"task_id": taskID, "comment_id": c.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.TaskComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskComment{}, err
	}
	return c, nil
}

func (s *TaskService) Comments(ctx context.Context, userID, taskID string) ([]db.ListTaskCommentsRow, error) {
	if _, err := s.authorize(ctx, userID, taskID); err != nil {
		return nil, err
	}
	return s.q.ListTaskComments(ctx, taskID)
}

func parseDate(s *string) (pgtype.Date, error) {
	if s == nil || *s == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", *s)
	if err != nil {
		return pgtype.Date{}, Invalid("due_date phải dạng YYYY-MM-DD")
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}
