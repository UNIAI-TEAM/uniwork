package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: people — the organization's directory and the profiles behind it
// (F-03). Every member reads; only owner and admin write the company-owned
// fields or take a copy of the list. Requires Bearer.
//
//	GET   /api/v1/orgs/{org}/people
//	GET   /api/v1/orgs/{org}/people.csv
//	GET   /api/v1/orgs/{org}/people/{userID}
//	PATCH /api/v1/orgs/{org}/people/{userID}/profile
func registerPeople(r api, h Routes) {
	r.Get("/orgs/{org}/people", h.ListPeople, apiOp{
		summary:     "Search the people directory",
		description: "Tìm theo tên/email/chức danh/phòng ban (không dấu cũng khớp), lọc theo department_id, manager_id, role, status; phân trang bằng cursor.",
		tags:        []string{"people"},
		sdo:         sdo.PeopleListSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/people.csv", h.ExportPeople, apiOp{
		summary:     "Export the directory as CSV",
		description: "Trả text/csv (có BOM UTF-8 để Excel đọc đúng tiếng Việt), tối đa 10.000 dòng. Chỉ owner/admin; ghi nhật ký people.exported.",
		tags:        []string{"people"},
		produces:    "text/csv; charset=utf-8",
		auth:        true,
	})
	r.Get("/orgs/{org}/people/{userID}", h.GetPerson, apiOp{
		summary:     "Get one person's profile",
		description: "Hồ sơ của một thành viên kèm danh sách người báo cáo trực tiếp.",
		tags:        []string{"people"},
		sdo:         sdo.PersonSDO{},
		auth:        true,
	})
	r.Patch("/orgs/{org}/people/{userID}/profile", h.PatchPersonProfile, apiOp{
		summary:     "Update a profile",
		description: "Chính chủ sửa chức danh, điện thoại, nơi làm việc, giới thiệu. Phòng ban, quản lý, mã nhân viên và ngày vào cần owner/admin.",
		tags:        []string{"people"},
		sdi:         sdi.ProfileSDI{},
		sdo:         sdo.PersonSDO{},
		auth:        true,
	})
}

// tag: departments — the organization's structure, at most two levels deep
// (F-03). Requires Bearer.
//
//	GET   /api/v1/orgs/{org}/departments
//	POST  /api/v1/orgs/{org}/departments
//	PUT   /api/v1/orgs/{org}/departments/order
//	PATCH /api/v1/orgs/{org}/departments/{departmentId}
//	POST  /api/v1/orgs/{org}/departments/{departmentId}/archive
func registerDepartments(r api, h Routes) {
	r.Get("/orgs/{org}/departments", h.ListDepartments, apiOp{
		summary:     "List departments",
		description: "Cây phòng ban trả phẳng kèm parent_id và số thành viên; client tự dựng cây. include_archived=true để xem cả phòng đã lưu trữ.",
		tags:        []string{"departments"},
		sdo:         sdo.DepartmentListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/departments", h.CreateDepartment, apiOp{
		summary:     "Create a department",
		description: "Owner/admin tạo phòng ban. Tối đa 2 cấp; mã phòng ban duy nhất trong tổ chức.",
		tags:        []string{"departments"},
		sdi:         sdi.DepartmentSDI{},
		sdo:         sdo.DepartmentSDO{},
		status:      201,
		auth:        true,
	})
	r.Put("/orgs/{org}/departments/order", h.ReorderDepartments, apiOp{
		summary:     "Reorder departments",
		description: "Ghi thứ tự hiển thị theo danh sách id gửi lên.",
		tags:        []string{"departments"},
		sdi:         sdi.DepartmentOrderSDI{},
		sdo:         sdo.DepartmentListSDO{},
		auth:        true,
	})
	r.Patch("/orgs/{org}/departments/{departmentId}", h.PatchDepartment, apiOp{
		summary:     "Update a department",
		description: "Đổi tên, mã, phòng ban cha hoặc trưởng phòng. Đổi tên sẽ cập nhật lại chỉ mục tìm kiếm của mọi thành viên trong phòng.",
		tags:        []string{"departments"},
		sdi:         sdi.DepartmentSDI{},
		sdo:         sdo.DepartmentSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/departments/{departmentId}/archive", h.ArchiveDepartment, apiOp{
		summary:     "Archive a department",
		description: "Lưu trữ phòng ban và bỏ gán mọi thành viên trong cùng transaction. Phòng còn phòng con thì từ chối.",
		tags:        []string{"departments"},
		sdo:         sdo.DepartmentSDO{},
		auth:        true,
	})
}
