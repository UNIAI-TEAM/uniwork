package sdi

// CreateCommentSDI is POST /api/v1/tasks/{taskID}/comments.
type CreateCommentSDI struct {
	Body        string  `json:"body" minLength:"1" description:"Nội dung bình luận" example:"Đã review, merge được."`
	ParentID    *string `json:"parent_id" description:"ULID comment cha khi trả lời" example:"01J8X4CMTN1P2Q3R4S5T6U7V"`
	CommentType string  `json:"type" description:"comment|status_change|progress_update|system" example:"comment"`
}

// UpdateCommentSDI is PUT /api/v1/comments/{commentID}.
type UpdateCommentSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung mới" example:"Đã sửa sau review."`
}

// ReactionSDI is POST/DELETE .../reactions.
type ReactionSDI struct {
	Emoji string `json:"emoji" minLength:"1" description:"Emoji phản ứng" example:"👍"`
}

// SubscribeTaskSDI is POST .../subscribe|unsubscribe|unsubscribe/subtree.
type SubscribeTaskSDI struct {
	UserID   string `json:"user_id" description:"ULID đích; bỏ trống = người gọi" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	UserType string `json:"user_type" description:"member hoặc agent" example:"member"`
}
