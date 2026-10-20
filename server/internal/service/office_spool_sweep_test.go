package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOfficeSpoolSweepRemovesOnlyStaleSpoolRegularFiles(t *testing.T) {
	if got := officeSpoolStaleAge(2 * time.Minute); got != time.Hour {
		t.Fatalf("officeSpoolStaleAge(2m) = %v, want 1h", got)
	}
	if got := officeSpoolStaleAge(45 * time.Minute); got != 90*time.Minute {
		t.Fatalf("officeSpoolStaleAge(45m) = %v, want 90m", got)
	}
	if officeSpoolCopyBudget != 20*time.Minute {
		t.Fatalf("officeSpoolCopyBudget = %v, want 20m", officeSpoolCopyBudget)
	}
	if officeSpoolMinStaleAge != time.Hour {
		t.Fatalf("officeSpoolMinStaleAge = %v, want 1h", officeSpoolMinStaleAge)
	}
	if officeSpoolSweepInterval != 15*time.Minute {
		t.Fatalf("officeSpoolSweepInterval = %v, want 15m", officeSpoolSweepInterval)
	}

	dir := t.TempDir()
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	staleAge := 30 * time.Minute
	oldTime := now.Add(-staleAge - time.Minute)
	freshTime := now.Add(-staleAge + time.Minute)

	writeFile := func(name string, mtime time.Time) string {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("spool"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		if err := os.Chtimes(p, mtime, mtime); err != nil {
			t.Fatalf("chtimes %s: %v", name, err)
		}
		return p
	}

	oldSpool := writeFile(officeSpoolPrefix+"stale", oldTime)
	freshSpool := writeFile(officeSpoolPrefix+"fresh", freshTime)
	otherPrefix := writeFile("other-prefix-stale", oldTime)

	oldDir := filepath.Join(dir, officeSpoolPrefix+"dir")
	if err := os.Mkdir(oldDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	oldDirChild := writeFile(filepath.Join(officeSpoolPrefix+"dir", "inside"), oldTime)
	if err := os.Chtimes(oldDir, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes dir: %v", err)
	}

	linkTarget := writeFile("target-outside-prefix", oldTime)
	oldLink := filepath.Join(dir, officeSpoolPrefix+"symlink")
	if err := os.Symlink(linkTarget, oldLink); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	sweeper := NewOfficeSpoolSweeper(2*time.Minute, nil)
	sweeper.SetTempDir(dir)
	sweeper.SetClock(func() time.Time { return now })
	sweeper.SetStaleAge(staleAge)

	removed, err := sweeper.Sweep(context.Background())
	if err != nil {
		t.Fatalf("Sweep error = %v", err)
	}
	if removed != 1 {
		t.Fatalf("Sweep removed = %d, want 1", removed)
	}

	if _, err := os.Lstat(oldSpool); !os.IsNotExist(err) {
		t.Fatalf("old spool still exists: err = %v", err)
	}
	for _, keep := range []string{freshSpool, otherPrefix, oldDir, oldDirChild, oldLink, linkTarget} {
		if _, err := os.Lstat(keep); err != nil {
			t.Fatalf("expected %s to remain, lstat err = %v", filepath.Base(keep), err)
		}
	}
}

func TestOfficeSpoolSweeperStopsOnContextCancel(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	oldTime := now.Add(-2 * time.Hour)

	oldSpool := filepath.Join(dir, officeSpoolPrefix+"startup")
	if err := os.WriteFile(oldSpool, []byte("spool"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Chtimes(oldSpool, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	svc := NewDocumentOfficeService(DocumentOfficeOptions{
		MaxDeadline: 2 * time.Minute,
		Clock:       func() time.Time { return now },
	})
	sweeper := svc.NewSpoolSweeper()
	sweeper.SetTempDir(dir)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		sweeper.Run(ctx)
		close(done)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Lstat(oldSpool); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			<-done
			t.Fatal("startup sweep did not remove stale spool file")
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("sweeper Run did not stop after context cancellation")
	}
}
