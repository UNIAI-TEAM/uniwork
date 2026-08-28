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
)

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

func errInvalidState() error {
	return coded(http.StatusConflict, "invalid_meeting_state", "thao tác không hợp lệ với trạng thái cuộc họp hiện tại")
}

func errNotHost() error {
	return coded(http.StatusForbidden, "not_meeting_host", "chỉ chủ tọa hoặc quản trị workspace mới được thực hiện")
}
