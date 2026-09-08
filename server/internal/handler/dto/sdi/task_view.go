package sdi

import "encoding/json"

// CreateTaskViewSDI is POST .../task-views.
type CreateTaskViewSDI struct {
	Name              string          `json:"name" minLength:"1" example:"Open backlog"`
	ScopeType         string          `json:"scope_type" description:"workspace|my|project" example:"workspace"`
	ScopeID           *string         `json:"scope_id" description:"Bắt buộc khi scope_type=project"`
	ScopeVariant      *string         `json:"scope_variant"`
	Visibility        string          `json:"visibility" description:"private|workspace" example:"private"`
	DefinitionVersion int32           `json:"definition_version" example:"1"`
	Query             json.RawMessage `json:"query"`
	Display           json.RawMessage `json:"display"`
}

// PatchTaskViewSDI is PATCH .../task-views/{id}.
type PatchTaskViewSDI struct {
	Name             *string         `json:"name"`
	Visibility       *string         `json:"visibility"`
	ScopeVariant     *string         `json:"scope_variant"`
	Query            json.RawMessage `json:"query"`
	Display          json.RawMessage `json:"display"`
	ExpectedRevision int64           `json:"expected_revision" example:"1"`
}

// PutTaskViewPreferenceSDI is PUT .../task-view-preferences.
type PutTaskViewPreferenceSDI struct {
	ScopeType string          `json:"scope_type" example:"workspace"`
	ScopeID   *string         `json:"scope_id"`
	Prefs     json.RawMessage `json:"prefs"`
}

// CreatePinSDI is POST .../pins.
type CreatePinSDI struct {
	ItemType string `json:"item_type" description:"task|project|task_view" example:"task"`
	ItemID   string `json:"item_id" example:"01J8X4TSK0N1P2Q3R4S5T6U7V8"`
}

// ReorderPinsSDI is PUT .../pins/reorder.
type ReorderPinsSDI struct {
	Items []ReorderPinItemSDI `json:"items"`
}

// ReorderPinItemSDI is one pin position update.
type ReorderPinItemSDI struct {
	ID       string  `json:"id"`
	Position float64 `json:"position"`
}
