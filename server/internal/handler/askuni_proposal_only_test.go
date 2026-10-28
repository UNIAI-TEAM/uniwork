package handler

// ADR 0044 §2, the oracle: Ask UNI's agent loop never runs a business write
// command. A dock turn in Ask mode whose scripted model calls every one of the
// 15 write tools only records proposals; the tenant's digest (the isolation
// matrix's own tenantDigest + isoDiff, over the real router, the real gateway
// and the real services) moves only in the AI bookkeeping tables, and no audit
// row is written. The provider is the scripted fake: no live AI.

import (
	"context"
	"fmt"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// askLoopPermitted is every table a proposal-only turn may change: the
// conversation and its two messages, the proposal rows, and the token
// accounting of the turn.
var askLoopPermitted = map[string]bool{
	"ai_conversations":       true,
	"ai_messages":            true,
	"agent_action_proposals": true,
	"ai_usage_events":        true,
	"usage_events":           true,
	"usage_counters":         true,
	"outbox_events":          true,
}

func TestAskUniLoopNeverRunsAWriteCommand(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	fake := &provider.Fake{}
	gw := service.NewAIGateway(w.pool, w.q, fake, ai.Options{})
	d := w.deps
	asker := service.NewAskUNIService(w.pool, w.q, d.Workspaces, d.Organizations, d.Tasks, d.Meetings, d.Chat, gw, nil)
	asker.SetFlags(d.FeatureFlags)
	asker.SetFiles(w.files)
	asker.SetEmailHub(d.EmailHub)
	asker.SetReadTools(d.McpTools)
	d.AskUNI = asker
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	start := time.Now().Add(48 * time.Hour).UTC()
	call := func(n int, name string, args any) provider.ToolCall {
		return propCall(fmt.Sprintf("c%d", n), name, args)
	}
	// Two meetings of their own for the two tools that need a state: one
	// scheduled to cancel, one cancelled to restore.
	newMeeting := func(title string) string {
		out := w.call(t, "POST", "/api/v1/workspaces/"+tn.wsID+"/meetings", tn.token, map[string]any{
			"title": title, "timezone": "Asia/Ho_Chi_Minh",
			"starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339),
		})
		return isoID(t, out, "meeting")
	}
	toCancel, cancelled := newMeeting("Sẽ hủy"), newMeeting("Đã hủy")
	w.call(t, "POST", "/api/v1/meetings/"+cancelled+"/cancel", tn.token, map[string]any{})

	// Each turn proposes at most ten rows, each round takes at most six calls,
	// and one object gets one row (ADR 0044 §3, R11).
	turns := [][][]provider.ToolCall{{{
		call(1, "create_task", map[string]any{"title": "Việc oracle"}),
		call(2, "update_task", map[string]any{"task_id": tn.ids["task"], "status": "done"}),
		call(3, "add_comment", map[string]any{"task_id": tn.ids["task"], "body": "Bình luận oracle"}),
		call(4, "create_project", map[string]any{"title": "Dự án oracle"}),
		call(5, "update_project", map[string]any{"project_id": tn.ids["project"], "title": "Dự án đổi tên"}),
		call(6, "schedule_meeting", map[string]any{"title": "Họp oracle", "starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339)}),
	}, {
		call(7, "update_meeting", map[string]any{"meeting_id": tn.ids["meeting"], "title": "Họp đổi tên"}),
		call(8, "create_document", map[string]any{"title": "Trang oracle"}),
		call(9, "update_document", map[string]any{"document_id": tn.ids["document"], "title": "Trang đổi tên"}),
		call(10, "add_document_comment", map[string]any{"document_id": tn.ids["document"], "body": "Bình luận trang"}),
	}}, {{
		call(11, "invite_to_meeting", map[string]any{"meeting_id": tn.ids["liveMeeting"], "user_ids": []string{tn.ids["peer"]}}),
		call(12, "cancel_meeting", map[string]any{"meeting_id": toCancel}),
		call(13, "restore_meeting", map[string]any{"meeting_id": cancelled}),
		call(14, "send_chat_message", map[string]any{"room_id": tn.ids["room"], "body": "Tin oracle"}),
		call(15, "create_office_document", map[string]any{"title": "Đề xuất oracle", "format": "docx", "outline": "## Mục 1"}),
	}}}

	before := uniworkProposalTake(t, w, tn)
	var conv string
	for i, rounds := range turns {
		n := 0
		fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
			if strings.Contains(req.System, "Name this conversation") {
				return provider.CompletionResponse{Text: "Tiêu đề", UsagePresent: true, StopReason: "end_turn"}
			}
			if n < len(rounds) {
				n++
				return provider.CompletionResponse{ToolCalls: rounds[n-1], StopReason: "tool_use", UsagePresent: true, InputTokens: 10, OutputTokens: 5}
			}
			return provider.CompletionResponse{Text: "Đã chuẩn bị.", StopReason: "end_turn", UsagePresent: true, InputTokens: 20, OutputTokens: 7}
		}
		body := map[string]any{"question": fmt.Sprintf("Làm hết giúp mình, lượt %d", i+1), "locale": "vi", "mode": "ask"}
		if conv != "" {
			body["conversation_id"] = conv
		}
		res := postStream(t, srv, tn.wsID, tn.token, body)
		if res.StatusCode != 200 {
			t.Fatalf("turn %d: status %d", i+1, res.StatusCode)
		}
		frames := collectFrames(readSSE(res.Body))
		for _, f := range frames {
			if f.event == "error" {
				t.Fatalf("turn %d: error frame %s", i+1, f.data)
			}
			if f.event == "run" && conv == "" {
				conv = strings.Split(strings.Split(f.data, `"conversation_id":"`)[1], `"`)[0]
			}
		}
		if names := eventsOf(frames); !slices.Contains(names, "proposal") {
			t.Fatalf("turn %d: no proposal event in %v", i+1, names)
		}
	}
	after := uniworkProposalTake(t, w, tn)

	// Every one of the 15 tools left a pending row and nothing else.
	rows, err := w.pool.Query(context.Background(), `SELECT action_type, status FROM agent_action_proposals WHERE organization_id = $1 AND conversation_id = $2`, tn.orgID, conv)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for rows.Next() {
		var tool, status string
		if err := rows.Scan(&tool, &status); err != nil {
			t.Fatal(err)
		}
		got[tool] = status
	}
	rows.Close()
	for _, c := range slices.Concat(turns[0][0], turns[0][1], turns[1][0]) {
		if status, ok := got[c.Name]; !ok || status != "pending" {
			t.Errorf("tool %s left status %q (rows %v), want a pending row", c.Name, status, got)
		}
	}

	changed := isoDiff(before.digest, after.digest)
	t.Logf("changed tables: %v", changed)
	for _, name := range changed {
		if !askLoopPermitted[name] {
			t.Errorf("table %s changed in a turn that only proposes; it is not an AI bookkeeping table (ADR 0044 §2)", name)
		}
	}
	for _, name := range []string{"ai_conversations", "ai_messages", "agent_action_proposals"} {
		if !slices.Contains(changed, name) {
			t.Errorf("table %s did not change; the turn recorded nothing", name)
		}
	}
	if after.audit != before.audit {
		t.Errorf("audit_events rows = %d, want %d: a turn that only proposes writes no audit row", after.audit, before.audit)
	}
	for id, row := range before.outbox {
		if after.outbox[id].canonical != row.canonical {
			t.Errorf("outbox_events %s changed", id)
		}
	}
	for id, row := range after.outbox {
		if _, ok := before.outbox[id]; !ok && !uniworkProposalTopics[row.topic] {
			t.Errorf("new outbox_events %s carries topic %q; a turn that only proposes may emit only the usage topics", id, row.topic)
		}
	}
}
