package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The API spool sweep (SIZE-OPS2, UNI-1991): readBase spools a legacy version
// (no stored checksum) to os.CreateTemp("", officeSpoolPrefix+"*"), keeps that
// descriptor open for every open() via io.NewSectionReader, and closes and
// removes it on release. After an API crash the file stays in os.TempDir().
// The sweeper removes regular files in os.TempDir() whose name starts with
// officeSpoolPrefix and whose mtime is older than max(1h, 2*MaxDeadline), at
// startup and every 15 minutes. A live spool is read through the descriptor
// held since creation, so removing its name cannot break it; the stale age only
// decides when crash leftovers go.
// Temp files are not business state, so the sweep writes no audit row.
const (
	officeSpoolPrefix = "office-base-"
	// officeSpoolCopyBudget bounds how long readBase may spend copying a legacy
	// storage body into a temp spool file before aborting the reader and
	// deleting the spool.
	officeSpoolCopyBudget = 20 * time.Minute
	// officeSpoolMinStaleAge is the floor for Sweep's mtime cutoff when
	// collecting crash leftovers.
	officeSpoolMinStaleAge   = time.Hour
	officeSpoolSweepInterval = 15 * time.Minute
)

func officeSpoolStaleAge(maxDeadline time.Duration) time.Duration {
	if d := 2 * maxDeadline; d > officeSpoolMinStaleAge {
		return d
	}
	return officeSpoolMinStaleAge
}

// OfficeSpoolSweeper removes stale office-base-* spool files left in the temp
// directory. main.go awaits Run in its shutdown sequence.
type OfficeSpoolSweeper struct {
	dir      string
	staleAge time.Duration
	interval time.Duration
	now      func() time.Time
	log      *slog.Logger
}

// NewOfficeSpoolSweeper builds a sweeper for os.TempDir() with stale age
// max(1h, 2*maxDeadline). A nil logger uses slog.Default().
func NewOfficeSpoolSweeper(maxDeadline time.Duration, log *slog.Logger) *OfficeSpoolSweeper {
	if log == nil {
		log = slog.Default()
	}
	return &OfficeSpoolSweeper{
		dir:      os.TempDir(),
		staleAge: officeSpoolStaleAge(maxDeadline),
		interval: officeSpoolSweepInterval,
		now:      time.Now,
		log:      log,
	}
}

// NewSpoolSweeper builds the spool sweeper using the service's MaxDeadline,
// clock and logger.
func (s *DocumentOfficeService) NewSpoolSweeper() *OfficeSpoolSweeper {
	var maxDL time.Duration
	var log *slog.Logger
	var now func() time.Time
	if s != nil {
		maxDL = s.maxDL
		log = s.log
		now = s.now
	}
	w := NewOfficeSpoolSweeper(maxDL, log)
	if now != nil {
		w.now = now
	}
	return w
}

// SetTempDir replaces the directory scanned by Sweep (tests).
func (w *OfficeSpoolSweeper) SetTempDir(dir string) { w.dir = dir }

// SetClock replaces the clock (tests).
func (w *OfficeSpoolSweeper) SetClock(now func() time.Time) { w.now = now }

// SetStaleAge replaces the stale age threshold (tests).
func (w *OfficeSpoolSweeper) SetStaleAge(d time.Duration) { w.staleAge = d }

// Run sweeps once at start, then every interval, until ctx ends.
func (w *OfficeSpoolSweeper) Run(ctx context.Context) {
	for {
		n, err := w.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.log.Warn("office spool sweep", "err", err)
		}
		if n > 0 {
			w.log.Info("office spool sweep", "removed", n)
		}
		if !retentionPause(ctx, w.interval) {
			return
		}
	}
}

// Sweep runs one pass over the configured temp directory, removing regular
// files with officeSpoolPrefix whose mtime is older than staleAge. Directories
// and symlinks are never removed or followed (os.Lstat).
func (w *OfficeSpoolSweeper) Sweep(ctx context.Context) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	dir := w.dir
	if dir == "" {
		dir = os.TempDir()
	}
	staleAge := w.staleAge
	if staleAge <= 0 {
		staleAge = officeSpoolMinStaleAge
	}
	now := time.Now
	if w.now != nil {
		now = w.now
	}
	cutoff := now().Add(-staleAge)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, stripSpoolPathError(err)
	}
	var removed int
	var errs []error
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return removed, err
		}
		name := entry.Name()
		if !strings.HasPrefix(name, officeSpoolPrefix) {
			continue
		}
		full := filepath.Join(dir, name)
		info, err := os.Lstat(full)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			errs = append(errs, stripSpoolPathError(err))
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		if !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(full); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			errs = append(errs, stripSpoolPathError(err))
			continue
		}
		removed++
	}
	return removed, errors.Join(errs...)
}

// stripSpoolPathError drops the filesystem path from os.PathError so logged
// errors carry only the operation and underlying errno.
func stripSpoolPathError(err error) error {
	var pe *os.PathError
	if errors.As(err, &pe) {
		return fmt.Errorf("%s: %w", pe.Op, pe.Err)
	}
	return err
}
