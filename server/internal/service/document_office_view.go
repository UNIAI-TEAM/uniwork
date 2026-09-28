package service

import (
	"errors"
	"strconv"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/office"
)

// Handler-facing view of the office boundary (G2-07a / UNI-690). The handler
// tier must not import internal/office (ADR 0021 leaf guard, G2-02): the
// operation/format allowlists, the pinned identity, the error table and the
// error classification the HTTP layer needs are exposed here, and the engine
// client is built through NewOfficeEngineClient. Only internal/service and
// cmd/server ever name internal/office.

// OfficeBoundaryView is one typed engine failure in the handler's vocabulary:
// the status/code/kind/retryable the HTTP error envelope carries.
type OfficeBoundaryView struct {
	Status    int
	Code      string
	Reason    string
	Kind      string
	Retryable bool
}

// OfficeBoundaryError unwraps an error to the engine boundary's typed failure.
func OfficeBoundaryError(err error) (OfficeBoundaryView, bool) {
	var ee *office.EngineError
	if !errors.As(err, &ee) {
		return OfficeBoundaryView{}, false
	}
	return OfficeBoundaryView{Status: ee.Status, Code: ee.Code, Reason: ee.Reason, Kind: ee.Kind, Retryable: ee.Retryable}, true
}

// IsOfficeNotConfigured reports the deployment error "no engine is wired":
// office routes answer office_not_configured, and nothing else changes.
func IsOfficeNotConfigured(err error) bool { return errors.Is(err, office.ErrNotConfigured) }

// IsOfficeServiceAuth reports the deployment error "the engine refused the
// service credential".
func IsOfficeServiceAuth(err error) bool { return errors.Is(err, office.ErrServiceAuth) }

// OfficeErrorClassification labels a settled job's error code for the SDO:
// the contract's kind and retry flag. ok=false means the code is outside the
// pinned table and the DTO carries code/reason only.
func OfficeErrorClassification(code string) (kind string, retryable bool, ok bool) {
	spec, found := office.ErrorCodes[code]
	if !found {
		return "", false, false
	}
	return spec.Kind, spec.Retryable, true
}

// OfficeEngineIdentity is the pinned identity a job SDO reports: name,
// version, contract and protocol.
func OfficeEngineIdentity() (name, version, contract, protocol string) {
	return "genoffice", office.TrustedEngineVersion, office.ContractVersion, strconv.Itoa(office.ProtocolVersion)
}

// ValidOfficeOperation reports whether raw names an operation the job route
// accepts (open, serialize, export, convert). The service parses the string
// again when it runs the command; the handler uses this to answer 400 before
// the service is touched.
func ValidOfficeOperation(raw string) bool {
	_, ok := parseOfficeOperation(raw)
	return ok
}

// ValidOfficeFormat reports whether raw names one of the six document formats.
func ValidOfficeFormat(raw string) bool {
	_, ok := parseOfficeFormat(raw)
	return ok
}

// parseOfficeOperation maps the wire string onto the boundary operation.
func parseOfficeOperation(raw string) (office.Operation, bool) {
	switch op := office.Operation(strings.TrimSpace(raw)); op {
	case office.OperationOpen, office.OperationSerialize, office.OperationExport, office.OperationConvert:
		return op, true
	}
	return "", false
}

// parseOfficeFormat maps the wire string onto the boundary format.
func parseOfficeFormat(raw string) (office.Format, bool) {
	switch format := office.Format(strings.TrimSpace(raw)); format {
	case office.FormatDOCX, office.FormatXLSX, office.FormatPPTX, office.FormatPDF, office.FormatMD, office.FormatHTML:
		return format, true
	}
	return "", false
}

// NewOfficeEngineClient builds the engine transport from a deployment URL.
// The composition root uses it; tests in other tiers use it to stand the
// service up without importing internal/office themselves.
func NewOfficeEngineClient(baseURL, serviceToken, grantKey string) (OfficeEngine, error) {
	return office.NewClient(office.Config{BaseURL: baseURL, ServiceToken: serviceToken, GrantKey: grantKey}, nil)
}
