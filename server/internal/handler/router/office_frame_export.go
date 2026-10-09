package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// registerOfficeFrameExport is the Docs frame's PDF export (UNI-1013), beside
// registerOfficeFrame and behind the same frame token and flags:
//
//	POST /api/v1/office-frame/documents/{documentID}/export/pdf
//
// limit is the route's own budget: one export holds an engine worker and a
// headless browser for seconds, so it is one counter per user across every
// document (a fixed bucket, not the path, which carries {documentID}).
func registerOfficeFrameExport(r api, h Routes, flags *featureflag.Service, frameAuth func(http.Handler) http.Handler, limit func(http.Handler) http.Handler) {
	if frameAuth == nil {
		// Same as registerOfficeFrame: no frame token service, no frame route.
		frameAuth = func(http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"not found"}}`))
			})
		}
	}
	// Auth first so the flags and the budget see the token's user.
	f := r.With(frameAuth, mw.RequireFeatureFlag(flags, "documents"), limit)
	f.Post("/office-frame/documents/{documentID}/export/pdf", h.ExportOfficeFramePDF, apiOp{
		summary: "Export the frame's document as PDF",
		description: "Frame token only, view access: renders the current DOCX version - or the multipart `file` part, the frame's unsaved edit of it - " +
			"with the Docs renderer on the Office engine and answers the PDF bytes; a multipart `version` field renders that stored version instead. Idempotency-Key (optional) replays the same render. " +
			"No engine or renderer, or a token of a module other than docs -> 501 unsupported_operation / 503 office_not_configured; a render past its deadline -> 504 engine_timeout.",
		tags: []string{"documents"}, sdi: sdi.ExportOfficeFramePDFSDI{}, produces: "application/pdf", auth: true,
	})
}

// frameUser names the user the frame token verified. The export budget runs
// after the frame auth middleware, so the context already carries that user;
// without one the request keeps its address's budget.
func frameUser(r *http.Request) string {
	if uid := mw.UserID(r.Context()); uid != "" {
		return "user:" + uid
	}
	return ""
}
