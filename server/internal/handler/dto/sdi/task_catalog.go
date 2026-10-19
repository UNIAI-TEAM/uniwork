package sdi

import "encoding/json"

// CreateTaskStatusSDI is POST .../task-statuses.
type CreateTaskStatusSDI struct {
	Key         string `json:"key" description:"Key bất biến; bỏ trống thì sinh từ name" example:"waiting_qa"`
	Name        string `json:"name" minLength:"1" example:"Waiting QA"`
	Description string `json:"description" example:"Chờ QA"`
	Category    string `json:"category" description:"backlog|todo|in_progress|in_review|done|blocked|cancelled" example:"in_review"`
	Color       string `json:"color" example:"#22c55e"`
	Icon        string `json:"icon" description:"Glyph: rỗng = theo category, hoặc backlog|todo|in_progress|in_review|done|blocked|cancelled" example:"in_progress"`
}

// PatchTaskStatusSDI is PATCH .../task-statuses/{id}.
type PatchTaskStatusSDI struct {
	Name        *string  `json:"name" example:"Waiting QA"`
	Description *string  `json:"description"`
	Color       *string  `json:"color" example:"#22c55e"`
	Icon        *string  `json:"icon" description:"Glyph: rỗng = theo category" example:"in_progress"`
	Category    *string  `json:"category" description:"Chuyển sang category khác; trạng thái xuống cuối category mới" example:"done"`
	Position    *float64 `json:"position" example:"1"`
}

// ReorderTaskStatusesSDI is PATCH .../task-statuses/reorder.
type ReorderTaskStatusesSDI struct {
	Group string   `json:"group" description:"not_started|started|completed|closed" example:"started"`
	IDs   []string `json:"ids" description:"Mọi trạng thái active trong nhóm (kể cả hệ thống), theo thứ tự mới"`
}

// CreateTaskLabelSDI is POST .../task-labels.
type CreateTaskLabelSDI struct {
	Name        string `json:"name" minLength:"1" example:"Bug"`
	Description string `json:"description"`
	Color       string `json:"color" example:"#ef4444"`
}

// PutTaskLabelSDI is PUT .../task-labels/{id}.
type PutTaskLabelSDI struct {
	Name        *string `json:"name" example:"Bug"`
	Description *string `json:"description"`
	Color       *string `json:"color" example:"#ef4444"`
}

// AttachTaskLabelSDI is POST .../tasks/{taskID}/labels.
type AttachTaskLabelSDI struct {
	LabelID string `json:"label_id" example:"01J8X4LBL0N1P2Q3R4S5T6U7V8"`
}

// CreateTaskPropertySDI is POST .../task-properties.
type CreateTaskPropertySDI struct {
	Name        string          `json:"name" minLength:"1" example:"Story Points"`
	Type        string          `json:"type" description:"text|number|select|multi_select|date|checkbox|url" example:"number"`
	Description string          `json:"description"`
	Config      json.RawMessage `json:"config"`
}

// PatchTaskPropertySDI is PATCH .../task-properties/{id}.
type PatchTaskPropertySDI struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	Config      json.RawMessage `json:"config"`
	Archived    *bool           `json:"archived"`
}

// PutTaskPropertyValueSDI is PUT .../tasks/{taskID}/properties/{propertyID}.
type PutTaskPropertyValueSDI struct {
	Value json.RawMessage `json:"value"`
}
