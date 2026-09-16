package tablequery

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Rows runs BuildRows and scans each row into a Row, in taskColumns order.
func Rows(ctx context.Context, tx pgx.Tx, r RowsRequest) ([]Row, error) {
	sql, args := BuildRows(r)
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("tablequery: rows: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Row, error) {
		var r Row
		t := &r.Task
		err := row.Scan(
			&t.ID, &t.WorkspaceID, &t.Title, &t.Description, &t.Status, &t.Priority,
			&t.AssigneeID, &t.DueDate, &t.Position, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt,
			&t.Kind, &t.CreatedByKind, &t.AssigneeKind, &t.OrganizationID, &t.Number,
			&t.ProjectID, &t.ParentTaskID, &t.AssigneeType, &t.CreatorType, &t.CreatorID,
			&t.AcceptanceCriteria, &t.ContextRefs, &t.Metadata, &t.Properties, &t.StartDate,
			&t.Stage, &t.OriginType, &t.OriginID, &t.FirstExecutedAt, &t.Revision, &t.LastActivityAt,
			&r.DirectChildCount, &r.SortValue, &r.SortNull,
		)
		return r, err
	})
	if err != nil {
		return nil, fmt.Errorf("tablequery: scan rows: %w", err)
	}
	return out, nil
}

// Count runs a single-value count statement (BuildCountBranch or
// BuildCountQuery).
func Count(ctx context.Context, tx pgx.Tx, sql string, args []any) (int64, error) {
	var n int64
	if err := tx.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		return 0, fmt.Errorf("tablequery: count: %w", err)
	}
	return n, nil
}

// Groups runs BuildGroups for q.
func Groups(ctx context.Context, tx pgx.Tx, q Query) ([]GroupCount, error) {
	sql, args := BuildGroups(q)
	return collectGroups(ctx, tx, q.Group.Kind, sql, args)
}

// Facet runs BuildFacet for one facet kind (status|priority|assignee|project).
func Facet(ctx context.Context, tx pgx.Tx, q Query, kind string) ([]GroupCount, error) {
	switch kind {
	case FacetStatus, FacetPriority, FacetAssignee, FacetProject:
	default:
		return nil, fmt.Errorf("tablequery: unsupported facet %q", kind)
	}
	sql, args := BuildFacet(q, kind)
	return collectGroups(ctx, tx, GroupKind(kind), sql, args)
}

func collectGroups(ctx context.Context, tx pgx.Tx, kind GroupKind, sql string, args []any) ([]GroupCount, error) {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("tablequery: groups: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (GroupCount, error) {
		var (
			key *string
			g   GroupCount
		)
		if err := row.Scan(&key, &g.Predicate.ActorKind, &g.Label, &g.Count); err != nil {
			return g, err
		}
		g.Predicate.Kind = kind
		if key == nil {
			g.Predicate.None = true
		} else {
			g.Predicate.Value = *key
		}
		return g, nil
	})
	if err != nil {
		return nil, fmt.Errorf("tablequery: scan groups: %w", err)
	}
	return out, nil
}
