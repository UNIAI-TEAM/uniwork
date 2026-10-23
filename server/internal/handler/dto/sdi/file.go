package sdi

// ResolveFilesSDI is POST /api/v1/workspaces/{workspaceID}/files/resolve.
type ResolveFilesSDI struct {
	FileIDs     []string `json:"file_ids" minItems:"1" maxItems:"100" description:"ULID các tệp người gọi đã tải lên trong workspace (tối đa 100, giữ thứ tự)" example:"[\"01J8X4FILEN1P2Q3R4S5T6U7V8\"]"`
	Disposition string   `json:"disposition,omitempty" enum:"inline,attachment" description:"inline để xem trước (mặc định), attachment để tải về" example:"inline"`
}
