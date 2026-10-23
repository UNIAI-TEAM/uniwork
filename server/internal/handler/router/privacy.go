package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: privacy — organization data export for the owner (C-06).
// Requires Bearer. The gate is the organization owner, in the service.
//
//	GET  /api/v1/orgs/{orgID}/privacy/exports
//	POST /api/v1/orgs/{orgID}/privacy/exports
//	GET  /api/v1/orgs/{orgID}/privacy/exports/{privacyExportID}
//	GET  /api/v1/orgs/{orgID}/privacy/exports/{privacyExportID}/download
func registerPrivacy(r api, h Routes) {
	r.Get("/orgs/{orgID}/privacy/exports", h.ListPrivacyExports, apiOp{
		summary:     "List organization data exports",
		description: "Các lần xuất dữ liệu gần đây của tổ chức. Chỉ chủ sở hữu.",
		tags:        []string{"privacy"},
		sdo:         sdo.PrivacyExportListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/privacy/deletion", h.CreatePrivacyDeletion, apiOp{
		summary:     "Delete an organization",
		description: "Ghi nhận xóa tổ chức. Job xóa cứng chạy sau 5 ngày. Trong thời gian đó thành viên không vào được; chủ sở hữu vẫn tải tệp, xuất nhật ký, xem hóa đơn và có thể hủy. Chỉ chủ sở hữu, sau khi gõ lại định danh.",
		tags:        []string{"privacy"},
		sdi:         sdi.CreatePrivacyDeletionSDI{},
		sdo:         sdo.PrivacyExportSDO{},
		status:      202,
		auth:        true,
	})
	r.Post("/orgs/{orgID}/privacy/deletion/cancel", h.CancelPrivacyDeletion, apiOp{
		summary:     "Cancel an organization deletion",
		description: "Hủy lệnh xóa khi job chưa chạy. Thành viên vào lại được. Chỉ chủ sở hữu.",
		tags:        []string{"privacy"},
		sdo:         sdo.PrivacyExportSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/privacy/exports", h.CreatePrivacyExport, apiOp{
		summary:     "Request an organization data export",
		description: "Xếp hàng một bản xuất zip toàn bộ dữ liệu nghiệp vụ của tổ chức. Mỗi tổ chức chỉ một bản đang chạy. Chỉ chủ sở hữu.",
		tags:        []string{"privacy"},
		sdo:         sdo.PrivacyExportSDO{},
		status:      202,
		auth:        true,
	})
	r.Get("/orgs/{orgID}/privacy/exports/{privacyExportID}", h.GetPrivacyExport, apiOp{
		summary:     "Get an organization data export",
		description: "Trạng thái một bản xuất và link tải khi đã xong. Link hết hạn sau 24 giờ.",
		tags:        []string{"privacy"},
		sdo:         sdo.PrivacyExportSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/privacy/exports/{privacyExportID}/download", h.DownloadPrivacyExport, apiOp{
		summary:     "Download an organization data export",
		description: "Tải zip qua FileService proxy; quyền chủ sở hữu và cửa sổ 24 giờ được kiểm tra lại mỗi lần tải.",
		tags:        []string{"privacy"},
		auth:        true,
	})
}
