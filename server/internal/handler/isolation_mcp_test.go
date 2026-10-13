package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
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
	}
	// refused runs every attack with B's access token: each answers 200 with
	// isError and the not-found text (the tenancy refusal, not a transport
	// failure, a bad argument or an infrastructure error) and carries nothing
	// of A's. It takes the subtest's t, so a failure is reported on the subtest
	// that ran it and not on the parent.
	refused := func(t *testing.T, label string) {
		t.Helper()
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
			want := a.marker
			if id := args["task_id"] + args["meeting_id"]; id != "" {
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
