package service

import (
	"slices"
	"strings"
)

// Scopes of the MCP connector (ADR 0033). write always brings read with it,
// so a grant holds "read" or "read write".
const (
	mcpScopeWrite     = "write"
	mcpScopeReadWrite = mcpScopeRead + " " + mcpScopeWrite
)

// parseMcpScope normalizes an OAuth scope parameter: empty is read, read and
// write in any order are accepted, anything else is not.
func parseMcpScope(raw string) (string, bool) {
	write := false
	for _, part := range strings.Fields(raw) {
		switch part {
		case mcpScopeRead:
		case mcpScopeWrite:
			write = true
		default:
			return "", false
		}
	}
	if write {
		return mcpScopeReadWrite, true
	}
	return mcpScopeRead, true
}

// mcpScopeHasWrite reports a stored grant or attempt scope that includes write.
func mcpScopeHasWrite(scope string) bool {
	return slices.Contains(strings.Fields(scope), mcpScopeWrite)
}
