package sdo

// ErrorSDO is the envelope for every 4xx/5xx JSON body.
type ErrorSDO struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code" description:"Mã lỗi máy đọc được" example:"invalid_request"`
	Message string `json:"message" description:"Thông báo lỗi dành cho người dùng" example:"invalid json"`
	// Fields carries machine-readable detail for a few codes (quota_exceeded:
	// meter, limit, current, delta). Absent for everything else.
	Fields map[string]any `json:"fields,omitempty" description:"Chi tiết máy đọc được, chỉ có ở một số mã lỗi"`
}

// ReadinessCheckSDO is one dependency probe of /readyz.
type ReadinessCheckSDO struct {
	Name   string `json:"name" description:"db | migrations | redis" example:"db"`
	OK     bool   `json:"ok" description:"Check đạt" example:"true"`
	Detail string `json:"detail,omitempty" description:"Lỗi hoặc phiên bản migration" example:"099_ai_tokens_quota"`
}

// ReadinessSDO is the body of /readyz; 503 carries the same shape.
type ReadinessSDO struct {
	Ready  bool                `json:"ready" description:"Mọi check đạt" example:"true"`
	Checks []ReadinessCheckSDO `json:"checks" description:"Từng check"`
}

// StatusSDO is the body of routes that only acknowledge success.
type StatusSDO struct {
	Status string `json:"status" description:"Kết quả của yêu cầu" example:"ok"`
}
