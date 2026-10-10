package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/mentions"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// MemberChecker is the one membership gate (CLAUDE.md § Database and
// Migration Rules); WorkspaceService satisfies it. A recipient who is no
// longer a member gets nothing.
type MemberChecker interface {
	RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error)
}

// DocumentReadChecker is the document permission port the document comment
// rules filter recipients through: a person is only notified while they can
// read the document right now. DocumentService implements it; it is
// injected through SetDocumentReaders so this package never imports
// internal/service (arch test).
type DocumentReadChecker interface {
	CanReadDocument(ctx context.Context, userID, documentID string) (bool, error)
	FilterDocumentReaders(ctx context.Context, documentID string, userIDs []string) ([]string, error)
}

// SummaryChecker says whether AI meeting summaries are open to an
// organization (plan and model). MeetingService implements it; it is
// injected through SetMeetingSummaries so the rule never guesses (C-11 §9.1 V1).
type SummaryChecker interface {
	SummaryAvailable(ctx context.Context, orgID string) bool
}

// Draft is a notification a rule wants to create for one user. The consumer
// applies preferences, merging and idempotency on top.
type Draft struct {
	UserID         string
	OrganizationID string
	WorkspaceID    string // "" for organization-level kinds
	Kind           string
	GroupKey       string
	ResourceType   string
	ResourceID     string
	ActorKind      string
	ActorID        string
	Params         map[string]string
}

// env is what a rule may touch: read queries, the membership gate and the
// injected document-read resolver.
type env struct {
	q         *db.Queries
	members   MemberChecker
	docs      DocumentReadChecker
	summaries SummaryChecker
}

// rule turns one outbox row into drafts. Rules are pure apart from reads; the
// actor is excluded here so "you did this yourself" never reaches an inbox.
type rule func(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error)

var rules = map[string]rule{
	"task.updated":           ruleTaskUpdated,
	"task.comment_added":     ruleTaskCommentAdded,
	"document.comment_added": ruleDocumentCommentAdded,
	"participant.invited":    ruleParticipantInvited,
	"member.joined":          ruleMemberJoined,
	"member.role_changed":    ruleRoleChanged,
	"audit.exported":         ruleAuditExported,
	"chat.follow_up.created": ruleChatFollowUpCreated,
	"chat.reminder.due":      ruleChatReminderDue,
	"email_hub.new_mail":     ruleEmailHubNewMail,
	"meeting.ended":          ruleMeetingEnded,

	"chat.message.mentioned":     chatMessageRule(KindChatMentioned),
	"chat.dm.received":           chatMessageRule(KindChatDM),
	"chat.thread.reply_received": chatMessageRule(KindChatThreadReplied),
}

// snippetRunes bounds what of a comment body lands in params: enough to
// recognise it, not the whole text (spec §7).
const snippetRunes = 140

func snippet(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= snippetRunes {
		return s
	}
	r := []rune(s)
	return string(r[:snippetRunes]) + "…"
}

// actorName is the display name snapshot stored in params. Unknown ids
// render as the product's own name rather than an empty string.
func actorName(ctx context.Context, q *db.Queries, ev outbox.Row) string {
	switch audit.Kind(ev.ActorKind.String) {
	case audit.KindHuman:
		if u, err := q.GetUserByID(ctx, ev.ActorID.String); err == nil {
			return u.DisplayName
		}
	case audit.KindAgent:
		if a, err := q.GetAgent(ctx, ev.ActorID.String); err == nil {
			return a.Name
		}
	}
	return "UniWork"
}

