package middleware

import (
	"net/http"
	"strings"
)

const cspBaseHeader = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https: data:; " +
	"connect-src 'self' wss:; "

const cspHeader = cspBaseHeader +
	"frame-ancestors 'none'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'"

const attachmentPreviewCSPHeader = cspBaseHeader +
	"frame-ancestors 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'"

const swaggerCSPHeader = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' https: data:; " +
	"font-src 'self' data:; " +
	"connect-src 'self'; " +
	"worker-src 'self' blob:; " +
	"frame-ancestors 'none'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'"

func ContentSecurityPolicy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", contentSecurityPolicyForRequest(r))
		next.ServeHTTP(w, r)
	})
}

func contentSecurityPolicyForRequest(r *http.Request) string {
	if isSwaggerPath(r.URL.Path) {
		return swaggerCSPHeader
	}
	if isAttachmentPreviewDocumentPath(r.URL.Path) {
		return attachmentPreviewCSPHeader
	}
	return cspHeader
}

func isSwaggerPath(path string) bool {
	return path == "/swagger" || strings.HasPrefix(path, "/swagger/")
}

func isAttachmentPreviewDocumentPath(path string) bool {
	return strings.HasPrefix(path, "/api/v1/attachments/") &&
		(strings.HasSuffix(path, "/download") || strings.HasSuffix(path, "/content"))
}
