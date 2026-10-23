package sdo

// OrganizationSDO wraps one organization.
type OrganizationSDO struct {
	Organization OrganizationDTO `json:"organization"`
}

// OrganizationListSDO is GET /api/v1/orgs.
type OrganizationListSDO struct {
	Organizations []OrganizationDTO `json:"organizations"`
}

type OrganizationDTO struct {
	ID   string `json:"id" description:"ULID tổ chức" example:"01J8X4ORG0N1P2Q3R4S5T6U7V"`
	Slug string `json:"slug" example:"acme"`
	Name string `json:"name" example:"Acme"`
	Role string `json:"role,omitempty" description:"Vai trò của người gọi trong tổ chức này" example:"owner"`
	// Status lets the client show the suspended page instead of a bare 403
	// on the first workspace request (F-11).
	Status string `json:"status,omitempty" description:"active | suspended | archived" example:"active"`
	// Deactivated marks a switched-off membership, which GET /orgs keeps
	// listing (F-03 §6.3) but which no longer counts as belonging (ADR 0032 D1).
	Deactivated bool `json:"deactivated,omitempty" description:"true khi tư cách thành viên của người gọi đã bị vô hiệu hóa; vắng mặt khi còn hiệu lực" example:"false"`
}
