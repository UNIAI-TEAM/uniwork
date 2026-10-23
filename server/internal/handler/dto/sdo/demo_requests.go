package sdo

type DemoRequestReceiptSDO struct {
	RequestID string `json:"request_id" description:"ULID yêu cầu đã được lưu"`
}
type DemoRequestDTO struct {
	ID          string `json:"id"`
	FullName    string `json:"full_name"`
	WorkEmail   string `json:"work_email"`
	CompanyName string `json:"company_name"`
	TeamSize    string `json:"team_size"`
	Message     string `json:"message"`
	Locale      string `json:"locale"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}
type DemoRequestSDO struct {
	Request DemoRequestDTO `json:"request"`
}
type DemoRequestListSDO struct {
	Requests []DemoRequestDTO `json:"requests"`
	Total    int64            `json:"total"`
}
