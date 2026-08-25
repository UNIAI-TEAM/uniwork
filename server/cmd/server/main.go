package main

import (
	"net/http"
	"os"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/handler"
	"github.com/unicomhub/uniwork/server/internal/logger"
)

func main() {
	log := logger.New()
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}
	h := handler.New(handler.Deps{Cfg: cfg, Log: log})
	log.Info("listening", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, h); err != nil {
		log.Error("server", "err", err)
		os.Exit(1)
	}
}
