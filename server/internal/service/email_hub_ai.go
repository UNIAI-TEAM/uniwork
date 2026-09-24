package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type EmailHubThreadSummaryView struct {
	Summary      string
	KeyPoints    []string
	ActionItems  []ai.ActionItem
	NeedsReply   bool
	ReplyHint    string
	Model        string
	Cached       bool
	SummarizedAt time.Time
}

func (s *EmailHubService) AIEnabled() bool {
	return s.AI != nil && s.AI.Enabled()
}

// GetThreadSummary returns a cached summary when the thread content fingerprint still matches.
func (s *EmailHubService) GetThreadSummary(
	ctx context.Context,
	actor Actor,
	workspaceID, accountID, threadID, locale string,
) (EmailHubThreadSummaryView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadSummaryView{}, err
	}
	if locale == "" {
		locale = "vi"
	}
	view, row, err := s.getThreadForSummary(ctx, actor, ws, workspaceID, accountID, threadID)
	if err != nil {
		return EmailHubThreadSummaryView{}, err
	}
	fp := plainBodyFingerprintSource(view, row.SyncedAt.Time)
	cached, ok, err := s.loadEmailHubThreadAiSummary(ctx, ws.OrganizationID, threadID, locale, fp)
	if err != nil {
		return EmailHubThreadSummaryView{}, err
	}
	if !ok {
		return EmailHubThreadSummaryView{}, ErrNotFound
	}
	return cached, nil
}

// SummarizeThread loads the thread body (IMAP when needed), uses DB cache unless force, else asks the gateway.
func (s *EmailHubService) SummarizeThread(
	ctx context.Context,
	actor Actor,
	workspaceID, accountID, threadID, locale string,
	force bool,
) (EmailHubThreadSummaryView, error) {
	if !s.AIEnabled() {
		return EmailHubThreadSummaryView{}, coded(http.StatusServiceUnavailable, "ai_not_configured", "AI chưa được cấu hình trên server")
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadSummaryView{}, err
	}
	if locale == "" {
		locale = "vi"
	}
	view, row, err := s.getThreadForSummary(ctx, actor, ws, workspaceID, accountID, threadID)
	if err != nil {
		return EmailHubThreadSummaryView{}, err
	}
	fp := plainBodyFingerprintSource(view, row.SyncedAt.Time)
	if !force {
		cached, ok, lerr := s.loadEmailHubThreadAiSummary(ctx, ws.OrganizationID, threadID, locale, fp)
		if lerr != nil {
			return EmailHubThreadSummaryView{}, lerr
		}
		if ok {
			return cached, nil
		}
	}
	body := imapclient.PlainBodyForAI(view.BodyHTML, view.BodyText, view.Snippet)
	if body == "" && strings.TrimSpace(view.Subject) == "" {
		return EmailHubThreadSummaryView{}, coded(http.StatusConflict, "nothing_to_summarize", "chưa có nội dung email để tóm tắt")
	}
	from := view.FromAddr
	if n := strings.TrimSpace(view.FromName); n != "" {
		from = n + " <" + view.FromAddr + ">"
	}
	resp, err := s.AI.Complete(ctx, ai.Request{
		Actor: Human(actor.ID), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Capability: ai.CapEmailThreadSummary, PromptID: ai.PromptEmailThreadSummary,
		Vars: map[string]any{
			"locale": locale, "subject": view.Subject, "from": from,
			"to": strings.Join(view.ToAddrs, ", "), "sent_at": view.SentAt.UTC().Format(time.RFC3339),
			"body": body,
		},
	})
	if err != nil {
		var aiErr *ai.Error
		if errors.As(err, &aiErr) {
			return EmailHubThreadSummaryView{}, coded(aiErr.Status, aiErr.Code, aiErr.Msg)
		}
		return EmailHubThreadSummaryView{}, coded(http.StatusBadGateway, "ai_failed", "không tạo được tóm tắt: "+err.Error())
	}
	parsed, err := ai.ParseEmailThreadSummaryJSON(resp.Text)
	if err != nil {
		return EmailHubThreadSummaryView{}, coded(http.StatusBadGateway, "ai_failed", "không tạo được tóm tắt: "+err.Error())
	}
	out := EmailHubThreadSummaryView{
		Summary: parsed.Summary, KeyPoints: parsed.KeyPoints, ActionItems: parsed.ActionItems,
		NeedsReply: parsed.NeedsReply, ReplyHint: parsed.ReplyHint, Model: resp.Model,
		Cached: false, SummarizedAt: time.Now().UTC(),
	}
	if err := s.saveEmailHubThreadAiSummary(ctx, actor, ws.OrganizationID, accountID, threadID, locale, fp, out); err != nil {
		s.log.Warn("email hub ai summary cache save failed", "thread_id", threadID, "err", err)
	}
	return out, nil
}

