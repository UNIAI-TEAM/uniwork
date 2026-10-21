package notification

import (
	"sync"
	"time"
)

// docCommandMemoTTL is how long a per-command lookup answer is kept.
const docCommandMemoTTL = 30 * time.Second

// docCommandMemo remembers the answers of the lookups every event of one
// command repeats - the users the command granted a share to, the owners of
// a trash batch - so a 500-document command reads them once, not 500 times
// (BE-R1-5, the ChatDocumentCardRefresher pattern). The command committed
// before its first event was claimed, so its own rows no longer change; the
// one answer that can is the batch's owner list, when part of the batch is
// restored inside the window, and that costs at most a missed or doubled
// notice for that window. The memory is per process and short; another node
// reads the answer once more. A failed load is not remembered.
type docCommandMemo struct {
	mu        sync.Mutex
	seen      map[string]docCommandMemoEntry
	lastSweep time.Time
	now       func() time.Time
}

type docCommandMemoEntry struct {
	at  time.Time
	ids []string
}

func newDocCommandMemo() *docCommandMemo {
	return &docCommandMemo{seen: map[string]docCommandMemoEntry{}, now: time.Now}
}

// ids returns the remembered answer of key, or loads and remembers it. A nil
// memo always loads.
func (m *docCommandMemo) ids(key string, load func() ([]string, error)) ([]string, error) {
	if m == nil {
		return load()
	}
	m.mu.Lock()
	now := m.now()
	if now.Sub(m.lastSweep) >= docCommandMemoTTL {
		for k, e := range m.seen {
			if now.Sub(e.at) >= docCommandMemoTTL {
				delete(m.seen, k)
			}
		}
		m.lastSweep = now
	}
	e, ok := m.seen[key]
	m.mu.Unlock()
	if ok && now.Sub(e.at) < docCommandMemoTTL {
		return e.ids, nil
	}
	ids, err := load()
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.seen[key] = docCommandMemoEntry{at: now, ids: ids}
	m.mu.Unlock()
	return ids, nil
}
