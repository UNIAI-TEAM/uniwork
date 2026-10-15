package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// decodeInto reads a tool's arguments into a typed struct. Unknown fields
// and wrong types come back as McpInvalidArgs the model can fix.
func decodeInto(input json.RawMessage, into any) error {
	trimmed := bytes.TrimSpace(input)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		trimmed = []byte("{}")
	}
	if trimmed[0] != '{' {
		return McpInvalidArgs{Msg: "arguments must be a JSON object"}
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		var typ *json.UnmarshalTypeError
		if errors.As(err, &typ) {
			return McpInvalidArgs{Msg: "field " + typ.Field + " has the wrong type"}
		}
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			return McpInvalidArgs{Msg: "unknown field " + strings.Trim(field, `"`)}
		}
		return McpInvalidArgs{Msg: "arguments must be a JSON object"}
	}
	// More() is false before a stray } or ], so ask for a second value and
	// require the end of input instead.
	if err := dec.Decode(&json.RawMessage{}); !errors.Is(err, io.EOF) {
		return McpInvalidArgs{Msg: "arguments must be one JSON object"}
	}
	return nil
}

// mcpOpt is a tool field that may be absent (leave it), null (clear it) or
// a value. The services take the same three states as **T.
type mcpOpt[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (o *mcpOpt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(bytes.TrimSpace(b)) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.Value)
}

// ptr is the value or nil; absent and null both read as nil.
func (o mcpOpt[T]) ptr() *T {
	if !o.Set || o.Null {
		return nil
	}
	v := o.Value
	return &v
}

// ptr2 is nil for absent, a pointer to nil for null, else the value.
func (o mcpOpt[T]) ptr2() **T {
	if !o.Set {
		return nil
	}
	if o.Null {
		var none *T
		return &none
	}
	v := o.Value
	p := &v
	return &p
}

// McpChange is one field a write changed, for the model to report and undo.
type McpChange struct {
	Field string `json:"field"`
	From  any    `json:"from"`
	To    any    `json:"to"`
}

// mcpChanges keeps the pairs that differ and cuts long text values to the
// length of a search hit.
func mcpChanges(pairs ...McpChange) []McpChange {
	out := []McpChange{}
	for _, c := range pairs {
		if reflect.DeepEqual(c.From, c.To) {
			continue
		}
		if s, ok := c.From.(string); ok {
			c.From = capRunes(s, mcpMaxHitRunes, mcpHitCut)
		}
		if s, ok := c.To.(string); ok {
			c.To = capRunes(s, mcpMaxHitRunes, mcpHitCut)
		}
		out = append(out, c)
	}
	return out
}

// mcpDescriptionUndoable refuses a description an update tool could not put
// back by sending changes.from: a new one longer than mcpMaxItemRunes, or,
// when the call replaces it, a current one longer than that, which the read
// tools show cut. Before the record is read, current is "": only the new one
// is checked.
func mcpDescriptionUndoable(next mcpOpt[string], current string) error {
	if utf8.RuneCountInString(next.Value) > mcpMaxItemRunes {
		return McpInvalidArgs{Msg: fmt.Sprintf("description holds at most %d characters here; a longer one could not be undone", mcpMaxItemRunes)}
	}
	if next.Set && utf8.RuneCountInString(current) > mcpMaxItemRunes {
		return McpInvalidArgs{Msg: "the description is too long to replace safely here; edit it in UniWork"}
	}
	return nil
}

// McpWriteResult is what every write tool returns: the record after the
// write, its new revision, what changed, and a note when only part of a
// multi-step write went through.
type McpWriteResult struct {
	Item     any         `json:"item"`
	Revision int64       `json:"revision,omitempty"` // a comment has none
	Changes  []McpChange `json:"changes,omitempty"`
	Note     string      `json:"note,omitempty"`
}

func mcpTypedTool[In any](name, title, desc string, kind ai.ToolKind, destructive bool, undo string, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool {
	return ai.Tool{Name: name, Title: title, Description: desc + mcpUntrusted, Kind: kind, Risk: ai.RiskLow, Destructive: destructive, Undo: undo, Schema: schema,
		Handle: func(ctx context.Context, tc ai.ToolContext, input json.RawMessage) (json.RawMessage, error) {
			var in In
			if err := decodeInto(input, &in); err != nil {
				return nil, err
			}
			out, err := run(ctx, principalOf(tc), in)
			if err != nil {
				return nil, mcpMapError(err)
			}
			return json.Marshal(out)
		}}
}

// mcpReadTool is a tool with typed arguments that only reads.
func mcpReadTool[In any](name, title, desc string, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool {
	return mcpTypedTool(name, title, desc, ai.ToolRead, false, "", schema, run)
}

// mcpWriteTool is a write tool (ADR 0033). desc says what it changes and who
// sees it; undo is how a person reverses it.
func mcpWriteTool[In any](name, title, desc, undo string, destructive bool, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool {
	return mcpTypedTool(name, title, desc+" To undo: "+undo+".", ai.ToolWrite, destructive, undo, schema, run)
}
