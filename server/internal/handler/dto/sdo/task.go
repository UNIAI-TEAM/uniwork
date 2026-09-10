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
	StartDate     *string   `json:"start_date,omitempty" example:"2026-08-25"`
	DueDate       *string   `json:"due_date,omitempty" example:"2026-08-28"`
	ProjectID     *string   `json:"project_id,omitempty" example:"01J8X4PROJN1P2Q3R4S5T6U7V8"`
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
	ParentID    *string  `json:"parent_id,omitempty" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	Type        string   `json:"type,omitempty" example:"comment"`
	Revision    int64    `json:"revision,omitempty" example:"1"`
	ResolvedAt  *string  `json:"resolved_at,omitempty" example:"2026-08-27T11:00:00Z"`
	CreatedAt   string   `json:"created_at" example:"2026-08-27T10:00:00Z"`
	UpdatedAt   string   `json:"updated_at,omitempty" example:"2026-08-27T10:00:00Z"`
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

// BatchUpdateTasksSDO is POST .../tasks/batch-update.
type BatchUpdateTasksSDO struct {
	Updated int `json:"updated" example:"3"`
}

// BatchDeleteTasksSDO is POST .../tasks/batch-delete.
type BatchDeleteTasksSDO struct {
	Deleted int `json:"deleted" example:"3"`
}

// ChildProgressDTO is one row of child-progress.
type ChildProgressDTO struct {
	ParentTaskID string `json:"parent_task_id" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	Total        int64  `json:"total" example:"4"`
	Done         int64  `json:"done" example:"1"`
}

// ChildProgressListSDO is GET .../tasks/child-progress.
type ChildProgressListSDO struct {
	Progress []ChildProgressDTO `json:"progress"`
}

// TaskDependencyDTO is one task_dependencies row.
type TaskDependencyDTO struct {
	ID              string `json:"id" example:"01J8X4DEPN1P2Q3R4S5T6U7"`
	OrganizationID  string `json:"organization_id" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID     string `json:"workspace_id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	TaskID          string `json:"task_id" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	DependsOnTaskID string `json:"depends_on_task_id" example:"01J8X4TASKN1P2Q3R4S5T6U8"`
	Type            string `json:"type" example:"blocked_by"`
	CreatedAt       string `json:"created_at" example:"2026-09-07T09:00:00Z"`
}

// TaskDependencySDO wraps one dependency.
type TaskDependencySDO struct {
	Dependency TaskDependencyDTO `json:"dependency"`
}

// TableActorRefDTO is an assignee key in a table group value.
type TableActorRefDTO struct {
	Type string `json:"type" example:"member"`
	ID   string `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}

// TableGroupValueDTO is the stable group value for table mode.
type TableGroupValueDTO struct {
	Kind     string            `json:"kind" example:"status"`
	Status   string            `json:"status,omitempty" example:"todo"`
	Priority string            `json:"priority,omitempty" example:"high"`
	Actor    *TableActorRefDTO `json:"actor,omitempty"`
}

// TableGroupDescriptorDTO is one bucket in TableGroupsSDO.
type TableGroupDescriptorDTO struct {
	Key   string             `json:"key" example:"todo"`
	Value TableGroupValueDTO `json:"value"`
	Count int64              `json:"count" example:"3"`
}

// TableGroupsSDO is POST .../tasks/table/groups.
type TableGroupsSDO struct {
	QueryFingerprint string                    `json:"query_fingerprint" example:"a1b2c3d4e5f60718"`
	Total            int64                     `json:"total" example:"6"`
	Groups           []TableGroupDescriptorDTO `json:"groups"`
	NextCursor       *string                   `json:"next_cursor"`
}

// TableRowDTO is one row in TableRowsSDO.
type TableRowDTO struct {
	Task             TaskDTO `json:"task"`
	DirectChildCount int64   `json:"direct_child_count" example:"0"`
}

// TableRowsSDO is POST .../tasks/table/rows.
type TableRowsSDO struct {
	QueryFingerprint string        `json:"query_fingerprint"`
	GroupKey         *string       `json:"group_key" example:"todo"`
	ParentID         *string       `json:"parent_id"`
	Total            int64         `json:"total" example:"3"`
	Rows             []TableRowDTO `json:"rows"`
	BranchTotal      int64         `json:"branch_total" example:"3"`
	NextCursor       *string       `json:"next_cursor"`
}

// TableFacetValueDTO is one facet bucket.
type TableFacetValueDTO struct {
	Key   string `json:"key" example:"todo"`
	Count int64  `json:"count" example:"3"`
}

// TableFacetDTO is one facet dimension.
type TableFacetDTO struct {
	Kind   string               `json:"kind" example:"status"`
	Values []TableFacetValueDTO `json:"values"`
}

// TableFacetsSDO is POST .../tasks/table/facets.
type TableFacetsSDO struct {
	QueryFingerprint string          `json:"query_fingerprint"`
	Total            int64           `json:"total" example:"6"`
	Facets           []TableFacetDTO `json:"facets"`
}
