package sdo

// TaskSDO wraps one task.
type TaskSDO struct {
	Task TaskDTO `json:"task"`
}

// TaskListSDO is GET /api/v1/workspaces/{workspaceID}/tasks.
type TaskListSDO struct {
	Tasks []TaskDTO `json:"tasks"`
}

type TaskDTO struct {
	ID             string  `json:"id" description:"ULID công việc" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	OrganizationID string  `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID    string  `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Number         int64   `json:"number" example:"42"`
	Identifier     string  `json:"identifier" example:"ALP-42"`
	Revision       int64   `json:"revision" example:"1"`
	Title          string  `json:"title" example:"Chuẩn bị standup"`
	Description    string  `json:"description" example:"Agenda và ghi chú"`
	Status         string  `json:"status" example:"todo"`
	Priority       string  `json:"priority" example:"medium"`
	AssigneeID     *string `json:"assignee_id,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	// AssigneeKind pairs with AssigneeID (ADR 0007); Assignee is the resolved
	// actor when the id is known.
	AssigneeKind  string    `json:"assignee_kind" description:"human hoặc agent" example:"human"`
	Assignee      *ActorDTO `json:"assignee,omitempty"`
	DueDate       *string   `json:"due_date,omitempty" example:"2026-08-28"`
	Position      float64   `json:"position" example:"0"`
	Kind          string    `json:"kind" description:"user hoặc welcome" example:"user"`
	CreatedBy     string    `json:"created_by" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedByKind string    `json:"created_by_kind" description:"human, agent hoặc system" example:"human"`
	CreatedAt     string    `json:"created_at" example:"2026-08-27T09:00:00Z"`
	UpdatedAt     string    `json:"updated_at" example:"2026-08-27T09:00:00Z"`
}

type CommentDTO struct {
	ID          string   `json:"id" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	TaskID      string   `json:"task_id" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	AuthorID    string   `json:"author_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	AuthorKind  string   `json:"author_kind" description:"human, agent hoặc system" example:"human"`
	Author      ActorDTO `json:"author"`
	Body        string   `json:"body" example:"Đã review, merge được."`
	CreatedAt   string   `json:"created_at" example:"2026-08-27T10:00:00Z"`
	DisplayName string   `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL   string   `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
}

// CommentSDO wraps one comment.
type CommentSDO struct {
	Comment CommentDTO `json:"comment"`
}

// CommentListSDO is GET /api/v1/tasks/{taskID}/comments.
type CommentListSDO struct {
	Comments []CommentDTO `json:"comments"`
}

// TaskQueryPageSDO is POST /api/v1/workspaces/{workspaceID}/tasks/query.
type TaskQueryPageSDO struct {
	Tasks  []TaskDTO `json:"tasks"`
	Total  int64     `json:"total" example:"42"`
	Limit  int32     `json:"limit" example:"50"`
	Offset int32     `json:"offset" example:"0"`
}

// TaskGroupDTO is one bucket in a grouped list.
type TaskGroupDTO struct {
	Key   string    `json:"key" example:"todo"`
	Tasks []TaskDTO `json:"tasks"`
}

// TaskGroupedSDO is GET /api/v1/workspaces/{workspaceID}/tasks/grouped.
type TaskGroupedSDO struct {
	Groups []TaskGroupDTO `json:"groups"`
}
