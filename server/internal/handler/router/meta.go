package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// apiHealthPath is liveness again, under /api. The production edge sends only
// /api, /mcp and the OAuth paths to the server; /healthz on the public host
// reaches the web app. The phone's reachability probe (apps/chat-mobile
// lib/reachability.ts) needs an answer from the API itself, so it asks here.
// Like /healthz, it skips the global rate limiter and load shedding: a probe
// refused while the server sheds would put every phone offline.
const apiHealthPath = "/api/v1/healthz"

// tag: meta
//
//	GET /healthz
//	GET /readyz
//	GET /api/v1/healthz (registerAPIHealth)
func registerMeta(root api, r chi.Router, store storage.Storage, h Routes) {
	root.Get("/healthz", h.Health, apiOp{
		summary:     "Liveness",
		description: "Kiểm tra tiến trình còn sống. Trả {status: ok} khi HTTP listener đang chạy.",
		tags:        []string{"meta"},
		sdo:         sdo.StatusSDO{},
	})
	root.Get("/readyz", h.Ready, apiOp{
		summary:     "Readiness",
		description: "Kiểm tra phụ thuộc: DB trả lời trong 500 ms, schema đúng phiên bản binary nhúng, Redis PING nếu cấu hình. 503 kèm từng check khi có check lỗi.",
		tags:        []string{"meta"},
		sdo:         sdo.ReadinessSDO{},
	})
	// Local storage only: S3 objects are reached through the URL storage
	// returned, so this route is not on the OpenAPI spec.
	if local, ok := store.(*storage.LocalStorage); ok {
		r.Get("/uploads/*", func(w http.ResponseWriter, req *http.Request) {
			local.ServeFile(w, req, chi.URLParam(req, "*"))
		})
	}
}

// registerAPIHealth mounts apiHealthPath on the /api/v1 router.
func registerAPIHealth(v1 api, h Routes) {
	v1.Get("/healthz", h.Health, apiOp{
		summary:     "Liveness (dưới /api)",
		description: "Như /healthz, dưới /api để edge đưa tới API: app mobile hỏi đây để biết máy chủ UniWork có trả lời không. Trả {status: ok}.",
		tags:        []string{"meta"},
		sdo:         sdo.StatusSDO{},
	})
}
