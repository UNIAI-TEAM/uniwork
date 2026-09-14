package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: home — the workspace home screen of the caller (A-05). Requires Bearer.
// Every row returned is the caller's own: tasks assigned to them, meetings
// they are part of, their unread notifications, their layout.
//
//	GET /api/v1/workspaces/{workspaceID}/home
//	GET /api/v1/workspaces/{workspaceID}/home/preferences
//	PUT /api/v1/workspaces/{workspaceID}/home/preferences
func registerHome(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/home", h.GetHomeSummary, apiOp{
		summary:     "Home summary",
		description: "Trang chủ của người gọi trong một request: số liệu hôm nay, việc được giao, cuộc họp hôm nay và ngày mai, thông báo chưa đọc. Query: limit_tasks (≤20), limit_meetings (≤10), limit_inbox (≤20). Nguồn lỗi nằm trong partial.",
		tags:        []string{"home"},
		sdo:         sdo.HomeSummarySDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/home/preferences", h.GetHomePreference, apiOp{
		summary:     "Get home layout",
		description: "Bố cục trang chủ đã lưu của người gọi; object rỗng khi chưa đổi.",
		tags:        []string{"home"},
		sdo:         sdo.HomePreferenceSDO{},
		auth:        true,
	})
	r.Put("/workspaces/{workspaceID}/home/preferences", h.PutHomePreference, apiOp{
		summary:     "Set home layout",
		description: "Thay bố cục trang chủ. prefs phải là object JSON ≤ 8 KiB, không thì 400.",
		tags:        []string{"home"},
		sdi:         sdi.PutHomePreferenceSDI{},
		sdo:         sdo.HomePreferenceSDO{},
		auth:        true,
	})
}
