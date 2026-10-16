package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// maxSummaryTasks caps one conversion request.
const maxSummaryTasks = 50

// SummaryActionItemView is one stored action item with what the server
// suggests for it and the task it already became, if any.
type SummaryActionItemView struct {
	Index int
	Title string
	Owner string
	Due   string
	// SuggestedAssigneeID is the one workspace member the AI owner names,
	// nil when nobody or more than one person matches.
	SuggestedAssigneeID *string
	// DueDate is the AI due phrase read against the meeting (YYYY-MM-DD),
	// nil when it does not parse.
	DueDate *string
	// TaskID is the live task this item of this summary became.
	TaskID *string
}

// MeetingSummaryView is a stored summary with its action items described.
type MeetingSummaryView struct {
	Summary db.MeetingSummary
	Items   []SummaryActionItemView
}

// SummaryView answers GET /meetings/{id}/summary: the latest summary, or nil
// when the meeting has none yet.
func (s *MeetingService) SummaryView(ctx context.Context, userID, meetingID string) (*MeetingSummaryView, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	sum, err := s.q.GetLatestMeetingSummary(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	view, err := s.describeSummary(ctx, m, sum)
	if err != nil {
		return nil, err
	}
	return &view, nil
}

// SummaryViewOf describes a summary the caller already holds (the one
// Summarize just stored), after checking the caller may read its meeting.
func (s *MeetingService) SummaryViewOf(ctx context.Context, userID string, sum db.MeetingSummary) (MeetingSummaryView, error) {
	m, _, err := s.authorize(ctx, userID, sum.MeetingID)
	if err != nil {
		return MeetingSummaryView{}, err
	}
	return s.describeSummary(ctx, m, sum)
}

func (s *MeetingService) describeSummary(ctx context.Context, m db.Meeting, sum db.MeetingSummary) (MeetingSummaryView, error) {
	stored := summaryActionItems(sum)
	view := MeetingSummaryView{Summary: sum, Items: make([]SummaryActionItemView, 0, len(stored))}
	if len(stored) == 0 {
		return view, nil
	}
	candidates, err := s.loadAssigneeCandidates(ctx, m.ID, m.WorkspaceID)
	if err != nil {
		return MeetingSummaryView{}, err
	}
	links, err := s.liveSummaryLinks(ctx, s.q, m.OrganizationID, sum.ID)
	if err != nil {
		return MeetingSummaryView{}, err
	}
	anchor := meetingDueAnchor(m)
	for i, it := range stored {
		item := SummaryActionItemView{Index: i, Title: it.Title, Owner: it.Owner, Due: it.Due}
		if strings.TrimSpace(it.Owner) != "" {
			item.SuggestedAssigneeID = candidates.resolve(it.Owner)
		}
		if strings.TrimSpace(it.Due) != "" {
			item.DueDate = parseMeetingDueSpoken(it.Due, anchor)
		}
		if taskID, ok := links[i]; ok {
			item.TaskID = &taskID
		}
		view.Items = append(view.Items, item)
	}
	return view, nil
}

// summaryActionItems reads the stored action items; a row that does not
// parse has none, so it can be read but not converted.
func summaryActionItems(sum db.MeetingSummary) []ai.ActionItem {
	var items []ai.ActionItem
	if err := json.Unmarshal([]byte(sum.ActionItems), &items); err != nil {
		return nil
	}
	return items
}

// liveSummaryLinks maps each converted item of a summary to its task, keeping
// only tasks that still exist (the oldest link wins if there are several).
func (s *MeetingService) liveSummaryLinks(ctx context.Context, q *db.Queries, orgID, summaryID string) (map[int]string, error) {
	rows, err := q.ListLiveMeetingSummaryTaskLinks(ctx, db.ListLiveMeetingSummaryTaskLinksParams{
		OrganizationID: orgID, SummaryID: summaryID,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[int]string, len(rows))
	for _, r := range rows {
		if _, ok := out[int(r.ItemIndex)]; !ok {
			out[int(r.ItemIndex)] = r.TaskID
		}
	}
	return out, nil
}

// MeetingSummaryTaskItem is one action item the host chose, with the values
// the host confirmed. The server never re-reads the AI owner or due phrase into
// these: nil is "nobody" / "no due date" (ADR 0010).
type MeetingSummaryTaskItem struct {
	// Index is the item's position in the summary's stored action items.
	Index int
	// Title replaces the stored title when not blank.
	Title       string
	Description string
	AssigneeID  *string
	DueDate     *string
	// ProjectID nil takes the meeting's project; "" is no project.
	ProjectID *string
	Priority  string
}

// SummaryTasksInput is POST /meetings/{id}/summary/tasks.
type SummaryTasksInput struct {
	SummaryID string
	Items     []MeetingSummaryTaskItem
}

// SummaryTaskLink pairs a converted item with its new task.
type SummaryTaskLink struct {
	Index  int
	TaskID string
}

// SummaryTasksResult is what a conversion created, in request order.
type SummaryTasksResult struct {
	Tasks []db.Task
	Links []SummaryTaskLink
}

func errSummarySuperseded() error {
	return CodedError{
		Code: "summary_superseded", Status: http.StatusConflict, Err: ErrConflict,
		Msg: "bản tóm tắt đã được tạo lại; hãy tải lại rồi chọn việc cần tạo",
	}
}

// CreateTasksFromSummary turns chosen action items of the meeting's latest
// summary into tasks. Every task, its link to the item and the batch's audit
// row commit in one transaction, so a refusal anywhere leaves nothing behind.
// The meeting's summary lock (LockMeetingSummaryChanges, also taken by the
// store of Summarize) keeps a regenerated summary from committing under the
// batch, and the summary row lock serializes conversions of the same summary.
func (s *MeetingService) CreateTasksFromSummary(ctx context.Context, userID, meetingID string, in SummaryTasksInput) (SummaryTasksResult, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return SummaryTasksResult{}, err
	}
	if s.Tasks == nil {
		return SummaryTasksResult{}, coded(http.StatusServiceUnavailable, "tasks_unavailable", "task service chưa sẵn sàng")
	}
	summaryID := strings.TrimSpace(in.SummaryID)
	if summaryID == "" {
		return SummaryTasksResult{}, Invalid("cần summary_id của bản tóm tắt")
	}
	if len(in.Items) == 0 {
		return SummaryTasksResult{}, Invalid("cần ít nhất một việc")
	}
	if len(in.Items) > maxSummaryTasks {
		return SummaryTasksResult{}, Invalid("tối đa 50 việc mỗi lần")
	}
	// Summaries are append-only: the latest row read here is the one locked
	// and re-checked inside the transaction below.
	sum, err := s.q.GetLatestMeetingSummary(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && sum.ID != summaryID) {
		return SummaryTasksResult{}, errSummarySuperseded()
	}
	if err != nil {
		return SummaryTasksResult{}, err
	}
	stored := summaryActionItems(sum)
	indexes := make([]int, 0, len(in.Items))
	seen := make(map[int]struct{}, len(in.Items))
	for _, it := range in.Items {
		if it.Index < 0 || it.Index >= len(stored) {
			return SummaryTasksResult{}, Invalid("index không trỏ tới việc nào trong bản tóm tắt")
		}
		if _, dup := seen[it.Index]; dup {
			return SummaryTasksResult{}, Invalid("mỗi việc chỉ được chọn một lần")
		}
		seen[it.Index] = struct{}{}
		indexes = append(indexes, it.Index)
	}

	// The meeting's project is the default only while it still exists:
	// deleting a project leaves meetings.project_id in place, and a dangling
	// default would refuse the whole batch as not found.
	var meetingProject *string
	if m.ProjectID.Valid {
		_, err := s.q.GetProject(ctx, db.GetProjectParams{
			ID: m.ProjectID.String, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		})
		switch {
		case err == nil:
			meetingProject = &m.ProjectID.String
		case !errors.Is(err, pgx.ErrNoRows):
			return SummaryTasksResult{}, err
		}
	}

	origin := meetingID
	inputs := make([]CreateTaskInput, 0, len(in.Items))
	for _, it := range in.Items {
		item := stored[it.Index]
		title := strings.TrimSpace(it.Title)
		if title == "" {
			title = strings.TrimSpace(item.Title)
		}
		projectID := it.ProjectID
		if projectID == nil {
			projectID = meetingProject
		}
		inputs = append(inputs, CreateTaskInput{
			Title: title, Description: summaryTaskDescription(it, item, m.Title),
			AssigneeID: it.AssigneeID, DueDate: it.DueDate, ProjectID: projectID,
			Priority: strings.TrimSpace(it.Priority), OriginType: "meeting", OriginID: &origin,
		})
	}

	actor := Human(userID)
	tasks, err := s.Tasks.CreateManyWith(ctx, actor, m.WorkspaceID, inputs, CreateManyOptions{
		KeepOrder: true,
		Before: func(ctx context.Context, q *db.Queries, ws db.Workspace) error {
			// The meeting lock first: a regenerated summary commits either
			// before the re-read below, which then refuses this one as
			// superseded, or after this batch commits.
			if err := q.LockMeetingSummaryChanges(ctx, meetingID); err != nil {
				return err
			}
			if _, err := q.LockMeetingSummary(ctx, db.LockMeetingSummaryParams{
				ID: summaryID, MeetingID: meetingID, OrganizationID: m.OrganizationID,
			}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errSummarySuperseded()
				}
				return err
			}
			latest, err := q.GetLatestMeetingSummary(ctx, meetingID)
			if err != nil {
				return err
			}
			if latest.ID != summaryID {
				return errSummarySuperseded()
			}
			// The people and projects named are checked before the items'
			// state: a reference the workspace does not have is refused as
			// such, whatever became of the item.
			projects := make([]pgtype.Text, 0, len(inputs))
			for _, ti := range inputs {
				if _, err := s.Tasks.assigneeKind(ctx, ws.OrganizationID, ws.ID, ti.AssigneeID, "", true); err != nil {
					return err
				}
				projectID, err := s.Tasks.normalizeProjectID(ctx, q, ws.OrganizationID, ws.ID, ti.ProjectID)
				if err != nil {
					return err
				}
				projects = append(projects, projectID)
			}
			links, err := s.liveSummaryLinks(ctx, q, m.OrganizationID, summaryID)
			if err != nil {
				return err
			}
			var converted []int
			for _, idx := range indexes {
				if _, ok := links[idx]; ok {
					converted = append(converted, idx)
				}
			}
			if len(converted) > 0 {
				sort.Ints(converted)
				return CodedError{
					Code: "summary_item_already_converted", Status: http.StatusConflict, Err: ErrConflict,
					Msg:    "có việc trong bản tóm tắt này đã được tạo trước đó",
					Fields: map[string]any{"indexes": converted},
				}
			}
			return refuseSummaryDuplicates(ctx, q, ws, indexes, inputs, projects)
		},
		After: func(ctx context.Context, q *db.Queries, ws db.Workspace, tasks []db.Task) error {
			taskIDs := make([]string, 0, len(tasks))
			for i, t := range tasks {
				if err := q.InsertMeetingSummaryTaskLink(ctx, db.InsertMeetingSummaryTaskLinkParams{
					ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID,
					MeetingID: meetingID, SummaryID: summaryID, ItemIndex: int32(indexes[i]), TaskID: t.ID,
					CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
				}); err != nil {
					return err
				}
				taskIDs = append(taskIDs, t.ID)
			}
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, Actor: actor,
				Action:       audit.ActionMeetingSummaryTasksCreated,
				ResourceType: "meeting_summary", ResourceID: summaryID,
				Metadata: map[string]any{
					"meeting_id": meetingID, "count": len(tasks), "item_indexes": indexes, "task_ids": taskIDs,
				},
			}, audit.Event{Topic: "summary.tasks_linked", Payload: map[string]string{
				"meeting_id": meetingID, "summary_id": summaryID, "workspace_id": ws.ID,
			}}); err != nil {
				return err
			}
			payload, err := json.Marshal(map[string]any{"count": len(tasks), "summary_id": summaryID})
			if err != nil {
				return err
			}
			return s.writeAudit(ctx, q, m, "TASKS_CREATED_FROM_SUMMARY", userID, "", "", string(payload))
		},
	})
	if err != nil {
		return SummaryTasksResult{}, err
	}
	out := SummaryTasksResult{Tasks: tasks, Links: make([]SummaryTaskLink, 0, len(tasks))}
	for i, t := range tasks {
		out.Links = append(out.Links, SummaryTaskLink{Index: indexes[i], TaskID: t.ID})
	}
	return out, nil
}

