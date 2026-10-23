package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The framework for Ask UNI's write tools (spec P3, ADR 0044). A write tool
// never runs in the agent loop: its prepare reads the target, rates the change
// and builds the preview the asker reviews; apply runs later, as the asker, once
// the proposal is confirmed (or auto-applied). Each tool names its inverse, and
// each family registers the inverses it needs in askInverses from its own file.

// The two levels a proposal can be rated (R4). Level 1 may auto-apply in Auto
// mode; level 2 always waits for the asker.
const askLevel1, askLevel2 = "l1", "l2"

// AskProposalField is one field a proposal changes, as the card shows it. From
// and To are readable values (names, labels), never ids.
type AskProposalField struct {
	Field   string   `json:"field"`
	Type    string   `json:"type"` // text | markdown | date | datetime | enum | person | project | labels
	From    any      `json:"from"`
	To      any      `json:"to"`
	Options []string `json:"options,omitempty"`
}

// AskAudience says who sees a change and who is told about it.
type AskAudience struct {
	Visibility   string          `json:"visibility"` // workspace | private | task | document | meeting | room
	RoomMembers  int             `json:"room_members,omitempty"`
	Notifies     []AskContextRef `json:"notifies"`
	NotifiesMore bool            `json:"notifies_more"`
}

// AskProposalPreview is what the card shows before anything is written (R7).
type AskProposalPreview struct {
	Target   AskContextRef      `json:"target"`
	Fields   []AskProposalField `json:"fields"`
	Body     string             `json:"body"`
	Audience AskAudience        `json:"audience"`
	Refs     []int              `json:"refs"`
}

// AskProposalResult is what a tool's apply reports back.
type AskProposalResult struct {
	ObjectID string      `json:"object_id"`
	Href     string      `json:"href"`
	Revision int64       `json:"revision"`
	Changes  []McpChange `json:"changes"`
	Note     string      `json:"note"`
}

// askInverse is how to undo an applied row: the name of an askInverses entry
// and its arguments.
type askInverse struct {
	Op   string          `json:"op"`
	Args json.RawMessage `json:"args"`
}

// askDraftRow is one proposed change, held in memory until the turn ends.
// TargetRevision is the revision prepare read (nil for a new object, or one
// that a {{row:N.id}} reference stands for).
type askDraftRow struct {
	Tool           string
	Args           json.RawMessage
	TargetKind     string
	TargetID       string
	TargetRevision *int64
	Level          string
	Preview        AskProposalPreview
}

type askWriteTool struct {
	ai.Tool
	prepare func(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error)
	apply   func(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error)
	// inverse is the askInverses entry that undoes this tool's apply.
	inverse string
}

// askInverses holds the inverse commands by name. Each tool family adds its own
// in an init, so the registry test can see that every tool's undo exists.
var askInverses = map[string]func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error{}

// askWriteTools is the write half of the agent's registry, in the order of R4.
// Each family adds its tools here.
func (s *AskUNIService) askWriteTools() []askWriteTool {
	return slices.Concat(s.askTaskTools(), s.askProjectTools(), s.askMeetingTools(), s.askDocumentTools(), s.askChatTools())
}

// askToolSchema is the MCP schema of a tool as the agent sees it: no
// workspace_id (the server binds it) and no revision (the server reads it), and
// the arrays of people cut to maxPeople (R5, ADR 0044 §3). Keys come out sorted,
// so the bytes are the same on every build.
func askToolSchema(mcp json.RawMessage, maxPeople int) json.RawMessage {
	var sc map[string]any
	if err := json.Unmarshal(mcp, &sc); err != nil {
		panic("askToolSchema: " + err.Error())
	}
	props, _ := sc["properties"].(map[string]any)
	for _, drop := range []string{"workspace_id", "revision"} {
		delete(props, drop)
	}
	for _, people := range []string{"attendee_ids", "user_ids"} {
		if p, ok := props[people].(map[string]any); ok {
			p["maxItems"] = maxPeople
		}
	}
	if req, ok := sc["required"].([]any); ok {
		kept := make([]any, 0, len(req))
		for _, r := range req {
			if r != "workspace_id" && r != "revision" {
				kept = append(kept, r)
			}
		}
		sc["required"] = kept
	}
	out, _ := json.Marshal(sc)
	return out
}

// askAuditKinds names, per kind of object, the audit resource type and the
// action that creates it (R8).
var askAuditKinds = map[string][2]string{
	"task":     {"task", "task.created"},
	"project":  {"project", "project.created"},
	"document": {"document", "document.created"},
	"meeting":  {"meeting", "meeting.created"},
}

// authoredByAsker says which of ids the asker made and alone touched: the audit
// history holds one creation and every row is the asker's. Anything else is, for
// the taint rules and for rating a change, somebody else's work.
func (s *AskUNIService) authoredByAsker(ctx context.Context, tc ai.ToolContext, kind string, ids []string) (map[string]bool, error) {
	k, ok := askAuditKinds[kind]
	if !ok {
		return nil, fmt.Errorf("ask uni: no audit kind %q", kind)
	}
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.AuditResourcesOnlyBy(ctx, db.AuditResourcesOnlyByParams{
		OrganizationID: tc.OrganizationID, ResourceType: k[0], CreatedAction: k[1], ActorID: tc.ActorID, ResourceIds: ids,
	})
	if err != nil {
		return nil, err
	}
	for _, id := range rows {
		out[id] = true
	}
	return out, nil
}

var askRowRefRe = regexp.MustCompile(`^\{\{row:([0-9]{1,3})\.id\}\}$`)

// askRowRef reads {{row:N.id}}: the id of the object row N of this turn creates.
func askRowRef(v string) (int, bool) {
	m := askRowRefRe.FindStringSubmatch(v)
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// askRowRefs reads the id fields of one call. A field holding {{row:N.id}} must
// name an earlier row (1-based) of the tool that creates that kind of object;
// anything else is the model's to correct. fields maps each id field to the
// create tool that may feed it. It returns the rows named, ascending and once,
// and for each ref'd field the row it names.
func askRowRefs(earlier []askDraftRow, fields map[string]string, values map[string]string) (refs []int, byField map[string]askDraftRow, err error) {
	byField = map[string]askDraftRow{}
	refs = []int{} // serializes as [], never null
	for field, v := range values {
		n, ok := askRowRef(v)
		if !ok {
			continue
		}
		want := fields[field]
		if n < 1 || n > len(earlier) || earlier[n-1].Tool != want {
			return nil, nil, McpInvalidArgs{Msg: fmt.Sprintf("%s must be an id, or {{row:N.id}} naming an earlier %s row of this turn", field, want)}
		}
		byField[field] = earlier[n-1]
		refs = append(refs, n)
	}
	slices.Sort(refs)
	return slices.Compact(refs), byField, nil
}