func (s *EmailHubService) getThreadForSummary(
	ctx context.Context,
	actor Actor,
	ws db.Workspace,
	workspaceID, accountID, threadID string,
) (EmailHubThreadView, db.EmailHubThread, error) {
	view, err := s.GetThread(ctx, actor, workspaceID, accountID, threadID, true, false)
	if err != nil {
		return EmailHubThreadView{}, db.EmailHubThread{}, err
	}
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, db.EmailHubThread{}, ErrNotFound
		}
		return EmailHubThreadView{}, db.EmailHubThread{}, err
	}
	return view, row, nil
}

// CreateTasksFromThreadSummary turns chosen action items into workspace tasks.
func (s *EmailHubService) CreateTasksFromThreadSummary(
	ctx context.Context,
	actor Actor,
	workspaceID, accountID, threadID string,
	items []SummaryTaskItem,
) ([]db.Task, error) {
	if s.Tasks == nil {
		return nil, coded(http.StatusServiceUnavailable, "tasks_unavailable", "task service chưa sẵn sàng")
	}
	if len(items) == 0 {
		return nil, Invalid("cần ít nhất một việc")
	}
	if len(items) > 50 {
		return nil, Invalid("tối đa 50 việc mỗi lần")
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	view, err := s.GetThread(ctx, actor, workspaceID, accountID, threadID, false, false)
	if err != nil {
		return nil, err
	}
	candidates, err := s.loadWorkspaceAssigneeCandidates(ctx, ws.ID)
	if err != nil {
		return nil, err
	}
	anchor := view.SentAt
	if anchor.IsZero() {
		anchor = time.Now().UTC()
	}
	threadOrigin := threadID
	subject := strings.TrimSpace(view.Subject)
	out := make([]db.Task, 0, len(items))
	for _, it := range items {
		assigneeID := it.AssigneeID
		if assigneeID == nil && strings.TrimSpace(it.Owner) != "" {
			assigneeID = candidates.resolve(it.Owner)
		}
		dueDate := it.DueDate
		if dueDate == nil && strings.TrimSpace(it.DueSpoken) != "" {
			dueDate = parseMeetingDueSpoken(it.DueSpoken, anchor)
		}
		desc := strings.TrimSpace(it.Description)
		var extra []string
		if strings.TrimSpace(it.Owner) != "" && assigneeID == nil {
			extra = append(extra, "Người phụ trách (AI): "+strings.TrimSpace(it.Owner))
		}
		if strings.TrimSpace(it.DueSpoken) != "" && dueDate == nil {
			extra = append(extra, "Hạn (AI): "+strings.TrimSpace(it.DueSpoken))
		}
		if len(extra) > 0 {
			block := strings.Join(extra, "\n")
			if desc == "" {
				desc = block
			} else {
				desc = desc + "\n" + block
			}
		}
		origin := "Từ email: " + subject
		if desc == "" {
			desc = origin
		} else {
			desc = desc + "\n\n" + origin
		}
		priority := strings.TrimSpace(it.Priority)
		t, err := s.Tasks.Create(ctx, actor, ws.ID, CreateTaskInput{
			Title: it.Title, Description: desc, AssigneeID: assigneeID, DueDate: dueDate, ProjectID: it.ProjectID,
			Priority: priority, OriginType: "email_thread", OriginID: &threadOrigin,
		})
		if err != nil {
			return out, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (s *EmailHubService) loadWorkspaceAssigneeCandidates(ctx context.Context, workspaceID string) (assigneeCandidates, error) {
	out := assigneeCandidates{byExact: make(map[string]string)}
	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return out, err
	}
	for _, m := range members {
		name := strings.TrimSpace(m.DisplayName)
		if name == "" {
			continue
		}
		c := assigneeCandidate{UserID: m.UserID, Name: name}
		out.all = append(out.all, c)
		out.byExact[normalizePersonName(name)] = m.UserID
	}
	return out, nil
}
