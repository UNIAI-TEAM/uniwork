package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// refused is a gate answer meaning "not a member now"; any other error is an
// outage the outbox must retry (UNI-1709).
func refused(err error) bool {
	return errors.Is(err, service.ErrForbidden) || errors.Is(err, service.ErrNotFound) ||
		errors.Is(err, service.ErrMemberDeactivated) || errors.Is(err, service.ErrOrganizationSuspended)
}

// MemberChecker is the one membership gate (CLAUDE.md § Database and
// Migration Rules); WorkspaceService satisfies it. A recipient who is no
// longer a member gets nothing.
type MemberChecker interface {
	RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error)
}

// OrgMemberChecker is the organization membership gate for organization-level
// notifications. OrganizationService satisfies it without this package
// importing internal/service.
type OrgMemberChecker interface {
	RequireMember(ctx context.Context, orgID, userID string) (db.OrganizationMember, error)
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

// MentionClaim names the durable mention row a draft may deliver at most
// once: the consumer claims it (ClaimDocumentCommentMention) inside the same
// transaction that writes the notification, and 0 rows updated drops the
// draft (contract-collab section 8.2).
type MentionClaim struct {
	MentionID string
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
	// Claim is set on mention drafts: the rule only reads mention rows, the
	// consumer's write() claims the row in the notification's own tx.
	Claim *MentionClaim
}

// env is what a rule may touch: read queries, the membership gate and the
// injected document-read resolver.
type env struct {
	q         *db.Queries
	members   MemberChecker
	orgs      OrgMemberChecker
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
	// The edit-time mentions and the resolve notification of the UNI-1337
	// table (contract-collab section 8.3, G8-05).
	"document.comment_updated":  ruleDocumentCommentUpdated,
	"document.comment_resolved": ruleDocumentCommentResolved,
	// The edit lock (UNI-1645): the holder, the requester and the previous
	// holder each get one notification, addressed by payload.user_id.
	"document.edit_requested":        ruleDocumentEditRequested,
	"document.edit_request_answered": ruleDocumentEditRequestAnswered,
	"document.lock_taken_over":       ruleDocumentEditTakenOver,
	// DOC-05 (UNI-1628): an admin opened emergency view access to a
	// restricted document; the owner must hear about it.
	"document.break_glass_granted": ruleDocumentBreakGlassGranted,
	// SH-S3 (UNI-1782): a direct user share that raised the recipient's
	// effective level on the document.
	"document.shared":        ruleDocumentShared,
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
		CorrelationID: ev.CorrelationID.String, Action: action, ResourceID: resourceID, Before: ev.CreatedAt,
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
	err   error
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
			if !refused(err) && r.err == nil {
				r.err = err
			}
			return
		}
	}
	r.seen[userID] = true
	r.order = append(r.order, userID)
}

func (r *recipients) drafts(orgID, kind, groupKey, resType, resID string, params map[string]string) ([]Draft, error) {
	if r.err != nil {
		return nil, r.err
	}
	out := make([]Draft, 0, len(r.order))
	for _, uid := range r.order {
		out = append(out, Draft{
			UserID: uid, OrganizationID: orgID, WorkspaceID: r.wsID,
			Kind: kind, GroupKey: groupKey, ResourceType: resType, ResourceID: resID,
			ActorKind: actorKindOf(r.ev), ActorID: r.ev.ActorID.String, Params: params,
		})
	}
	return out, nil
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
		ds, err := r.drafts(orgID, KindTaskAssigned, "task:"+task.ID+":assigned", "task", task.ID, params)
		if err != nil {
			return nil, err
		}
		out = append(out, ds...)
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
		ds, err := r.drafts(orgID, KindTaskStatusChanged, "task:"+task.ID+":status", "task", task.ID, sp)
		if err != nil {
			return nil, err
		}
		out = append(out, ds...)
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
		ds, err := r.drafts(orgID, KindMentioned, "task:"+task.ID+":mention:"+p["comment_id"], "task", task.ID, params)
		if err != nil {
			return nil, err
		}
		out = append(out, ds...)
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
	ds, err := r.drafts(orgID, KindTaskCommented, "task:"+task.ID+":commented", "task", task.ID, params)
	if err != nil {
		return nil, err
	}
	out = append(out, ds...)
	return out, nil
}

