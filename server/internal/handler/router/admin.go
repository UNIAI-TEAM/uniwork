package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: admin — platform console (F-11). Requires Bearer plus users.platform_role:
// support reads, admin writes. No route here goes through RequireMember and
// none returns content (task bodies, messages, files) — metadata only.
// A user without a platform role gets 404 on every route.
//
//	GET  /api/v1/admin/me
//	GET  /api/v1/admin/organizations
//	GET  /api/v1/admin/organizations/{orgID}
//	POST /api/v1/admin/organizations/{orgID}/suspend
//	POST /api/v1/admin/organizations/{orgID}/unsuspend
//	POST /api/v1/admin/organizations/{orgID}/plan
//	GET  /api/v1/admin/trace/{traceID}
//	GET  /api/v1/admin/system
//	GET  /api/v1/admin/flags
//	GET  /api/v1/admin/flags/{key}/overrides
//	PUT  /api/v1/admin/flags/{key}/overrides
//	DELETE /api/v1/admin/flags/{key}/overrides
func registerAdmin(r api, h Routes, limit, support, admin func(http.Handler) http.Handler) {
	tags := []string{"admin"}
	r.Route("/admin", func(a api) {
		a.Use(limit)
		a.Use(support)
		a.Get("/me", h.AdminMe, apiOp{summary: "Admin: my platform role", description: "Vai trò platform của người gọi; 404 khi không có.", tags: tags, sdo: sdo.AdminMeSDO{}, auth: true})
		a.Get("/organizations", h.AdminListOrganizations, apiOp{summary: "Admin: list organizations", description: "Danh sách tổ chức kèm gói, số thành viên/workspace, hoạt động gần nhất. Query: q, status, limit, offset.", tags: tags, sdo: sdo.AdminOrganizationListSDO{}, auth: true})
		a.Get("/organizations/{orgID}", h.AdminGetOrganization, apiOp{summary: "Admin: organization detail", description: "Chi tiết, quota (entitlement snapshot) và 20 thao tác admin gần nhất.", tags: tags, sdo: sdo.AdminOrganizationDetailSDO{}, auth: true})
		a.Get("/trace/{traceID}", h.AdminTrace, apiOp{summary: "Admin: trace lookup", description: "Audit, outbox và admin_actions mang cùng trace id (tối đa 500 dòng mỗi bảng).", tags: tags, sdo: sdo.AdminTraceSDO{}, auth: true})
		a.Get("/system", h.AdminSystem, apiOp{summary: "Admin: system", description: "Phiên bản build, migration nhúng, readiness, outbox pending/dead-letter, realtime connections, chuỗi flag provider.", tags: tags, sdo: sdo.AdminSystemSDO{}, auth: true})
		a.Get("/flags", h.AdminListFlags, apiOp{summary: "Admin: flag catalogue", description: "Mọi flag đã khai báo: mô tả, mặc định, public, ngày review, số override.", tags: tags, sdo: sdo.AdminFlagListSDO{}, auth: true})
		a.Get("/flags/{key}/overrides", h.AdminListFlagOverrides, apiOp{summary: "Admin: list overrides", description: "Override của một flag theo scope.", tags: tags, sdo: sdo.AdminFlagOverrideListSDO{}, auth: true})
		a.Group(func(w api) {
			w.Use(admin)
			w.Post("/organizations/{orgID}/suspend", h.AdminSuspendOrganization, apiOp{summary: "Admin: suspend organization", description: "status → suspended; mọi request của thành viên trả 403 organization_suspended. reason ≥ 10 ký tự.", tags: tags, sdi: sdi.ReasonSDI{}, sdo: sdo.AdminOrganizationSDO{}, auth: true})
			w.Post("/organizations/{orgID}/unsuspend", h.AdminUnsuspendOrganization, apiOp{summary: "Admin: unsuspend organization", description: "status → active. reason ≥ 10 ký tự.", tags: tags, sdi: sdi.ReasonSDI{}, sdo: sdo.AdminOrganizationSDO{}, auth: true})
			w.Post("/organizations/{orgID}/plan", h.AdminChangePlan, apiOp{summary: "Admin: change plan", description: "Đổi gói thủ công (pilot, đối tác), ghi admin_actions với before/after.", tags: tags, sdi: sdi.AdminChangePlanSDI{}, sdo: sdo.SubscriptionSDO{}, auth: true})
			w.Put("/flags/{key}/overrides", h.AdminSetFlagOverride, apiOp{summary: "Admin: set override", description: "Ghi/đè override theo scope; user scope bắt buộc expires_at ≤ 30 ngày. Phát flag.updated.", tags: tags, sdi: sdi.FlagOverrideSDI{}, sdo: sdo.AdminFlagOverrideListSDO{}, auth: true})
			w.Delete("/flags/{key}/overrides", h.AdminDeleteFlagOverride, apiOp{summary: "Admin: delete override", description: "Xóa override theo scope. Phát flag.updated.", tags: tags, sdi: sdi.FlagOverrideDeleteSDI{}, sdo: sdo.AdminFlagOverrideListSDO{}, auth: true})
		})
	})
}
