package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
)

// tag: meta — UniChat mobile's anonymous product events.
//
//	POST /api/v1/mobile/events
func registerMobileEvents(r api, h Routes) {
	r.Post("/mobile/events", h.MobileEvents, apiOp{
		summary:     "Report UniChat mobile events",
		description: "Lô sự kiện sản phẩm ẩn danh của UniChat mobile (mở app, gửi tin, mở từ push, nối cuộc gọi, thời gian màn đầu). Cần đăng nhập, body ≤ 4 KB, tối đa 20 sự kiện, luôn 204. Chỉ thành bộ đếm uniwork_mobile_events_total và histogram uniwork_mobile_event_duration_seconds theo OS và version; không lưu người, tổ chức hay nội dung.",
		tags:        []string{"meta"},
		sdi:         sdi.MobileEventsSDI{},
		status:      204,
		auth:        true,
	})
}
