package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// The edit lock routes (UNI-1645 R1-R10) are on the spec with their path
// parameters, status and every wire field of the SDI/SDO, and the four gated
// writes document edit_lock_id. No database needed. A 204 route has no SDO
// and an empty-object SDI no properties, so the catalogue documents neither
// (as for every other such route); those rows check the path only.
func TestDocumentEditLockOpenAPI(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	type operation struct {
		Parameters []struct {
			Name string `json:"name"`
		} `json:"parameters"`
		RequestBody json.RawMessage            `json:"requestBody"`
		Responses   map[string]json.RawMessage `json:"responses"`
	}
	var spec struct {
		Paths      map[string]map[string]*operation `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	const base = "/api/v1/documents/{documentID}"
	routes := []struct {
		method, path, status string
		body                 bool
	}{
		{"get", base + "/edit-lock", "200", false},
		{"post", base + "/edit-lock", "201", true},
		{"post", base + "/edit-lock/{lockID}/heartbeat", "200", false},
		{"delete", base + "/edit-lock/{lockID}", "", false},
		{"post", base + "/edit-lock/take-over", "201", true},
		{"put", base + "/edit-lock/{lockID}/offline-hold", "200", false},
		{"delete", base + "/edit-lock/{lockID}/offline-hold", "200", false},
		{"post", base + "/edit-requests", "201", false},
		{"post", base + "/edit-requests/{requestID}/answer", "200", true},
		{"delete", base + "/edit-requests/{requestID}", "", false},
	}
	for _, rt := range routes {
		op := spec.Paths[rt.path][rt.method]
		if op == nil {
			t.Errorf("%s %s is missing from the spec", strings.ToUpper(rt.method), rt.path)
			continue
		}
		params := map[string]bool{}
		for _, p := range op.Parameters {
			params[p.Name] = true
		}
		for _, want := range []string{"documentID", "lockID", "requestID"} {
			if strings.Contains(rt.path, "{"+want+"}") && !params[want] {
				t.Errorf("%s %s is missing the %s parameter", rt.method, rt.path, want)
			}
		}
		if _, ok := op.Responses[rt.status]; rt.status != "" && !ok {
			t.Errorf("%s %s is missing the %s response", rt.method, rt.path, rt.status)
		}
		if rt.body && len(op.RequestBody) == 0 {
			t.Errorf("%s %s has no request body", rt.method, rt.path)
		}
	}
	for schemaName, fields := range map[string][]string{
		"SdiAcquireDocumentEditLockSDI":   {"editor_id", "client", "move_from_self"},
		"SdiTakeOverDocumentEditLockSDI":  {"editor_id", "client", "expected_lock_id"},
		"SdiAnswerDocumentEditRequestSDI": {"decision", "lock_id"},
		"SdoDocumentEditLockSDO": {
			"lock_id", "document_id", "holder_id", "client", "acquired_at", "expires_at", "offline_hold_until",
			"hold_max_until", "granted_via", "heartbeat_interval_ms", "ttl_ms", "server_time",
		},
		"SdoDocumentEditLockSummarySDO": {
			"lock_id", "holder_id", "holder_name", "holder_avatar_url", "since", "expires_at", "offline_hold_until", "reserved", "held_by_me",
		},
		"SdoDocumentEditLockStateSDO": {"lock", "my_request", "pending_requests", "can_take_over", "can_request", "server_time"},
		"SdoDocumentEditHeartbeatSDO": {"lock_id", "expires_at", "offline_hold_until", "server_time"},
		"SdoDocumentEditRequestSDO": {
			"request_id", "document_id", "requester_id", "requester_name", "holder_id", "status", "created_at", "expires_at", "answered_at",
		},
		"SdiPatchDocumentSDI":            {"edit_lock_id"},
		"SdiCommitDocumentVersionSDI":    {"edit_lock_id"},
		"SdiRestoreDocumentVersionSDI":   {"edit_lock_id"},
		"SdiCommitOfficeFrameVersionSDI": {"edit_lock_id"},
	} {
		schema, ok := spec.Components.Schemas[schemaName]
		if !ok {
			t.Errorf("schema %s is missing from the spec", schemaName)
			continue
		}
		for _, field := range fields {
			if _, ok := schema.Properties[field]; !ok {
				t.Errorf("%s is missing %s", schemaName, field)
			}
		}
	}
}
