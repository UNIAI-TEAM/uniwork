package service

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/service/templates"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const questionnaireMaxBytes = 16 * 1024

var validRoles = map[string]bool{"engineer": true, "manager": true, "product": true, "ops": true,
	"sales": true, "hr": true, "student": true, "other": true}
var validUseCases = map[string]bool{"team_tasks": true, "meetings": true, "personal_tasks": true,
	"project_tracking": true, "other": true}
var validCompletionPaths = map[string]bool{"": true, "full": true, "invite_skipped": true,
	"skip_existing": true, "invite_accept": true}

type OnboardingService struct {
	q      *db.Queries
	ws     *WorkspaceService
	pub    EventPublisher
	render mail.Renderer
	out    mail.Enqueuer
}

func NewOnboardingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher, r mail.Renderer, out mail.Enqueuer) *OnboardingService {
	return &OnboardingService{q: q, ws: ws, pub: pub, render: r, out: out}
}

// questionnaire chỉ validate shape; server không suy diễn gì từ nội dung.
type questionnaire struct {
	Version        int      `json:"version"`
	Role           *string  `json:"role"`
	RoleOther      string   `json:"role_other"`
	RoleSkipped    bool     `json:"role_skipped"`
	UseCase        []string `json:"use_case"`
	UseCaseOther   string   `json:"use_case_other"`
	UseCaseSkipped bool     `json:"use_case_skipped"`
}

func validateQuestionnaire(raw json.RawMessage) error {
	if len(raw) > questionnaireMaxBytes {
		return Invalid("questionnaire quá lớn")
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return Invalid("questionnaire phải là object JSON")
	}
	var qn questionnaire
	if err := json.Unmarshal(raw, &qn); err != nil {
		return Invalid("questionnaire sai kiểu dữ liệu")
	}
	if qn.Role != nil && !validRoles[*qn.Role] {
		return Invalid("role không hợp lệ")
	}
	for _, u := range qn.UseCase {
		if !validUseCases[u] {
			return Invalid("use_case không hợp lệ")
		}
	}
	if len(qn.RoleOther) > 80 || len(qn.UseCaseOther) > 80 {
		return Invalid("mô tả 'khác' tối đa 80 ký tự")
	}
	return nil
}

func (s *OnboardingService) PatchQuestionnaire(ctx context.Context, userID string, raw json.RawMessage) (db.User, error) {
	var arg []byte
	if len(raw) > 0 {
		if err := validateQuestionnaire(raw); err != nil {
			return db.User{}, err
		}
		arg = raw
	}
	return s.q.PatchUserOnboarding(ctx, db.PatchUserOnboardingParams{Questionnaire: arg, ID: userID})
}

func (s *OnboardingService) Complete(ctx context.Context, userID, path, workspaceID string) (db.User, error) {
	if !validCompletionPaths[path] {
		return db.User{}, Invalid("completion_path không hợp lệ")
	}
	if err := requireVerifiedEmail(ctx, s.q, userID); err != nil {
		return db.User{}, err
	}
	if workspaceID != "" {
		if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
			return db.User{}, err
		}
	}
	before, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	first := !before.OnboardedAt.Valid
	u, err := s.q.MarkUserOnboarded(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if first && (path == "full" || path == "invite_accept") && workspaceID != "" {
		s.sendWelcome(ctx, u, workspaceID)
	}
	return u, nil
}

// sendWelcome queues the welcome mail. Complete already guards this to the
// user's first-ever onboarding via onboarded_at, so no extra dedup check
// against the (prunable) emails table is needed here. Failures are logged:
// onboarding must not fail because of a greeting.
func (s *OnboardingService) sendWelcome(ctx context.Context, u db.User, workspaceID string) {
	view, err := s.ws.GetView(ctx, u.ID, workspaceID)
	if err != nil {
		slog.Warn("welcome mail: workspace view", "user", u.ID, "err", err)
		return
	}
	msg, err := s.render.Welcome(u.Email, u.Locale, u.ID, mail.WelcomeData{
		DisplayName: u.DisplayName, WorkspaceName: view.Name,
		WorkspaceURL: s.render.AppURL + "/" + view.OrganizationSlug + "/" + view.Slug,
	})
	if err != nil {
		slog.Warn("welcome mail: render", "user", u.ID, "err", err)
		return
	}
	if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
		slog.Warn("welcome mail: enqueue", "user", u.ID, "err", err)
		return
	}
	s.out.Kick()
}

// SeedWelcomeTask: đúng 1 task hướng dẫn / (workspace, user); lần 2 trả task cũ.
func (s *OnboardingService) SeedWelcomeTask(ctx context.Context, userID, workspaceID string) (db.Task, bool, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Task{}, false, err
	}
	if existing, err := s.q.GetWelcomeTask(ctx, db.GetWelcomeTaskParams{WorkspaceID: workspaceID, CreatedBy: userID}); err == nil {
		return existing, false, nil
	}
	maxPos, err := s.q.MaxTaskPosition(ctx, db.MaxTaskPositionParams{WorkspaceID: workspaceID, Status: "in_progress"})
	if err != nil {
		return db.Task{}, false, err
	}
	task, err := s.q.CreateWelcomeTask(ctx, db.CreateWelcomeTaskParams{
		ID: util.NewID(), WorkspaceID: workspaceID,
		Title: templates.WelcomeTaskTitle, Description: templates.WelcomeTaskBody,
		AssigneeID: pgtype.Text{String: userID, Valid: true}, Position: maxPos + 1024,
	})
	if isUniqueViolation(err) { // đua với chính mình (StrictMode) → đọc lại
		existing, gerr := s.q.GetWelcomeTask(ctx, db.GetWelcomeTaskParams{WorkspaceID: workspaceID, CreatedBy: userID})
		return existing, false, gerr
	}
	if err != nil {
		return db.Task{}, false, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "task.created", Payload: map[string]string{"task_id": task.ID}})
	return task, true, nil
}
