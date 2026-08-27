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
}
