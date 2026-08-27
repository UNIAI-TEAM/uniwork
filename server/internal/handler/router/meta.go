package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// tag: meta
//
//	GET /healthz
func registerMeta(root api, r chi.Router, store storage.Storage, h Routes) {
	root.Get("/healthz", h.Health, apiOp{
		summary:     "Liveness",
		description: "Kiểm tra tiến trình còn sống. Trả {status: ok} khi HTTP listener đang chạy.",
		tags:        []string{"meta"},
		sdo:         sdo.StatusSDO{},
	})
	// Local storage only: S3 objects are reached through the URL storage
	// returned, so this route is not on the OpenAPI spec.
	if local, ok := store.(*storage.LocalStorage); ok {
		r.Get("/uploads/*", func(w http.ResponseWriter, req *http.Request) {
			local.ServeFile(w, req, chi.URLParam(req, "*"))
		})
	}
}
