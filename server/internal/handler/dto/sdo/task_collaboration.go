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
