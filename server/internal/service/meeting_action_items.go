package service

import (
	"context"
	"encoding/json"
	"errors"
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

// The action items of a meeting (UNI-1998, spec meeting follow-through §3,
// §5.1, §6.1–6.3): what a summary proposed, what a clerk added, and what
// became of each. Anyone in the workspace reads them; only a clerk (host,
// secretary, workspace admin) adds, dismisses, restores or converts.

const (
	// maxActionItemsPerConvert caps one conversion request.
	maxActionItemsPerConvert = 50
	// maxActionItemTitleRunes bounds a title a clerk types. Tasks have no
	// title limit of their own; this one only keeps a typed row readable.
	maxActionItemTitleRunes = 500
	// maxActionItemTextRunes bounds the owner and due phrases of a manual item.
	maxActionItemTextRunes = 200
	// maxDismissReasonRunes bounds the optional reason for dismissing an item.
	maxDismissReasonRunes = 500
)

// Action item sources (meeting_action_items.source). LIVE rows come from the
// AI scribe during the meeting (UNI-2025) and, like MANUAL ones, survive a
// regenerated summary.
const (
	ActionItemSourceAI     = "AI"
	ActionItemSourceManual = "MANUAL"
	ActionItemSourceLive   = "LIVE"
)

// Action item states. They are derived, never stored: actionItemStatus is the
// one rule every read and every write applies.
const (
	ActionItemPending   = "PENDING"
	ActionItemConverted = "CONVERTED"
	ActionItemDismissed = "DISMISSED"
)

// actionItemStatus: dismissed wins; otherwise an item whose task still exists
// is converted; anything else, a deleted task included, is pending again.
func actionItemStatus(it db.MeetingActionItem, taskLive bool) string {
	switch {
	case it.DismissedAt.Valid:
		return ActionItemDismissed
	case it.TaskID.Valid && taskLive:
		return ActionItemConverted
	default:
		return ActionItemPending
	}
}

// ActionItemTask is the live task a converted item became.
type ActionItemTask struct {
	ID, Title, Status string
	// Done reads the status category: a status in done or cancelled closes it.
	Done bool
	// Overdue is an open task due before today, in the meeting's timezone.
	Overdue    bool
	AssigneeID *string
	DueDate    *string
}

// ActionItemView is one item with its derived state and, while it is
// pending, what the server suggests for it (never applied on its own).
type ActionItemView struct {
	Item                db.MeetingActionItem
	Status              string
	SuggestedAssigneeID *string
	SuggestedDueDate    *string
	Task                *ActionItemTask
	// Evidence is what an AI item rests on (UNI-2002); empty for the others.
	Evidence []EvidenceRef
}

// ActionItemCounts heads the meeting's "after the meeting" section.
type ActionItemCounts struct {
	Pending, Converted, Dismissed, TasksDone, TasksOverdue int
}

// ActionItemsView answers GET /meetings/{id}/action-items.
type ActionItemsView struct {
	Items  []ActionItemView
	Counts ActionItemCounts
}

// ActionItems lists a meeting's action items for any member of its workspace.
func (s *MeetingService) ActionItems(ctx context.Context, userID, meetingID string) (ActionItemsView, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return ActionItemsView{}, err
	}
	rows, err := s.q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return ActionItemsView{}, err
	}
	return s.describeActionItems(ctx, m, rows, time.Now())
}

