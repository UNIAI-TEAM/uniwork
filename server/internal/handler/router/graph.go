package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerGraph mounts the Work Graph reads (C-11 §6). graph_ui is checked in
// the service with the organization RequireMember resolved, because the
// route middleware only knows the user.
func registerGraph(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/graph/nodes/{nodeType}/{nodeID}/neighbors", h.GraphNeighbors, apiOp{
		summary: "Work Graph neighbors", description: "Hàng xóm một bước đang hiệu lực của một node, sau hai lớp quyền.",
		tags: []string{"graph"}, sdi: sdi.GraphNeighborsSDI{}, sdo: sdo.GraphNeighborsSDO{}, auth: true,
	})
	r.Get("/workspaces/{workspaceID}/graph/nodes/{nodeType}/{nodeID}/history", h.GraphHistory, apiOp{
		summary: "Work Graph history", description: "Lịch sử cạnh và fact của một node (người phụ trách, hạn, nguồn gốc…).",
		tags: []string{"graph"}, sdi: sdi.GraphHistorySDI{}, sdo: sdo.GraphHistorySDO{}, auth: true,
	})
}
