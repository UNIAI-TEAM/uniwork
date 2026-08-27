package service

import "errors"

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
