package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// BuiltInTaskStatus is one row of the immutable workspace status catalog.
type BuiltInTaskStatus struct {
	Key, Name, Description, Color, Category string
	Position                                float64
}

var builtInTaskStatuses = []BuiltInTaskStatus{
	{Key: "backlog", Name: "Backlog", Description: "Parked work.", Color: "#6b7280", Category: "backlog", Position: 0},
	{Key: "todo", Name: "Todo", Description: "Queued for work.", Color: "#6b7280", Category: "todo", Position: 1024},
	{Key: "in_progress", Name: "In Progress", Description: "Actively being worked on.", Color: "#f59e0b", Category: "in_progress", Position: 2048},
	{Key: "in_review", Name: "In Review", Description: "Waiting on human review.", Color: "#22c55e", Category: "in_review", Position: 3072},
	{Key: "done", Name: "Done", Description: "Completed.", Color: "#3b82f6", Category: "done", Position: 4096},
	{Key: "blocked", Name: "Blocked", Description: "Stalled on a dependency.", Color: "#ef4444", Category: "blocked", Position: 5120},
	{Key: "cancelled", Name: "Cancelled", Description: "Decided not to do.", Color: "#6b7280", Category: "cancelled", Position: 6144},
}

// BuiltInTaskStatuses returns a copy of the canonical seven statuses.
func BuiltInTaskStatuses() []BuiltInTaskStatus {
	return append([]BuiltInTaskStatus(nil), builtInTaskStatuses...)
}

// deriveTaskPrefix keeps [A-Za-z0-9] from the slug, uppercases the first three
// characters, and falls back to UW when nothing remains.
func deriveTaskPrefix(slug string) string {
	var b strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	s := strings.ToUpper(b.String())
	if s == "" {
		return "UW"
	}
	if len(s) > 3 {
		s = s[:3]
	}
	return s
}

func seedBuiltInTaskStatuses(ctx context.Context, q *db.Queries, w db.Workspace) error {
	for _, st := range builtInTaskStatuses {
		if _, err := q.CreateTaskStatus(ctx, db.CreateTaskStatusParams{
			ID:             util.NewID(),
			OrganizationID: w.OrganizationID,
			WorkspaceID:    w.ID,
			Key:            st.Key,
			Name:           st.Name,
			Description:    st.Description,
			Category:       st.Category,
			Color:          st.Color,
			IsSystem:       true,
			Position:       st.Position,
			CreatedBy:      w.CreatedBy,
			CreatedByKind:  "system",
		}); err != nil {
			return err
		}
	}
	return nil
}
