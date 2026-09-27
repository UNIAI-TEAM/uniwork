package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// decodeErrBody reads the raw error envelope so the test can tell an absent
// error_class key apart from an empty one.
func decodeErrBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("error body is not the envelope: %v (%q)", err, rec.Body.String())
	}
	return body["error"]
}

// mapServiceError is the single place service errors become wire responses;
// the class rides along per the C-01 section 14.5 table while status and
// code stay exactly what they were.
func TestMapServiceErrorStampsErrorClass(t *testing.T) {
	h := &handlers{Deps: Deps{Log: slog.Default()}}
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantClass  string
	}{
		{"not found", service.ErrNotFound, 404, "not_found", "missing"},
		{"forbidden", service.ErrForbidden, 403, "forbidden", "permission"},
		{"idempotency in flight", service.ErrIdempotencyInFlight, 409, "idempotency_in_flight", "conflict"},
		{"revision conflict", service.CheckTaskRevision(1, 2), 422, "revision_conflict", "conflict"},
		{
			"document version conflict",
			service.CodedError{Code: "document_version_conflict", Status: http.StatusConflict, Msg: "x"},
			409, "document_version_conflict", "conflict",
		},
		{
			"quota exceeded",
			service.CodedError{Code: "quota_exceeded", Status: http.StatusForbidden, Msg: "x"},
			403, "quota_exceeded", "quota",
		},
		{
			"engine incompatible",
			service.CodedError{Code: "engine_incompatible", Status: http.StatusConflict, Msg: "x"},
			409, "engine_incompatible", "incompatible",
		},
		{"internal", errors.New("boom"), 500, "internal", ""},
		{"rate limited", service.ErrRateLimited, 429, "rate_limited", ""},
		{"invalid credentials", service.ErrInvalidCredentials, 401, "invalid_credentials", ""},
		{"generic conflict", service.ErrConflict, 409, "conflict", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.mapServiceError(rec, tc.err)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			errObj := decodeErrBody(t, rec)
			if errObj["code"] != tc.wantCode {
				t.Fatalf("code = %v, want %q", errObj["code"], tc.wantCode)
			}
			class, present := errObj["error_class"]
			if tc.wantClass == "" {
				if present {
					t.Fatalf("error_class present (%v) for unclassified code %q", class, tc.wantCode)
				}
				return
			}
			if !present || class != tc.wantClass {
				t.Fatalf("error_class = %v (present %v), want %q", class, present, tc.wantClass)
			}
		})
	}
}

// respondErrorFields keeps error_class alongside fields so a classified code
// loses neither detail nor class.
func TestRespondErrorFieldsKeepsClassAndFields(t *testing.T) {
	rec := httptest.NewRecorder()
	respondErrorFields(rec, http.StatusForbidden, "quota_exceeded", "hết hạn mức", map[string]any{"meter": "storage"})
	errObj := decodeErrBody(t, rec)
	if errObj["error_class"] != "quota" {
		t.Fatalf("error_class = %v, want quota", errObj["error_class"])
	}
	fields, _ := errObj["fields"].(map[string]any)
	if fields["meter"] != "storage" {
		t.Fatalf("fields = %v, want meter=storage", errObj["fields"])
	}
}
