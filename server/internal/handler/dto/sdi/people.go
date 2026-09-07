package sdi

// OrgMemberRoleSDI is PATCH /api/v1/orgs/{org}/members/{userID}. Ownership is
// not a role change: it goes through POST /orgs/{org}/transfer-ownership so the
// organization is never left without an owner, or with two.
type OrgMemberRoleSDI struct {
	Role string `json:"role" enum:"admin,member" description:"Vai trò mới trong tổ chức" example:"admin"`
}
