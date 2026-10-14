package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

func TestDecodeIntoRefusesWhatTheModelCanFix(t *testing.T) {
	type in struct {
		Title string         `json:"title"`
		Due   mcpOpt[string] `json:"due_date"`
		Tags  []string       `json:"label_ids"`
	}
	var v in
	if err := decodeInto(json.RawMessage(`{"title":"A","due_date":null}`), &v); err != nil {
		t.Fatal(err)
	}
	if v.Title != "A" || !v.Due.Set || !v.Due.Null || v.Due.ptr() != nil || *v.Due.ptr2() != nil {
		t.Fatalf("null due_date read as %+v", v.Due)
	}
	v = in{}
	if err := decodeInto(json.RawMessage(`{"title":"A"}`), &v); err != nil || v.Due.Set || v.Due.ptr2() != nil {
		t.Fatalf("absent due_date read as %+v (%v)", v.Due, err)
	}
	v = in{}
	if err := decodeInto(json.RawMessage(`{"due_date":"2026-10-20"}`), &v); err != nil || **v.Due.ptr2() != "2026-10-20" {
		t.Fatalf("set due_date read as %+v (%v)", v.Due, err)
	}
	for raw, want := range map[string]string{
		`{"titel":"A"}`:     "unknown field titel",
		`{"title":7}`:       "wrong type",
		`[1,2]`:             "JSON object",
		`{"title":"A"} {}`:  "one JSON object",
		`{"label_ids":"x"}`: "wrong type",
	} {
		err := decodeInto(json.RawMessage(raw), &in{})
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, want) {
			t.Errorf("decodeInto(%s) = %v, want McpInvalidArgs containing %q", raw, err, want)
		}
	}
}

func TestMcpChangesDropsEqualPairsAndCutsLongText(t *testing.T) {
	long := strings.Repeat("ê", 2000)
	got := mcpChanges(
		McpChange{Field: "title", From: "A", To: "A"},
		McpChange{Field: "status", From: "todo", To: "done"},
		McpChange{Field: "description", From: long, To: "short"},
	)
	if len(got) != 2 || got[0].Field != "status" {
		t.Fatalf("changes = %+v", got)
	}
	if from := got[1].From.(string); len([]rune(from)) != mcpMaxHitRunes || !strings.HasSuffix(from, mcpHitCut) {
		t.Fatalf("long value not cut to %d runes: %d", mcpMaxHitRunes, len([]rune(from)))
	}
}

func TestMcpMapError(t *testing.T) {
	cases := []struct {
		in       error
		notFound bool
		code     string
		invalid  bool
	}{
		{ErrForbidden, true, "", false},
		{errMemberDeactivated(), true, "", false},
		{CheckTaskRevision(3, 5), false, "revision_conflict", false},
		{CodedError{Code: "active_duplicate_task", Msg: "x"}, false, "active_duplicate_task", false},
		{CodedError{Code: "quota_exceeded", Err: ErrQuotaExceeded}, false, "quota_exceeded", false},
		{Invalid("tiêu đề không được để trống"), false, "", true},
		{errInvalidState(), false, "invalid_meeting_state", false},
		{ErrConflict, false, "conflict", false},
	}
	for _, c := range cases {
		got := mcpMapError(c.in)
		var te McpToolError
		var bad McpInvalidArgs
		switch {
		case c.notFound:
			if !errors.Is(got, ErrNotFound) {
				t.Errorf("%v → %v, want ErrNotFound", c.in, got)
			}
		case c.invalid:
			if !errors.As(got, &bad) || bad.Msg != c.in.Error() {
				t.Errorf("%v → %v, want McpInvalidArgs", c.in, got)
			}
		default:
			if !errors.As(got, &te) || te.Code != c.code || te.Msg == "" {
				t.Errorf("%v → %#v, want McpToolError %s", c.in, got, c.code)
			}
		}
	}
	if got := mcpMapError(CheckTaskRevision(3, 5)); !strings.Contains(got.Error(), "5") {
		t.Errorf("revision_conflict does not name the current revision: %v", got)
	}
	plain := errors.New("db down")
	if mcpMapError(plain) != plain {
		t.Error("an infrastructure error was rewritten")
	}
}

// The typed constructors wire decodeInto, the principal and mcpMapError the
// same way for every tool, so one fake run func covers the lot.
func TestMcpTypedToolsDecodeRunAndMapErrors(t *testing.T) {
	type in struct {
		Title string `json:"title"`
	}
	schema := json.RawMessage(`{"type":"object"}`)
	run := func(_ context.Context, p McpPrincipal, a in) (any, error) {
		if a.Title == "" {
			return nil, ErrForbidden
		}
		return McpWriteResult{Item: p.UserID + ":" + a.Title}, nil
	}
	read := mcpReadTool("r", "R", "Reads.", schema, run)
	write := mcpWriteTool("w", "W", "Writes.", "set it back by hand", true, schema, run)
	if read.Kind != ai.ToolRead || read.Destructive || read.Undo != "" {
		t.Errorf("read tool carries write metadata: %+v", read)
	}
	if write.Kind != ai.ToolWrite || !write.Destructive || write.Undo != "set it back by hand" || !strings.Contains(write.Description, "To undo: set it back by hand.") {
		t.Errorf("write tool metadata = %+v", write)
	}
	tc := ai.ToolContext{ActorID: "u1", OrganizationID: "o1"}
	out, err := write.Handle(context.Background(), tc, json.RawMessage(`{"title":"A"}`))
	if err != nil || string(out) != `{"item":"u1:A"}` {
		t.Fatalf("run = %s, %v", out, err)
	}
	if _, err := write.Handle(context.Background(), tc, json.RawMessage(`{}`)); !errors.Is(err, ErrNotFound) {
		t.Errorf("a refusal reached the model as %v, want ErrNotFound", err)
	}
	var bad McpInvalidArgs
	if _, err := read.Handle(context.Background(), tc, json.RawMessage(`{"x":1}`)); !errors.As(err, &bad) {
		t.Errorf("an unknown field reached the model as %v, want McpInvalidArgs", err)
	}
}
