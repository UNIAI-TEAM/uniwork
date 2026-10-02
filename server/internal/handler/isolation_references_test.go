package handler

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// isoReference is one write on B's own route whose body names a row of
// another tenant. The path is always filled with B's ids; the body is built
// twice from the same template — once naming B's own rows (the control: the
// request is well-formed and B may make it) and once naming A's rows (the
// attack: refused, nothing of A's in the answer, no B row left pointing at A).
type isoReference struct {
	method, pattern, what string
	query                 string
	// body is a JSON template: isoRef("key") is the referenced tenant's row,
	// isoOwn("key") is always B's.
	body any
	// allow2xx marks a filter or a batch: answering is fine as long as it
	// shows and changes nothing of A's.
	allow2xx bool
	// noControl says why the own-ids request is not sent (it is
	// destructive, or there is no own counterpart).
	noControl string
	// idempotent adds an Idempotency-Key header.
	idempotent bool
	// covers names the request DTO fields the case attacks
	// ("CreateTaskSDI.project_id"); TestEveryBodyIDFieldHasAReferenceCase
	// requires every id field of every SDI to be covered or exempted.
	covers []string
	// mustNotContain lists strings the attack's answer may not hold even
	// when it is 2xx (a URL, a ticket).
	mustNotContain []string
}

type isoRef string       // the referenced tenant's row
type isoOwn string       // always the caller's own row
type isoUnique string    // a title unique to the case and the referenced tenant
type isoAt time.Duration // a timestamp this far from now, RFC3339

// isoResolve fills a template: ref is the tenant whose rows isoRef names;
// salt keeps isoUnique titles apart across cases.
func isoResolve(v any, own, ref *isoTenant, salt string) any {
	switch x := v.(type) {
	case isoRef:
		return ref.ids[string(x)]
	case isoOwn:
		return own.ids[string(x)]
	case isoAt:
		return time.Now().Add(time.Duration(x)).UTC().Truncate(time.Minute).Format(time.RFC3339)
	case isoUnique:
		return string(x) + " " + isoHash(salt+string(x)+ref.tag)
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[k] = isoResolve(e, own, ref, salt)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = isoResolve(e, own, ref, salt)
		}
		return out
	}
	return v
}

func (c isoReference) build(w *isoWorld, own, ref *isoTenant) isoBody {
	if c.body == nil {
		return isoBody{}
	}
	b := isoBody{json: isoResolve(c.body, own, ref, c.method+c.pattern+c.what)}
	if c.idempotent {
		key, _ := json.Marshal(b.json)
		b.headers = map[string]string{"Idempotency-Key": "iso-ref-" + ref.tag + "-" + isoHash(c.method+c.pattern+string(key))}
	}
	return b
}

func isoHash(s string) string {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h = (h ^ uint32(s[i])) * 16777619
	}
	return string(rune('a'+h%26)) + string(rune('a'+(h/26)%26)) + string(rune('a'+(h/676)%26)) + string(rune('a'+(h/17576)%26))
}