func (s *MeetingService) describeActionItems(ctx context.Context, m db.Meeting, rows []db.ListMeetingActionItemsRow, now time.Time) (ActionItemsView, error) {
	out := ActionItemsView{Items: make([]ActionItemView, 0, len(rows))}
	var candidates *assigneeCandidates
	anchor := meetingDueAnchor(m)
	today := now.In(meetingLocation(m.Timezone)).Format("2006-01-02")
	for _, r := range rows {
		v := ActionItemView{Item: r.MeetingActionItem, Status: actionItemStatus(r.MeetingActionItem, r.TaskLive), Evidence: decodeEvidence(r.MeetingActionItem.Evidence)}
		switch v.Status {
		case ActionItemPending:
			out.Counts.Pending++
			if strings.TrimSpace(v.Item.OwnerText) != "" {
				if candidates == nil {
					c, err := s.loadAssigneeCandidates(ctx, m.ID, m.WorkspaceID)
					if err != nil {
						return ActionItemsView{}, err
					}
					candidates = &c
				}
				v.SuggestedAssigneeID = candidates.resolve(v.Item.OwnerText)
			}
			if strings.TrimSpace(v.Item.DueText) != "" {
				v.SuggestedDueDate = parseMeetingDueSpoken(v.Item.DueText, anchor)
			}
		case ActionItemDismissed:
			out.Counts.Dismissed++
		case ActionItemConverted:
			out.Counts.Converted++
			task := &ActionItemTask{ID: v.Item.TaskID.String, Title: r.TaskTitle, Status: r.TaskStatus, Done: r.TaskClosed}
			if r.TaskAssigneeID.Valid {
				task.AssigneeID = &r.TaskAssigneeID.String
			}
			if r.TaskDueDate.Valid {
				due := r.TaskDueDate.Time.Format("2006-01-02")
				task.DueDate = &due
				task.Overdue = !task.Done && due < today
			}
			if task.Done {
				out.Counts.TasksDone++
			}
			if task.Overdue {
				out.Counts.TasksOverdue++
			}
			v.Task = task
		}
		out.Items = append(out.Items, v)
	}
	return out, nil
}

func errActionItemNotFound(ids []string) error {
	return CodedError{
		Code: "action_item_not_found", Status: http.StatusNotFound, Err: ErrNotFound,
		Msg:    "không tìm thấy việc trong cuộc họp này; có thể bản tóm tắt vừa được tạo lại",
		Fields: map[string]any{"action_item_ids": ids},
	}
}

func errActionItemNotPending(ids []string) error {
	return CodedError{
		Code: "action_item_not_pending", Status: http.StatusConflict, Err: ErrConflict,
		Msg:    "có việc đã được giao hoặc đã bỏ qua",
		Fields: map[string]any{"action_item_ids": ids},
	}
}

// lockActionItems takes the meeting's summary lock (so a regenerated summary
// cannot replace the items under the command), then locks the named items.
// An id this meeting does not hold is 404 with every such id named.
func lockActionItems(ctx context.Context, q *db.Queries, m db.Meeting, ids []string) ([]db.LockMeetingActionItemsRow, error) {
	if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
		return nil, err
	}
	rows, err := q.LockMeetingActionItems(ctx, db.LockMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID, Ids: ids})
	if err != nil {
		return nil, err
	}
	if len(rows) == len(ids) {
		return rows, nil
	}
	found := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		found[r.MeetingActionItem.ID] = struct{}{}
	}
	var missing []string
	for _, id := range ids {
		if _, ok := found[id]; !ok {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	return nil, errActionItemNotFound(missing)
}

// AddActionItemInput is POST /meetings/{id}/action-items.
type AddActionItemInput struct {
	Title, OwnerText, DueText string
}

// AddActionItem records an item a clerk typed. It is never replaced by a
// regenerated summary.
func (s *MeetingService) AddActionItem(ctx context.Context, userID, meetingID string, in AddActionItemInput) (ActionItemView, error) {
	title := strings.TrimSpace(in.Title)
	owner, due := strings.TrimSpace(in.OwnerText), strings.TrimSpace(in.DueText)
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return ActionItemView{}, err
	}
	switch {
	case title == "":
		return ActionItemView{}, Invalid("cần tiêu đề việc")
	case utf8.RuneCountInString(title) > maxActionItemTitleRunes:
		return ActionItemView{}, Invalid("tiêu đề việc tối đa 500 ký tự")
	case utf8.RuneCountInString(owner) > maxActionItemTextRunes || utf8.RuneCountInString(due) > maxActionItemTextRunes:
		return ActionItemView{}, Invalid("người phụ trách và hạn tối đa 200 ký tự")
	}
	if m.Status != MeetingInProgress && m.Status != MeetingEnded {
		return ActionItemView{}, errInvalidState()
	}
	var row db.MeetingActionItem
	err = s.inTx(ctx, func(q *db.Queries) error {
		if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
			return err
		}
		position, err := q.NextMeetingActionItemPosition(ctx, db.NextMeetingActionItemPositionParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
		if err != nil {
			return err
		}
		actor := Human(userID)
		row, err = q.InsertMeetingActionItem(ctx, db.InsertMeetingActionItemParams{
			ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
			Source: ActionItemSourceManual, Position: position, Title: title, OwnerText: owner, DueText: due,
			Evidence: "[]", CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		})
		if err != nil {
			return err
		}
		return s.recordActionItem(ctx, q, m, actor, audit.ActionMeetingActionItemCreated, "action_item.created", row.ID, nil)
	})
	if err != nil {
		return ActionItemView{}, err
	}
	view, err := s.describeActionItems(ctx, m, []db.ListMeetingActionItemsRow{{MeetingActionItem: row}}, time.Now())
	if err != nil {
		return ActionItemView{}, err
	}
	return view.Items[0], nil
}

