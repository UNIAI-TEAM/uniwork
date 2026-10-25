package service

import "context"

// AIWriteGate is the one order every AI write path checks (ADR 0044 §6): the
// gate is open, the caller may write, then the budget has room. MCP builds it
// from a principal, Ask UNI from the flag, the ceiling and the mode.
type AIWriteGate struct {
	Open      bool
	OpenCode  string
	Scoped    bool
	ScopeCode string
	// Budget spends one unit and says whether there was room; nil means no
	// budget. BudgetCode is the refusal when there is none, and defaults to
	// "write_rate_limited".
	Budget     func(ctx context.Context) bool
	BudgetCode string
}

// Refusal is the code of why a write may not run, or "" when it may. The
// budget is spent only by a call that would otherwise run.
func (g AIWriteGate) Refusal(ctx context.Context) string {
	switch {
	case !g.Open:
		return g.OpenCode
	case !g.Scoped:
		return g.ScopeCode
	case g.Budget != nil && !g.Budget(ctx):
		if g.BudgetCode == "" {
			return "write_rate_limited"
		}
		return g.BudgetCode
	}
	return ""
}
