package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// mcpCallTool runs tools/call on /mcp with one grant's access token and
// returns the HTTP status and the JSON-RPC answer as bytes.
func mcpCallTool(t *testing.T, w *isoWorld, bearer, tool string, args map[string]string) (int, []byte) {
	t.Helper()
	if args == nil {
		args = map[string]string{}
	}
	argJSON, _ := json.Marshal(args)
	body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, tool, argJSON)
	res, out := mcpRPC(t, w.srv, "Bearer "+bearer, "", body)
	raw, _ := json.Marshal(out)
	return res.StatusCode, raw
}

// mcpCallToolJSON is mcpCallTool for arguments that are not all strings
// (revisions, lists, null).
func mcpCallToolJSON(t *testing.T, w *isoWorld, bearer, tool string, args map[string]any) (int, []byte) {
	t.Helper()
	argJSON, _ := json.Marshal(args)
	body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, tool, argJSON)
	res, out := mcpRPC(t, w.srv, "Bearer "+bearer, "", body)
	raw, _ := json.Marshal(out)
	return res.StatusCode, raw
}

// swapIDs is args with every string equal to a key of stand-ins replaced by
// its value. B's refusal for A's real row is compared with the refusal for an
// id that never existed: the two must read the same, or the answer tells B
// which ids exist.
func swapIDs(t *testing.T, args map[string]any, standIns map[string]string) map[string]any {
	t.Helper()
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for from, to := range standIns {
		text = strings.ReplaceAll(text, `"`+from+`"`, `"`+to+`"`)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// writeAnswer is the part of a write tool's result a control reads.
type writeAnswer struct {
	Item struct {
		ID string `json:"id"`
	} `json:"item"`
	Changes []writeChange `json:"changes"`
	Note    string        `json:"note"`
}

type writeChange struct {
	Field string `json:"field"`
}

// taskRef is the PREFIX-N a person reads for a task.
func (w *isoWorld) taskRef(t *testing.T, id string) string {
	t.Helper()
	var ref string
	if err := w.pool.QueryRow(context.Background(),
		`SELECT w.task_prefix || '-' || t.number FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = $1`, id).Scan(&ref); err != nil {
		t.Fatal(err)
	}
	return ref
}

// taskRevision is a task's current revision, the one update_task must send.
func (w *isoWorld) taskRevision(t *testing.T, id string) int64 {
	t.Helper()
	var rev int64
	if err := w.pool.QueryRow(context.Background(), `SELECT revision FROM tasks WHERE id = $1`, id).Scan(&rev); err != nil {
		t.Fatal(err)
	}
	return rev
}

// isToolError reports a tools/call answer that carries result.isError: the way
// the connector refuses without a JSON-RPC error.
func isToolError(raw []byte) bool {
	var out struct {
		Result struct {
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	return json.Unmarshal(raw, &out) == nil && out.Result.IsError
}

// mcpNotFoundText is the one answer a tool gives for an id that does not
// exist and for one the grant may not read (mcpToolResult, spec §7.5).
const mcpNotFoundText = "not found or not accessible"

// toolText is the text of a tools/call answer's content.
func toolText(raw []byte) string {
	var out struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return ""
	}
	texts := make([]string, 0, len(out.Result.Content))
	for _, c := range out.Result.Content {
		texts = append(texts, c.Text)
	}
	return strings.Join(texts, "\n")
}

// TestIsolationMCP holds ADR 0008 for the MCP connector: a grant reads its
// own organization only, whoever holds it and whatever ids it names. B's grant
// names B's organization; every call below aims it at A's rows.
func TestIsolationMCP(t *testing.T) {
	w := newIsolationServer(t)
	w.alpha = w.buildTenant(t, "alpha")
	w.bravo = w.buildTenant(t, "bravo")
	a, b := w.alpha, w.bravo
	aTask, aMeeting := a.get(t, "task"), a.get(t, "meeting")
	aTask2, aProject, aLabel, aComment := a.get(t, "task2"), a.get(t, "project"), a.get(t, "label"), a.get(t, "taskComment")
	bTask := b.get(t, "task")
	// A holds a third task, so it has a PREFIX-N that B's workspace does not:
	// both workspaces count from 1 under the same prefix, and a ref that B's
	// own workspace can answer would test nothing.
	aTask3 := isoID(t, w.call(t, "POST", "/api/v1/workspaces/"+a.wsID+"/tasks", a.token, map[string]any{"title": a.marker + " Third Task"}), "task")
	a.ids["task3"] = aTask3
	aRef, aRef3, bRef := w.taskRef(t, aTask), w.taskRef(t, aTask3), w.taskRef(t, bTask)
	// liveRevision is the revision a task holds now, for the task an
	// update_task call names (an id, or A's third task by its ref): the revision
	// check must pass, so only the tenant gate can refuse the call.
	liveRevision := func(t *testing.T, task any) int64 {
		t.Helper()
		id := fmt.Sprint(task)
		if id == aRef3 {
			id = aTask3
		}
		return w.taskRevision(t, id)
	}

	attacks := []struct {
		tool string
		args map[string]string
	}{
		{"my_work", map[string]string{"workspace_id": a.wsID}},
		{"search", map[string]string{"workspace_id": a.wsID, "query": a.marker}},
		{"get_task", map[string]string{"workspace_id": a.wsID, "task_id": aTask}},
		{"get_meeting", map[string]string{"workspace_id": a.wsID, "meeting_id": aMeeting}},
		{"get_task", map[string]string{"workspace_id": b.wsID, "task_id": aTask}},
		{"get_meeting", map[string]string{"workspace_id": b.wsID, "meeting_id": aMeeting}},
		// The task tools of Phase 1: the lists and options of A's workspace,
		// and a task named by its PREFIX-N, which is resolved inside the
		// workspace the call names.
		{"list_members", map[string]string{"workspace_id": a.wsID}},
		{"task_options", map[string]string{"workspace_id": a.wsID}},
		{"list_tasks", map[string]string{"workspace_id": a.wsID}},
		{"get_task", map[string]string{"workspace_id": a.wsID, "task_id": aRef3}},
		{"get_task", map[string]string{"workspace_id": b.wsID, "task_id": aRef3}},
	}
	// writeAttacks aim B's write grant at A's rows: A's workspace and task, and
	// A's ids named in a call that is about B's own workspace and task. Each
	// is refused with the answer an id that never existed gets (want is its
	// prefix; the not-found text when empty) and changes none of A's rows.
	// control is the same call by A's own grant on A's rows, which must
	// succeed. An update_task row carries no revision, in the attack or the
	// control: the run sends the live one of the task named, so a missing
	// tenant gate would write and not stop at a revision conflict. A create_task
	// control carries no title, the run makes one up. Phases 2-4 add their rows here.
	writeAttacks := []struct {
		tool    string
		args    map[string]any
		control map[string]any
		want    string
	}{
		{"create_task", map[string]any{"workspace_id": a.wsID, "title": "iso-write"},
			map[string]any{"workspace_id": a.wsID}, ""},
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-write", "parent_task_id": aTask},
			map[string]any{"workspace_id": a.wsID, "parent_task_id": aTask}, ""},
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-write", "parent_task_id": aRef3},
			map[string]any{"workspace_id": a.wsID, "parent_task_id": aRef3}, ""},
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-write", "project_id": aProject},
			map[string]any{"workspace_id": a.wsID, "project_id": aProject}, ""},
		// A person of A's is not a member of B's workspace; the answer is the
		// one a user id that does not exist gets, so it is not an oracle.
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-write", "assignee_id": a.userID},
			map[string]any{"workspace_id": a.wsID, "assignee_id": a.userID}, "assignee_not_member:"},
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-write", "label_ids": []string{aLabel}},
			map[string]any{"workspace_id": a.wsID, "label_ids": []string{aLabel}}, "invalid arguments: label không hợp lệ"},
		{"update_task", map[string]any{"workspace_id": a.wsID, "task_id": aTask, "title": "iso"},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask, "title": "iso-control"}, ""},
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": aTask, "title": "iso"},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask, "title": "iso-control"}, ""},
		{"update_task", map[string]any{"workspace_id": a.wsID, "task_id": aRef3, "title": "iso"},
			map[string]any{"workspace_id": a.wsID, "task_id": aRef3, "title": "iso-control"}, ""},
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": bTask, "parent_task_id": aTask},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask2, "parent_task_id": aTask}, ""},
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": bTask, "project_id": aProject},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask2, "project_id": aProject}, ""},
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": bTask, "assignee_id": a.userID},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask2, "assignee_id": a.userID}, "assignee_not_member:"},
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": bTask, "add_label_ids": []string{aLabel}},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask2, "add_label_ids": []string{aLabel}}, "invalid arguments: add_label_ids"},
		// A's task has A's label on it, so the control can take it off.
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": bTask, "remove_label_ids": []string{aLabel}},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask, "remove_label_ids": []string{aLabel}}, "invalid arguments: remove_label_ids"},
		{"add_comment", map[string]any{"workspace_id": a.wsID, "task_id": aTask, "body": "iso"},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask, "body": "iso-control"}, ""},
		{"add_comment", map[string]any{"workspace_id": b.wsID, "task_id": aTask, "body": "iso"},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask, "body": "iso-control"}, ""},
		{"add_comment", map[string]any{"workspace_id": a.wsID, "task_id": aRef3, "body": "iso"},
			map[string]any{"workspace_id": a.wsID, "task_id": aRef3, "body": "iso-control"}, ""},
		{"add_comment", map[string]any{"workspace_id": b.wsID, "task_id": bTask, "body": "iso", "reply_to": aComment},
			map[string]any{"workspace_id": a.wsID, "task_id": aTask, "body": "iso-control", "reply_to": aComment}, ""},
	}
	// missing gives every id of A's that a write attack names a stand-in that
	// never existed; the twin of an attack is the same call with those swapped in.
	missing := map[string]string{
		a.wsID: util.NewID(), aTask: util.NewID(), aProject: util.NewID(), aLabel: util.NewID(),
		a.userID: util.NewID(), aComment: util.NewID(), aRef3: strings.Split(aRef3, "-")[0] + "-9999",
	}
	// refused runs every attack with B's access token: each answers 200 with
	// isError and the not-found text (the tenancy refusal, not a transport
	// failure, a bad argument or an infrastructure error; a write attack's
	// answer may instead be the validation text of the id it names) and carries
	// nothing of A's. Afterwards A's tenant digest is as it was and no row of
	// B's names a row of A's. It takes the subtest's t, so a failure is
	// reported on the subtest that ran it and not on the parent.
	refused := func(t *testing.T, label string) {
		t.Helper()
		before, preRefs := w.tenantDigest(t, a), w.referencesTo(t, b, a)
		for _, at := range attacks {
			status, raw := mcpCallTool(t, w, b.ids["mcpAccess"], at.tool, at.args)
			if status != http.StatusOK || !isToolError(raw) || toolText(raw) != mcpNotFoundText {
				t.Errorf("%s %s %v: status %d, not refused with %q: %s", label, at.tool, at.args, status, mcpNotFoundText, raw)
			}
			// Not even an id the call itself names may come back.
			if leak := a.leakIn(raw, ""); leak != "" {
				t.Errorf("%s %s %v leaked %s: %s", label, at.tool, at.args, leak, raw)
			}
		}
		status, raw := mcpCallTool(t, w, b.ids["mcpAccess"], "list_workspaces", nil)
		if status != http.StatusOK || isToolError(raw) {
			t.Errorf("%s list_workspaces: status %d: %s", label, status, raw)
		}
		if leak := a.leakIn(raw, ""); leak != "" {
			t.Errorf("%s list_workspaces shows A's %s: %s", label, leak, raw)
		}
		if !strings.Contains(string(raw), b.wsID) {
			t.Errorf("%s list_workspaces does not show B's own workspace: %s", label, raw)
		}

		// Both workspaces count their tasks from 1 under the same prefix, so A's
		// first ref may also be B's. A ref is read in the workspace the call
		// names: B's call then answers B's own task and nothing of A's.
		status, raw = mcpCallTool(t, w, b.ids["mcpAccess"], "get_task", map[string]string{"workspace_id": b.wsID, "task_id": aRef})
		if aRef == bRef && (status != http.StatusOK || isToolError(raw) || !strings.Contains(string(raw), bTask)) {
			t.Errorf("%s get_task %s in B's workspace is not B's own task: %d %s", label, aRef, status, raw)
		}
		if aRef != bRef && (status != http.StatusOK || !isToolError(raw) || toolText(raw) != mcpNotFoundText) {
			t.Errorf("%s get_task %s in B's workspace: %d %s", label, aRef, status, raw)
		}
		if leak := a.leakIn(raw, ""); leak != "" {
			t.Errorf("%s get_task %s in B's workspace leaked %s: %s", label, aRef, leak, raw)
		}
		// A's project filters B's workspace to nothing; the answer names none of A's.
		status, raw = mcpCallTool(t, w, b.ids["mcpAccess"], "list_tasks", map[string]string{"workspace_id": b.wsID, "project_id": aProject})
		if status != http.StatusOK || isToolError(raw) || !strings.Contains(string(raw), `\"tasks\":[]`) {
			t.Errorf("%s list_tasks in B's workspace by A's project: %d %s", label, status, raw)
		}
		if leak := a.leakIn(raw, ""); leak != "" {
			t.Errorf("%s list_tasks by A's project leaked %s: %s", label, leak, raw)
		}

		for _, at := range writeAttacks {
			args := maps.Clone(at.args)
			if at.tool == "update_task" {
				args["revision"] = liveRevision(t, args["task_id"])
			}
			status, raw := mcpCallToolJSON(t, w, b.ids["mcpAccess"], at.tool, args)
			text := toolText(raw)
			want, ok := at.want, strings.HasPrefix(text, at.want)
			if want == "" {
				want, ok = mcpNotFoundText, text == mcpNotFoundText
			}
			if status != http.StatusOK || !isToolError(raw) || !ok {
				t.Errorf("%s %s %v: status %d, not refused with %q: %s", label, at.tool, args, status, want, raw)
			}
			if leak := a.leakIn(raw, ""); leak != "" {
				t.Errorf("%s %s %v leaked %s: %s", label, at.tool, args, leak, raw)
			}
			// The same call naming ids that never existed reads the same.
			twin := swapIDs(t, args, missing)
			if tStatus, tRaw := mcpCallToolJSON(t, w, b.ids["mcpAccess"], at.tool, twin); tStatus != status || toolText(tRaw) != text {
				t.Errorf("%s %s %v: A's rows answer %q, rows that do not exist answer %q", label, at.tool, args, text, toolText(tRaw))
			}
		}
		if changed := isoDiff(before, w.tenantDigest(t, a)); len(changed) > 0 {
			t.Errorf("%s: an attack changed A's rows in %v", label, changed)
		}
		if refs := w.referencesTo(t, b, a); strings.Join(refs, ",") != strings.Join(preRefs, ",") {
			t.Errorf("%s: an attack left B's rows naming A's: %v, before %v", label, refs, preRefs)
		}
	}

	// Each owner reads their own rows through their own grant, so a refusal
	// below is the tenancy check and not a broken token or a wrong id. A's
	// control runs every attacked tool with the attack's own arguments, B's
	// workspace swapped for A's: the same call succeeds for the tenant whose
	// rows it names. It names the row it asked for, or A's marker, in the
	// answer.
	t.Run("control", func(t *testing.T) {
		for _, at := range attacks {
			args := map[string]string{}
			for k, v := range at.args {
				if v == b.wsID {
					v = a.wsID
				}
				args[k] = v
			}
			status, raw := mcpCallTool(t, w, a.ids["mcpAccess"], at.tool, args)
			if status != http.StatusOK || isToolError(raw) {
				t.Errorf("A's own %s %v through MCP: %d %s", at.tool, args, status, raw)
				continue
			}
			// A task named by its PREFIX-N is not in the answer under that
			// name; it shows A's marker like a list does.
			want := a.marker
			if id := args["task_id"] + args["meeting_id"]; len(id) >= 20 {
				want = id
			}
			if !strings.Contains(strings.ToLower(string(raw)), strings.ToLower(want)) {
				t.Errorf("A's own %s %v does not show %s: %s", at.tool, args, want, raw)
			}
		}
		status, raw := mcpCallTool(t, w, a.ids["mcpAccess"], "list_workspaces", nil)
		if status != http.StatusOK || isToolError(raw) || !strings.Contains(string(raw), a.wsID) {
			t.Errorf("A's own list_workspaces does not show A's workspace: %d %s", status, raw)
		}
		status, raw = mcpCallTool(t, w, b.ids["mcpAccess"], "get_task", map[string]string{"workspace_id": b.wsID, "task_id": b.get(t, "task")})
		if status != http.StatusOK || isToolError(raw) || !strings.Contains(string(raw), b.get(t, "task")) {
			t.Fatalf("B reading B's own task through MCP: %d %s", status, raw)
		}

		// A's own grant runs every attacked write tool with the attack's own
		// ids. A title may not repeat an active task's (a create is refused as
		// a duplicate), so each control names its own; update_task wants the
		// revision the task holds now.
		written := w.tenantDigest(t, a)
		for i, at := range writeAttacks {
			args := maps.Clone(at.control)
			if _, titled := args["title"]; titled || at.tool == "create_task" {
				args["title"] = fmt.Sprintf("iso-control-%s-%d", a.tag, i)
			}
			if at.tool == "update_task" {
				args["revision"] = liveRevision(t, args["task_id"])
			}
			status, raw := mcpCallToolJSON(t, w, a.ids["mcpAccess"], at.tool, args)
			var done struct {
				Result struct {
					StructuredContent writeAnswer `json:"structuredContent"`
				} `json:"result"`
			}
			if status != http.StatusOK || isToolError(raw) || json.Unmarshal(raw, &done) != nil || done.Result.StructuredContent.Item.ID == "" {
				t.Errorf("A's own %s %v through MCP: %d %s", at.tool, args, status, raw)
				continue
			}
			if at.tool != "update_task" {
				continue
			}
			// An update that saved its fields but failed a later step (parent,
			// labels) still answers 200 with an item: it must have no note, and
			// every field the call names must show in changes.
			sc := done.Result.StructuredContent
			if sc.Note != "" {
				t.Errorf("A's own %s %v came back with a note: %s", at.tool, args, raw)
			}
			for key, field := range map[string]string{"title": "title", "project_id": "project_id", "assignee_id": "assignee_id", "parent_task_id": "parent_task_id", "add_label_ids": "labels", "remove_label_ids": "labels"} {
				if _, named := args[key]; named && !slices.ContainsFunc(sc.Changes, func(c writeChange) bool { return c.Field == field }) {
					t.Errorf("A's own %s %v does not change %s: %s", at.tool, args, field, raw)
				}
			}
		}
		// The digest sees these writes, so "unchanged" in refused means something.
		if changed := isoDiff(written, w.tenantDigest(t, a)); !slices.Contains(changed, "tasks") || !slices.Contains(changed, "task_comments") {
			t.Errorf("A's own writes changed the digest of %v only, want tasks and task_comments among them", changed)
		}
	})

	t.Run("outsider", func(t *testing.T) { refused(t, "outsider") })

	t.Run("approve with a foreign organization", func(t *testing.T) {
		// McpConsentSDI.organization_id (isoRefFieldExempt): B's own attempt,
		// with B's own live CSRF token, cannot be approved into A. The 403
		// holds only while B is not a member of A, so this subtest runs
		// before "member of both organizations".
		res, consent := doJSON(t, w.srv, "GET", "/api/v1/auth/connect/attempts/"+b.ids["mcpAttempt"], b.token, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("B reading B's own attempt: %d %v", res.StatusCode, consent)
		}
		res, out := doJSON(t, w.srv, "POST", "/api/v1/auth/connect/attempts/"+b.ids["mcpAttempt"], b.token, map[string]any{
			"decision": "approve", "csrf_token": consent["csrf_token"], "organization_id": a.orgID,
		})
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("approve into A's organization: %d %v, want 403", res.StatusCode, out)
		}
		// The refusal left B's attempt undecided and wrote nothing into A.
		var decided bool
		if err := w.pool.QueryRow(context.Background(), `SELECT approved_at IS NOT NULL OR cancelled_at IS NOT NULL OR used_at IS NOT NULL FROM mcp_auth_attempts WHERE id = $1`, b.ids["mcpAttempt"]).Scan(&decided); err != nil {
			t.Fatal(err)
		}
		if decided {
			t.Error("the refused approval decided B's attempt")
		}
		var foreign int
		if err := w.pool.QueryRow(context.Background(), `SELECT count(*) FROM mcp_grants WHERE organization_id = $1 AND user_id <> $2`, a.orgID, a.userID).Scan(&foreign); err != nil {
			t.Fatal(err)
		}
		if foreign != 0 {
			t.Errorf("A's organization holds %d grants of someone else's", foreign)
		}
	})

	// This subtest must stay last: it makes B's owner a member of A, which
	// changes the world every subtest above relies on (B approving into A
	// would no longer be refused).
	t.Run("member of both organizations", func(t *testing.T) {
		// B's owner now belongs to A as well; the grant still names B only.
		w.joinAsMember(t, b, a)
		refused(t, "member of both")
	})
}
