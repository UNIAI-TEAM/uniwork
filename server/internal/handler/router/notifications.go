package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: notifications — the caller's own inbox (F-07). Requires Bearer. There
// is no endpoint to read another person's notifications and none to create
// one by hand: rows come from the outbox consumer only.
//
//	GET    /api/v1/me/notifications
//	GET    /api/v1/me/notifications/unread-count
//	POST   /api/v1/me/notifications/read
//	POST   /api/v1/me/notifications/unread
//	POST   /api/v1/me/notifications/archive
//	GET    /api/v1/me/notification-preferences
//	PUT    /api/v1/me/notification-preferences
//	GET    /api/v1/notifications/push/config
//	POST   /api/v1/me/push-subscriptions
//	DELETE /api/v1/me/push-subscriptions
func registerNotifications(r api, h Routes) {
	r.Get("/me/notifications", h.ListNotifications, apiOp{
		summary:     "List my notifications",
		description: "Hộp việc của người gọi, mới nhất trước. Query: workspace_id, unread=1, before=<id>, limit (≤100).",
		tags:        []string{"notifications"},
		sdo:         sdo.NotificationListSDO{},
		auth:        true,
	})
	r.Get("/me/notifications/unread-count", h.UnreadNotificationCount, apiOp{
		summary:     "Unread count",
		description: "Tổng chưa đọc và theo workspace, một query — cho badge sidebar và switcher.",
		tags:        []string{"notifications"},
		sdo:         sdo.UnreadCountSDO{},
		auth:        true,
	})
	r.Post("/me/notifications/read", h.MarkNotificationsRead, apiOp{
		summary:     "Mark read",
		description: "ids hoặc all=true (tùy chọn workspace_id). Id của người khác → 404, không đổi gì.",
		tags:        []string{"notifications"},
		sdi:         sdi.NotificationIDsSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/me/notifications/unread", h.MarkNotificationsUnread, apiOp{
		summary:     "Mark unread",
		description: "Bỏ đánh dấu đã đọc.",
		tags:        []string{"notifications"},
		sdi:         sdi.NotificationIDsSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/me/notifications/archive", h.ArchiveNotifications, apiOp{
		summary:     "Archive",
		description: "Ẩn khỏi hộp việc. Không có xóa.",
		tags:        []string{"notifications"},
		sdi:         sdi.NotificationIDsSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Get("/me/notification-preferences", h.GetNotificationPreferences, apiOp{
		summary:     "Get preferences",
		description: "Ma trận loại × kênh (in-app, push, email digest) với mặc định đã áp dụng.",
		tags:        []string{"notifications"},
		sdo:         sdo.NotificationPreferencesSDO{},
		auth:        true,
	})
	r.Put("/me/notification-preferences", h.PutNotificationPreferences, apiOp{
		summary:     "Set preferences",
		description: "Ghi các dòng gửi lên; loại không hợp lệ → 400.",
		tags:        []string{"notifications"},
		sdi:         sdi.NotificationPreferencesSDI{},
		sdo:         sdo.NotificationPreferencesSDO{},
		auth:        true,
	})
	r.Get("/notifications/push/config", h.PushConfig, apiOp{
		summary:     "Push config",
		description: "enabled và VAPID public key; enabled=false khi server chưa cấu hình.",
		tags:        []string{"notifications"},
		sdo:         sdo.PushConfigSDO{},
		auth:        true,
	})
	r.Post("/me/push-subscriptions", h.SubscribePush, apiOp{
		summary:     "Register push subscription",
		description: "Upsert theo endpoint. 404 khi push tắt trên server.",
		tags:        []string{"notifications"},
		sdi:         sdi.PushSubscribeSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Delete("/me/push-subscriptions", h.UnsubscribePush, apiOp{
		summary:     "Remove push subscription",
		description: "Thu hồi subscription của endpoint này.",
		tags:        []string{"notifications"},
		sdi:         sdi.PushUnsubscribeSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
}
