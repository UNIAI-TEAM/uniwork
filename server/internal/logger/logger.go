package logger

import (
	"log/slog"
	"os"

	"github.com/lmittmann/tint"
)

func New() *slog.Logger {
	return slog.New(tint.NewHandler(os.Stderr, &tint.Options{Level: slog.LevelDebug}))
}
