package handler

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/unicomhub/uniwork/server/internal/config"
)

type Deps struct {
	Cfg config.Config
	Log *slog.Logger
}

type handlers struct {
	Deps
}

func New(d Deps) http.Handler {
	h := &handlers{Deps: d}
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{d.Cfg.FrontendOrigin},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))
	r.Get("/healthz", h.health)
	r.Route("/api/v1", func(r chi.Router) {
		// domains mount thêm ở các task sau
	})
	return r
}