// The owner's own rows each tenant also has an id for: "peer" is the plain
// member, so a reference to A's peer is a person outside B's organization.
var isoReferences = []isoReference{
	// Tasks.
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks", what: "project", body: map[string]any{"title": isoUnique("ref"), "project_id": isoRef("project")}, covers: []string{"CreateTaskSDI.project_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks", what: "parent", body: map[string]any{"title": isoUnique("ref"), "parent_task_id": isoRef("task2")}, covers: []string{"CreateTaskSDI.parent_task_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks", what: "assignee", body: map[string]any{"title": isoUnique("ref"), "assignee_id": isoRef("peer")}, covers: []string{"CreateTaskSDI.assignee_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks", what: "label", body: map[string]any{"title": isoUnique("ref"), "label_ids": []any{isoRef("label")}}, covers: []string{"CreateTaskSDI.label_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks", what: "attachment", body: map[string]any{"title": isoUnique("ref"), "attachment_ids": []any{isoRef("attachment")}},
		noControl: "the attachment is already attached to a task; a staged one would be needed", covers: []string{"CreateTaskSDI.attachment_ids"}},
	{method: "PATCH", pattern: "/api/v1/tasks/{taskID}", what: "assignee", body: map[string]any{"assignee_id": isoRef("peer")}, covers: []string{"PatchTaskSDI.assignee_id"}},
	{method: "PATCH", pattern: "/api/v1/tasks/{taskID}", what: "project", body: map[string]any{"project_id": isoRef("project")}, covers: []string{"PatchTaskSDI.project_id"}},
	{method: "PUT", pattern: "/api/v1/tasks/{taskID}/parent", what: "parent", body: map[string]any{"parent_task_id": isoRef("task2")}, covers: []string{"SetTaskParentSDI.parent_task_id"}},
	{method: "POST", pattern: "/api/v1/tasks/{taskID}/dependencies", what: "depends on", body: map[string]any{"depends_on_task_id": isoRef("task2"), "type": "related"},
		noControl: "the fixture already links task to task2", covers: []string{"SetTaskDependencySDI.depends_on_task_id"}},
	{method: "POST", pattern: "/api/v1/tasks/{taskID}/labels", what: "label", body: map[string]any{"label_id": isoRef("label")},
		noControl: "the fixture already attaches this label", covers: []string{"AttachTaskLabelSDI.label_id"}},
	{method: "POST", pattern: "/api/v1/tasks/{taskID}/comments", what: "reply parent", body: map[string]any{"body": "ref", "parent_id": isoRef("taskComment")}, covers: []string{"CreateCommentSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks/batch-update", what: "task ids", allow2xx: true,
		body: map[string]any{"task_ids": []any{isoRef("task2")}, "updates": map[string]any{"priority": "high"}}, covers: []string{"BatchUpdateTasksSDI.task_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks/batch-delete", what: "task ids", allow2xx: true,
		body: map[string]any{"task_ids": []any{isoRef("task2")}}, noControl: "deleting B's own task would break later cases", covers: []string{"BatchDeleteTasksSDI.task_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks/query", what: "project filter", allow2xx: true,
		body: map[string]any{"project_id": isoRef("project")}, covers: []string{"QueryTasksSDI.project_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/pins", what: "pinned task", body: map[string]any{"item_type": "task", "item_id": isoRef("task2")}, covers: []string{"CreatePinSDI.item_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/task-views", what: "project scope", body: map[string]any{
		"name": isoUnique("ref"), "scope_type": "project", "scope_id": isoRef("project"), "visibility": "private", "definition_version": 1,
		"query": map[string]any{}, "display": map[string]any{}}, covers: []string{"CreateTaskViewSDI.scope_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/projects", what: "lead", body: map[string]any{
		"title": isoUnique("ref"), "status": "planned", "priority": "none", "lead_type": "member", "lead_id": isoRef("peer")}, covers: []string{"CreateProjectSDI.lead_id"}},

	// Chat.
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/groups", what: "members", body: map[string]any{
		"name": isoUnique("ref"), "member_user_ids": []any{isoRef("peer"), isoOwn("third")}}, covers: []string{"CreateGroupSDI.member_user_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/dm", what: "other person", body: map[string]any{"user_id": isoRef("peer")}, covers: []string{"ResolveDMSDI.user_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/members", what: "new member", body: map[string]any{
		"member_user_ids": []any{isoRef("peer")}}, noControl: "the peer is already in B's group", covers: []string{"InviteGroupMembersSDI.member_user_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/channels", what: "project", body: map[string]any{
		"name": "ref-channel", "visibility": "public", "project_id": isoRef("project")}, covers: []string{"CreateChatChannelSDI.project_id"}},
	{method: "PATCH", pattern: "/api/v1/workspaces/{workspaceID}/chat/channels/{roomID}", what: "project", body: map[string]any{"project_id": isoRef("project")}, covers: []string{"UpdateChatChannelSDI.project_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/messages/{messageID}/links", what: "linked task", body: map[string]any{
		"target_type": "task", "target_id": isoRef("task2")}, covers: []string{"CreateChatMessageLinkSDI.target_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync", what: "synced task", body: map[string]any{"task_id": isoRef("task2")}, covers: []string{"SyncThreadTaskSDI.task_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/messages/{messageID}/tasks", what: "project", body: map[string]any{
		"title": isoUnique("ref"), "project_id": isoRef("project")}, covers: []string{"CreateTaskFromMessageSDI.project_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/messages/{messageID}/tasks", what: "assignee", body: map[string]any{
		"title": isoUnique("ref"), "assignee_id": isoRef("peer")}, covers: []string{"CreateTaskFromMessageSDI.assignee_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages", what: "reply to", body: map[string]any{
		"body": "ref", "reply_to_message_id": isoRef("message")}, covers: []string{"SendChatMessageSDI.reply_to_message_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/ai/chat/catch-up", what: "room", body: map[string]any{"room_id": isoRef("room")}, covers: []string{"ChatCatchUpSDI.room_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/ai/ask", what: "conversation", body: map[string]any{
		"question": "ref", "conversation_id": isoRef("conversation")}, covers: []string{"AskUniSDI.conversation_id"}},

	// Meetings.
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/meetings", what: "attendee", body: map[string]any{
		"title": isoUnique("ref"), "timezone": "Asia/Ho_Chi_Minh", "starts_at": isoAt(48 * time.Hour), "ends_at": isoAt(49 * time.Hour),
		"attendee_user_ids": []any{isoRef("peer")}}, covers: []string{"CreateMeetingSDI.attendee_user_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/meetings", what: "project", body: map[string]any{
		"title": isoUnique("ref"), "timezone": "Asia/Ho_Chi_Minh", "starts_at": isoAt(72 * time.Hour), "ends_at": isoAt(73 * time.Hour),
		"project_id": isoRef("project")}, covers: []string{"CreateMeetingSDI.project_id"}},
	{method: "PATCH", pattern: "/api/v1/meetings/{meetingID}", what: "project", body: map[string]any{"project_id": isoRef("project")}, covers: []string{"PatchMeetingSDI.project_id"}},
	{method: "POST", pattern: "/api/v1/meetings/{meetingID}/invitations", what: "invitee", body: map[string]any{"user_id": isoRef("peer")},
		noControl: "B's peer is already an attendee", covers: []string{"InviteParticipantSDI.user_id"}},
	{method: "POST", pattern: "/api/v1/meetings/{meetingID}/host-transfer", what: "new host", body: map[string]any{"new_host_user_id": isoRef("peer")},
		noControl: "handing B's meeting to B's peer would take the owner's host role for later cases", covers: []string{"HostTransferSDI.new_host_user_id"}},
	{method: "POST", pattern: "/api/v1/meetings/{meetingID}/join", what: "invite link", body: map[string]any{"invite_link_id": isoRef("inviteLink"), "secret": isoRef("inviteSecret")},
		covers: []string{"JoinMeetingSDI.invite_link_id"}},
	{method: "POST", pattern: "/api/v1/meetings/{meetingID}/summary/tasks", what: "assignee", body: map[string]any{
		"items": []any{map[string]any{"title": isoUnique("ref"), "assignee_id": isoRef("peer")}}}, covers: []string{"SummaryTaskItemSDI.assignee_id"}},
	{method: "POST", pattern: "/api/v1/meetings/{meetingID}/summary/tasks", what: "project", body: map[string]any{
		"items": []any{map[string]any{"title": isoUnique("ref"), "project_id": isoRef("project")}}}, covers: []string{"SummaryTaskItemSDI.project_id"}},

	// Documents.
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/documents", what: "parent page", body: map[string]any{
		"title": isoUnique("ref"), "kind": "page", "parent_id": isoRef("document")}, covers: []string{"CreateDocumentSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/shares", what: "user principal", body: map[string]any{
		"principal_type": "user", "principal_id": isoRef("peer"), "level": "view"}, noControl: "the fixture already shares with B's peer", covers: []string{"ShareDocumentSDI.principal_id"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/shares", what: "workspace principal", body: map[string]any{
		"principal_type": "workspace", "principal_id": isoRef("ws"), "level": "view"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/shares", what: "organization principal", body: map[string]any{
		"principal_type": "organization", "principal_id": isoRef("org"), "level": "view"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/comments", what: "reply parent", body: map[string]any{
		"body": "ref", "type": "comment", "parent_id": isoRef("docComment")}, covers: []string{"CreateDocumentCommentSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/copies", what: "parent page", idempotent: true, body: map[string]any{
		"consent": "copy", "parent_id": isoRef("document")}, covers: []string{"CopyDocumentSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/copies", what: "convert job", idempotent: true, body: map[string]any{
		"consent": "copy", "job_id": isoRef("officeJob")}, noControl: "a serialize job is not a convert job", covers: []string{"CopyDocumentSDI.job_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/documents/files/blank", what: "parent page", idempotent: true, body: map[string]any{
		"format": "md", "title": isoUnique("ref"), "parent_id": isoRef("document")}, noControl: "the office stub engine never finishes a blank document", covers: []string{"CreateBlankDocumentFileSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/versions/commit", what: "uploaded file", idempotent: true, body: map[string]any{
		"upload_id": isoRef("docUpload"), "base_revision": "1"}, covers: []string{"CommitDocumentVersionSDI.upload_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/files/resolve", what: "file ids", allow2xx: true, body: map[string]any{
		"file_ids": []any{isoRef("file")}}, covers: []string{"ResolveFilesSDI.file_ids"},
		noControl:      "resolve answers files the caller staged; the fixture's files are already claimed, so B's own answers file_not_found too",
		mustNotContain: []string{`"url":"`, "ticket="}},

	// Organization and people.
	{method: "PATCH", pattern: "/api/v1/orgs/{org}/people/{userID}/profile", what: "department", body: map[string]any{"department_id": isoRef("department")}, covers: []string{"ProfileSDI.department_id"}},
	{method: "PATCH", pattern: "/api/v1/orgs/{org}/people/{userID}/profile", what: "manager", body: map[string]any{"manager_id": isoRef("peer")},
		noControl: "a person cannot manage themself; the own peer is the profile's subject", covers: []string{"ProfileSDI.manager_id"}},
	{method: "POST", pattern: "/api/v1/orgs/{org}/departments", what: "parent", body: map[string]any{"name": isoUnique("ref"), "parent_id": isoRef("department")}, covers: []string{"DepartmentSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/orgs/{org}/departments", what: "head", body: map[string]any{"name": isoUnique("ref head"), "head_user_id": isoRef("peer")}, covers: []string{"DepartmentSDI.head_user_id"}},
	{method: "PUT", pattern: "/api/v1/orgs/{org}/departments/order", what: "ids", allow2xx: true, body: map[string]any{"ids": []any{isoRef("department")}}},
	{method: "POST", pattern: "/api/v1/orgs/{org}/transfer-ownership", what: "new owner", body: map[string]any{
		"to_user_id": isoRef("peer"), "password": "password123"}, noControl: "transferring B's ownership would end the run", covers: []string{"TransferOwnershipSDI.to_user_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/agents", what: "agent", body: map[string]any{"agent_id": isoRef("agent")},
		noControl: "B's agent was created in B's workspace already", covers: []string{"AddWorkspaceAgentSDI.agent_id"}},

	// The caller's own inbox and directory: another tenant's rows are not
	// theirs to touch or find.
	{method: "POST", pattern: "/api/v1/me/notifications/read", what: "notification ids", body: map[string]any{"ids": []any{isoRef("notification")}}},
	{method: "POST", pattern: "/api/v1/me/notifications/unread", what: "notification ids", body: map[string]any{"ids": []any{isoRef("notification")}}},
	{method: "POST", pattern: "/api/v1/me/notifications/archive", what: "notification ids", body: map[string]any{"ids": []any{isoRef("notification")}}},
	{method: "POST", pattern: "/api/v1/me/notifications/unarchive", what: "notification ids", body: map[string]any{"ids": []any{isoRef("notification")}}},
	{method: "GET", pattern: "/api/v1/workspaces/{workspaceID}/chat/users/lookup", what: "email of a person in another tenant", allow2xx: true,
		query: "?email={peerEmail}"},
	{method: "GET", pattern: "/api/v1/workspaces/{workspaceID}/chat/users/lookup", what: "user id of a person in another tenant", allow2xx: true,
		query: "?user_id={peerID}"},

	// Fields the first matrix run left without a case.
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/channels", what: "members", body: map[string]any{
		"name": isoUnique("ref-members"), "visibility": "private", "member_user_ids": []any{isoRef("peer")}},
		covers: []string{"CreateChatChannelSDI.member_user_ids"}},
	{method: "POST", pattern: "/api/v1/documents/{documentID}/move", what: "parent page", body: map[string]any{
		"parent_id": isoRef("document"), "revision": "1"}, noControl: "B's page is already at the root; moving it under itself is refused",
		covers: []string{"MoveDocumentSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/tasks/{taskID}/subscribe", what: "subscriber", body: map[string]any{"user_id": isoRef("owner"), "user_type": "member"},
		covers: []string{"SubscribeTaskSDI.user_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/ai/chat/catch-up", what: "thread", body: map[string]any{
		"room_id": isoOwn("room"), "thread_root_id": isoRef("message")}, covers: []string{"ChatCatchUpSDI.thread_root_id"}},
	{method: "PUT", pattern: "/api/v1/workspaces/{workspaceID}/task-view-preferences", what: "project scope", body: map[string]any{
		"scope_type": "project", "scope_id": isoRef("project"), "prefs": map[string]any{"layout": "list"}},
		covers: []string{"PutTaskViewPreferenceSDI.scope_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks/table/rows", what: "filters", allow2xx: true, body: map[string]any{
		"query": map[string]any{"filter": map[string]any{"assignee_ids": []any{isoRef("peer")}, "project_ids": []any{isoRef("project")}, "label_ids": []any{isoRef("label")}}},
		"limit": 50}, covers: []string{"TableFilterSDI.assignee_ids", "TableFilterSDI.project_ids", "TableFilterSDI.label_ids"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/tasks/table/rows", what: "children of", allow2xx: true, body: map[string]any{
		"parent_id": isoRef("task"), "hierarchy": true, "limit": 50}, covers: []string{"TableRowsSDI.parent_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/pins", what: "pinned project", body: map[string]any{"item_type": "project", "item_id": isoRef("project")}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/pins", what: "pinned view", body: map[string]any{"item_type": "task_view", "item_id": isoRef("view")}},
	{method: "PUT", pattern: "/api/v1/workspaces/{workspaceID}/projects/{projectID}", what: "lead", body: map[string]any{
		"revision": 1, "lead_type": "member", "lead_id": isoRef("peer")}, noControl: "B's project has moved past revision 1 by now",
		covers: []string{"PutProjectSDI.lead_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/poll/vote", what: "option", body: map[string]any{
		"option_id": isoRef("pollOption")}, covers: []string{"VoteChatPollSDI.option_id"}},
	{method: "POST", pattern: "/api/v1/me/notifications/read", what: "workspace filter", allow2xx: true, body: map[string]any{
		"all": true, "workspace_id": isoRef("ws")}, covers: []string{"NotificationIDsSDI.workspace_id"}},
	{method: "POST", pattern: "/api/v1/me/onboarding/complete", what: "workspace", allow2xx: true, body: map[string]any{
		"completion_path": "joined", "workspace_id": isoRef("ws")}, noControl: "B's owner is onboarded already",
		covers: []string{"CompleteOnboardingSDI.workspace_id"}},

	// Email hub.
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/email-hub/send", what: "mailbox", body: map[string]any{
		"account_id": isoRef("emailAccount"), "to": []any{"someone@example.com"}, "subject": "ref", "body_text": "ref"},
		noControl: "sending needs an SMTP server", covers: []string{"SendEmailHubSDI.account_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/email-hub/send", what: "replied thread", body: map[string]any{
		"account_id": isoOwn("emailAccount"), "reply_to_thread_id": isoRef("emailThread"), "to": []any{"someone@example.com"}, "subject": "ref", "body_text": "ref"},
		noControl: "sending needs an SMTP server", covers: []string{"SendEmailHubSDI.reply_to_thread_id"}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summary/tasks", what: "assignee", body: map[string]any{
		"account_id": isoOwn("emailAccount"), "items": []any{map[string]any{"title": isoUnique("ref"), "assignee_id": isoRef("peer")}}}},
	{method: "POST", pattern: "/api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summary/tasks", what: "project", body: map[string]any{
		"account_id": isoOwn("emailAccount"), "items": []any{map[string]any{"title": isoUnique("ref"), "project_id": isoRef("project")}}}},
}

// referenceControls sends each reference case with B's own rows: the request
// must be accepted, or the attack's refusal could be a malformed body rather
// than the tenancy check.
func (w *isoWorld) referenceControls(t *testing.T) {
	t.Helper()
	for _, c := range isoReferences {
		if c.noControl != "" {
			continue
		}
		path, ok := isoPath(t, c.pattern, w.bravo)
		if !ok {
			continue
		}
		status, raw := w.do(t, c.method, path+isoQuery(c.query, w.bravo), w.bravo.token, c.build(w, w.bravo, w.bravo))
		if status < 200 || status >= 300 {
			t.Errorf("reference control %s %s %s with B's own rows = %d: %s", c.method, c.pattern, c.what, status, isoClip(raw))
		}
	}
}

// isoRefFieldExempt lists request DTO id fields no reference case attacks,
// each with the reason another pass covers it or it names no tenant row.
var isoRefFieldExempt = map[string]string{
	"FlagOverrideSDI.scope_id":              "platform console: an override names any organization or user by design (RequirePlatformRole)",
	"FlagOverrideDeleteSDI.scope_id":        "platform console: an override names any organization or user by design (RequirePlatformRole)",
	"CalendarSelectionSDI.calendar_ids":     "ids of the provider's calendars (Google, Microsoft), not UniWork rows",
	"SendChatMessageSDI.client_msg_id":      "the client's idempotency key, not a row",
	"MintChatVoiceTokenSDI.call_id":         "a client-generated call id, not a row",
	"VoiceSignalSDI.call_id":                "a client-generated call id, not a row",
	"MintChatVoiceTokenSDI.room_id":         "the route names no other row: the cross-tenant pass sends A's room in the body",
	"ResolveInviteLinkSDI.link_id":          "public route: the link id comes with its secret, and holding both is the grant",
	"SummarizeEmailHubThreadSDI.account_id": "the mixed pass sends B's workspace with A's thread and A's account in the body",
	"PatchEmailHubThreadSDI.account_id":     "the mixed pass sends B's workspace with A's thread and A's account in the body",
	"EmailHubSummaryTasksSDI.account_id":    "the mixed pass sends B's workspace with A's thread and A's account in the body",
}

// A body field that names another row is an attack surface the path passes
// never see: every id field of every request DTO has an isoReferences case,
// or an entry in isoRefFieldExempt saying why it needs none.
func TestEveryBodyIDFieldHasAReferenceCase(t *testing.T) {
	covered := map[string]bool{}
	for _, c := range isoReferences {
		for _, f := range c.covers {
			covered[f] = true
		}
	}
	fset := token.NewFileSet()
	paths, err := filepath.Glob(filepath.Join("dto", "sdi", "*.go"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("no request DTOs under dto/sdi: %v", err)
	}
	seen := map[string]bool{}
	var missing []string
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range gen.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, field := range st.Fields.List {
					if field.Tag == nil {
						continue
					}
					tag, _ := strconv.Unquote(field.Tag.Value)
					name := strings.Split(reflect.StructTag(tag).Get("json"), ",")[0]
					if !strings.HasSuffix(name, "_id") && !strings.HasSuffix(name, "_ids") {
						continue
					}
					key := ts.Name.Name + "." + name
					seen[key] = true
					if _, exempt := isoRefFieldExempt[key]; !exempt && !covered[key] {
						missing = append(missing, key)
					}
				}
			}
		}
	}
	var stale []string
	for key := range covered {
		if !seen[key] {
			stale = append(stale, key+" (covers)")
		}
	}
	for key := range isoRefFieldExempt {
		if !seen[key] {
			stale = append(stale, key+" (exempt)")
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 {
		t.Errorf("request fields naming a row with no isoReferences case (add one with covers, or exempt it with a reason):\n  %s", strings.Join(missing, "\n  "))
	}
	if len(stale) > 0 {
		t.Errorf("covers / isoRefFieldExempt entries that name no DTO field:\n  %s", strings.Join(stale, "\n  "))
	}
}
