package featureflags

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// OverrideStore is what the provider reads; *db.Queries satisfies it.
type OverrideStore interface {
	ListActiveFlagOverrides(ctx context.Context) ([]db.FeatureFlagOverride, error)
}

// Scope values of feature_flag_overrides.scope_type, in precedence order.
const (
	ScopeUser         = "user"
	ScopeOrganization = "organization"
	ScopeGlobal       = "global"
)

// CacheTTL bounds how stale an override can be on a node that missed the
// flag.updated event.
const CacheTTL = 30 * time.Second

// DBProvider resolves overrides from feature_flag_overrides: user →
// organization → global, first match wins; expired rows are already
// filtered by the query. The whole table (a few dozen rows at most) is
// cached for CacheTTL and dropped on Invalidate.
type DBProvider struct {
	store OverrideStore
	log   *slog.Logger
	now   func() time.Time

	mu       sync.Mutex
	loadedAt time.Time
	byKey    map[string][]db.FeatureFlagOverride
	warned   bool
}

func NewDBProvider(store OverrideStore, log *slog.Logger) *DBProvider {
	return &DBProvider{store: store, log: log, now: time.Now}
}

func (*DBProvider) Name() string { return "db" }

// Invalidate drops the cache; the next Lookup reloads.
func (p *DBProvider) Invalidate() {
	p.mu.Lock()
	p.loadedAt = time.Time{}
	p.mu.Unlock()
}

func (p *DBProvider) rows(ctx context.Context, key string) []db.FeatureFlagOverride {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.byKey == nil || p.now().Sub(p.loadedAt) > CacheTTL {
		rows, err := p.store.ListActiveFlagOverrides(ctx)
		if err != nil {
			// Keep serving the last snapshot; warn once so a dead database
			// does not turn into a log flood.
			if !p.warned && p.log != nil {
				p.log.Warn("feature flags: override store unavailable, serving cached or default", "err", err)
				p.warned = true
			}
			if p.byKey == nil {
				return nil
			}
			return p.byKey[key]
		}
		p.warned = false
		byKey := make(map[string][]db.FeatureFlagOverride, len(rows))
		for _, r := range rows {
			byKey[r.FlagKey] = append(byKey[r.FlagKey], r)
		}
		p.byKey, p.loadedAt = byKey, p.now()
	}
	return p.byKey[key]
}

// Lookup implements featureflag.Provider.
func (p *DBProvider) Lookup(ctx context.Context, key string) (featureflag.Decision, bool) {
	if p == nil || p.store == nil {
		return featureflag.Decision{}, false
	}
	ec := featureflag.EvalContextFrom(ctx)
	var match *db.FeatureFlagOverride
	best := 3
	rows := p.rows(ctx, key)
	for i := range rows {
		r := &rows[i]
		rank := 3
		switch r.ScopeType {
		case ScopeUser:
			if ec.UserID != "" && r.ScopeID == ec.UserID {
				rank = 0
			}
		case ScopeOrganization:
			if ec.OrganizationID != "" && r.ScopeID == ec.OrganizationID {
				rank = 1
			}
		case ScopeGlobal:
			rank = 2
		}
		if rank < best {
			best, match = rank, r
		}
	}
	if match == nil {
		return featureflag.Decision{}, false
	}
	variant := "off"
	if match.Enabled {
		variant = "on"
	}
	return featureflag.Decision{Key: key, Enabled: match.Enabled, Variant: variant, Reason: featureflag.ReasonOverride, Source: "db"}, true
}

// Invalidator is the outbox consumer for flag.updated: every node drops its
// cache the moment an override is written anywhere.
type Invalidator struct{ p *DBProvider }

func NewInvalidator(p *DBProvider) *Invalidator { return &Invalidator{p: p} }

func (*Invalidator) Name() string     { return "featureflags" }
func (*Invalidator) Topics() []string { return []string{"flag.updated"} }
func (i *Invalidator) Handle(context.Context, outbox.Row) error {
	i.p.Invalidate()
	return nil
}

// NewService is the server's flag service: DB overrides first, then the
// static file and env kill switches from pkg/featureflag (F-11 §7.1). A nil
// store leaves the DB layer out.
func NewService(store OverrideStore, log *slog.Logger) (*featureflag.Service, *DBProvider, error) {
	base, err := featureflag.NewServiceFromEnv(featureflag.WithLogger(log))
	if err != nil {
		return nil, nil, err
	}
	if store == nil {
		return base, nil, nil
	}
	dbp := NewDBProvider(store, log)
	return featureflag.NewService(featureflag.NewChainProvider(dbp, base.Provider()), featureflag.WithLogger(log)), dbp, nil
}
