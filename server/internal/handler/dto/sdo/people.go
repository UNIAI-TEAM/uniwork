package sdo

// OrgMemberDTO is one row of the organization's membership list: identity plus
// the tenant-scoped facts about the person. `deactivated_at` is a timestamp
// rather than a flag so the client can say when, not just whether.
type OrgMemberDTO struct {
	UserID        string `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Email         string `json:"email" example:"an@acme.vn"`
	DisplayName   string `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL     string `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
	Role          string `json:"role" description:"owner, admin hoặc member" example:"member"`
	DeactivatedAt string `json:"deactivated_at,omitempty" description:"Thời điểm bị vô hiệu hóa, rỗng nếu đang hoạt động" example:"2026-09-07T09:00:00Z"`
	InvitedBy     string `json:"invited_by,omitempty" description:"ULID người đã mời" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	CreatedAt     string `json:"created_at" example:"2026-09-01T09:00:00Z"`
}

// OrgMemberSDO wraps one membership row.
type OrgMemberSDO struct {
	Member OrgMemberDTO `json:"member"`
}

// OrgMemberListSDO is GET /api/v1/orgs/{org}/members. `next_cursor` is opaque:
// pass it back verbatim to get the following page.
type OrgMemberListSDO struct {
	Members    []OrgMemberDTO `json:"members"`
	NextCursor string         `json:"next_cursor,omitempty" description:"Con trỏ trang kế tiếp, rỗng khi đã hết" example:"TmfDtG4AMDFK"`
}

// OrgMembershipSDO is GET /api/v1/orgs/{org}/members/me: what the caller may
// do in this organization, before any screen is drawn.
type OrgMembershipSDO struct {
	Role          string `json:"role" description:"owner, admin hoặc member" example:"owner"`
	DeactivatedAt string `json:"deactivated_at,omitempty" description:"Rỗng khi tài khoản đang hoạt động" example:""`
	PlatformRole  string `json:"platform_role,omitempty" description:"support hoặc admin, chỉ có với nhân sự vận hành" example:""`
}

// DepartmentRefDTO is the department a person belongs to, small enough to
// inline in every directory row.
type DepartmentRefDTO struct {
	ID   string `json:"id" example:"01J8X4DEPT0N1P2Q3R4S5T6U"`
	Name string `json:"name" example:"Kỹ thuật"`
}

// PersonDTO is one entry of the people directory: the global identity, the
// membership, and the profile — already reduced to what the caller may see.
// `phone` is absent unless its owner published it, or the caller is that owner
// or an administrator (OPEN_QUESTIONS P3).
type PersonDTO struct {
	UserID        string            `json:"user_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DisplayName   string            `json:"display_name" example:"Nguyễn Văn An"`
	Email         string            `json:"email" example:"an@acme.vn"`
	AvatarURL     string            `json:"avatar_url,omitempty" example:"https://cdn.example.com/avatars/an.png"`
	OrgRole       string            `json:"org_role" description:"owner, admin hoặc member" example:"member"`
	Status        string            `json:"status" description:"active hoặc deactivated" example:"active"`
	Title         string            `json:"title" example:"Trưởng nhóm sản phẩm"`
	Department    *DepartmentRefDTO `json:"department" description:"Phòng ban, null nếu chưa gán"`
	Manager       *ActorDTO         `json:"manager" description:"Người quản lý trực tiếp, null nếu chưa gán"`
	EmployeeCode  string            `json:"employee_code,omitempty" example:"NV0142"`
	Phone         string            `json:"phone,omitempty" example:"0901234567"`
	PhoneVisible  bool              `json:"phone_visible" description:"Chủ hồ sơ cho phép đồng nghiệp xem số điện thoại" example:"false"`
	Location      string            `json:"location,omitempty" example:"Hà Nội"`
	Bio           string            `json:"bio,omitempty" example:"Làm sản phẩm từ 2019"`
	JoinedOn      string            `json:"joined_on,omitempty" description:"Ngày vào công ty, YYYY-MM-DD" example:"2024-03-01"`
	Timezone      string            `json:"timezone" example:"Asia/Ho_Chi_Minh"`
	DeactivatedAt string            `json:"deactivated_at,omitempty" example:""`
	IsSelf        bool              `json:"is_self" description:"Hồ sơ của chính người gọi" example:"false"`
}

// PersonSDO is one profile plus the people who report to them.
type PersonSDO struct {
	Person  PersonDTO  `json:"person"`
	Reports []ActorDTO `json:"reports"`
}

// PeopleListSDO is GET /api/v1/orgs/{org}/people.
type PeopleListSDO struct {
	People      []PersonDTO `json:"people"`
	NextCursor  string      `json:"next_cursor,omitempty" description:"Con trỏ trang kế tiếp, rỗng khi đã hết" example:"TmfDtG4AMDFK"`
	TotalActive int64       `json:"total_active" description:"Số thành viên đang hoạt động của tổ chức" example:"128"`
}

// DepartmentDTO is one node of the (at most two level) department tree. The
// list is flat and carries parent_id; the client assembles the tree.
type DepartmentDTO struct {
	ID          string    `json:"id" example:"01J8X4DEPT0N1P2Q3R4S5T6U"`
	Name        string    `json:"name" example:"Kỹ thuật"`
	Code        string    `json:"code,omitempty" example:"ENG"`
	ParentID    string    `json:"parent_id,omitempty" example:""`
	Head        *ActorDTO `json:"head" description:"Trưởng phòng, null nếu chưa gán"`
	MemberCount int64     `json:"member_count" description:"Số thành viên đang hoạt động" example:"12"`
	SortOrder   int32     `json:"sort_order" example:"0"`
	ArchivedAt  string    `json:"archived_at,omitempty" example:""`
}

// DepartmentSDO wraps one department.
type DepartmentSDO struct {
	Department DepartmentDTO `json:"department"`
}

// DepartmentListSDO is GET /api/v1/orgs/{org}/departments.
type DepartmentListSDO struct {
	Departments []DepartmentDTO `json:"departments"`
}

// OrgInvitationDTO is one outstanding invitation to the organization.
type OrgInvitationDTO struct {
	ID            string `json:"id" example:"01J8X4INV0N1P2Q3R4S5T6U7"`
	Email         string `json:"email" example:"an@acme.vn"`
	OrgRole       string `json:"org_role" example:"member"`
	InvitedByName string `json:"invited_by_name,omitempty" example:"Đỗ Thị Hà"`
	ExpiresAt     string `json:"expires_at" example:"2026-09-14T09:00:00Z"`
	CreatedAt     string `json:"created_at" example:"2026-09-07T09:00:00Z"`
}

// OrgInvitationListSDO is GET and POST /api/v1/orgs/{org}/invitations.
// `skipped` names the addresses that were not invited because they are already
// members or are not valid addresses.
type OrgInvitationListSDO struct {
	Invitations []OrgInvitationDTO `json:"invitations"`
	Skipped     []string           `json:"skipped"`
}
