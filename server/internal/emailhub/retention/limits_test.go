package retention

import (
	"testing"
)

func TestFromEnvDefaults(t *testing.T) {
	t.Setenv("EMAIL_HUB_MAX_THREADS_PER_FOLDER", "")
	t.Setenv("EMAIL_HUB_BODY_RETENTION_DAYS", "")
	t.Setenv("EMAIL_HUB_MAX_BODY_CACHED_PER_FOLDER", "")
	t.Setenv("EMAIL_HUB_PREFETCH_MAX_AGE_DAYS", "")

	lim := FromEnv()
	if lim.MaxThreadsPerFolder != defaultMaxThreadsPerFolder {
		t.Fatalf("max threads: got %d want %d", lim.MaxThreadsPerFolder, defaultMaxThreadsPerFolder)
	}
}

func TestFromEnvZeroDisables(t *testing.T) {
	t.Setenv("EMAIL_HUB_MAX_THREADS_PER_FOLDER", "0")
	t.Setenv("EMAIL_HUB_BODY_RETENTION_DAYS", "0")

	lim := FromEnv()
	if lim.MaxThreadsPerFolder != 0 || lim.BodyRetentionDays != 0 {
		t.Fatalf("expected zero overrides, got %+v", lim)
	}
}

func TestFromEnvOverride(t *testing.T) {
	t.Setenv("EMAIL_HUB_PREFETCH_MAX_AGE_DAYS", "7")

	lim := FromEnv()
	if lim.PrefetchMaxAgeDays != 7 {
		t.Fatalf("prefetch age: got %d", lim.PrefetchMaxAgeDays)
	}
}
