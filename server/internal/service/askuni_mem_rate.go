package service

import (
	"sync"
	"time"
)

type askMemRateEntry struct {
	mu        sync.Mutex
	count     int64
	windowEnd time.Time
}

var askMemRates sync.Map // userID -> *askMemRateEntry

// askMemIncrement counts one Ask UNI hit for userID when Redis is absent.
// Counts are per process, not cluster-wide.
func askMemIncrement(userID string, now time.Time, window time.Duration) int64 {
	raw, _ := askMemRates.LoadOrStore(userID, &askMemRateEntry{})
	entry := raw.(*askMemRateEntry)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if now.After(entry.windowEnd) {
		entry.count = 0
		entry.windowEnd = now.Add(window)
	}
	entry.count++
	return entry.count
}
