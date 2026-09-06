package sdo

import "encoding/json"

// NotificationDTO is one inbox row. title_key + params render client-side.
type NotificationDTO struct {
	ID              string          `json:"id" example:"01K4NOTIF00000000000000001"`
	Kind            string          `json:"kind" description:"task_assigned, task_status_changed, task_commented, mentioned, meeting_invited, meeting_starting, member_added, role_changed, audit_export_ready" example:"task_assigned"`
	WorkspaceID     string          `json:"workspace_id,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	OrganizationID  string          `json:"organization_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V9"`
	ResourceType    string          `json:"resource_type" description:"task, meeting, workspace hoặc audit_export" example:"task"`
	ResourceID      string          `json:"resource_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	ResourceDeleted bool            `json:"resource_deleted" description:"true khi task/meeting đích không còn" example:"false"`
	ActorKind       string          `json:"actor_kind" description:"human, agent hoặc system" example:"human"`
	ActorID         string          `json:"actor_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7VB"`
	TitleKey        string          `json:"title_key" description:"Khoá i18n, client render với params" example:"notifications.kind.task_assigned"`
	Params          json.RawMessage `json:"params" description:"Tham số cho title_key: tên đã snapshot lúc sự kiện" example:"{\"actor\":\"An\",\"task\":\"Viết spec\"}"`
	Count           int32           `json:"count" description:"Số sự kiện đã gộp vào dòng này" example:"1"`
	ReadAt          string          `json:"read_at,omitempty" example:"2026-09-06T08:00:00Z"`
	CreatedAt       string          `json:"created_at" example:"2026-09-06T07:59:00Z"`
	UpdatedAt       string          `json:"updated_at" example:"2026-09-06T07:59:00Z"`
}

// NotificationListSDO is GET /api/v1/me/notifications.
type NotificationListSDO struct {
	Notifications []NotificationDTO `json:"notifications"`
	NextBefore    string            `json:"next_before,omitempty" description:"Truyền lại làm before để lấy trang cũ hơn; rỗng khi hết" example:"01K4NOTIF00000000000000001"`
}

// UnreadCountSDO is GET /api/v1/me/notifications/unread-count.
type UnreadCountSDO struct {
	Total       int64            `json:"total" example:"3"`
	ByWorkspace map[string]int64 `json:"by_workspace" description:"workspace_id → số chưa đọc; sự kiện cấp tổ chức chỉ vào total" example:"{\"01J8X4K2M0N1P2Q3R4S5T6U7V8\":2}"`
}

// NotificationPreferenceDTO is one row of the kind × channel matrix.
type NotificationPreferenceDTO struct {
	Kind  string `json:"kind" example:"task_assigned"`
	InApp bool   `json:"in_app" example:"true"`
	Push  bool   `json:"push" example:"true"`
	Email bool   `json:"email" example:"true"`
}

// NotificationPreferencesSDO is GET|PUT /api/v1/me/notification-preferences.
type NotificationPreferencesSDO struct {
	Preferences []NotificationPreferenceDTO `json:"preferences"`
}

// PushConfigSDO is GET /api/v1/notifications/push/config.
type PushConfigSDO struct {
	Enabled   bool   `json:"enabled" description:"false khi server không có VAPID key; client ẩn tùy chọn push" example:"true"`
	PublicKey string `json:"public_key,omitempty" description:"VAPID public key (applicationServerKey)" example:"BOr…"`
}
