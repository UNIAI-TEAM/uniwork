package office

import (
	"errors"
	"fmt"
)

// EngineError is a typed failure from the engine boundary. Code is always a
// key of ErrorCodes (the contract table pinned by G2-01): a code the engine
// sends that the table does not know is reported as engine_result_invalid, so
// callers branch on a closed set and never on message text.
type EngineError struct {
	Code       string
	Status     int
	ErrorClass string
	Kind       string
	Retryable  bool
	// Reason is the engine's narrow cause (deadline, cpu_limit, q7_blocker,
	// signature, ...). It is diagnostic, not a switch key.
	Reason string
}

func (e *EngineError) Error() string {
	if e.Reason != "" {
		return "office engine: " + e.Code + " (" + e.Reason + ")"
	}
	return "office engine: " + e.Code
}

// NewEngineError builds the typed error for a table code; an unknown code
// becomes engine_result_invalid with the unknown code as the reason.
func NewEngineError(code, reason string) *EngineError {
	spec, ok := ErrorCodes[code]
	if !ok {
		return NewEngineError("engine_result_invalid", "unknown_code:"+code)
	}
	return &EngineError{Code: code, Status: spec.Status, ErrorClass: spec.ErrorClass, Kind: spec.Kind, Retryable: spec.Retryable, Reason: reason}
}

// ErrServiceAuth: the engine refused the service credential. It is a
// deployment error (OFFICE_ENGINE_SERVICE_TOKEN differs), not an engine
// outcome, so it is not one of the table codes.
var ErrServiceAuth = errors.New("office: engine refused the service credential")

// ErrNotConfigured: no engine URL/credentials are configured. Office jobs are
// refused; everything else keeps working.
var ErrNotConfigured = errors.New("office: engine service is not configured")

// ContractViolationError: the engine rejected a request as a wire-schema
// violation. That is a bug on the Go side, never retryable.
type ContractViolationError struct {
	FieldPath string
	Rule      string
}

func (e *ContractViolationError) Error() string {
	return fmt.Sprintf("office: engine contract violation at %s: %s", e.FieldPath, e.Rule)
}

// ErrorCode returns the table code of an engine error, or "" for anything
// else.
func ErrorCode(err error) string {
	var ee *EngineError
	if errors.As(err, &ee) {
		return ee.Code
	}
	return ""
}

// Retryable reports whether the same key and fingerprint may be retried.
// Transport failures are engine_crashed (retryable); contract violations and
// credential failures are not.
func Retryable(err error) bool {
	var ee *EngineError
	return errors.As(err, &ee) && ee.Retryable
}
