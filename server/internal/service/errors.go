package service

import "errors"

var (
	ErrNotFound           = errors.New("not_found")
	ErrForbidden          = errors.New("forbidden")
	ErrInvalidCredentials = errors.New("invalid_credentials")
	ErrConflict           = errors.New("conflict")
)

type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

func Invalid(msg string) error { return ValidationError{Msg: msg} }
