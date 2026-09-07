package service

import (
	"github.com/unicomhub/uniwork/server/internal/audit"
)

// auditRecorder is the process-wide recorder every service writes through.
//
// It is a package variable rather than a constructor argument on eight
// services because the recorder holds no connection: what makes an audit row
// atomic with the change it describes is the *db.Queries the caller passes in,
// bound to the caller's transaction. Threading an identical stateless value
// through every constructor and every test fixture would buy nothing and would
// make it easy to leave one service with a nil recorder — the one case where
// commands would silently stop being audited.
var auditRecorder = audit.NewRecorder()

// SetAuditCounter attaches the Prometheus counter. Called once from main; the
// zero state (no counter) is what tests run with.
func SetAuditCounter(c audit.Counter) { auditRecorder.Counter = c }
