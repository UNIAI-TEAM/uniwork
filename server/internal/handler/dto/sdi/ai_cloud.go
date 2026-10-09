package sdi

// AiCloudMediaSDI is one file sent as bytes (the server never fetches a URL).
type AiCloudMediaSDI struct {
	Mime       string `json:"mime" minLength:"1" description:"MIME type của tệp" example:"image/png"`
	DataBase64 string `json:"data_base64" minLength:"1" description:"Nội dung tệp, base64 chuẩn (chấp nhận tiền tố data:...;base64,)" example:"iVBORw0KGgo="`
}

// AiCloudSearchSDI is POST /api/v1/orgs/{orgID}/ai/cloud/search.
type AiCloudSearchSDI struct {
	Query      string `json:"query" minLength:"1" maxLength:"400" description:"Từ khóa tìm kiếm" example:"báo cáo thị trường cà phê 2026"`
	Kind       string `json:"kind" enum:"web,image" description:"web hoặc image; mặc định web" example:"web"`
	MaxResults int    `json:"max_results" minimum:"1" maximum:"10" description:"Số kết quả, 1..10; mặc định 6" example:"6"`
}

// AiCloudImageSDI is POST /api/v1/orgs/{orgID}/ai/cloud/images.
type AiCloudImageSDI struct {
	Prompt          string            `json:"prompt" minLength:"1" maxLength:"4000" description:"Mô tả ảnh cần tạo" example:"Ảnh minh họa văn phòng xanh, phong cách phẳng"`
	AspectRatio     string            `json:"aspect_ratio,omitempty" description:"1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4…; quy về khổ ngang/dọc/vuông" example:"16:9"`
	ImageSize       string            `json:"image_size,omitempty" description:"1024x1024, 1536x1024, 1024x1536 hoặc auto; ưu tiên hơn aspect_ratio" example:"1536x1024"`
	ReferenceImages []AiCloudMediaSDI `json:"reference_images,omitempty" maxItems:"4" description:"Ảnh tham chiếu PNG/JPEG/WebP, mỗi ảnh ≤ 8 MiB"`
}

// AiCloudAnalyzeSDI is POST /api/v1/orgs/{orgID}/ai/cloud/media/analyze.
type AiCloudAnalyzeSDI struct {
	Requirements string            `json:"requirements" minLength:"1" maxLength:"4000" description:"Người dùng cần gì từ các tệp" example:"Tóm tắt nội dung biểu đồ"`
	Locale       string            `json:"locale,omitempty" description:"vi hoặc en; mặc định vi" example:"vi"`
	Media        []AiCloudMediaSDI `json:"media" minItems:"1" maxItems:"4" description:"1..4 tệp thuộc danh sách MIME cho phép (ảnh png/jpeg/webp/gif, audio mpeg/wav/mp4/webm, video mp4/webm, pdf), tổng ≤ 25 MiB"`
}

// AiCloudTranscribeSDI is POST /api/v1/orgs/{orgID}/ai/cloud/transcribe.
type AiCloudTranscribeSDI struct {
	Prompt string          `json:"prompt,omitempty" maxLength:"4000" description:"Gợi ý từ vựng/ngữ cảnh cho bản ghi" example:"Cuộc họp về ngân sách quý"`
	Audio  AiCloudMediaSDI `json:"audio" description:"Tệp âm thanh ≤ 25 MiB"`
}
