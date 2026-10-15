package service

import (
	"errors"
	"fmt"
)

// McpToolError is a refusal the model can read and act on: a stale revision,
// a duplicate, a closed write switch. The transport shows it as
// "code: message"; it never carries another tenant's data.
type McpToolError struct {
	Code string
	Msg  string
}

func (e McpToolError) Error() string { return e.Code + ": " + e.Msg }

// mcpToolMessages is what the model reads for a service refusal it can act
// on. Codes absent here pass with the service's own message.
var mcpToolMessages = map[string]string{
	"active_duplicate_task":     "an active task with this title already exists here; read it instead of creating another",
	"duplicate_project_title":   "a project with this title already exists in the workspace",
	"assignee_not_member":       "that person is not a member of this workspace; call list_members for who can be assigned",
	"lead_not_member":           "that person is not a member of this workspace; call list_members for who can lead it",
	"quota_exceeded":            "the organization has reached its plan limit for this",
	"parent_cycle":              "that parent would make the task its own ancestor",
	"cross_workspace_reference": "tasks, projects and parents must all be in the same workspace",
	"invalid_meeting_state":     "the meeting's current status does not allow this",
	"not_meeting_host":          "only the meeting's host or a workspace admin may do this",
	"participant_removed":       "that person was removed from this meeting earlier and cannot be invited to it again",
	"not_project_editor":        "only the project's creator, its lead or a workspace admin may edit it",
	"conflict":                  "it changed while this call ran; read it again and retry",
	// The service words these for its screens, in Vietnamese; the model reads English.
	"document_parent_kind": "a page goes at the top level, inside a folder or inside another page, never inside a file",
	"document_too_deep":    "documents nest at most 5 levels; put it higher up in the tree",
}

// mcpMapError turns a service error into what a tool returns. Refusals that
// could tell a model which ids exist become ErrNotFound (hidden); a stale
// revision names the current one; a validation message passes as
// McpInvalidArgs; known codes become McpToolError; anything else is left
// for the transport to call "temporarily unavailable".
func mcpMapError(err error) error {
	if err = hidden(err); errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	var invalid ValidationError
	if errors.As(err, &invalid) {
		return McpInvalidArgs(invalid)
	}
	var ce CodedError
	if errors.As(err, &ce) {
		if ce.Code == "revision_conflict" {
			current := ce.Fields["want"]
			if current == nil {
				current = ce.Fields["current_revision"]
			}
			return McpToolError{Code: "revision_conflict", Msg: fmt.Sprintf("someone changed it since you read it; the current revision is %v, read it again before writing", current)}
		}
		if msg, ok := mcpToolMessages[ce.Code]; ok {
			return McpToolError{Code: ce.Code, Msg: msg}
		}
		if errors.Is(ce, ErrQuotaExceeded) {
			return McpToolError{Code: "quota_exceeded", Msg: mcpToolMessages["quota_exceeded"]}
		}
		return McpToolError{Code: ce.Code, Msg: ce.Error()}
	}
	switch {
	case errors.Is(err, ErrQuotaExceeded):
		return McpToolError{Code: "quota_exceeded", Msg: mcpToolMessages["quota_exceeded"]}
	case errors.Is(err, ErrConflict):
		return McpToolError{Code: "conflict", Msg: mcpToolMessages["conflict"]}
	}
	return err
}
