package sdi

import "encoding/json"

// CreateProjectSDI is POST .../projects.
type CreateProjectSDI struct {
	Title       string                          `json:"title" minLength:"1" example:"Q3 launch"`
	Description *string                         `json:"description"`
	Icon        *string                         `json:"icon"`
	Status      string                          `json:"status" description:"planned|in_progress|paused|completed|cancelled" example:"planned"`
	Priority    string                          `json:"priority" description:"urgent|high|medium|low|none" example:"none"`
	LeadType    *string                         `json:"lead_type" description:"member|agent"`
	LeadID      *string                         `json:"lead_id"`
	StartDate   *string                         `json:"start_date" example:"2026-09-01"`
	DueDate     *string                         `json:"due_date" example:"2026-09-30"`
	Resources   []CreateProjectResourceEmbedSDI `json:"resources"`
}

// CreateProjectResourceEmbedSDI is an optional resource on project create.
type CreateProjectResourceEmbedSDI struct {
	ResourceType string          `json:"resource_type"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	Label        *string         `json:"label"`
	Position     *int32          `json:"position"`
}

// PutProjectSDI is PUT .../projects/{projectID}.
type PutProjectSDI struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Icon        *string `json:"icon"`
	Status      *string `json:"status"`
	Priority    *string `json:"priority"`
	LeadType    *string `json:"lead_type"`
	LeadID      *string `json:"lead_id"`
	StartDate   *string `json:"start_date"`
	DueDate     *string `json:"due_date"`
}

// CreateProjectResourceSDI is POST .../projects/{projectID}/resources.
type CreateProjectResourceSDI struct {
	ResourceType string          `json:"resource_type" example:"github_repo"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	Label        *string         `json:"label"`
	Position     *int32          `json:"position"`
}

// PutProjectResourceSDI is PUT .../projects/{projectID}/resources/{resourceID}.
type PutProjectResourceSDI struct {
	ResourceRef json.RawMessage `json:"resource_ref"`
	Label       *string         `json:"label"`
	Position    *int32          `json:"position"`
}