// refuseSummaryDuplicates finds, before any insert, every item the
// active-duplicate guard of createTaskInTx would refuse: a title that matches
// an open task under the same project (summary tasks have no parent), or that
// repeats an earlier item of the batch under the same project. One refusal
// names them all in fields.indexes, so the host knows which items to leave
// out, instead of the batch rolling back on the first one with no item named.
// The open task of the lowest refused item that has one is named in the
// guard's own fields. The guard's key locks are taken here, in sorted order so
// two batches cannot deadlock on them, and held until commit, so the answer
// stays true while the batch inserts.
func refuseSummaryDuplicates(ctx context.Context, q *db.Queries, ws db.Workspace, indexes []int, inputs []CreateTaskInput, projects []pgtype.Text) error {
	keys := make([]string, len(inputs))
	locks := make([]string, 0, len(inputs))
	for i, in := range inputs {
		normalized := normalizeTaskTitle(in.Title)
		if normalized == "" {
			continue
		}
		keys[i] = activeDuplicateLockKey(ws, projects[i], pgtype.Text{}, normalized)
		locks = append(locks, keys[i])
	}
	sort.Strings(locks)
	locks = slices.Compact(locks)
	for _, key := range locks {
		if err := q.LockTaskDuplicateKey(ctx, key); err != nil {
			return err
		}
	}
	var refused []int
	var named *db.Task
	namedIndex := -1
	seen := make(map[string]struct{}, len(inputs))
	for i, in := range inputs {
		if keys[i] == "" {
			continue
		}
		if _, repeat := seen[keys[i]]; repeat {
			refused = append(refused, indexes[i])
			continue
		}
		seen[keys[i]] = struct{}{}
		dup, err := q.FindActiveDuplicateTask(ctx, db.FindActiveDuplicateTaskParams{
			OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, ProjectID: projects[i],
			NormalizedTitle: normalizeTaskTitle(in.Title),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		refused = append(refused, indexes[i])
		if named == nil || indexes[i] < namedIndex {
			named, namedIndex = &dup, indexes[i]
		}
	}
	if len(refused) == 0 {
		return nil
	}
	sort.Ints(refused)
	fields := map[string]any{}
	if named != nil {
		fields = activeDuplicateFields(ws, *named)
	}
	fields["indexes"] = refused
	return CodedError{
		Code: "active_duplicate_task", Status: http.StatusConflict, Err: ErrConflict,
		Msg:    "có việc trùng tiêu đề với một task đang mở hoặc với việc khác trong lần tạo này",
		Fields: fields,
	}
}

// summaryTaskDescription is the host's description, then what the AI said
// that the task does not carry (an owner when it has no assignee, a due phrase
// when it has no due date), then the meeting it came from. The labels are
// Vietnamese: the summary does not record the language it was written in.
func summaryTaskDescription(it MeetingSummaryTaskItem, item ai.ActionItem, meetingTitle string) string {
	desc := strings.TrimSpace(it.Description)
	var extra []string
	if owner := strings.TrimSpace(item.Owner); owner != "" && it.AssigneeID == nil {
		extra = append(extra, "Người phụ trách (AI): "+owner)
	}
	if due := strings.TrimSpace(item.Due); due != "" && it.DueDate == nil {
		extra = append(extra, "Hạn (AI): "+due)
	}
	if len(extra) > 0 {
		block := strings.Join(extra, "\n")
		if desc == "" {
			desc = block
		} else {
			desc += "\n" + block
		}
	}
	origin := "Từ cuộc họp: " + meetingTitle
	if desc == "" {
		return origin
	}
	return desc + "\n\n" + origin
}
