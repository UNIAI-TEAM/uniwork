package sdi

// CreateTaskFromMessageSDI is POST .../chat/messages/{messageID}/tasks.
type CreateTaskFromMessageSDI struct {
	Title        string   `json:"title,omitempty" description:"Task title; defaults to the first 120 characters of the message" example:"Sửa bug login"`
	Description  string   `json:"description,omitempty" description:"Optional task description; defaults to the message body with chat provenance" example:"Chốt demo thứ Sáu với An"`
	Status       string   `json:"status,omitempty" description:"Task status key; defaults to todo" example:"todo"`
	ProjectID    *string  `json:"project_id,omitempty" description:"Optional project id in the same workspace" example:"01J8X4PRJ0N1P2Q3R4S5T6U7V8"`
	AssigneeID   *string  `json:"assignee_id,omitempty" description:"Optional assignee user or agent id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	AssigneeKind string   `json:"assignee_kind,omitempty" description:"human or agent" example:"human"`
	StartDate    *string  `json:"start_date,omitempty" description:"Optional YYYY-MM-DD start date" example:"2026-09-18"`
	DueDate      *string  `json:"due_date,omitempty" description:"Optional YYYY-MM-DD due date" example:"2026-09-20"`
	LabelIDs     []string `json:"label_ids,omitempty" description:"Optional workspace label ids" example:"[\"01J8X4LBL0N1P2Q3R4S5T6U7V8\"]"`
	SyncThread   bool     `json:"sync_thread,omitempty" description:"When true, also link the message thread to the new task" example:"true"`
	Priority     string   `json:"priority,omitempty" description:"Task priority; defaults to medium" example:"medium"`
}

// CreateChatMessageLinkSDI is POST .../chat/messages/{messageID}/links.
type CreateChatMessageLinkSDI struct {
	TargetType string `json:"target_type" description:"Link target type; task in this release" example:"task"`
	TargetID   string `json:"target_id" description:"Target entity id" example:"01J8X4TSK0N1P2Q3R4S5T6U7V8"`
}

// SyncThreadTaskSDI is POST .../chat/threads/{messageID}/task-sync.
type SyncThreadTaskSDI struct {
	TaskID    string `json:"task_id" description:"Task id to sync with the thread" example:"01J8X4TSK0N1P2Q3R4S5T6U7V8"`
	Direction string `json:"direction,omitempty" description:"both or chat_to_task; defaults to both" example:"both"`
}
