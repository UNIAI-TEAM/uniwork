package realtime

import (
	"context"
	"sync"
	"time"
)

// scopeGrantCacheMax bounds a grant cache. Past it, decisions are simply not
// remembered until expired entries make room.
const scopeGrantCacheMax = 10_000

type scopeGrantKey struct{ userID, workspaceID, scopeID string }

// grantCache remembers positive scope decisions for ttl. A refusal or a
// failed lookup is never stored, so it is asked again next time.
type grantCache struct {
	ttl time.Duration
	now func() time.Time
	max int

	mu      sync.Mutex
	allowed map[scopeGrantKey]time.Time // expiry
}

func newGrantCache(ttl time.Duration) *grantCache {
	return &grantCache{
		ttl:     ttl,
		now:     time.Now,
		max:     scopeGrantCacheMax,
		allowed: map[scopeGrantKey]time.Time{},
	}
}

// authorize answers from the cache, or asks and remembers a yes.
func (g *grantCache) authorize(
	ctx context.Context, key scopeGrantKey, ask func(context.Context) (bool, error),
) (bool, error) {
	if g.cached(key) {
		return true, nil
	}
	ok, err := ask(ctx)
	if err != nil || !ok {
		return false, err
	}
	g.remember(key)
	return true, nil
}

func (g *grantCache) forget(key scopeGrantKey) {
	g.mu.Lock()
	delete(g.allowed, key)
	g.mu.Unlock()
}

func (g *grantCache) cached(key scopeGrantKey) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	exp, ok := g.allowed[key]
	if !ok {
		return false
	}
	if !g.now().Before(exp) {
		delete(g.allowed, key)
		return false
	}
	return true
}

func (g *grantCache) remember(key scopeGrantKey) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if len(g.allowed) >= g.max {
		for k, exp := range g.allowed {
			if !now.Before(exp) {
				delete(g.allowed, k)
			}
		}
		if len(g.allowed) >= g.max {
			return
		}
	}
	g.allowed[key] = now.Add(g.ttl)
}
