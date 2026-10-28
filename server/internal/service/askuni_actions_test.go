package service

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The invariants every Ask UNI write tool keeps, over whatever the registry
// holds (ADR 0010 §3, ADR 0044): a later task pins the full catalogue.
func TestAskUniWriteToolsDeclareLevelAndUndo(t *testing.T) {
	low := map[string]bool{"create_task": true, "update_task": true, "create_document": true}
	tools := (&AskUNIService{}).askWriteTools()
	if len(tools) == 0 {
		t.Fatal("no write tools")
	}
	for _, tool := range tools {
		if tool.Kind != ai.ToolWrite || tool.prepare == nil || tool.apply == nil || tool.inverse == "" || tool.Handle != nil {
			t.Errorf("%s: incomplete write tool", tool.Name)
		}
		if _, ok := askInverses[tool.inverse]; !ok {
			t.Errorf("%s: inverse %q is not registered", tool.Name, tool.inverse)
		}
		if (tool.Risk == ai.RiskLow) != low[tool.Name] {
			t.Errorf("%s: risk %s", tool.Name, tool.Risk)
		}
		if strings.HasPrefix(tool.Name, "delete_") || strings.HasPrefix(tool.Name, "remove_") {
			t.Errorf("%s: a delete tool", tool.Name)
		}
		var sc struct {
			Properties map[string]struct {
				MaxItems *int `json:"maxItems"`
			} `json:"properties"`
		}
		if err := json.Unmarshal(tool.Schema, &sc); err != nil {
			t.Fatalf("%s: schema: %v", tool.Name, err)
		}
		for _, banned := range []string{"workspace_id", "revision"} {
			if _, ok := sc.Properties[banned]; ok {
				t.Errorf("%s: schema takes %s", tool.Name, banned)
			}
		}
		for _, people := range []string{"attendee_ids", "user_ids"} {
			if p, ok := sc.Properties[people]; ok && (p.MaxItems == nil || *p.MaxItems > 10) {
				t.Errorf("%s: %s is not capped at 10", tool.Name, people)
			}
		}
	}
}

func TestAskToolSchemaStripsWorkspaceAndRevision(t *testing.T) {
	got := askToolSchema(json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"revision":{"type":"integer"},"user_ids":{"type":"array","maxItems":50}},"required":["workspace_id","revision","user_ids"]}`), 10)
	want := `{"properties":{"user_ids":{"maxItems":10,"type":"array"}},"required":["user_ids"],"type":"object"}`
	if string(got) != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestAskRowRef(t *testing.T) {
	for in, want := range map[string]int{"{{row:2.id}}": 2, "{{row:10.id}}": 10} {
		if n, ok := askRowRef(in); !ok || n != want {
			t.Errorf("%s = %d, %v", in, n, ok)
		}
	}
	for _, in := range []string{"", "row:2.id", "{{row:0.id}}x", "{{row:x.id}}", " {{row:1.id}}", "{{row:1.name}}"} {
		if _, ok := askRowRef(in); ok {
			t.Errorf("%q read as a ref", in)
		}
	}
}

// The write registry is exactly the 16 tools of R4, in that order: the order is
// part of the cache prefix.
func TestAskUniWriteToolCatalogue(t *testing.T) {
	want := []string{
		"create_task", "update_task", "add_comment", "create_project", "update_project",
		"schedule_meeting", "update_meeting", "invite_to_meeting", "cancel_meeting", "restore_meeting",
		"create_document", "update_document", "add_document_comment", "create_office_document", "save_attachment_template", "send_chat_message",
	}
	var got []string
	for _, tool := range (&AskUNIService{}).askWriteTools() {
		got = append(got, tool.Name)
	}
	if !slices.Equal(got, want) {
		t.Errorf("write tools = %v\nwant %v", got, want)
	}
}
