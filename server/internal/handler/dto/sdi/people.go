package sdi

// OrgMemberRoleSDI is PATCH /api/v1/orgs/{org}/members/{userID}. Ownership is
// not a role change: it goes through POST /orgs/{org}/transfer-ownership so the
// organization is never left without an owner, or with two.
type OrgMemberRoleSDI struct {
	Role string `json:"role" enum:"admin,member" description:"Vai trò mới trong tổ chức" example:"admin"`
}

// ProfileSDI is PATCH /api/v1/orgs/{org}/people/{userID}/profile. Every field
// is optional; an absent field is left alone. department_id, manager_id,
// employee_code and joined_on need an owner or admin — sending one as a plain
// member is 403, not a silent no-op.
type ProfileSDI struct {
	Title        *string `json:"title,omitempty" description:"Chức danh trong tổ chức" example:"Trưởng nhóm sản phẩm"`
	DepartmentID *string `json:"department_id,omitempty" description:"ULID phòng ban; chuỗi rỗng để bỏ gán" example:"01J8X4DEPT0N1P2Q3R4S5T6U"`
	ManagerID    *string `json:"manager_id,omitempty" description:"ULID người quản lý trực tiếp; chuỗi rỗng để bỏ gán" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	EmployeeCode *string `json:"employee_code,omitempty" description:"Mã nhân viên, duy nhất trong tổ chức" example:"NV0142"`
	Phone        *string `json:"phone,omitempty" example:"0901234567"`
	PhoneVisible *bool   `json:"phone_visible,omitempty" description:"Cho phép đồng nghiệp xem số điện thoại" example:"true"`
	Location     *string `json:"location,omitempty" example:"Hà Nội"`
	Bio          *string `json:"bio,omitempty" maxLength:"500" example:"Làm sản phẩm từ 2019"`
	JoinedOn     *string `json:"joined_on,omitempty" description:"Ngày vào công ty, YYYY-MM-DD; chuỗi rỗng để xóa" example:"2024-03-01"`
}

// DepartmentSDI creates or updates a department. On PATCH every field is
// optional and an absent field is left alone.
type DepartmentSDI struct {
	Name       *string `json:"name,omitempty" minLength:"1" example:"Kỹ thuật"`
	Code       *string `json:"code,omitempty" description:"Mã ngắn, duy nhất trong tổ chức; viết hoa tự động" example:"ENG"`
	ParentID   *string `json:"parent_id,omitempty" description:"ULID phòng ban cha; chuỗi rỗng để đưa lên cấp 1" example:""`
	HeadUserID *string `json:"head_user_id,omitempty" description:"ULID trưởng phòng; chuỗi rỗng để bỏ gán" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}

// DepartmentOrderSDI is PUT /api/v1/orgs/{org}/departments/order: the ids in
// the order the settings screen wants them shown.
type DepartmentOrderSDI struct {
	IDs []string `json:"ids" description:"ULID phòng ban theo thứ tự hiển thị mong muốn"`
}

// OrgInviteSDI is POST /api/v1/orgs/{org}/invitations: an invitation to the
// organization itself, with no workspace behind it.
type OrgInviteSDI struct {
	Emails  []string `json:"emails" description:"Tối đa 50 địa chỉ, không trùng nhau"`
	OrgRole string   `json:"org_role,omitempty" enum:"admin,member" description:"Vai trò khi tham gia, mặc định member" example:"member"`
}

// TransferOwnershipSDI is POST /api/v1/orgs/{org}/transfer-ownership. The
// current owner re-enters their password: this is the one change they cannot
// undo alone afterwards (OPEN_QUESTIONS P2).
type TransferOwnershipSDI struct {
	ToUserID string `json:"to_user_id" description:"ULID thành viên nhận quyền chủ sở hữu" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Password string `json:"password" description:"Mật khẩu hiện tại của chủ sở hữu" example:"••••••••"`
}
