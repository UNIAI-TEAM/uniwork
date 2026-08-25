package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var validStatus = map[string]bool{"todo": true, "in_progress": true, "done": true, "cancelled": true}
var validPriority = map[string]bool{"low": true, "medium": true, "high": true, "urgent": true}

type TaskService struct {
	q   *db.Queries
	ws  *WorkspaceService
	pub EventPublisher
}

func NewTaskService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *TaskService {
	return &TaskService{q: q, ws: ws, pub: pub}
}

type CreateTaskInput struct {
	Title       string
	Description string
	Priority    string
	AssigneeID  *string
	DueDate     *string
}

// UpdateTaskInput: con trỏ nil = không đổi; với AssigneeID/DueDate con trỏ
// kép — con trỏ tới nil = xóa giá trị.
type UpdateTaskInput struct {
	Title       *string
	Description *string
	Status      *string
	Priority    *string
	Position    *float64
	AssigneeID  **string
	DueDate     **string
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

func (s *TaskService) Create(ctx context.Context, userID, workspaceID string, in CreateTaskInput) (db.Task, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
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
	maxPos, err := s.q.MaxTaskPosition(ctx, db.MaxTaskPositionParams{WorkspaceID: workspaceID, Status: "todo"})
	if err != nil {
		return db.Task{}, err
	}
	due, err := parseDate(in.DueDate)
	if err != nil {
		return db.Task{}, err
	}
	task, err := s.q.CreateTask(ctx, db.CreateTaskParams{
		ID: util.NewID(), WorkspaceID: workspaceID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		Priority: in.Priority, AssigneeID: optText(in.AssigneeID), DueDate: due,
		Position: maxPos + 1024, CreatedBy: userID,
	})
	if err != nil {
		return db.Task{}, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "task.created", Payload: map[string]string{"task_id": task.ID}})
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
	task, err := s.q.GetTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Task{}, ErrNotFound
	}
	if err != nil {
		return db.Task{}, err
	}
	if _, err := s.ws.RequireMember(ctx, task.WorkspaceID, userID); err != nil {
		return db.Task{}, err
	}
	return task, nil
}

func (s *TaskService) Get(ctx context.Context, userID, taskID string) (db.Task, error) {
	return s.authorize(ctx, userID, taskID)
}

func (s *TaskService) Update(ctx context.Context, userID, taskID string, in UpdateTaskInput) (db.Task, error) {
	task, err := s.authorize(ctx, userID, taskID)
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
	task, err = s.q.UpdateTask(ctx, db.UpdateTaskParams{
		ID: taskID, Title: optText(in.Title), Description: optText(in.Description),
		Status: optText(in.Status), Priority: optText(in.Priority), Position: optFloat(in.Position),
	})
	if err != nil {
		return db.Task{}, err
	}
	if in.AssigneeID != nil {
		task, err = s.q.SetTaskAssignee(ctx, db.SetTaskAssigneeParams{ID: taskID, AssigneeID: optText(*in.AssigneeID)})
		if err != nil {
			return db.Task{}, err
		}
	}
	if in.DueDate != nil {
		due, err := parseDate(*in.DueDate)
		if err != nil {
			return db.Task{}, err
		}
		task, err = s.q.SetTaskDueDate(ctx, db.SetTaskDueDateParams{ID: taskID, DueDate: due})
		if err != nil {
			return db.Task{}, err
		}
	}
	s.pub.Publish(ctx, task.WorkspaceID, Event{Type: "task.updated", Payload: map[string]string{"task_id": task.ID}})
	return task, nil
}

func (s *TaskService) Delete(ctx context.Context, userID, taskID string) error {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return err
	}
	if err := s.q.DeleteTask(ctx, taskID); err != nil {
		return err
	}
	s.pub.Publish(ctx, task.WorkspaceID, Event{Type: "task.deleted", Payload: map[string]string{"task_id": taskID}})
	return nil
}

func (s *TaskService) AddComment(ctx context.Context, userID, taskID, body string) (db.TaskComment, error) {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return db.TaskComment{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.TaskComment{}, Invalid("nội dung không được để trống")
	}
	c, err := s.q.CreateTaskComment(ctx, db.CreateTaskCommentParams{
		ID: util.NewID(), TaskID: taskID, AuthorID: userID, Body: body,
	})
	if err != nil {
		return db.TaskComment{}, err
	}
	s.pub.Publish(ctx, task.WorkspaceID, Event{Type: "comment.created", Payload: map[string]string{"task_id": taskID}})
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
