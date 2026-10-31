package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A page on another site can sign the browser in only with what it may send
// without a preflight: a form, a text/plain fetch, or a request the browser
// marks cross-site. SameSiteJSON refuses each; the web app (same-site JSON)
// and the native apps (no Sec-Fetch-Site, JSON) pass.
func TestSameSiteJSONRefusesWhatAnotherSiteCanSend(t *testing.T) {
	h := SameSiteJSON(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	cases := []struct {
		name, method, site, contentType string
		want                            int
		code                            string
	}{
		{"web app", http.MethodPost, "same-site", "application/json", http.StatusNoContent, ""},
		{"web app, same origin, charset", http.MethodPost, "same-origin", "application/json; charset=utf-8", http.StatusNoContent, ""},
		{"native app", http.MethodPost, "", "application/json", http.StatusNoContent, ""},
		{"typed address", http.MethodGet, "none", "", http.StatusNoContent, ""},
		{"cross-site json", http.MethodPost, "cross-site", "application/json", http.StatusForbidden, "cross_site_request"},
		{"cross-site read", http.MethodGet, "Cross-Site", "", http.StatusForbidden, "cross_site_request"},
		{"cross-site delete", http.MethodDelete, "cross-site", "", http.StatusForbidden, "cross_site_request"},
		{"form, no fetch metadata", http.MethodPost, "", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"multipart form", http.MethodPost, "same-site", "multipart/form-data; boundary=x", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"text/plain fetch", http.MethodPost, "", "text/plain", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"no content type", http.MethodPost, "", "", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"json lookalike", http.MethodPost, "", "application/jsonp", http.StatusUnsupportedMediaType, "unsupported_media_type"},
		{"delete has no body", http.MethodDelete, "same-site", "", http.StatusNoContent, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "/api/v1/auth/login", strings.NewReader("{}"))
			if tc.site != "" {
				r.Header.Set("Sec-Fetch-Site", tc.site)
			}
			if tc.contentType != "" {
				r.Header.Set("Content-Type", tc.contentType)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d", w.Code, tc.want)
			}
			if tc.code == "" {
				return
			}
			var body struct {
				Error struct{ Code string } `json:"error"`
			}
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil || body.Error.Code != tc.code {
				t.Fatalf("code = %q (%v), want %q", body.Error.Code, err, tc.code)
			}
		})
	}
}
