package sdi

// CreateOrganizationSDI is POST /api/v1/orgs.
type CreateOrganizationSDI struct {
	Name string `json:"name" minLength:"1" description:"Tên hiển thị của tổ chức" example:"Acme"`
	Slug string `json:"slug" minLength:"1" description:"Slug trên URL, không trùng" example:"acme"`
}
