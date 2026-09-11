package service

import "net/http"

// CapabilityUnavailable is the stable stub error for catalogue routes that
// are registered but not backed by storage or a ported subsystem yet.
func CapabilityUnavailable(reason, msg string) error {
	return CodedError{
		Code:   "capability_unavailable",
		Status: http.StatusUnprocessableEntity,
		Msg:    msg,
		Fields: map[string]any{"reason_code": reason},
	}
}