// changedFields reads the audit row written in the same transaction as ev and
// returns the fields that moved with their new values. This is how the
// consumer learns "assignee changed" without Tasks knowing about
// notifications (OPEN_QUESTIONS N1).
func changedFields(ctx context.Context, q *db.Queries, ev outbox.Row, action, resourceID string) (map[string]audit.Change, error) {
	if !ev.CorrelationID.Valid {
		return nil, nil
	}
	row, err := q.GetAuditEventByCorrelation(ctx, db.GetAuditEventByCorrelationParams{
		CorrelationID: ev.CorrelationID.String, Action: action, ResourceID: resourceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var changes map[string]audit.Change
	if err := json.Unmarshal([]byte(row.Changes), &changes); err != nil {
		return nil, fmt.Errorf("notification: audit changes of %s: %w", row.ID, err)
	}
	return changes, nil
}

func changeTo(c map[string]audit.Change, field string) (string, bool) {
	ch, ok := c[field]
	if !ok {
		return "", false
	}
	s, _ := ch.To.(string)
	return s, true
}

// recipients collects distinct human user ids, skipping the actor and anyone
// who is not (or no longer) a member of the workspace.
type recipients struct {
	ctx   context.Context
	e     env
	ev    outbox.Row
	wsID  string
	seen  map[string]bool
	order []string
}

func newRecipients(ctx context.Context, e env, ev outbox.Row, wsID string) *recipients {
	return &recipients{ctx: ctx, e: e, ev: ev, wsID: wsID, seen: map[string]bool{}}
}

func (r *recipients) add(userID string) {
	if userID == "" || r.seen[userID] {
		return
	}
	if r.ev.ActorKind.String == string(audit.KindHuman) && r.ev.ActorID.String == userID {
		return
	}
	if r.wsID != "" {
		if _, err := r.e.members.RequireMember(r.ctx, r.wsID, userID); err != nil {
			return
		}
	}
	r.seen[userID] = true
	r.order = append(r.order, userID)
}

func (r *recipients) drafts(orgID, kind, groupKey, resType, resID string, params map[string]string) []Draft {
	out := make([]Draft, 0, len(r.order))
	for _, uid := range r.order {
		out = append(out, Draft{
			UserID: uid, OrganizationID: orgID, WorkspaceID: r.wsID,
			Kind: kind, GroupKey: groupKey, ResourceType: resType, ResourceID: resID,
			ActorKind: actorKindOf(r.ev), ActorID: r.ev.ActorID.String, Params: params,
		})
	}
	return out
}

// actorKindOf defaults to system for rows written before actor_kind existed.
func actorKindOf(ev outbox.Row) string {
	if ev.ActorKind.Valid && ev.ActorKind.String != "" {
		return ev.ActorKind.String
	}
	return string(audit.KindSystem)
}

func orgOf(ctx context.Context, q *db.Queries, ev outbox.Row, wsID string) (string, error) {
	if ev.OrganizationID.Valid && ev.OrganizationID.String != "" {
		return ev.OrganizationID.String, nil
	}
	ws, err := q.GetWorkspaceByID(ctx, wsID)
	if err != nil {
		return "", err
	}
	return ws.OrganizationID, nil
}

func ruleTaskUpdated(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	task, err := e.q.GetTask(ctx, p["task_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	changes, err := changedFields(ctx, e.q, ev, audit.ActionTaskUpdated, task.ID)
	if err != nil || len(changes) == 0 {
		return nil, err
	}
	orgID, err := orgOf(ctx, e.q, ev, task.WorkspaceID)
	if err != nil {
		return nil, err
	}
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "task": task.Title}
	var out []Draft
	if _, ok := changes["assignee_id"]; ok && task.AssigneeID.Valid && task.AssigneeKind == string(audit.KindHuman) {
		r := newRecipients(ctx, e, ev, task.WorkspaceID)
		r.add(task.AssigneeID.String)
		out = append(out, r.drafts(orgID, KindTaskAssigned, "task:"+task.ID+":assigned", "task", task.ID, params)...)
	}
	if status, ok := changeTo(changes, "status"); ok {
		sp := map[string]string{"actor": params["actor"], "task": task.Title, "status": status}
		r := newRecipients(ctx, e, ev, task.WorkspaceID)
		if task.AssigneeKind == string(audit.KindHuman) {
			r.add(task.AssigneeID.String)
		}
		if task.CreatedByKind == string(audit.KindHuman) {
			r.add(task.CreatedBy)
		}
		out = append(out, r.drafts(orgID, KindTaskStatusChanged, "task:"+task.ID+":status", "task", task.ID, sp)...)
	}
	return out, nil
}

// mentionedIn finds workspace members named as @Display Name in body. There
// is no user handle yet, so the display name is the only thing a person can
// type. ponytail: linear scan over members; switch to @handle when Settings
// grows one.
func mentionedIn(body string, members []db.ListWorkspaceMembersRow) []string {
	lower := strings.ToLower(body)
	var out []string
	for _, m := range members {
		name := strings.ToLower(strings.TrimSpace(m.DisplayName))
		if name != "" && strings.Contains(lower, "@"+name) {
			out = append(out, m.UserID)
		}
	}
	return out
}

func ruleTaskCommentAdded(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	task, err := e.q.GetTask(ctx, p["task_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	orgID, err := orgOf(ctx, e.q, ev, task.WorkspaceID)
	if err != nil {
		return nil, err
	}
	comments, err := e.q.ListTaskComments(ctx, db.ListTaskCommentsParams{
		TaskID: task.ID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	body := ""
	for _, c := range comments {
		if c.ID == p["comment_id"] {
			body = c.Body
		}
	}
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "task": task.Title, "snippet": snippet(body)}

	var out []Draft
	mentioned := map[string]bool{}
	if body != "" {
		members, err := e.q.ListWorkspaceMembers(ctx, task.WorkspaceID)
		if err != nil {
			return nil, err
		}
		r := newRecipients(ctx, e, ev, task.WorkspaceID)
		for _, uid := range mentionedIn(body, members) {
			r.add(uid)
		}
		for _, uid := range r.order {
			mentioned[uid] = true
		}
		out = append(out, r.drafts(orgID, KindMentioned, "task:"+task.ID+":mention:"+p["comment_id"], "task", task.ID, params)...)
	}

	r := newRecipients(ctx, e, ev, task.WorkspaceID)
	for uid := range mentioned {
		r.seen[uid] = true // a mention already says it; no second row
	}
	if task.AssigneeKind == string(audit.KindHuman) {
		r.add(task.AssigneeID.String)
	}
	if task.CreatedByKind == string(audit.KindHuman) {
		r.add(task.CreatedBy)
	}
	for _, c := range comments {
		if c.AuthorKind == string(audit.KindHuman) {
			r.add(c.AuthorID)
		}
	}
	out = append(out, r.drafts(orgID, KindTaskCommented, "task:"+task.ID+":commented", "task", task.ID, params)...)
	return out, nil
}

// sortedKeys keeps the candidate scan (and so the draft order) deterministic.
func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if k != "" {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// ruleDocumentCommentAdded turns a document comment into mention and
// commented notifications. Every candidate - the mentioned ids, the ACL
// owner, every earlier human commenter - goes through the injected
// FilterDocumentReaders at delivery time, so a share revoked between the
// comment and this run yields no row and no stored snippet; a direct-share
// recipient in another workspace still gets it while the share holds, which
// is why this rule does not gate on workspace membership.
func ruleDocumentCommentAdded(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if e.docs == nil {
		// No document permission port wired: silent beats leaking a snippet
		// to someone who cannot read the document.
		return nil, nil
	}
	doc, err := e.q.GetDocumentByID(ctx, p["document_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// The id came from the event payload: only trust a document that lives
	// in the event's own tenant pair.
	if (ev.OrganizationID.Valid && doc.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && doc.WorkspaceID != ev.WorkspaceID.String) {
		return nil, nil
	}
	comment, err := e.q.GetDocumentComment(ctx, db.GetDocumentCommentParams{
		ID: p["comment_id"], OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // deleted between the event and this delivery
	}
	if err != nil {
		return nil, err
	}
	comments, err := e.q.ListDocumentComments(ctx, db.ListDocumentCommentsParams{
		DocumentID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}

	mentioned := mentions.MemberIDs(comment.Body)
	mentionedSet := map[string]bool{}
	candidates := map[string]bool{}
	for _, uid := range mentioned {
		mentionedSet[uid] = true
		candidates[uid] = true
	}
	for _, c := range comments {
		if c.AuthorKind == string(audit.KindHuman) {
			candidates[c.AuthorID] = true
		}
	}
	if doc.AclOwnerID.Valid {
		candidates[doc.AclOwnerID.String] = true
	}
	readers, err := e.docs.FilterDocumentReaders(ctx, doc.ID, sortedKeys(candidates))
	if err != nil {
		return nil, err
	}
	readable := map[string]bool{}
	for _, uid := range readers {
		readable[uid] = true
	}
	isActor := func(uid string) bool {
		return ev.ActorKind.String == string(audit.KindHuman) && ev.ActorID.String == uid
	}
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "document": doc.Title, "snippet": snippet(comment.Body)}

	var out []Draft
	for _, uid := range mentioned {
		if !readable[uid] || isActor(uid) {
			continue
		}
		out = append(out, Draft{
			UserID: uid, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Kind: KindDocumentMentioned, GroupKey: "document:" + doc.ID + ":mention:" + comment.ID,
			ResourceType: "document", ResourceID: doc.ID,
			ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String, Params: params,
		})
	}
	for _, uid := range sortedKeys(candidates) {
		if mentionedSet[uid] || !readable[uid] || isActor(uid) {
			continue
		}
		out = append(out, Draft{
			UserID: uid, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Kind: KindDocumentCommented, GroupKey: "document:" + doc.ID + ":commented",
			ResourceType: "document", ResourceID: doc.ID,
			ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String, Params: params,
		})
	}
	return out, nil
}

func ruleParticipantInvited(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	part, err := e.q.GetMeetingParticipant(ctx, p["participant_id"])
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !part.UserID.Valid) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m, err := e.q.GetMeeting(ctx, part.MeetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	orgID, err := orgOf(ctx, e.q, ev, m.WorkspaceID)
	if err != nil {
		return nil, err
	}
	r := newRecipients(ctx, e, ev, m.WorkspaceID)
	r.add(part.UserID.String)
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "meeting": m.Title}
	return r.drafts(orgID, KindMeetingInvited, "meeting:"+m.ID+":invited", "meeting", m.ID, params), nil
}

func ruleMemberJoined(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	wsID := p["workspace_id"]
	if wsID == "" {
		return nil, nil // organization membership has no screen to open yet
	}
	ws, err := e.q.GetWorkspaceByID(ctx, wsID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r := newRecipients(ctx, e, ev, wsID)
	r.add(p["user_id"])
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "workspace": ws.Name}
	return r.drafts(ws.OrganizationID, KindMemberAdded, "workspace:"+wsID+":added", "workspace", wsID, params), nil
}

func ruleRoleChanged(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	wsID := p["workspace_id"]
	if wsID == "" {
		return nil, nil
	}
	ws, err := e.q.GetWorkspaceByID(ctx, wsID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	changes, err := changedFields(ctx, e.q, ev, audit.ActionWorkspaceMemberRoleChanged, p["user_id"])
	if err != nil {
		return nil, err
	}
	role, _ := changeTo(changes, "role")
	r := newRecipients(ctx, e, ev, wsID)
	r.add(p["user_id"])
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "workspace": ws.Name, "role": role}
	return r.drafts(ws.OrganizationID, KindRoleChanged, "workspace:"+wsID+":role", "workspace", wsID, params), nil
}

func ruleAuditExported(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if p["user_id"] == "" || p["export_id"] == "" {
		return nil, nil
	}
	// The requester is also the actor of the export; the "skip the actor"
	// rule does not apply because finishing is the news they asked for.
	return []Draft{{
		UserID: p["user_id"], OrganizationID: p["organization_id"],
		Kind: KindAuditExportReady, GroupKey: "export:" + p["export_id"],
		ResourceType: "audit_export", ResourceID: p["export_id"],
		ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String, Params: map[string]string{},
	}}, nil
}

func ruleEmailHubNewMail(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if p["user_id"] == "" || p["account_id"] == "" {
		return nil, nil
	}
	acc, err := e.q.GetEmailHubAccountByID(ctx, p["account_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if acc.UserID != p["user_id"] {
		return nil, nil
	}
	counts, err := e.q.CountEmailHubThreads(ctx, db.CountEmailHubThreadsParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: "INBOX", LabelFilter: "",
	})
	if err != nil {
		return nil, err
	}
	if counts.Unread == 0 {
		return nil, nil
	}
	wsID := p["workspace_id"]
	if wsID == "" {
		if wsID, err = userWorkspaceIn(ctx, e.q, p["user_id"], acc.OrganizationID); err != nil {
			return nil, err
		}
	}
	params := map[string]string{
		"mailbox": acc.EmailAddress,
		"count":   fmt.Sprintf("%d", counts.Unread),
	}
	return []Draft{{
		UserID: p["user_id"], OrganizationID: acc.OrganizationID, WorkspaceID: wsID,
		Kind: KindEmailHubNewMail, GroupKey: "email_hub:" + acc.ID + ":mail",
		ResourceType: "email_account", ResourceID: acc.ID,
		ActorKind: string(audit.KindSystem), ActorID: "", Params: params,
	}}, nil
}

func ruleChatFollowUpCreated(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if p["user_id"] == "" || p["follow_up_id"] == "" || p["workspace_id"] == "" || p["message_id"] == "" {
		return nil, nil
	}
	ws, err := e.q.GetWorkspaceByID(ctx, p["workspace_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Personal reminder: the creator is the recipient even when they are the actor.
	return []Draft{{
		UserID: p["user_id"], OrganizationID: ws.OrganizationID, WorkspaceID: p["workspace_id"],
		Kind: KindChatFollowUp, GroupKey: "chat_follow_up:" + p["follow_up_id"],
		ResourceType: "chat_message", ResourceID: p["message_id"],
		ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String, Params: map[string]string{},
	}}, nil
}

// ruleChatReminderDue tells every member of the room a reminder posted there
// is due (H16): the reminder worker emits the event per occurrence, so a
// repeat lands as a new delivery merged into the same unread row.
func ruleChatReminderDue(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	msg, err := e.q.GetChatMessageByID(ctx, p["message_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if msg.DeletedAt.Valid {
		return nil, nil
	}
	members, err := e.q.ListChatRoomMemberUserIDs(ctx, msg.RoomID)
	if err != nil {
		return nil, err
	}
	r := newRecipients(ctx, e, ev, msg.WorkspaceID)
	for _, uid := range members {
		r.add(uid)
	}
	return r.drafts(msg.OrganizationID, KindChatReminder, "chat_reminder:"+msg.ID,
		"chat_message", msg.ID, map[string]string{"body": snippet(msg.Body)}), nil
}

// ruleMeetingEnded nudges the host to summarize a meeting that has something
// to summarize and no summary yet (C-11 §9.1 V1). It never calls a model.
// Personal reminder: the host is the recipient even when they ended the
// meeting themselves, so the draft is built here rather than through
// recipients.add, which drops the actor.
func ruleMeetingEnded(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if e.summaries == nil {
		return nil, nil
	}
	m, err := e.q.GetMeeting(ctx, p["meeting_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// GetMeeting is by-id: the row must belong to the event's tenant.
	if (ev.OrganizationID.Valid && m.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && m.WorkspaceID != ev.WorkspaceID.String) {
		return nil, nil
	}
	if m.Status != "ENDED" || m.HostUserID == "" {
		return nil, nil
	}
	if !e.summaries.SummaryAvailable(ctx, m.OrganizationID) {
		return nil, nil
	}
	if _, err := e.q.GetLatestMeetingSummary(ctx, m.ID); err == nil {
		return nil, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	has, err := e.q.HasMeetingSummarySource(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, nil
	}
	if _, err := e.members.RequireMember(ctx, m.WorkspaceID, m.HostUserID); err != nil {
		return nil, nil
	}
	return []Draft{{
		UserID: m.HostUserID, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Kind: KindMeetingSummaryReminder, GroupKey: "meeting:" + m.ID + ":summary_reminder",
		ResourceType: "meeting", ResourceID: m.ID,
		ActorKind: string(audit.KindSystem), ActorID: "meeting_summary_reminder",
		Params: map[string]string{"meeting": m.Title},
	}}, nil
}
