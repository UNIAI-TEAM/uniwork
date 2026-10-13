package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
)

// The save body is optional (UNI-1305 item C): no content, a chunked request
// that sends nothing and blank bytes all leave the input empty; anything else
// is decoded like every JSON body.
func TestDecodeOptionalBody(t *testing.T) {
	chunked := func(body string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/", io.NopCloser(strings.NewReader(body)))
		r.ContentLength = -1 // Transfer-Encoding: chunked
		return r
	}
	cases := []struct {
		name       string
		req        *http.Request
		wantOK     bool
		wantStatus int
		wantTitle  string
	}{
		{"no body", httptest.NewRequest(http.MethodPost, "/", nil), true, http.StatusOK, ""},
		{"empty chunked body", chunked(""), true, http.StatusOK, ""},
		{"blank chunked body", chunked(" \n"), true, http.StatusOK, ""},
		{"json body", chunked(`{"title":"Báo cáo"}`), true, http.StatusOK, "Báo cáo"},
		{"empty object", chunked(`{}`), true, http.StatusOK, ""},
		{"broken json", chunked(`{"title":`), false, http.StatusBadRequest, ""},
		{"not json", chunked(`title`), false, http.StatusBadRequest, ""},
		{"over the cap", chunked(`{"title":"` + strings.Repeat("x", maxJSONBody) + `"}`), false, http.StatusRequestEntityTooLarge, ""},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		var in sdi.SaveSourceFileSDI
		if ok := decodeOptionalBody(rec, c.req, &in); ok != c.wantOK {
			t.Errorf("%s: ok = %v, want %v", c.name, ok, c.wantOK)
		}
		if !c.wantOK && rec.Code != c.wantStatus {
			t.Errorf("%s: status = %d, want %d", c.name, rec.Code, c.wantStatus)
		}
		if got := optionalField(in.Title); got != c.wantTitle {
			t.Errorf("%s: title = %q, want %q", c.name, got, c.wantTitle)
		}
	}
}
