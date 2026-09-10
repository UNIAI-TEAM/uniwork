package service

import (
	"errors"
	"net/http"
)

var (
	ErrNotFound           = errors.New("not_found")
	ErrForbidden          = errors.New("forbidden")
	ErrInvalidCredentials = errors.New("invalid_credentials")
	ErrConflict           = errors.New("conflict")
	// ErrRateLimited: the caller asked again before the per-user gap elapsed
	// (resend verification code).
	ErrRateLimited = errors.New("rate_limited")
	// ErrInvalidCode covers wrong, expired and exhausted verification codes
	// alike; one message so the response does not reveal which.
	ErrInvalidCode = errors.New("invalid_code")
	// ErrEmailUnverified: the action needs a verified email address.
	ErrEmailUnverified = errors.New("email_unverified")
	// ErrInvalidToken covers unknown, expired and used password reset tokens.
	ErrInvalidToken = errors.New("invalid_token")
	// Entitlement gate (F-02). Always wrapped in a CodedError carrying the
	// feature/meter in Fields; errors.Is still matches the sentinel.
	ErrEntitlementRequired  = errors.New("entitlement_required")
	ErrQuotaExceeded        = errors.New("quota_exceeded")
	ErrSubscriptionInactive = errors.New("subscription_inactive")
)

// Organization status values (F-11). Anything but active is closed to the
// organization's own members; only /api/v1/admin reaches it.
const (
	OrganizationActive    = "active"
	OrganizationSuspended = "suspended"
)

// ErrOrganizationSuspended is what every RequireMember answers for a tenant a
// platform admin has suspended; the client shows the "tổ chức tạm ngưng" page.
// Always wrapped by errOrganizationSuspended so handlers get the 403 code and
// errors.Is still matches the sentinel.
var ErrOrganizationSuspended = errors.New("organization_suspended")

func errOrganizationSuspended() error {
	return CodedError{Code: "organization_suspended", Status: http.StatusForbidden, Msg: "tổ chức đang tạm ngưng", Err: ErrOrganizationSuspended}
}

// Organization membership lifecycle (F-03). A deactivated member keeps their
// rows — workspace membership, authored content, history — and is refused at
// every membership gate, so the sentinel is separate from ErrForbidden: the
// client shows "tài khoản bị vô hiệu hóa", not "bạn không có quyền".
var ErrMemberDeactivated = errors.New("member_deactivated")

func errMemberDeactivated() error {
	return CodedError{Code: "member_deactivated", Status: http.StatusForbidden, Msg: "tài khoản của bạn đã bị vô hiệu hóa trong tổ chức này", Err: ErrMemberDeactivated}
}

// ErrLastOwner: an organization always has exactly one owner, so the last one
// cannot leave or be demoted — they transfer ownership first.
var ErrLastOwner = errors.New("last_owner")

func errLastOwner() error {
	return CodedError{Code: "last_owner", Status: http.StatusConflict, Msg: "tổ chức phải có đúng một chủ sở hữu; hãy chuyển quyền trước", Err: ErrLastOwner}
}

// ErrOwnerMustTransfer: an account that owns an organization cannot be
// deleted while it does — the organization would be left without an owner.
var ErrOwnerMustTransfer = errors.New("owner_must_transfer")

func errOwnerMustTransfer() error {
	return CodedError{Code: "owner_must_transfer", Status: http.StatusConflict, Msg: "bạn đang là chủ sở hữu tổ chức; hãy chuyển quyền trước khi xóa tài khoản", Err: ErrOwnerMustTransfer}
}

func errCannotDeactivateSelf() error {
	return coded(http.StatusBadRequest, "cannot_deactivate_self", "không thể tự vô hiệu hóa tài khoản của mình")
}

type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

func Invalid(msg string) error { return ValidationError{Msg: msg} }

// CodedError is a machine-readable API error. Handlers map Code + Status
// onto ErrorSDO without leaking provider SDK strings.
type CodedError struct {
	Code   string
	Status int
	Msg    string
	Err    error
	// Fields is machine-readable detail (meter, limit, current…) for the
	// client to render its own sentence. Optional.
	Fields map[string]any
}

func (e CodedError) Error() string {
	if e.Msg != "" {
		return e.Msg
	}
	return e.Code
}

func (e CodedError) Unwrap() error { return e.Err }

func coded(status int, code, msg string) error {
	return CodedError{Code: code, Status: status, Msg: msg}
}

func codedIs(err error, code string) bool {
	var ce CodedError
	return errors.As(err, &ce) && ce.Code == code
}

func errInvalidState() error {
	return coded(http.StatusConflict, "invalid_meeting_state", "thao tác không hợp lệ với trạng thái cuộc họp hiện tại")
}

func errNotHost() error {
	return coded(http.StatusForbidden, "not_meeting_host", "chỉ chủ tọa hoặc quản trị workspace mới được thực hiện")
}
