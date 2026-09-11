package sdo

import "encoding/json"

// TaskViewDTO is one saved task view.
type TaskViewDTO struct {
	ID                string          `json:"id"`
	OrganizationID    string          `json:"organization_id"`
	WorkspaceID       string          `json:"workspace_id"`
	OwnerID           string          `json:"owner_id"`
	Name              string          `json:"name" example:"Open backlog"`
	ScopeType         string          `json:"scope_type" example:"workspace"`
	ScopeID           *string         `json:"scope_id"`
	ScopeVariant      *string         `json:"scope_variant"`
	Visibility        string          `json:"visibility" example:"private"`
	DefinitionVersion int32           `json:"definition_version"`
	Query             json.RawMessage `json:"query"`
	Display           json.RawMessage `json:"display"`
	Revision          int64           `json:"revision"`
	CreatedAt         string          `json:"created_at"`
	UpdatedAt         string          `json:"updated_at"`
}

// TaskViewListSDO is GET .../task-views.
type TaskViewListSDO struct {
	Views []TaskViewDTO `json:"views"`
	Total int           `json:"total"`
}

// TaskViewSDO wraps one view.
type TaskViewSDO struct {
	View TaskViewDTO `json:"view"`
}

// TaskViewPreferenceSDO is GET/PUT .../task-view-preferences.
type TaskViewPreferenceSDO struct {
	ScopeType string          `json:"scope_type"`
	ScopeID   string          `json:"scope_id"`
	Prefs     json.RawMessage `json:"prefs"`
	UpdatedAt string          `json:"updated_at,omitempty"`
}

// TaskPinDTO is one sidebar pin.
type TaskPinDTO struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	WorkspaceID    string  `json:"workspace_id"`
	UserID         string  `json:"user_id"`
	ItemType       string  `json:"item_type" example:"task"`
	ItemID         string  `json:"item_id"`
	Position       float64 `json:"position"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// TaskPinListSDO is GET .../pins.
type TaskPinListSDO struct {
	Pins  []TaskPinDTO `json:"pins"`
	Total int          `json:"total"`
}

// TaskPinSDO wraps one pin.
type TaskPinSDO struct {
	Pin TaskPinDTO `json:"pin"`
}
