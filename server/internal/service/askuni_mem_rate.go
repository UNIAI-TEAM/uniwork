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

// askMemIncrement counts one Ask UNI hit for userID when Redis is absent.
// Counts live on the service, as the per-pod run cap does: per process, not
// cluster-wide.
func (s *AskUNIService) askMemIncrement(userID string, now time.Time, window time.Duration) int64 {
	return memIncrement(&s.askMem, userID, now, window)
}

// memIncrement counts one hit on key in counts, in a window that starts at
// the first hit after the last one ended.
func memIncrement(counts *sync.Map, key string, now time.Time, window time.Duration) int64 {
	raw, _ := counts.LoadOrStore(key, &askMemRateEntry{})
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
