package router

import "github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"

// tag: meta — public runtime config for the web client.
//
//	GET /api/v1/config
func registerConfig(r api, h Routes) {
	r.Get("/config", h.Config, apiOp{
		summary:     "Public config",
		description: "Flag public theo ngữ cảnh người gọi (Bearer tùy chọn, ?organization_id= tùy chọn) và tỷ lệ gửi web-vitals. Flag chỉ ẩn/hiện năng lực, không phải quyền.",
		tags:        []string{"meta"},
		sdo:         sdo.ConfigSDO{},
	})
}
