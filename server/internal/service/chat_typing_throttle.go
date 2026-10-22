package service

import (
	"sync"
	"sync/atomic"
	"time"
)

const chatTypingMinGap = 2 * time.Second

const chatTypingPruneEvery = time.Minute

var chatTypingLastPublished sync.Map // key: userID|roomID -> time.Time

var chatTypingLastPrune atomic.Int64 // unix nanos

func shouldPublishTyping(userID, roomID string, now time.Time) bool {
	key := userID + "|" + roomID
	if raw, ok := chatTypingLastPublished.Load(key); ok {
		if now.Sub(raw.(time.Time)) < chatTypingMinGap {
			return false
		}
	}
	chatTypingLastPublished.Store(key, now)
	maybePruneTypingMap(now)
	return true
}

func maybePruneTypingMap(now time.Time) {
	last := chatTypingLastPrune.Load()
	if now.UnixNano()-last < int64(chatTypingPruneEvery) {
		return
	}
	if !chatTypingLastPrune.CompareAndSwap(last, now.UnixNano()) {
		return
	}
	chatTypingLastPublished.Range(func(k, v any) bool {
		if now.Sub(v.(time.Time)) > chatTypingMinGap {
			chatTypingLastPublished.Delete(k)
		}
		return true
	})
}
