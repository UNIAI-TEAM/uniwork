package service

import "time"

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
}

// ProjectTrashRow is one project on the project trash page.
type ProjectTrashRow struct {
	ID, Title, TrashedBy  string
	TrashedAt, PurgeAfter time.Time
	TaskCount             int
}
