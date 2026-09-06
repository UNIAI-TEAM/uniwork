package sdi

// NotificationIDsSDI is the body of POST /api/v1/me/notifications/{read,unread,archive}.
type NotificationIDsSDI struct {
	IDs         []string `json:"ids" description:"Id thông báo của chính người gọi; id của người khác trả 404" example:"[\"01K4NOTIF00000000000000001\"]"`
	All         bool     `json:"all" description:"Chỉ với /read: đánh dấu tất cả đã đọc, bỏ qua ids" example:"false"`
	WorkspaceID string   `json:"workspace_id" description:"Với all=true: giới hạn trong một workspace" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}

// NotificationPreferenceSDI is one row of PUT /api/v1/me/notification-preferences.
type NotificationPreferenceSDI struct {
	Kind  string `json:"kind" minLength:"1" description:"Loại thông báo" example:"task_assigned"`
	InApp bool   `json:"in_app" example:"true"`
	Push  bool   `json:"push" example:"true"`
	Email bool   `json:"email" description:"Vào email digest hằng ngày" example:"true"`
}

// NotificationPreferencesSDI is PUT /api/v1/me/notification-preferences.
type NotificationPreferencesSDI struct {
	Preferences []NotificationPreferenceSDI `json:"preferences"`
}

// PushKeysSDI is the browser's PushSubscription.keys.
type PushKeysSDI struct {
	P256dh string `json:"p256dh" minLength:"1" example:"BNcRd…"`
	Auth   string `json:"auth" minLength:"1" example:"tBHI…"`
}

// PushSubscribeSDI is POST /api/v1/me/push-subscriptions.
type PushSubscribeSDI struct {
	Endpoint string      `json:"endpoint" minLength:"1" description:"PushSubscription.endpoint (https)" example:"https://fcm.googleapis.com/fcm/send/abc"`
	Keys     PushKeysSDI `json:"keys"`
}

// PushUnsubscribeSDI is DELETE /api/v1/me/push-subscriptions.
type PushUnsubscribeSDI struct {
	Endpoint string `json:"endpoint" minLength:"1" example:"https://fcm.googleapis.com/fcm/send/abc"`
}
