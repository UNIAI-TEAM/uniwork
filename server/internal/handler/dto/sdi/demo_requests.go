package sdi

type CreateDemoRequestSDI struct {
	FullName    string `json:"full_name" description:"Họ và tên" example:"Nguyễn Lan"`
	WorkEmail   string `json:"work_email" description:"Email liên hệ công việc" example:"lan@example.com" format:"email"`
	CompanyName string `json:"company_name" description:"Tên công ty hoặc đội ngũ" example:"Acme"`
	TeamSize    string `json:"team_size" description:"Quy mô đội ngũ" example:"11-50"`
	Message     string `json:"message" description:"Nội dung muốn xem, tối đa 2000 ký tự" example:"Quản lý dự án và cộng tác"`
	Locale      string `json:"locale" description:"Ngôn ngữ liên hệ en hoặc vi" example:"vi"`
}
type UpdateDemoRequestSDI struct {
	Status string `json:"status" description:"new, in_progress hoặc completed" example:"in_progress"`
	Reason string `json:"reason" description:"Lý do cập nhật, tối thiểu 10 ký tự" example:"Đã liên hệ với khách hàng" minLength:"10"`
}