// DismissActionItem sets a pending item aside, with an optional reason.
func (s *MeetingService) DismissActionItem(ctx context.Context, userID, meetingID, itemID, reason string) error {
	reason = strings.TrimSpace(reason)
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	if utf8.RuneCountInString(reason) > maxDismissReasonRunes {
		return Invalid("lý do tối đa 500 ký tự")
	}
	return s.inTx(ctx, func(q *db.Queries) error {
		rows, err := lockActionItems(ctx, q, m, []string{itemID})
		if err != nil {
			return err
		}
		if actionItemStatus(rows[0].MeetingActionItem, rows[0].TaskLive) != ActionItemPending {
			return errActionItemNotPending([]string{itemID})
		}
		if err := q.DismissMeetingActionItem(ctx, db.DismissMeetingActionItemParams{
			OrganizationID: m.OrganizationID, ID: itemID, DismissedBy: strText(userID), DismissReason: reason,
		}); err != nil {
			return err
		}
		return s.recordActionItem(ctx, q, m, Human(userID), audit.ActionMeetingActionItemDismissed, "action_item.dismissed", itemID,
			map[string]audit.Change{"reason": {From: "", To: reason}})
	})
}

// RestoreActionItem brings a dismissed item back to pending.
func (s *MeetingService) RestoreActionItem(ctx context.Context, userID, meetingID, itemID string) error {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	return s.inTx(ctx, func(q *db.Queries) error {
		rows, err := lockActionItems(ctx, q, m, []string{itemID})
		if err != nil {
			return err
		}
		if actionItemStatus(rows[0].MeetingActionItem, rows[0].TaskLive) != ActionItemDismissed {
			return CodedError{Code: "action_item_not_dismissed", Status: http.StatusConflict, Err: ErrConflict, Msg: "việc này không ở trạng thái đã bỏ qua"}
		}
		if err := q.RestoreMeetingActionItem(ctx, db.RestoreMeetingActionItemParams{OrganizationID: m.OrganizationID, ID: itemID}); err != nil {
			return err
		}
		return s.recordActionItem(ctx, q, m, Human(userID), audit.ActionMeetingActionItemRestored, "action_item.restored", itemID, nil)
	})
}

// recordActionItem writes the audit row and the action_item.* event of a
// command on one item, in the command's transaction.
func (s *MeetingService) recordActionItem(ctx context.Context, q *db.Queries, m db.Meeting, actor Actor, action, topic, itemID string, changes map[string]audit.Change) error {
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, Actor: actor,
		Action: action, ResourceType: "meeting_action_item", ResourceID: itemID, Changes: changes,
		Metadata: map[string]any{"meeting_id": m.ID},
	}, audit.Event{Topic: topic, Payload: map[string]string{
		"meeting_id": m.ID, "action_item_id": itemID, "workspace_id": m.WorkspaceID,
	}})
}

