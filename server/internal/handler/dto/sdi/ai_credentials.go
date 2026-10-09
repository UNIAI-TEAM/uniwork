package sdi

// Personal AI provider credentials (UNI-1008, ADR 0029). The path carries the
// organization and the provider; the body carries the key and its settings.

// SaveAICredentialSDI is the body of
// PUT /api/v1/orgs/{orgID}/ai/credentials/{aiProvider}. api_key is required
// when nothing is stored yet; left out, the stored key is kept and only the
// label and base URL change. A field left out keeps its stored value; only an
// explicit empty string clears it.
type SaveAICredentialSDI struct {
	APIKey  *string `json:"api_key,omitempty" maxLength:"4096" description:"API key của nhà cung cấp; bắt buộc khi tạo mới, bỏ trống để giữ khóa đã lưu. Không bao giờ được trả lại" example:"sk-proj-0123456789abcdef"`
	BaseURL *string `json:"base_url,omitempty" description:"Endpoint https riêng (bắt buộc với custom); bỏ qua để giữ giá trị đã lưu, chuỗi rỗng để về endpoint mặc định của nhà cung cấp" example:"https://api.example.com/v1"`
	Label   *string `json:"label,omitempty" maxLength:"80" description:"Nhãn hiển thị trong cài đặt; bỏ qua để giữ nhãn đã lưu, chuỗi rỗng để xóa nhãn" example:"Khóa công việc"`
}
