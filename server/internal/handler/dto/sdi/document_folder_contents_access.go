package sdi

// FolderContentsAccessItemSDI is one principal entry in
// UpdateFolderContentsAccessSDI (UNI-2244 §3.1). Unlike single-document
// DocumentAccessItemSDI, level is always a non-empty grant level ("view",
// "comment", "edit", "manage") — merge never revokes and replace revokes by
// omitting the principal from items.
type FolderContentsAccessItemSDI struct {
	PrincipalType string `json:"principal_type" description:"user, workspace hoặc organization" example:"user"`
	PrincipalID   string `json:"principal_id" description:"ULID người dùng, workspace hoặc tổ chức" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Level         string `json:"level" description:"Bắt buộc: view, comment, edit hoặc manage (manage không nhận cho workspace gốc của tài liệu và organization -> 422 document_access_rejected)" example:"edit"`
}

// UpdateFolderContentsAccessSDI is the body of
// PUT /api/v1/documents/{folderID}/contents-access (UNI-2244 §3.1): bulk
// merge or replace of access grants across every manageable document in a
// folder's subtree, with optional dry_run preview.
type UpdateFolderContentsAccessSDI struct {
	Mode   string                        `json:"mode" description:"merge (thêm vào quyền đã có, lấy mức cao hơn, không hạ) hoặc replace (đặt đúng tập đã chọn và gỡ phần còn lại)" example:"merge"`
	Items  []FolderContentsAccessItemSDI `json:"items" maxItems:"100" description:"0–100 mục phân quyền; danh sách rỗng chỉ hợp lệ với mode=replace (gỡ hết share và đưa tài liệu về Riêng tư); trùng (principal_type, principal_id) -> 422 document_access_rejected" example:"[{\"principal_type\":\"user\",\"principal_id\":\"01J8X4K2M0N1P2Q3R4S5T6U7V8\",\"level\":\"edit\"}]"`
	DryRun bool                          `json:"dry_run,omitempty" description:"true = chỉ tính preview số đếm và cảnh báo trên cây con, không ghi DB, không ghi audit" example:"false"`
}
