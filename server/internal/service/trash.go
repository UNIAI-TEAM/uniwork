package service

import (
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// Task and project trash (UNI-2171): a deleted row keeps its data for
// trashRetention, then the purge worker removes it for good.
const (
	trashRetention = 30 * 24 * time.Hour
	// taskTrashMaxNodes bounds one trash batch (a task and its subtree, or a
	// batch delete with every subtree it names).
	taskTrashMaxNodes = 1000
	trashPageSize     = 50
)

// TrashResult names the batch a trash or restore moved and the rows in it.
type TrashResult struct {
	BatchID string
	IDs     []string
}

// TrashPage is one keyset page of a trash list; NextCursor is empty on the
// last page.
type TrashPage[T any] struct {
	Items      []T
	NextCursor string
}

// TaskTrashRow is one batch root on the task trash page. BatchSize counts the
// root and its descendants in the same batch: what a purge of it removes.
type TaskTrashRow struct {
	ID, Identifier, Title, TrashedBy string
	TrashedAt, PurgeAfter            time.Time
	BatchSize                        int
	// ProjectID and ProjectTitle name the project the task points at when
	// read, a project in the trash included; empty when it has none.
	ProjectID, ProjectTitle string
}

// ProjectTrashRow is one project on the project trash page.
type ProjectTrashRow struct {
	ID, Title, TrashedBy  string
	TrashedAt, PurgeAfter time.Time
	TaskCount             int
	// CanManage is whether the reader may restore or purge it: the rule
	// RestoreProject applies (canManageProject).
	CanManage bool
}

// TrashFilter narrows a trash list. Query matches the name, case-insensitive
// and by containment; TrashedBy is the id of whoever deleted the row. Empty
// means no filter. The same filter must accompany every page of one list: a
// cursor only marks the position.
type TrashFilter struct {
	Query, TrashedBy string
}

// args is the filter as the nullable sqlc parameters: the LIKE wildcards of
// Query are escaped so they match literally.
func (f TrashFilter) args() (query, trashedBy pgtype.Text) {
	if q := strings.TrimSpace(f.Query); q != "" {
		query = pgtype.Text{String: escapeLikePattern(q), Valid: true}
	}
	return query, nullText(f.TrashedBy)
}
