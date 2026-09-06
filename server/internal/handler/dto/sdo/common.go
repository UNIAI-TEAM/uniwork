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

// StatusSDO is the body of routes that only acknowledge success.
type StatusSDO struct {
	Status string `json:"status" description:"Kết quả của yêu cầu" example:"ok"`
}
