package service

import (
	"context"
	"log/slog"
	"time"
)

// McpCleanupReport counts what one sweep deleted.
type McpCleanupReport struct{ Attempts, Tokens, Clients int64 }

const mcpSweepEvery = time.Hour

// Sweep deletes authorization attempts expired for a day, tokens expired for a
// week, dynamically registered clients that never got a grant and sat unused
// for 30 days, and metadata-document clients with no grant that were neither
// used nor fetched for a day (spec §6); none of them while a live attempt
// needs the client. Grants are never deleted: settings and audit read them
// long after their tokens are gone.
func (s *McpAuthService) Sweep(ctx context.Context) (McpCleanupReport, error) {
	var r McpCleanupReport
	var err error
	if r.Attempts, err = s.q.DeleteExpiredMcpAuthAttempts(ctx); err != nil {
		return r, err
	}
	if r.Tokens, err = s.q.DeleteExpiredMcpTokens(ctx); err != nil {
		return r, err
	}
	r.Clients, err = s.q.DeleteAbandonedMcpClients(ctx)
	return r, err
}

// Run sweeps once on start and then every hour until ctx ends. Every replica
// runs it: the deletes are idempotent and the rows they touch are never read
// by a live request (an expired token is refused before it is deleted).
func (s *McpAuthService) Run(ctx context.Context) {
	for {
		r, err := s.Sweep(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			slog.Default().Warn("mcp cleanup sweep", "err", err)
		case err == nil && (r.Attempts+r.Tokens+r.Clients) > 0:
			slog.Default().Info("mcp cleanup sweep", "attempts", r.Attempts, "tokens", r.Tokens, "clients", r.Clients)
		}
		if !retentionPause(ctx, mcpSweepEvery) {
			return
		}
	}
}
