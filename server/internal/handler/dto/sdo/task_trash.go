package sdo

// TaskTrashSDO is DELETE /tasks/{taskID} and POST /tasks/{taskID}/restore:
// the batch that moved and the rows in it (the task and its subtasks).
type TaskTrashSDO struct {
	TrashBatchID string   `json:"trash_batch_id" description:"Lô thùng rác của thao tác" example:"01J8X4BATCHN1P2Q3R4S5T6U"`
	IDs          []string `json:"ids" description:"ULID các công việc trong lô" example:"[\"01J8X4TASKN1P2Q3R4S5T6U7\"]"`
}

// TaskTrashItemDTO is one batch root in the task trash.
type TaskTrashItemDTO struct {
	ID         string `json:"id" description:"ULID công việc gốc của lô" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	Identifier string `json:"identifier" description:"Mã công việc PREFIX-N" example:"UNI-12"`
	Title      string `json:"title" example:"Soạn hợp đồng"`
	TrashedAt  string `json:"trashed_at" description:"RFC 3339" example:"2026-10-26T09:00:00Z"`
	TrashedBy  string `json:"trashed_by" description:"ULID người xoá" example:"01J8X4USERN1P2Q3R4S5T6U7"`
	PurgeAfter string `json:"purge_after" description:"RFC 3339; sau mốc này công việc bị xoá vĩnh viễn" example:"2026-11-25T09:00:00Z"`
	BatchSize  int    `json:"batch_size" description:"Số công việc của nhánh gốc này trong lô (gốc và các việc con cùng lô), đúng số bị xoá khi xoá vĩnh viễn dòng này" example:"3"`
}

// TaskTrashPageSDO is GET /workspaces/{workspaceID}/tasks/trash.
type TaskTrashPageSDO struct {
	Items      []TaskTrashItemDTO `json:"items"`
	NextCursor string             `json:"next_cursor" description:"Con trỏ trang kế (chuỗi mờ); rỗng ở trang cuối" example:"1790000000000000.01J8X4TASKN1P2Q3R4S5T6U7"`
}

// ProjectTrashItemDTO is one project in the trash.
type ProjectTrashItemDTO struct {
	ID         string `json:"id" example:"01J8X4PROJN1P2Q3R4S5T6U7V8"`
	Title      string `json:"title" example:"Ra mắt Q4"`
	TrashedAt  string `json:"trashed_at" description:"RFC 3339" example:"2026-10-26T09:00:00Z"`
	TrashedBy  string `json:"trashed_by" description:"ULID người xoá" example:"01J8X4USERN1P2Q3R4S5T6U7"`
	PurgeAfter string `json:"purge_after" description:"RFC 3339; sau mốc này dự án bị xoá vĩnh viễn" example:"2026-11-25T09:00:00Z"`
	TaskCount  int    `json:"task_count" description:"Số công việc còn sống mà khôi phục sẽ gắn lại vào dự án (việc đã chuyển sang dự án khác không tính)" example:"12"`
}

// ProjectTrashPageSDO is GET /workspaces/{workspaceID}/projects/trash.
type ProjectTrashPageSDO struct {
	Items      []ProjectTrashItemDTO `json:"items"`
	NextCursor string                `json:"next_cursor" description:"Con trỏ trang kế (chuỗi mờ); rỗng ở trang cuối" example:"1790000000000000.01J8X4PROJN1P2Q3R4S5T6U7V8"`
}
