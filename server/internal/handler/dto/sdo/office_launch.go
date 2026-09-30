package sdo

// OfficeLaunchSessionSDO is returned once by web launch-session creation.
// The ticket is opaque and short-lived; no title, path, bytes or token is
// embedded in it.
type OfficeLaunchSessionSDO struct {
	LaunchTicket string `json:"launch_ticket" description:"Ticket đục dùng một lần, chỉ trả về một lần" example:"ticket_opaque_ticket"`
	LaunchURL    string `json:"launch_url" description:"Deep link exact-match chỉ chứa ticket" example:"uniwork-office://open?ticket=ticket_opaque_ticket"`
	ExpiresAt    string `json:"expires_at" description:"Hạn ticket (RFC3339)" example:"2026-09-29T10:02:00Z"`
	DocumentID   string `json:"document_id" description:"ULID tài liệu được chọn" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Operation    string `json:"operation" description:"Thao tác hiệu lực: view hoặc edit" example:"edit"`
	Version      int32  `json:"version" description:"Version được chọn; 0 = hiện tại" example:"0"`
}

// OfficeLaunchDocumentDTO is the metadata descriptor returned after a
// successful ticket exchange. Bytes and storage URLs are never returned.
type OfficeLaunchDocumentDTO struct {
	ID              string `json:"id" description:"ULID tài liệu" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	OrganizationID  string `json:"organization_id" description:"ULID tổ chức sở hữu" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID     string `json:"workspace_id" description:"ULID workspace sở hữu" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Title           string `json:"title" description:"Tiêu đề tài liệu sau khi kiểm ACL" example:"Q4 plan"`
	Kind            string `json:"kind" description:"launch bridge chỉ nhận file" example:"file"`
	Operation       string `json:"operation" description:"Thao tác hiệu lực: view hoặc edit" example:"edit"`
	Version         int32  `json:"version" description:"Version được chọn; 0 = hiện tại" example:"0"`
	Revision        string `json:"revision" description:"Revision dạng chuỗi thập phân" example:"41"`
	ContractVersion string `json:"contract_version,omitempty" description:"Mã hợp đồng engine theo wire G2" example:"uniwork-office-engine-contract/1"`
	ProtocolVersion string `json:"protocol_version,omitempty" description:"Phiên bản protocol engine dạng chuỗi thập phân theo G2" example:"1"`
	DownloadPath    string `json:"download_path" description:"Route tải first-party; không bao giờ là URL presigned" example:"/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/download"`
}

// OfficeLaunchExchangeSDO is POST /api/v1/office/sessions/exchange.
type OfficeLaunchExchangeSDO struct {
	ReceiptID  string                  `json:"receipt_id" description:"ULID biên nhận redeem; không phải credential" example:"01J8X4RECEIPT1P2Q3R4S5T6U7"`
	Document   OfficeLaunchDocumentDTO `json:"document"`
	RedeemedAt string                  `json:"redeemed_at" description:"Thời điểm redeem nguyên tử (RFC3339)" example:"2026-09-29T10:01:02Z"`
}
