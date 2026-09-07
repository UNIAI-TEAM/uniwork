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
