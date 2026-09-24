package sdo

// CommentReactionDTO is one emoji on a comment.
type CommentReactionDTO struct {
	ID        string `json:"id" example:"01J8X4REACTN1P2Q3R4S5T6"`
	CommentID string `json:"comment_id" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	ActorType string `json:"actor_type" example:"member"`
	ActorID   string `json:"actor_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Emoji     string `json:"emoji" example:"👍"`
	CreatedAt string `json:"created_at" example:"2026-08-27T10:00:00Z"`
}

// TaskReactionDTO is one emoji on a task.
type TaskReactionDTO struct {
	ID        string `json:"id" example:"01J8X4TREACTN1P2Q3R4S5T"`
	TaskID    string `json:"task_id" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	ActorType string `json:"actor_type" example:"member"`
	ActorID   string `json:"actor_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Emoji     string `json:"emoji" example:"🔥"`
	CreatedAt string `json:"created_at" example:"2026-08-27T10:00:00Z"`
}

// TaskSubscriberDTO is one watcher on a task.
type TaskSubscriberDTO struct {
	TaskID    string `json:"task_id" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	ActorType string `json:"actor_type" example:"member"`
	ActorID   string `json:"actor_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Reason    string `json:"reason" example:"manual"`
	CreatedAt string `json:"created_at" example:"2026-08-27T10:00:00Z"`
}

// TaskSubscriberListSDO is GET .../subscribers.
type TaskSubscriberListSDO struct {
	Subscribers []TaskSubscriberDTO `json:"subscribers"`
}

// CommentReactionSDO wraps one comment reaction.
type CommentReactionSDO struct {
	Reaction CommentReactionDTO `json:"reaction"`
}

// TaskReactionSDO wraps one task reaction.
type TaskReactionSDO struct {
	Reaction TaskReactionDTO `json:"reaction"`
}

// AttachmentDTO is public attachment metadata (no object_key).
type AttachmentDTO struct {
	ID           string  `json:"id" description:"ULID đính kèm" example:"01J8X4ATTN1P2Q3R4S5T6U7V8"`
	WorkspaceID  string  `json:"workspace_id" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	TaskID       *string `json:"task_id,omitempty" description:"ULID task nếu thuộc task" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	CommentID    *string `json:"comment_id,omitempty" description:"ULID comment nếu thuộc comment" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	UploaderType string  `json:"uploader_type" description:"member hoặc agent" example:"member"`
	UploaderID   string  `json:"uploader_id" description:"ULID người/agent tải lên" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Filename     string  `json:"filename" description:"Tên tệp an toàn" example:"note.md"`
	URL          string  `json:"url" description:"Đường dẫn preview /content (cùng origin)" example:"/api/v1/attachments/01J8X4ATTN1P2Q3R4S5T6U7V8/content"`
	DownloadURL  string  `json:"download_url" description:"Đường dẫn /download (cùng origin)" example:"/api/v1/attachments/01J8X4ATTN1P2Q3R4S5T6U7V8/download"`
	MarkdownURL  string  `json:"markdown_url" description:"URL ổn định để nhúng markdown (thường = download_url)" example:"/api/v1/attachments/01J8X4ATTN1P2Q3R4S5T6U7V8/download"`
	ContentType  string  `json:"content_type" description:"MIME type" example:"text/markdown"`
	SizeBytes    int64   `json:"size_bytes" description:"Kích thước bytes" example:"128"`
	CreatedAt    string  `json:"created_at" description:"RFC3339" example:"2026-09-09T10:00:00Z"`
}

// AttachmentListSDO is GET .../tasks/{taskID}/attachments.
type AttachmentListSDO struct {
	Attachments []AttachmentDTO `json:"attachments"`
}
