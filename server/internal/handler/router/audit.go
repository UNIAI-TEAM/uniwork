package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: audit — the immutable log, its export and its retention window.
// Requires Bearer.
//
// The organization-wide log is owner/admin only; resource history is a
// workspace read any effective member may do. Both gates live in the service,
// not here.
//
//	GET  /api/v1/orgs/{orgID}/audit
//	GET  /api/v1/orgs/{orgID}/audit/{eventID}
//	GET  /api/v1/orgs/{orgID}/audit/retention
//	PUT  /api/v1/orgs/{orgID}/audit/retention
//	GET  /api/v1/orgs/{orgID}/audit/exports
//	POST /api/v1/orgs/{orgID}/audit/exports
//	GET  /api/v1/orgs/{orgID}/audit/exports/{exportID}
//	GET  /api/v1/workspaces/{workspaceID}/resources/{resourceType}/{resourceID}/history
func registerAudit(r api, h Routes) {
	r.Get("/orgs/{orgID}/audit", h.ListAuditEvents, apiOp{
		summary:     "List audit events",
		description: "Nhật ký của tổ chức, mới nhất trước. Phân trang bằng con trỏ `before`; lọc theo `actor_id`, `action`, `resource_type`, `resource_id`, `workspace_id`, `from`, `to`. Chỉ owner và admin của tổ chức.",
		tags:        []string{"audit"},
		sdo:         sdo.AuditEventListSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/audit/retention", h.GetAuditRetention, apiOp{
		summary:     "Get audit retention",
		description: "Số ngày tổ chức giữ nhật ký. Mặc định 90 khi chưa đặt.",
		tags:        []string{"audit"},
		sdo:         sdo.AuditRetentionSDO{},
		auth:        true,
	})
	r.Put("/orgs/{orgID}/audit/retention", h.SetAuditRetention, apiOp{
		summary:     "Set audit retention",
		description: "Đặt số ngày giữ nhật ký, từ 30 đến 730. Chỉ chủ sở hữu tổ chức.",
		tags:        []string{"audit"},
		sdi:         sdi.SetAuditRetentionSDI{},
		sdo:         sdo.AuditRetentionSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/audit/exports", h.ListAuditExports, apiOp{
		summary:     "List audit exports",
		description: "Các lần xuất nhật ký gần đây của tổ chức.",
		tags:        []string{"audit"},
		sdo:         sdo.AuditExportListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/audit/exports", h.CreateAuditExport, apiOp{
		summary:     "Request an audit export",
		description: "Xếp hàng một bản xuất CSV hoặc JSON theo khoảng thời gian. Mỗi tổ chức chỉ một bản đang chạy. Chỉ chủ sở hữu tổ chức.",
		tags:        []string{"audit"},
		sdi:         sdi.CreateAuditExportSDI{},
		sdo:         sdo.AuditExportSDO{},
		status:      202,
		auth:        true,
	})
	r.Get("/orgs/{orgID}/audit/exports/{exportID}", h.GetAuditExport, apiOp{
		summary:     "Get an audit export",
		description: "Trạng thái một bản xuất và link tải khi đã xong. Link hết hạn sau 24 giờ.",
		tags:        []string{"audit"},
		sdo:         sdo.AuditExportSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/audit/{eventID}", h.GetAuditEvent, apiOp{
		summary:     "Get an audit event",
		description: "Một bản ghi đầy đủ. `ip_address` chỉ trả cho chủ sở hữu tổ chức.",
		tags:        []string{"audit"},
		sdo:         sdo.AuditEventSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/resources/{resourceType}/{resourceID}/history", h.ListResourceHistory, apiOp{
		summary:     "Resource history",
		description: "Lịch sử thao tác trên một công việc hoặc cuộc họp, cho tab Hoạt động. Mọi thành viên workspace đọc được; không kèm địa chỉ IP.",
		tags:        []string{"audit"},
		sdo:         sdo.AuditEventListSDO{},
		auth:        true,
	})
}