func (s *MeetingService) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ConvertActionItem is one pending item a clerk turns into a task, with the
// values the clerk confirmed. The server never re-reads the owner or due
// phrase into these: nil is "nobody" / "no due date" (ADR 0010).
type ConvertActionItem struct {
	ActionItemID string
	// Title replaces the item's title when not blank.
	Title       string
	Description string
	AssigneeID  *string
	DueDate     *string
	// ProjectID nil takes the meeting's project; "" is no project.
	ProjectID *string
	Priority  string
}

// ActionItemLink pairs a converted item with its new task.
type ActionItemLink struct {
	ActionItemID string
	TaskID       string
}

// ConvertActionItems turns chosen pending items into tasks (spec §6.3). Every
// task, the items' task_id and the batch's audit row commit in one
// transaction, so a refusal anywhere leaves nothing behind. The meeting's
// summary lock keeps a regenerated summary from replacing the items under the
// batch, and the item row locks serialize two conversions of the same item.
func (s *MeetingService) ConvertActionItems(ctx context.Context, userID, meetingID string, items []ConvertActionItem) ([]ActionItemLink, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	if s.Tasks == nil {
		return nil, coded(http.StatusServiceUnavailable, "tasks_unavailable", "task service chưa sẵn sàng")
	}
	if len(items) == 0 {
		return nil, Invalid("cần ít nhất một việc")
	}
	if len(items) > maxActionItemsPerConvert {
		return nil, Invalid("tối đa 50 việc mỗi lần")
	}
	ids := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, it := range items {
		id := strings.TrimSpace(it.ActionItemID)
		if id == "" {
			return nil, Invalid("cần action_item_id cho mỗi việc")
		}
		if _, dup := seen[id]; dup {
			return nil, Invalid("mỗi việc chỉ được chọn một lần")
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	// Titles and phrases never change after insert, so this read outside the
	// transaction only shapes the inputs; whether each item still exists and
	// is still pending is decided under the locks in Before.
	rows, err := s.q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return nil, err
	}
	stored := make(map[string]db.MeetingActionItem, len(rows))
	for _, r := range rows {
		stored[r.MeetingActionItem.ID] = r.MeetingActionItem
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
			return nil, err
		}
	}

	// The description is written once, by the clerk: its labels speak their language.
	clerk, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	origin := meetingID
	inputs := make([]CreateTaskInput, 0, len(items))
	for i, it := range items {
		item := stored[ids[i]]
		title := strings.TrimSpace(it.Title)
		if title == "" {
			title = strings.TrimSpace(item.Title)
		}
		projectID := it.ProjectID
		if projectID == nil {
			projectID = meetingProject
		}
		inputs = append(inputs, CreateTaskInput{
			Title: title, Description: actionItemTaskDescription(it, item, clerk.Locale),
			AssigneeID: it.AssigneeID, DueDate: it.DueDate, ProjectID: projectID,
			Priority: strings.TrimSpace(it.Priority), OriginType: "meeting", OriginID: &origin,
		})
	}

	actor := Human(userID)
	tasks, err := s.Tasks.CreateManyWith(ctx, actor, m.WorkspaceID, inputs, CreateManyOptions{
		KeepOrder: true,
		Before: func(ctx context.Context, q *db.Queries, ws db.Workspace) error {
			locked, err := lockActionItems(ctx, q, m, ids)
			if err != nil {
				return err
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
			var handled []string
			for _, r := range locked {
				if actionItemStatus(r.MeetingActionItem, r.TaskLive) != ActionItemPending {
					handled = append(handled, r.MeetingActionItem.ID)
				}
			}
			if len(handled) > 0 {
				return errActionItemNotPending(handled)
			}
			return refuseActionItemDuplicates(ctx, q, ws, ids, inputs, projects)
		},
		After: func(ctx context.Context, q *db.Queries, ws db.Workspace, tasks []db.Task) error {
			taskIDs := make([]string, 0, len(tasks))
			for i, t := range tasks {
				if err := q.ConvertMeetingActionItem(ctx, db.ConvertMeetingActionItemParams{
					OrganizationID: ws.OrganizationID, ID: ids[i], TaskID: strText(t.ID), ConvertedBy: strText(actor.ID),
				}); err != nil {
					return err
				}
				taskIDs = append(taskIDs, t.ID)
			}
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, Actor: actor,
				Action:       audit.ActionMeetingActionItemsConverted,
				ResourceType: "meeting", ResourceID: meetingID,
				Metadata: map[string]any{"count": len(tasks), "action_item_ids": ids, "task_ids": taskIDs},
			}, audit.Event{Topic: "action_item.converted", Payload: map[string]string{
				"meeting_id": meetingID, "workspace_id": ws.ID,
			}}); err != nil {
				return err
			}
			payload, err := json.Marshal(map[string]any{"count": len(tasks)})
			if err != nil {
				return err
			}
			// The old timeline name, so rows written before UNI-1998 keep their label.
			return s.writeAudit(ctx, q, m, "TASKS_CREATED_FROM_SUMMARY", userID, "", "", string(payload))
		},
	})
	if err != nil {
		return nil, err
	}
	out := make([]ActionItemLink, 0, len(tasks))
	for i, t := range tasks {
		out = append(out, ActionItemLink{ActionItemID: ids[i], TaskID: t.ID})
	}
	return out, nil
}

