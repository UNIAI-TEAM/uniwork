package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatDelivery mounts the delivery ack (UNI-1908 F4). Like the read
// route it has no budget of its own: the client batches one request a second
// at most, and the global limiter covers a burst.
func registerChatDelivery(r api, h Routes) {
	r.Post("/workspaces/{workspaceID}/chat/delivered", h.AckChatDelivered, apiOp{
		summary:     "Acknowledge chat delivery",
		description: "Thiết bị báo đã nhận tin tới mốc up_to ở từng phòng (✓✓ xám). Con trỏ chỉ tiến, không vượt hiện tại; phòng người gọi không ở trong thì bỏ qua, không báo.",
		tags:        []string{"chat"},
		sdi:         sdi.AckChatDeliveredSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
}
