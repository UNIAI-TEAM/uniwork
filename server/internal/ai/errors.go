package ai

import (
	"fmt"
	"time"
)

// Error is a gateway refusal with the stable code the API returns (spec F-09
// §5). The gateway fails closed: missing policy, quota, unknown tool, bad
// output — each is one of these, never a silent fallback.
type Error struct {
	Code   string
	Status int
	Msg    string
	Err    error
	// Fields is machine-readable detail the API carries beside the code,
	// mirroring service.CodedError.Fields: the handler sets Retry-After from
	// Fields["retry_after"] (G6-03a A5) and the error envelope shows them.
	// Optional; nil on every refusal that carries none.
	Fields map[string]any
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
	ErrDisabled       = &Error{Code: "ai_disabled", Status: 503, Msg: "AI chưa được cấu hình trên server"}
	ErrQuotaExceeded  = &Error{Code: "ai_quota_exceeded", Status: 402, Msg: "tổ chức đã hết hạn mức token AI của tháng"}
	ErrRateLimited    = &Error{Code: "ai_rate_limited", Status: 429, Msg: "bạn hỏi quá nhanh, thử lại sau một phút"}
	ErrToolNotAllowed = &Error{Code: "ai_tool_not_allowed", Status: 403, Msg: "mô hình gọi công cụ không được phép"}
	ErrProviderError  = &Error{Code: "ai_provider_error", Status: 502, Msg: "nhà cung cấp AI không trả lời được"}
	// ErrProviderTimeout is a call that ran out of time rather than failing:
	// the façade's 55 s deadline (G6-03a A14) or the gateway's own timeout.
	ErrProviderTimeout  = &Error{Code: "ai_provider_timeout", Status: 504, Msg: "nhà cung cấp AI trả lời quá hạn chờ"}
	ErrOutputInvalid    = &Error{Code: "ai_output_invalid", Status: 502, Msg: "câu trả lời của mô hình không đúng định dạng"}
	ErrContextForbidden = &Error{Code: "ai_context_forbidden", Status: 403, Msg: "bạn không có quyền xem dữ liệu này"}

	// BYOK proxy (UNI-1008). Messages never carry the key or the vendor URL.
	ErrProviderNotSupported = &Error{Code: "provider_not_supported", Status: 400, Msg: "nhà cung cấp này không dùng được qua proxy cho thao tác này"}
	ErrBaseURLRefused       = &Error{Code: "base_url_refused", Status: 400, Msg: "địa chỉ nhà cung cấp không được phép (chỉ https, máy chủ công khai)"}
	ErrProxyBadRequest      = &Error{Code: "invalid_request", Status: 400, Msg: "thân yêu cầu không đúng định dạng của nhà cung cấp"}
	ErrProviderAuthFailed   = &Error{Code: "provider_auth_failed", Status: 424, Msg: "nhà cung cấp từ chối khóa API đã lưu"}
	ErrProviderUnreachable  = &Error{Code: "provider_unreachable", Status: 502, Msg: "không kết nối được nhà cung cấp AI"}
	ErrCloudUnavailable     = &Error{Code: "cloud_unavailable", Status: 503, Msg: "công cụ AI đám mây chưa được cấu hình trên server"}
	ErrMediaUnsupported     = &Error{Code: "media_unsupported", Status: 422, Msg: "mô hình không nhận loại tệp này"}
)

func errPolicy(msg string) error {
	return fmt.Errorf("ai: policy: %s", msg)
}

// The wait a vendor 429 asks for is clamped before it reaches a client
// (G6-D1 A5): a vendor that sent no Retry-After is read as 30 s, and a longer
// one never exceeds 300 s.
const (
	rateLimitRetryDefault = 30 * time.Second
	rateLimitRetryMax     = 300 * time.Second
)

// errRateLimited is a vendor 429 as the API answers it (design §3.4/§6.4):
// the ai_rate_limited refusal carrying the wait in Fields["retry_after"], the
// same field the handler sets Retry-After from, so a client can tell "slow
// down" from an outage whatever layer produced the refusal.
func errRateLimited(retry time.Duration) *Error {
	switch {
	case retry <= 0:
		retry = rateLimitRetryDefault
	case retry > rateLimitRetryMax:
		retry = rateLimitRetryMax
	}
	return &Error{Code: ErrRateLimited.Code, Status: ErrRateLimited.Status, Msg: ErrRateLimited.Msg,
		Fields: map[string]any{"retry_after": int(retry / time.Second)}}
}
