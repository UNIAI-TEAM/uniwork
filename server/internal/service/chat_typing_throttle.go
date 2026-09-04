package service

import (
	"sync"
	"time"
)

const chatTypingMinGap = 2 * time.Second

var chatTypingLastPublished sync.Map // key: userID|roomID -> time.Time

func shouldPublishTyping(userID, roomID string, now time.Time) bool {
	key := userID + "|" + roomID
	if raw, ok := chatTypingLastPublished.Load(key); ok {
		if now.Sub(raw.(time.Time)) < chatTypingMinGap {
			return false
		}
	}
	chatTypingLastPublished.Store(key, now)
	return true
}
