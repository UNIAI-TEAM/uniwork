package retention

import (
	"os"
	"strconv"
)

// Limits tune Email Hub Postgres cache size. Zero disables a rule.
type Limits struct {
	MaxThreadsPerFolder    int // metadata rows kept per account+folder (non-starred overflow pruned)
	BodyRetentionDays      int // strip cached body when sent_at is older than this
	MaxBodyCachedPerFolder int // max body_cached=true rows per folder; oldest bodies stripped first
	PrefetchMaxAgeDays     int // only prefetch bodies for threads newer than this
}

const (
	defaultMaxThreadsPerFolder    = 2000
	defaultBodyRetentionDays      = 90
	defaultMaxBodyCachedPerFolder = 150
	defaultPrefetchMaxAgeDays     = 14
	pruneBatchSize                = 200
)

// DefaultLimits are used when env vars are unset.
func DefaultLimits() Limits {
	return Limits{
		MaxThreadsPerFolder:    defaultMaxThreadsPerFolder,
		BodyRetentionDays:      defaultBodyRetentionDays,
		MaxBodyCachedPerFolder: defaultMaxBodyCachedPerFolder,
		PrefetchMaxAgeDays:     defaultPrefetchMaxAgeDays,
	}
}

// FromEnv reads EMAIL_HUB_* retention knobs. Invalid or negative values fall back to defaults; explicit 0 disables a rule.
func FromEnv() Limits {
	lim := DefaultLimits()
	if v, ok := envInt("EMAIL_HUB_MAX_THREADS_PER_FOLDER"); ok {
		lim.MaxThreadsPerFolder = v
	}
	if v, ok := envInt("EMAIL_HUB_BODY_RETENTION_DAYS"); ok {
		lim.BodyRetentionDays = v
	}
	if v, ok := envInt("EMAIL_HUB_MAX_BODY_CACHED_PER_FOLDER"); ok {
		lim.MaxBodyCachedPerFolder = v
	}
	if v, ok := envInt("EMAIL_HUB_PREFETCH_MAX_AGE_DAYS"); ok {
		lim.PrefetchMaxAgeDays = v
	}
	return lim
}

// PruneBatchSize caps how many thread ids are processed per retention pass.
func PruneBatchSize() int {
	return pruneBatchSize
}

func envInt(key string) (int, bool) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}
