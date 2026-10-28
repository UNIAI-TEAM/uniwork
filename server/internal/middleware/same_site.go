package middleware

import (
	"encoding/json"
	"mime"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// SameSiteJSON guards the public routes that open a session or set a sign-in
// cookie (login, register, the second factor, the password reset, the
// sign-in ticket) against login CSRF (ADR 0049 §9): a page on another site
// must not be able to sign the browser in to an account of its choosing, or
// spend the browser's pending sign-in. It refuses
//
//   - a request the browser marks Sec-Fetch-Site: cross-site (403
//     cross_site_request): same-site is the web app on its own origin,
//     none a typed address;
//   - a body that is not application/json (415 unsupported_media_type): a
//     form or a text/plain fetch is all a cross-site page can send without a
//     CORS preflight, and old browsers send no Sec-Fetch-Site.
//
// Native clients send no Sec-Fetch-Site and post JSON, so they pass. A
// request without a body (GET, DELETE) is held only to the first rule.
func SameSiteJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
			refuse(w, http.StatusForbidden, "cross_site_request", "this request came from another site")
			return
		}
		if carriesBody(r.Method) && !isJSON(r.Header.Get("Content-Type")) {
			refuse(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "send the body as application/json")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func carriesBody(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch
}

func isJSON(contentType string) bool {
	media, _, err := mime.ParseMediaType(contentType)
	return err == nil && media == "application/json"
}

func refuse(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO(code, msg))
}
