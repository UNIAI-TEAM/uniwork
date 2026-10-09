package sdo

// AiCloudToolsDTO says which cloud tools the caller can use right now.
type AiCloudToolsDTO struct {
	WebSearch     bool `json:"web_search" example:"true"`
	ImageSearch   bool `json:"image_search" example:"true"`
	ImageGenerate bool `json:"image_generate" example:"true"`
	MediaAnalyze  bool `json:"media_analyze" example:"true"`
	Transcribe    bool `json:"transcribe" example:"false"`
}

// AiCloudCreditsDTO is the ai.tokens meter of the current billing period.
type AiCloudCreditsDTO struct {
	Unit      string  `json:"unit" example:"ai.tokens"`
	Used      int64   `json:"used" example:"12500"`
	Limit     *int64  `json:"limit" description:"null = không giới hạn" example:"100000"`
	Remaining *int64  `json:"remaining" description:"null = không giới hạn" example:"87500"`
	PeriodEnd *string `json:"period_end" description:"RFC3339; null khi không rõ" example:"2026-11-01T00:00:00Z"`
}

// AiCloudStatusSDO is GET /api/v1/orgs/{orgID}/ai/cloud.
type AiCloudStatusSDO struct {
	Enabled bool              `json:"enabled" example:"true"`
	Reason  string            `json:"reason,omitempty" description:"Khi enabled=false: entitlement_required, subscription_inactive hoặc cloud_unavailable" example:"entitlement_required"`
	Tools   AiCloudToolsDTO   `json:"tools"`
	Credits AiCloudCreditsDTO `json:"credits"`
}

// AiCloudSearchResultDTO is one search hit.
type AiCloudSearchResultDTO struct {
	Title        string `json:"title" example:"Thị trường cà phê 2026"`
	URL          string `json:"url" example:"https://example.com/bao-cao"`
	Snippet      string `json:"snippet" example:"Giá cà phê tăng 12%…"`
	ImageURL     string `json:"image_url,omitempty" example:"https://example.com/anh.png"`
	ThumbnailURL string `json:"thumbnail_url,omitempty" example:"https://example.com/anh-nho.png"`
}

// AiCloudSearchSDO is POST /api/v1/orgs/{orgID}/ai/cloud/search.
type AiCloudSearchSDO struct {
	Results []AiCloudSearchResultDTO `json:"results"`
	Answer  string                   `json:"answer,omitempty" description:"Câu trả lời tóm tắt khi nhà cung cấp có" example:"Giá cà phê năm 2026 tăng."`
}

// AiCloudMediaDTO is one generated file, base64.
type AiCloudMediaDTO struct {
	Mime       string `json:"mime" example:"image/png"`
	DataBase64 string `json:"data_base64" example:"iVBORw0KGgo="`
}

// AiCloudImageSDO is POST /api/v1/orgs/{orgID}/ai/cloud/images.
type AiCloudImageSDO struct {
	Images []AiCloudMediaDTO `json:"images"`
	Model  string            `json:"model" example:"gpt-image-1"`
}

// AiCloudTextSDO is the answer of media analysis and transcription.
type AiCloudTextSDO struct {
	Text string `json:"text" example:"Biểu đồ cho thấy doanh thu tăng đều."`
}
