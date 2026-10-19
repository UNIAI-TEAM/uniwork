package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// The desktop grants an offline lease with PUT and no body (login-sync contract
// 6.2.1, G5-D1), so an empty body is a new grant, exactly like {}. A body that
// is present still goes through decode: invalid JSON is 400, too large is 413.
func TestPutOfficeOfflineLeaseBodyContract(t *testing.T) {
	w := newIsolationServer(t)
	tn := w.buildTenant(t, "alpha")
	path := "/api/v1/documents/" + tn.ids["fileDocument"] + "/office/offline-lease"

	errorCode := func(raw []byte) string {
		var out sdo.ErrorSDO
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("not an error body: %s", raw)
		}
		return out.Error.Code
	}

	for _, c := range []struct {
		name string
		body isoBody
	}{
		{"no body and no content type", isoBody{noBody: true}},
		{"empty object", isoBody{raw: []byte("{}")}},
	} {
		t.Run(c.name+" grants", func(t *testing.T) {
			status, raw := w.do(t, http.MethodPut, path, tn.token, c.body)
			if status != http.StatusOK {
				t.Fatalf("PUT = %d, want 200: %s", status, raw)
			}
			var out sdo.OfficeOfflineLeaseSDO
			if err := json.Unmarshal(raw, &out); err != nil || out.Lease == "" || out.DocumentID != tn.ids["fileDocument"] {
				t.Fatalf("grant = %+v, err %v: %s", out, err, raw)
			}
		})
	}

	t.Run("a body that is not json is 400", func(t *testing.T) {
		status, raw := w.do(t, http.MethodPut, path, tn.token, isoBody{raw: []byte("not json")})
		if status != http.StatusBadRequest || errorCode(raw) != "invalid_request" {
			t.Fatalf("PUT = %d %s, want 400 invalid_request", status, raw)
		}
	})

	t.Run("a body over the cap is 413", func(t *testing.T) {
		big := []byte(`{"lease":"` + strings.Repeat("a", maxJSONBody) + `"}`)
		status, raw := w.do(t, http.MethodPut, path, tn.token, isoBody{raw: big})
		if status != http.StatusRequestEntityTooLarge || errorCode(raw) != "payload_too_large" {
			t.Fatalf("PUT = %d %s, want 413 payload_too_large", status, raw[:min(len(raw), 200)])
		}
	})
}

func TestEmptyBodyAsObject(t *testing.T) {
	for _, c := range []struct {
		name, body string
		wantOK     bool
	}{
		{"empty", "", true},
		{"object", `{"lease":"x"}`, true},
		{"garbage", "not json", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodPut, "/", strings.NewReader(c.body))
			emptyBodyAsObject(req)
			rec := httptest.NewRecorder()
			var in struct {
				Lease string `json:"lease"`
			}
			if got := decode(rec, req, &in, maxJSONBody); got != c.wantOK {
				t.Fatalf("decode = %v (status %d), want %v", got, rec.Code, c.wantOK)
			}
			if c.name == "object" && in.Lease != "x" {
				t.Fatalf("a present body was altered: %+v", in)
			}
		})
	}
}
