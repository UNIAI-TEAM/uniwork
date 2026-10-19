package sdo

// TaskStatusDTO is one workspace status catalog row.
type TaskStatusDTO struct {
	ID             string  `json:"id" example:"01J8X4STS0N1P2Q3R4S5T6U7V8"`
	OrganizationID string  `json:"organization_id"`
	WorkspaceID    string  `json:"workspace_id"`
	Key            string  `json:"key" example:"todo"`
	Name           string  `json:"name" example:"Todo"`
	Description    string  `json:"description"`
	Category       string  `json:"category" example:"todo"`
	Color          string  `json:"color" example:"#6b7280"`
	Icon           string  `json:"icon" description:"Glyph: rỗng = theo category" example:""`
	IsSystem       bool    `json:"is_system"`
	Customized     bool    `json:"customized" description:"Trạng thái có sẵn đã được admin sửa tên, mô tả, màu hoặc biểu tượng"`
	Position       float64 `json:"position"`
	ArchivedAt     *string `json:"archived_at,omitempty"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// TaskStatusListSDO is GET .../task-statuses.
type TaskStatusListSDO struct {
	Statuses   []TaskStatusDTO `json:"statuses"`
	Categories []string        `json:"categories"`
	Total      int             `json:"total"`
}

// TaskStatusSDO wraps one status.
type TaskStatusSDO struct {
	Status TaskStatusDTO `json:"status"`
}

// TaskLabelDTO is one workspace label.
type TaskLabelDTO struct {
	ID             string  `json:"id"`
	OrganizationID string  `json:"organization_id"`
	WorkspaceID    string  `json:"workspace_id"`
	Name           string  `json:"name" example:"Bug"`
	Description    string  `json:"description"`
	Color          string  `json:"color" example:"#ef4444"`
	UsageCount     int64   `json:"usage_count"`
	ArchivedAt     *string `json:"archived_at,omitempty"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// TaskLabelListSDO is GET .../task-labels or GET .../tasks/{taskID}/labels.
type TaskLabelListSDO struct {
	Labels []TaskLabelDTO `json:"labels"`
	Total  int            `json:"total"`
}

// TaskLabelLinkDTO is one label on one task.
type TaskLabelLinkDTO struct {
	TaskID  string `json:"task_id" description:"ULID công việc" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	LabelID string `json:"label_id" description:"ULID nhãn" example:"01J8X4LBL0N1P2Q3R4S5T6U7V8"`
}

// TaskLabelLinkListSDO is GET .../task-label-links.
type TaskLabelLinkListSDO struct {
	Links []TaskLabelLinkDTO `json:"links"`
}

// TaskLabelSDO wraps one label.
type TaskLabelSDO struct {
	Label TaskLabelDTO `json:"label"`
}

// TaskPropertyDTO is one custom property definition.
type TaskPropertyDTO struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	WorkspaceID    string         `json:"workspace_id"`
	Name           string         `json:"name" example:"Story Points"`
	Type           string         `json:"type" example:"number"`
	Description    string         `json:"description"`
	Config         map[string]any `json:"config"`
	Position       float64        `json:"position"`
	UsageCount     int64          `json:"usage_count"`
	ArchivedAt     *string        `json:"archived_at,omitempty"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      string         `json:"updated_at"`
}

// TaskPropertyListSDO is GET .../task-properties.
type TaskPropertyListSDO struct {
	Properties []TaskPropertyDTO `json:"properties"`
	Total      int               `json:"total"`
}

// TaskPropertySDO wraps one property.
type TaskPropertySDO struct {
	Property TaskPropertyDTO `json:"property"`
}
