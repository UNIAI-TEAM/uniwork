package service

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
)

const (
	emailHubLiveSyncInterval            = 2 * time.Second
	emailHubLiveSyncInteractiveInterval = 6 * time.Second
	emailHubInboxSyncInterval           = 8 * time.Second
	emailHubFullSyncInterval            = 45 * time.Second
	emailHubSearchIndexTTL              = 30 * time.Second
)

type emailHubSyncMode int

const (
	emailHubSyncModeInbox emailHubSyncMode = iota
	emailHubSyncModeFull
)

type emailHubSearchIndexKey struct {
	folder string
	query  string
}

type emailHubAccountGate struct {
	syncMu        sync.Mutex
	imapMu        sync.Mutex
	searchMu      sync.Mutex
	watching      int32
	interactive   int32
	lastInboxSync time.Time
	lastFullSync  time.Time
	lastSearchKey emailHubSearchIndexKey
	lastSearchAt  time.Time
}

type emailHubGovernor struct {
	mu                  sync.Mutex
	gates               map[string]*emailHubAccountGate
	mailboxMu           sync.RWMutex
	mailboxMaps         map[string]imapclient.MailboxMap
	bodyPrefetchMu      sync.Mutex
	bodyPrefetchAfter   map[string]time.Time
	bodyPrefetchRunning map[string]bool
}

func newEmailHubGovernor() *emailHubGovernor {
	return &emailHubGovernor{
		gates:       make(map[string]*emailHubAccountGate),
		mailboxMaps: make(map[string]imapclient.MailboxMap),
	}
}

func (g *emailHubGovernor) setMailboxes(accountID string, mailboxes imapclient.MailboxMap) {
	g.mailboxMu.Lock()
	defer g.mailboxMu.Unlock()
	g.mailboxMaps[accountID] = mailboxes
}

func (g *emailHubGovernor) mailboxes(accountID string) (imapclient.MailboxMap, bool) {
	g.mailboxMu.RLock()
	defer g.mailboxMu.RUnlock()
	m, ok := g.mailboxMaps[accountID]
	return m, ok
}

func (g *emailHubGovernor) gate(accountID string) *emailHubAccountGate {
	g.mu.Lock()
	defer g.mu.Unlock()
	gt, ok := g.gates[accountID]
	if !ok {
		gt = &emailHubAccountGate{}
		g.gates[accountID] = gt
	}
	return gt
}

func (g *emailHubGovernor) beginWatch(accountID string) {
	atomic.AddInt32(&g.gate(accountID).watching, 1)
}

func (g *emailHubGovernor) endWatch(accountID string) {
	atomic.AddInt32(&g.gate(accountID).watching, -1)
}

func (g *emailHubGovernor) isWatching(accountID string) bool {
	return atomic.LoadInt32(&g.gate(accountID).watching) > 0
}

func (g *emailHubGovernor) beginInteractive(accountID string) {
	atomic.AddInt32(&g.gate(accountID).interactive, 1)
}

func (g *emailHubGovernor) endInteractive(accountID string) {
	atomic.AddInt32(&g.gate(accountID).interactive, -1)
}

func (g *emailHubGovernor) interactiveActive(accountID string) bool {
	return atomic.LoadInt32(&g.gate(accountID).interactive) > 0
}

func bodyPrefetchKey(accountID, folder string) string {
	return accountID + "\x00" + folder
}

func (g *emailHubGovernor) tryBeginBodyPrefetch(accountID, folder string) bool {
	g.bodyPrefetchMu.Lock()
	defer g.bodyPrefetchMu.Unlock()
	if g.bodyPrefetchRunning == nil {
		g.bodyPrefetchRunning = make(map[string]bool)
	}
	key := bodyPrefetchKey(accountID, folder)
	if g.bodyPrefetchRunning[key] {
		return false
	}
	g.bodyPrefetchRunning[key] = true
	return true
}