// isActorOfEvent reports whether uid is the human actor of the event; a rule
// never notifies somebody about their own action.
func isActorOfEvent(ev outbox.Row, uid string) bool {
	return ev.ActorKind.String == string(audit.KindHuman) && ev.ActorID.String == uid
}

// documentCommentContext loads the document and comment an event names, and
// proves the pair belongs to the event's own tenant. ok=false means "nothing
// to do": the document or comment is gone, or the row is not the event's.
func documentCommentContext(ctx context.Context, e env, ev outbox.Row, p map[string]string) (db.Document, db.DocumentComment, bool, error) {
	if p["document_id"] == "" || p["comment_id"] == "" {
		return db.Document{}, db.DocumentComment{}, false, nil
	}
	doc, err := e.q.GetDocumentByID(ctx, p["document_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, db.DocumentComment{}, false, nil
	}
	if err != nil {
		return db.Document{}, db.DocumentComment{}, false, err
	}
	// The id came from the event payload: only trust a document that lives
	// in the event's own tenant pair.
	if (ev.OrganizationID.Valid && doc.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && doc.WorkspaceID != ev.WorkspaceID.String) {
		return db.Document{}, db.DocumentComment{}, false, nil
	}
	comment, err := e.q.GetDocumentComment(ctx, db.GetDocumentCommentParams{
		ID: p["comment_id"], OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return doc, db.DocumentComment{}, false, nil // deleted between the event and this delivery
	}
	if err != nil {
		return db.Document{}, db.DocumentComment{}, false, err
	}
	return doc, comment, true, nil
}

// ruleDocumentCommentAdded drafts the create-time recipients of the UNI-1337
// table (contract-collab section 8.3): the people whose mention row nobody
// claimed yet, and - for a reply - the parent's author when no mention
// already speaks for them. A new comment or thread without a mention notifies
// nobody; document_commented is no longer emitted, its kind survives for rows
// written before this change.
func ruleDocumentCommentAdded(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	return documentCommentMentionRule(ctx, e, ev, p, true)
}

// ruleDocumentCommentUpdated drafts the edit-time mentions only (UNI-1336
// "mentions on edit"): an edit can add or drop mention tokens, but it never
// re-announces a reply, so the reply arm stays out.
func ruleDocumentCommentUpdated(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	return documentCommentMentionRule(ctx, e, ev, p, false)
}

// documentCommentMentionRule is the create/edit body: it reads the comment's
// unclaimed active mention rows (the rules never write; the claim happens in
// the consumer's transaction, section 8.2) and re-checks read access at
// delivery time, so a share revoked between the comment and this run yields
// no draft and no claim.
func documentCommentMentionRule(ctx context.Context, e env, ev outbox.Row, p map[string]string, withReply bool) ([]Draft, error) {
	if e.docs == nil {
		// No document permission port wired: silent beats leaking a snippet
		// to someone who cannot read the document.
		return nil, nil
	}
	doc, comment, ok, err := documentCommentContext(ctx, e, ev, p)
	if err != nil || !ok {
		return nil, err
	}
	if comment.DeletedAt.Valid {
		return nil, nil
	}
	rows, err := e.q.ListClaimableDocumentCommentMentions(ctx, db.ListClaimableDocumentCommentMentionsParams{
		CommentID: comment.ID, DocumentID: doc.ID,
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	var parent db.DocumentComment
	hasParent := false
	if withReply && comment.ParentCommentID.Valid {
		parent, err = e.q.GetDocumentComment(ctx, db.GetDocumentCommentParams{
			ID: comment.ParentCommentID.String, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// The parent was hard-deleted between the reply and this run.
		case err != nil:
			return nil, err
		default:
			hasParent = true
		}
	}
	// One read gate for everyone the drafts depend on: the mention rows and
	// the parent's author.
	candidates := make([]string, 0, len(rows)+1)
	for _, r := range rows {
		candidates = append(candidates, r.UserID)
	}
	if hasParent && parent.AuthorKind == string(audit.KindHuman) {
		candidates = append(candidates, parent.AuthorID)
	}
	readable := map[string]bool{}
	if len(candidates) > 0 {
		readers, err := e.docs.FilterDocumentReaders(ctx, doc.ID, candidates)
		if err != nil {
			return nil, err
		}
		for _, id := range readers {
			readable[id] = true
		}
	}
	params := map[string]string{
		"actor": actorName(ctx, e.q, ev), "document": doc.Title,
		"snippet": snippet(comment.Body), "comment_id": comment.ID, "kind": comment.CommentType,
	}
	kind := KindDocumentMentioned
	if comment.CommentType == "discussion" {
		kind = KindDocumentDiscussionMentioned
	}
	var out []Draft
	touched := map[string]bool{}
	for _, r := range rows {
		// A row's creator is the author of its token: a self-mention never
		// notifies the person who wrote it, whichever actor triggers this
		// event - a later edit by another member that keeps the token must
		// not resurrect it.
		if !readable[r.UserID] || isActorOfEvent(ev, r.UserID) || r.CreatedBy == r.UserID {
			continue
		}
		touched[r.UserID] = true
		out = append(out, Draft{
			UserID: r.UserID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Kind: kind, GroupKey: "document:" + doc.ID + ":mention:" + comment.ID,
			ResourceType: "document", ResourceID: doc.ID,
			ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String, Params: params,
			Claim: &MentionClaim{MentionID: r.ID},
		})
	}
	if hasParent && parent.AuthorKind == string(audit.KindHuman) {
		uid := parent.AuthorID
		if touched[uid] || isActorOfEvent(ev, uid) || !readable[uid] {
			return out, nil
		}
		replyKind := KindDocumentCommentReplied
		if comment.CommentType == "discussion" {
			replyKind = KindDocumentDiscussionReplied
		}
		out = append(out, Draft{
			UserID: uid, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Kind: replyKind, GroupKey: "document:" + doc.ID + ":replied:" + comment.ID,
			ResourceType: "document", ResourceID: doc.ID,
			ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String, Params: params,
		})
	}
	return out, nil
}

// ruleDocumentCommentResolved tells the author of a resolved Comment (the
// provisional OQ-C7 reading of the UNI-1337 table): only kind=comment
// resolves notify, a Discussion stays silent.
func ruleDocumentCommentResolved(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if e.docs == nil {
		return nil, nil
	}
	doc, comment, ok, err := documentCommentContext(ctx, e, ev, p)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	if comment.DeletedAt.Valid || !comment.ResolvedAt.Valid || comment.CommentType != "comment" {
		return nil, nil
	}
	uid := comment.AuthorID
	if comment.AuthorKind != string(audit.KindHuman) || isActorOfEvent(ev, uid) {
		return nil, nil
	}
	readers, err := e.docs.FilterDocumentReaders(ctx, doc.ID, []string{uid})
	if err != nil {
		return nil, err
	}
	if len(readers) == 0 {
		return nil, nil
	}
	return []Draft{{
		UserID: uid, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		Kind: KindDocumentCommentResolved, GroupKey: "document:" + doc.ID + ":resolved:" + comment.ID,
		ResourceType: "document", ResourceID: doc.ID,
		ActorKind: actorKindOf(ev), ActorID: ev.ActorID.String,
		Params: map[string]string{
			"actor": actorName(ctx, e.q, ev), "document": doc.Title,
			"snippet": snippet(comment.Body), "comment_id": comment.ID, "kind": comment.CommentType,
		},
	}}, nil
}

// ruleDocumentBreakGlassGranted tells the document's ACL owner that an admin
// opened emergency view access to it; with no ACL owner who is still in the
// workspace, the workspace owners (never the admin who opened it) hear
// instead. The params carry ids plus the two names the title renders, never
// the reason.
func ruleDocumentBreakGlassGranted(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if p["document_id"] == "" || p["grant_id"] == "" {
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
	r := newRecipients(ctx, e, ev, doc.WorkspaceID)
	if doc.AclOwnerID.Valid && !doc.OwnerKind.Valid {
		r.add(doc.AclOwnerID.String)
	}
	if len(r.order) == 0 {
		members, err := e.q.ListWorkspaceMembers(ctx, doc.WorkspaceID)
		if err != nil {
			return nil, err
		}
		for _, m := range members {
			if m.Role == "owner" {
				r.add(m.UserID)
			}
		}
	}
	params := map[string]string{
		"actor": actorName(ctx, e.q, ev), "document": doc.Title,
		"document_id": doc.ID, "grant_id": p["grant_id"],
	}
	return r.drafts(doc.OrganizationID, KindDocumentBreakGlass, "document:"+doc.ID+":break_glass:"+p["grant_id"], "document", doc.ID, params)
}

// ruleDocumentShared notifies a person when a direct user share raised their
// effective level on the document (SH-S3, UNI-1782; addendum §8, §10 Q-S2).
// The mutation transaction stamps notify_user_id on the event only when that
// rise holds; this rule re-checks CanReadDocument at delivery time so a grant
// revoked before the consumer runs sends nothing.
func ruleDocumentShared(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	uid := p["notify_user_id"]
	if e.docs == nil || p["document_id"] == "" || p["share_id"] == "" || uid == "" {
		return nil, nil
	}
	if isActorOfEvent(ev, uid) {
		return nil, nil
	}
	doc, err := e.q.GetDocumentByID(ctx, p["document_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if (ev.OrganizationID.Valid && doc.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && doc.WorkspaceID != ev.WorkspaceID.String) {
		return nil, nil
	}
	canRead, err := e.docs.CanReadDocument(ctx, uid, doc.ID)
	if err != nil || !canRead {
		return nil, err
	}
	var level string
	sh, err := e.q.GetLiveDocumentShareByID(ctx, db.GetLiveDocumentShareByIDParams{
		ID: p["share_id"], OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	switch {
	case err == nil:
		if sh.PrincipalType != "user" || sh.PrincipalID != uid {
			return nil, nil
		}
		level = sh.Level
	case errors.Is(err, pgx.ErrNoRows):
		changes, err := changedFields(ctx, e.q, ev, audit.ActionDocumentShared, doc.ID)
		if err != nil {
			return nil, err
		}
		level, _ = changeTo(changes, "level")
		if level == "" {
			return nil, nil
		}
	default:
		return nil, err
	}
	return []Draft{{
		UserID:         uid,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Kind:           KindDocumentShared,
		GroupKey:       "document:" + doc.ID + ":shared",
		ResourceType:   "document",
		ResourceID:     doc.ID,
		ActorKind:      actorKindOf(ev),
		ActorID:        ev.ActorID.String,
		Params: map[string]string{
			"actor":       actorName(ctx, e.q, ev),
			"document":    doc.Title,
			"document_id": doc.ID,
			"level":       level,
		},
	}}, nil
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
	return r.drafts(orgID, KindMeetingInvited, "meeting:"+m.ID+":invited", "meeting", m.ID, params)
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
	return r.drafts(ws.OrganizationID, KindMemberAdded, "workspace:"+wsID+":added", "workspace", wsID, params)
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
	return r.drafts(ws.OrganizationID, KindRoleChanged, "workspace:"+wsID+":role", "workspace", wsID, params)
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
	// A mailbox row and its queued event can outlive the recipient's access.
	// Re-check current organization membership before reading unread state or
	// producing any in-app/push delivery.
	if e.orgs == nil {
		return nil, nil
	}
	if _, err := e.orgs.RequireMember(ctx, acc.OrganizationID, acc.UserID); err != nil {
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
	if wsID != "" {
		if e.members == nil {
			return nil, nil
		}
		if _, err := e.members.RequireMember(ctx, wsID, acc.UserID); err != nil {
			return nil, nil
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
	room, err := e.q.GetChatRoomByID(ctx, msg.RoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if room.ArchivedAt.Valid {
		return nil, nil // archived after the worker emitted: the room is closed
	}
	members, err := e.q.ListChatRoomMemberUserIDs(ctx, msg.RoomID)
	if err != nil {
		return nil, err
	}
	var out []Draft
	for _, uid := range members {
		wsID, err := chatRecipientWorkspace(ctx, e, room, uid)
		if err != nil {
			return nil, err
		}
		if wsID == "" {
			continue
		}
		r := newRecipients(ctx, e, ev, wsID)
		r.add(uid)
		ds, err := r.drafts(msg.OrganizationID, KindChatReminder, "chat_reminder:"+msg.ID,
			"chat_message", msg.ID, map[string]string{"body": snippet(msg.Body)})
		if err != nil {
			return nil, err
		}
		out = append(out, ds...)
	}
	return out, nil
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
		if refused(err) {
			return nil, nil
		}
		return nil, err
	}
	return []Draft{{
		UserID: m.HostUserID, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Kind: KindMeetingSummaryReminder, GroupKey: "meeting:" + m.ID + ":summary_reminder",
		ResourceType: "meeting", ResourceID: m.ID,
		ActorKind: string(audit.KindSystem), ActorID: "meeting_summary_reminder",
		Params: map[string]string{"meeting": m.Title},
	}}, nil
}