// refuseActionItemDuplicates finds, before any insert, every item the
// active-duplicate guard of createTaskInTx would refuse: a title that matches
// an open task under the same project (these tasks have no parent), or that
// repeats an earlier item of the batch under the same project. One refusal
// names them all in fields.action_item_ids, so the clerk knows which items to
// leave out, instead of the batch rolling back on the first one with no item
// named. The open task of the first refused item that has one is named in the
// guard's own fields. The guard's key locks are taken here, in sorted order so
// two batches cannot deadlock on them, and held until commit, so the answer
// stays true while the batch inserts.
func refuseActionItemDuplicates(ctx context.Context, q *db.Queries, ws db.Workspace, ids []string, inputs []CreateTaskInput, projects []pgtype.Text) error {
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
	var refused []string
	var named *db.Task
	seen := make(map[string]struct{}, len(inputs))
	for i, in := range inputs {
		if keys[i] == "" {
			continue
		}
		if _, repeat := seen[keys[i]]; repeat {
			refused = append(refused, ids[i])
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
		refused = append(refused, ids[i])
		if named == nil {
			named = &dup
		}
	}
	if len(refused) == 0 {
		return nil
	}
	sort.Strings(refused)
	fields := map[string]any{}
	if named != nil {
		fields = activeDuplicateFields(ws, *named)
	}
	fields["action_item_ids"] = refused
	return CodedError{
		Code: "active_duplicate_task", Status: http.StatusConflict, Err: ErrConflict,
		Msg:    "có việc trùng tiêu đề với một task đang mở hoặc với việc khác trong lần tạo này",
		Fields: fields,
	}
}

// actionItemTaskDescription is the clerk's description, then what the item
// says that the task does not carry (an owner when it has no assignee, a due
// phrase when it has no due date). Phrases the AI wrote are marked as such.
// The meeting it came from is not written here: the task's origin carries it
// and the task screen shows it. The labels are in the converting clerk's
// locale (Vietnamese unless it is "en"); the phrases stay as the summary said them.
func actionItemTaskDescription(it ConvertActionItem, item db.MeetingActionItem, locale string) string {
	desc := strings.TrimSpace(it.Description)
	mark := " (AI)"
	if item.Source == ActionItemSourceManual {
		mark = ""
	}
	ownerLabel, dueLabel := "Người phụ trách", "Hạn"
	if locale == "en" {
		ownerLabel, dueLabel = "Owner", "Due"
	}
	var extra []string
	if owner := strings.TrimSpace(item.OwnerText); owner != "" && it.AssigneeID == nil {
		extra = append(extra, ownerLabel+mark+": "+owner)
	}
	if due := strings.TrimSpace(item.DueText); due != "" && it.DueDate == nil {
		extra = append(extra, dueLabel+mark+": "+due)
	}
	if len(extra) == 0 {
		return desc
	}
	block := strings.Join(extra, "\n")
	if desc == "" {
		return block
	}
	return desc + "\n" + block
}
