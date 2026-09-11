package service

import (
	"strings"
	"sync"
	"time"
)

const chatPresenceMinGap = 15 * time.Second

var chatPresenceLastPublished sync.Map // key: userID -> time.Time

func shouldPublishPresence(userID string, now time.Time) bool {
	key := strings.ToUpper(strings.TrimSpace(userID))
	if key == "" {
		return false
	}
	if raw, ok := chatPresenceLastPublished.Load(key); ok {
		if now.Sub(raw.(time.Time)) < chatPresenceMinGap {
			return false
		}
	}
	chatPresenceLastPublished.Store(key, now)
	return true
}

func clearPresenceThrottle(userID string) {
	key := strings.ToUpper(strings.TrimSpace(userID))
	if key == "" {
		return
	}
	chatPresenceLastPublished.Delete(key)
}
