package ai

import "fmt"

// Error is a gateway refusal with the stable code the API returns (spec F-09
// §5). The gateway fails closed: missing policy, quota, unknown tool, bad
// output — each is one of these, never a silent fallback.
type Error struct {
	Code   string
	Status int
	Msg    string
	Err    error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code + ": " + e.Msg
}

func (e *Error) Unwrap() error { return e.Err }

// Is lets errors.Is(err, ErrQuotaExceeded) match a wrapped copy by code.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func (e *Error) wrap(err error) error {
	return &Error{Code: e.Code, Status: e.Status, Msg: e.Msg, Err: err}
}

var (
	ErrDisabled         = &Error{Code: "ai_disabled", Status: 503, Msg: "AI chưa được cấu hình trên server"}
	ErrQuotaExceeded    = &Error{Code: "ai_quota_exceeded", Status: 402, Msg: "tổ chức đã hết hạn mức token AI của tháng"}
	ErrRateLimited      = &Error{Code: "ai_rate_limited", Status: 429, Msg: "bạn hỏi quá nhanh, thử lại sau một phút"}
	ErrToolNotAllowed   = &Error{Code: "ai_tool_not_allowed", Status: 403, Msg: "mô hình gọi công cụ không được phép"}
	ErrProviderError    = &Error{Code: "ai_provider_error", Status: 502, Msg: "nhà cung cấp AI không trả lời được"}
	ErrOutputInvalid    = &Error{Code: "ai_output_invalid", Status: 502, Msg: "câu trả lời của mô hình không đúng định dạng"}
	ErrContextForbidden = &Error{Code: "ai_context_forbidden", Status: 403, Msg: "bạn không có quyền xem dữ liệu này"}
)

func errPolicy(msg string) error {
	return fmt.Errorf("ai: policy: %s", msg)
}
