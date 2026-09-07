package sdo

import "encoding/json"

// ProjectDTO is one workspace project.
type ProjectDTO struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	WorkspaceID    string  `json:"workspace_id"`
	Title          string  `json:"title" example:"Q3 launch"`
	Description    string  `json:"description"`
	Icon           *string `json:"icon"`
	Status         string  `json:"status" example:"planned"`
	Priority       string  `json:"priority" example:"none"`
	LeadType       *string `json:"lead_type"`
	LeadID         *string `json:"lead_id"`
	StartDate      *string `json:"start_date" example:"2026-09-01"`
	DueDate        *string `json:"due_date" example:"2026-09-30"`
	Revision       int64   `json:"revision"`
	TaskCount      int64   `json:"task_count"`
	DoneCount      int64   `json:"done_count"`
	ResourceCount  int64   `json:"resource_count"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// ProjectListSDO is GET .../projects and .../projects/search.
type ProjectListSDO struct {
	Projects []ProjectDTO `json:"projects"`
	Total    int          `json:"total"`
}

// ProjectSDO wraps one project.
type ProjectSDO struct {
	Project ProjectDTO `json:"project"`
}

// ProjectResourceDTO is one project resource row.
type ProjectResourceDTO struct {
	ID           string          `json:"id"`
	ProjectID    string          `json:"project_id"`
	WorkspaceID  string          `json:"workspace_id"`
	ResourceType string          `json:"resource_type" example:"github_repo"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	Label        *string         `json:"label"`
	Position     int32           `json:"position"`
	CreatedAt    string          `json:"created_at"`
	UpdatedAt    string          `json:"updated_at"`
}

// ProjectResourceListSDO is GET .../projects/{projectID}/resources.
type ProjectResourceListSDO struct {
	Resources []ProjectResourceDTO `json:"resources"`
	Total     int                  `json:"total"`
}

// ProjectResourceSDO wraps one resource.
type ProjectResourceSDO struct {
	Resource ProjectResourceDTO `json:"resource"`
}
