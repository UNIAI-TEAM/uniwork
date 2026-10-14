package service

import (
	"errors"
	"fmt"
	"net/http"
	"time"
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

// ErrPasswordIncorrect: a signed-in caller re-entered their password to
// confirm an action (handing an organization over) and it did not match.
// It is not ErrInvalidCredentials on purpose: that one answers 401, which the
// client reads as an expired session and answers by refreshing and replaying
// the request — the password would be checked, and sent, twice. Login keeps
// 401 invalid_credentials.
var ErrPasswordIncorrect = errors.New("password_incorrect")

func errPasswordIncorrect() error {
	return CodedError{Code: "password_incorrect", Status: http.StatusForbidden, Msg: "mật khẩu không đúng", Err: ErrPasswordIncorrect}
}

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

// ErrOrganizationDeletionScheduled is what both membership gates answer for a
// member of an organization whose deletion is waiting out its five days. The
// owner still passes, so they can download files and cancel.
var ErrOrganizationDeletionScheduled = errors.New("organization_deletion_scheduled")

func errOrganizationDeletionScheduled(at time.Time) error {
	when := at.In(time.FixedZone("ICT", 7*3600)).Format("02/01/2006")
	return CodedError{
		Code:   "organization_deletion_scheduled",
		Status: http.StatusForbidden,
		Msg:    fmt.Sprintf("tổ chức sẽ bị xóa vào %s. Chỉ chủ sở hữu còn vào được.", when),
		Err:    ErrOrganizationDeletionScheduled,
	}
}

// errInvitationForAnotherEmail refuses an invitation redeemed by an account
// whose address is not the one it was sent to. The answer names no address:
// the person holding the link learns only that they must sign in as the
// invitee.
func errInvitationForAnotherEmail() error {
	return CodedError{Code: "invitation_email_mismatch", Status: http.StatusForbidden, Msg: "lời mời này gửi tới một email khác", Err: ErrForbidden}
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

// One account, one organization (ADR 0032). Each sentinel is wrapped in a
// CodedError so the handler writes the code and its details; errors.Is
// still matches the sentinel.
var (
	ErrAlreadyInOrganization      = errors.New("already_in_organization")
	ErrOrganizationSwitchRequired = errors.New("organization_switch_required")
	ErrMemberInOtherOrganization  = errors.New("member_in_other_organization")
)

// errAlreadyInOrganization names the caller's own organization, so the client
// can point them at it; it is theirs, so nothing leaks.
func errAlreadyInOrganization(current OrganizationRef) error {
	return CodedError{
		Code: "already_in_organization", Status: http.StatusConflict,
		Msg:    "mỗi tài khoản chỉ thuộc một tổ chức; hãy rời tổ chức hiện tại trước",
		Err:    ErrAlreadyInOrganization,
		Fields: map[string]any{"organization": current},
	}
}

// errOrganizationSwitchRequired carries the caller's organizations that stand
// in the way and what each one needs before the invitation can be accepted.
func errOrganizationSwitchRequired(conflicts []MembershipConflict) error {
	return CodedError{
		Code: "organization_switch_required", Status: http.StatusConflict,
		Msg:    "bạn đang thuộc một tổ chức khác; cần rời tổ chức đó trước khi tham gia",
		Err:    ErrOrganizationSwitchRequired,
		Fields: map[string]any{"conflicts": conflicts},
	}
}

// errMemberInOtherOrganization refuses a reactivation without naming the
// organization the person moved to: that one is another tenant's business.
func errMemberInOtherOrganization() error {
	return CodedError{
		Code: "member_in_other_organization", Status: http.StatusConflict,
		Msg: "người này đã tham gia một tổ chức khác", Err: ErrMemberInOtherOrganization,
	}
}

// ErrInvitationGone: the invitation exists but no longer lets anybody in. The
// three codes say why, so the invitation page can tell the person, and the
// switch it was part of has rolled back entirely (spec §4.4, AC-10).
var ErrInvitationGone = errors.New("invitation_gone")

func errInvitationExpired() error {
	return CodedError{Code: "invitation_expired", Status: http.StatusGone, Msg: "lời mời đã hết hạn", Err: ErrInvitationGone}
}

func errInvitationRevoked() error {
	return CodedError{Code: "invitation_revoked", Status: http.StatusGone, Msg: "lời mời đã bị thu hồi", Err: ErrInvitationGone}
}

func errInvitationAccepted() error {
	return CodedError{Code: "invitation_accepted", Status: http.StatusGone, Msg: "lời mời đã được dùng", Err: ErrInvitationGone}
}

// errMembershipBusy answers a switch that lost a lock race Postgres had to
// break (a deadlock or a serialization failure). Nothing was changed, and the
// same request sent again decides on what the other one committed.
func errMembershipBusy() error {
	return CodedError{
		Code: "membership_busy", Status: http.StatusConflict,
		Msg: "một thay đổi tổ chức khác đang diễn ra; hãy thử lại", Err: ErrConflict,
	}
}

// Closing an organization (ADR 0032 D5) needs the owner to be its only active
// member and the slug typed back as confirmation.
var (
	ErrOrganizationHasMembers = errors.New("organization_has_members")
	ErrCloseConfirmMismatch   = errors.New("close_confirm_mismatch")
)

func errOrganizationHasMembers() error {
	return CodedError{
		Code: "organization_has_members", Status: http.StatusConflict,
		Msg: "tổ chức vẫn còn thành viên khác; hãy chuyển quyền sở hữu thay vì đóng", Err: ErrOrganizationHasMembers,
	}
}

func errCloseConfirmMismatch() error {
	return CodedError{
		Code: "close_confirm_mismatch", Status: http.StatusBadRequest,
		Msg: "địa chỉ tổ chức nhập lại không khớp", Err: ErrCloseConfirmMismatch,
	}
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

// CodeValue lets transport middleware classify additive error codes without
// importing the service package (which would invert the layer dependency).
func (e CodedError) CodeValue() string { return e.Code }

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

func errNotClerk() error {
	return coded(http.StatusForbidden, "not_meeting_clerk", "chỉ chủ tọa, thư ký hoặc quản trị workspace mới được thực hiện")
}

func errNotProjectEditor() error {
	return coded(http.StatusForbidden, "not_project_editor", "chỉ người tạo, người phụ trách hoặc quản trị workspace mới được sửa dự án")
}