func (g *emailHubGovernor) endBodyPrefetch(accountID, folder string) {
	g.bodyPrefetchMu.Lock()
	defer g.bodyPrefetchMu.Unlock()
	delete(g.bodyPrefetchRunning, bodyPrefetchKey(accountID, folder))
}

func (g *emailHubGovernor) deferBodyPrefetch(threadID string, d time.Duration) {
	g.bodyPrefetchMu.Lock()
	defer g.bodyPrefetchMu.Unlock()
	if g.bodyPrefetchAfter == nil {
		g.bodyPrefetchAfter = make(map[string]time.Time)
	}
	g.bodyPrefetchAfter[threadID] = time.Now().UTC().Add(d)
}

func (g *emailHubGovernor) clearBodyPrefetchDefer(threadID string) {
	g.bodyPrefetchMu.Lock()
	defer g.bodyPrefetchMu.Unlock()
	delete(g.bodyPrefetchAfter, threadID)
}

func (g *emailHubGovernor) bodyPrefetchDeferred(threadID string) bool {
	g.bodyPrefetchMu.Lock()
	defer g.bodyPrefetchMu.Unlock()
	until, ok := g.bodyPrefetchAfter[threadID]
	if !ok {
		return false
	}
	if time.Now().UTC().Before(until) {
		return true
	}
	delete(g.bodyPrefetchAfter, threadID)
	return false
}

// withIMAP serializes IMAP connections per account so Gmail is not flooded
// with concurrent dials that can hang indefinitely.
func (g *emailHubGovernor) withIMAP(accountID string, fn func() error) error {
	gt := g.gate(accountID)
	gt.imapMu.Lock()
	defer gt.imapMu.Unlock()
	return fn()
}

// tryWithIMAP runs fn only when no other background IMAP work holds the lock.
func (g *emailHubGovernor) tryWithIMAP(accountID string, fn func() error) bool {
	gt := g.gate(accountID)
	if !gt.imapMu.TryLock() {
		return false
	}
	defer gt.imapMu.Unlock()
	_ = fn()
	return true
}

// shouldIndexSearch reports whether an IMAP search should run for this folder/query pair.
func (g *emailHubGovernor) shouldIndexSearch(accountID, folder, query string) bool {
	key := emailHubSearchIndexKey{folder: folder, query: query}
	gt := g.gate(accountID)
	gt.searchMu.Lock()
	defer gt.searchMu.Unlock()
	if key == gt.lastSearchKey && !gt.lastSearchAt.IsZero() && time.Since(gt.lastSearchAt) < emailHubSearchIndexTTL {
		return false
	}
	gt.lastSearchKey = key
	gt.lastSearchAt = time.Now().UTC()
	return true
}

// trySync serializes sync per account and debounces unless force is set.
// release must be called when sync finishes; ok=false means the call was skipped.
func (g *emailHubGovernor) trySync(accountID string, force, live bool, mode emailHubSyncMode) (release func(), ok bool) {
	gt := g.gate(accountID)
	gt.syncMu.Lock()
	if !force && g.interactiveActive(accountID) {
		if mode != emailHubSyncModeInbox || !live {
			gt.syncMu.Unlock()
			return nil, false
		}
	}
	interval := emailHubFullSyncInterval
	last := gt.lastFullSync
	if mode == emailHubSyncModeInbox {
		interval = emailHubInboxSyncInterval
		last = gt.lastInboxSync
		if live && !force {
			interval = emailHubLiveSyncInterval
			if g.interactiveActive(accountID) {
				interval = emailHubLiveSyncInteractiveInterval
			}
		}
	}
	if !force && !last.IsZero() && time.Since(last) < interval {
		gt.syncMu.Unlock()
		return nil, false
	}
	return func() {
		now := time.Now().UTC()
		if mode == emailHubSyncModeInbox {
			gt.lastInboxSync = now
		} else {
			gt.lastFullSync = now
		}
		gt.syncMu.Unlock()
	}, true
}
