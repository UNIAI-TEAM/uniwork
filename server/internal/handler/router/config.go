package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: meta — public runtime config for the web client.
//
//	GET  /api/v1/config
//	POST /api/v1/rum
func registerConfig(r api, h Routes, rumLimit func(http.Handler) http.Handler) {
	r.Get("/config", h.Config, apiOp{
		summary:     "Public config",
		description: "Flag public theo ngữ cảnh người gọi (Bearer tùy chọn, ?organization_id= tùy chọn) và tỷ lệ gửi web-vitals. Flag chỉ ẩn/hiện năng lực, không phải quyền.",
		tags:        []string{"meta"},
		sdo:         sdo.ConfigSDO{},
	})
	r.With(rumLimit).Post("/rum", h.RUM, apiOp{
		summary:     "Report web-vitals",
		description: "Một mẫu web-vitals (lcp, inp, cls, ttfb) từ trình duyệt; không auth, giới hạn 60/phút/IP, body ≤ 1 KB, luôn 204. Thành histogram uniwork_web_vitals_seconds.",
		tags:        []string{"meta"},
		sdi:         sdi.RUMSampleSDI{},
		status:      204,
	})
}
