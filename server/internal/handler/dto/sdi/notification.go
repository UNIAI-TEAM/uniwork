package sdi

// NotificationIDsSDI is the body of POST /api/v1/me/notifications/{read,unread,archive,unarchive}.
type NotificationIDsSDI struct {
	IDs         []string `json:"ids" description:"Id thông báo của chính người gọi; id của người khác trả 404" example:"[\"01K4NOTIF00000000000000001\"]"`
	All         bool     `json:"all" description:"Chỉ với /read: đánh dấu tất cả đã đọc, bỏ qua ids" example:"false"`
	WorkspaceID string   `json:"workspace_id" description:"Với all=true: giới hạn trong một workspace" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}

// NotificationDocumentsSDI is the query of GET /api/v1/me/notifications/{notificationID}/documents.
type NotificationDocumentsSDI struct {
	Cursor *string `query:"cursor" description:"next_cursor của trang trước (chuỗi mờ, gửi lại nguyên vẹn); chỉ dùng được cho đúng thông báo và người gọi đã tạo ra nó" example:"ndc1.opaque-cursor"`
	Limit  *int32  `query:"limit" description:"Số tài liệu mỗi trang, mặc định 50, tối đa 100" example:"50"`
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

// PushKeysSDI is the browser's PushSubscription.keys; left empty for an Expo
// token, so the service (not the schema) requires them for https endpoints.
type PushKeysSDI struct {
	P256dh string `json:"p256dh" description:"Bắt buộc với endpoint https; để rỗng với token Expo" example:"BNcRd…"`
	Auth   string `json:"auth" description:"Bắt buộc với endpoint https; để rỗng với token Expo" example:"tBHI…"`
}

// PushSubscribeSDI is POST /api/v1/me/push-subscriptions.
type PushSubscribeSDI struct {
	Endpoint string      `json:"endpoint" minLength:"1" description:"PushSubscription.endpoint (https) hoặc token Expo ExponentPushToken[...]" example:"https://fcm.googleapis.com/fcm/send/abc"`
	Keys     PushKeysSDI `json:"keys"`
	Platform string      `json:"platform,omitempty" description:"ios | android, bắt buộc khi endpoint là token Expo" example:"ios"`
	CallUI   bool        `json:"call_ui,omitempty" description:"true khi bản Android tự vẽ cuộc gọi đến (UniChat 0.3.0 trở lên): push đổ chuông và kết thúc tới máy đó là data-only; thiếu thì máy nhận push hiển thị như trước" example:"true"`
	// ChatQuiet: the build created the chat_quiet channel and its FCM service
	// lifts data.tag, so a room's pushes replace one notification (UNI-2141).
	ChatQuiet bool `json:"chat_quiet,omitempty" description:"true khi bản Android đã tạo kênh chat_quiet: tin chat tới trong vòng 30 giây sau một tin đã reo của cùng phòng hiện im lặng trên kênh đó, và mỗi push của phòng thay thông báo của phòng (tiêu đề kèm số tin); thiếu thì máy không nhận các tin im lặng ấy và tiêu đề không kèm số tin" example:"true"`
	// Transport "apns_voip" registers an iPhone's PushKit token (ADR 0038):
	// endpoint is the token in hex, with the APNs environment of the build and
	// the app's bundle id. Kind and bundle_id are the same fields under the
	// other names the contract gave them; transport and apns_bundle_id win.
	Transport       string `json:"transport,omitempty" enum:"apns_voip" description:"apns_voip khi endpoint là token PushKit (VoIP) của iPhone, dạng hex; bỏ trống với subscription trình duyệt và token Expo" example:"apns_voip"`
	Kind            string `json:"kind,omitempty" enum:"apns_voip" description:"Tên khác của transport; transport thắng khi có cả hai" example:"apns_voip"`
	APNsEnvironment string `json:"apns_environment,omitempty" enum:"production,sandbox" description:"Bắt buộc với apns_voip: production cho bản TestFlight/App Store, sandbox cho bản development" example:"production"`
	APNsBundleID    string `json:"apns_bundle_id,omitempty" description:"Bắt buộc với apns_voip: bundle id của app; push VoIP đi tới topic <apns_bundle_id>.voip" example:"com.uniworkos.chat"`
	BundleID        string `json:"bundle_id,omitempty" description:"Tên khác của apns_bundle_id; apns_bundle_id thắng khi có cả hai" example:"com.uniworkos.chat"`
}

// PushUnsubscribeSDI is DELETE /api/v1/me/push-subscriptions.
type PushUnsubscribeSDI struct {
	Endpoint string `json:"endpoint" minLength:"1" example:"https://fcm.googleapis.com/fcm/send/abc"`
}
