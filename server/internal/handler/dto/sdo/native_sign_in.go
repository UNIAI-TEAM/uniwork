package sdo

// NativeSignInSDO is the one answer of every door of the app's own sign-in
// screen (ADR 0047 §8, spec §3.6): a device session, the second factor still
// owed, or a ticket for the app's choice screen. The app stores the session
// only when it parses; the ticket and the challenge stay in memory only.
type NativeSignInSDO struct {
	Status      string             `json:"status" enum:"signed_in,mfa_required,identity_unmatched,link_required" description:"signed_in: có session; mfa_required: gửi mfa_token và mã ở POST /auth/native/mfa; identity_unmatched: không khớp tài khoản nào, màn chọn với ticket; link_required: email đã có tài khoản, đăng nhập vào đó để liên kết" example:"signed_in"`
	Session     *DesktopSessionSDO `json:"session,omitempty" description:"Phiên thiết bị native, chỉ khi signed_in (cùng hình với /auth/desktop/exchange)"`
	Reclaimed   bool               `json:"reclaimed" description:"true khi lần đăng nhập này vừa lấy lại tài khoản đăng ký trước khi email được xác minh (mật khẩu, xác thực hai lớp và mọi phiên của người đăng ký trước đã bị xoá); app báo một lần" example:"false"`
	LinkSkipped string             `json:"link_skipped" description:"Sau bước hai mang liên kết Google/Apple đang chờ: đăng nhập thành công nhưng chưa liên kết được, kèm mã lý do (sign_in_method_taken, link_required, sign_in_account_conflict, sign_in_account_unverified, sign_in_email_unverified, sign_in_failed); rỗng khi không có gì bị bỏ qua" example:""`
	MFAToken    string             `json:"mfa_token,omitempty" description:"Token thử thách 5 phút gắn với client và deployment này, chỉ khi mfa_required" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mfa"`
	Ticket      string             `json:"ticket,omitempty" description:"Vé đăng nhập 15 phút cho màn chọn, chỉ khi identity_unmatched hay link_required; chỉ dùng được cùng nonce gốc, client và deployment này" example:"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw…"`
	Identity    *NativeIdentitySDO `json:"identity,omitempty" description:"Danh tính nhà cung cấp màn chọn hiện, chỉ khi có ticket"`
}

// NativeIdentitySDO is what the app's choice screen shows of a pending
// provider sign-in.
type NativeIdentitySDO struct {
	Provider     string `json:"provider" enum:"google,apple" description:"Nhà cung cấp của lượt đăng nhập đang chờ" example:"apple"`
	Email        string `json:"email" description:"Email nhà cung cấp cho; có thể là email ẩn của Apple" example:"an@icloud.com"`
	Name         string `json:"name" description:"Tên nhà cung cấp cho; rỗng thì màn tạo tài khoản hỏi tên hiển thị" example:"Nguyễn Văn An"`
	PrivateRelay bool   `json:"private_relay" description:"true khi email là địa chỉ ẩn của Apple (Hide My Email)" example:"false"`
}
