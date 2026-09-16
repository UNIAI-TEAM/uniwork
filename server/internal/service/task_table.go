package service

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/db/tablequery"
)

// TableQueryInput is the shared request for TableGroups / TableRows /
// TableFacets (spec 2026-09-16 §3.1).
type TableQueryInput struct {
	Filter    tablequery.Filter
	Search    string
	SortField string // position|title|created_at|updated_at|start_date|due_date|status|priority|property:<id>
	SortDir   string // asc|desc
	GroupBy   string // none|status|priority|assignee|project|property:<id>
	Hierarchy bool
}

// TableRowsInput is one page request of table rows.
type TableRowsInput struct {
	TableQueryInput
	GroupKey *string // required when GroupBy != none, nil when none
	ParentID *string // only with Hierarchy
	Cursor   *string
	Limit    int32 // 1..100, default 50
}

// TableFacetsInput asks for facet counts; GroupBy is ignored.
type TableFacetsInput struct {
	TableQueryInput
	Facets []string // status|priority|assignee|project; empty = status, priority
}

// TableGroupValue is the stable group descriptor value for table mode.
type TableGroupValue struct {
	Kind       string         `json:"kind"`
	Status     string         `json:"status,omitempty"`
	Priority   string         `json:"priority,omitempty"`
	Actor      *TableActorRef `json:"actor,omitempty"`
	ProjectID  string         `json:"project_id,omitempty"`
	PropertyID string         `json:"property_id,omitempty"`
	Option     string         `json:"option,omitempty"` // select option value or "true"/"false"
	Label      string         `json:"label,omitempty"`
}

// TableActorRef is an assignee key for group_by=assignee.
type TableActorRef struct {
	Type string `json:"type"` // human|agent
	ID   string `json:"id"`
}

// TableGroupDescriptor is one bucket in TableGroups.
type TableGroupDescriptor struct {
	Key   string
	Value TableGroupValue
	Count int64
}

// TableGroupsResult is POST .../tasks/table/groups.
type TableGroupsResult struct {
	QueryFingerprint string
	Total            int64
	Groups           []TableGroupDescriptor
}

// TableRowLabel is a label attached to a table row.
type TableRowLabel struct{ ID, Name, Color string }

// TableRow is one row in TableRows.
type TableRow struct {
	Task             db.Task
	DirectChildCount int64
	Labels           []TableRowLabel // never nil
}

// TableRowsResult is POST .../tasks/table/rows. Total counts the whole
// branch (group roots or children of ParentID) across every page.
type TableRowsResult struct {
	QueryFingerprint string
	GroupKey         *string
	ParentID         *string
	Total            int64
	Rows             []TableRow
	NextCursor       *string
}

// TableFacetValue is one facet bucket; Key is the raw value ("" = none).
type TableFacetValue struct {
	Key   string
	Count int64
}

// TableFacet is one requested facet dimension.
type TableFacet struct {
	Kind   string
	Values []TableFacetValue
}

// TableFacetsResult is POST .../tasks/table/facets.
type TableFacetsResult struct {
	QueryFingerprint string
	Total            int64
	Facets           []TableFacet
}

// beginTableRead opens the snapshot every table read counts and pages in.
func (s *TaskService) beginTableRead(ctx context.Context) (pgx.Tx, error) {
	return s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
}

func (s *TaskService) TableGroups(ctx context.Context, actor Actor, workspaceID string, in TableQueryInput) (TableGroupsResult, error) {
	r, err := s.resolveTableQuery(ctx, actor, workspaceID, in, true)
	if err != nil {
		return TableGroupsResult{}, err
	}
	tx, err := s.beginTableRead(ctx)
	if err != nil {
		return TableGroupsResult{}, err
	}
	defer tx.Rollback(ctx)

	countSQL, countArgs := tablequery.BuildCountQuery(r.query)
	total, err := tablequery.Count(ctx, tx, countSQL, countArgs)
	if err != nil {
		return TableGroupsResult{}, err
	}
	groups := []TableGroupDescriptor{}
	if r.query.Group.Kind != tablequery.GroupKindNone {
		counts, err := tablequery.Groups(ctx, tx, r.query)
		if err != nil {
			return TableGroupsResult{}, err
		}
		for _, g := range counts {
			groups = append(groups, TableGroupDescriptor{
				Key:   tablequery.EncodeGroupKey(r.query.Group, g.Predicate),
				Value: tableGroupValue(r.query.Group, g, r.optionLabels),
				Count: g.Count,
			})
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return TableGroupsResult{}, err
	}
	return TableGroupsResult{QueryFingerprint: r.fingerprint, Total: total, Groups: groups}, nil
}

func (s *TaskService) TableRows(ctx context.Context, actor Actor, workspaceID string, in TableRowsInput) (TableRowsResult, error) {
	r, err := s.resolveTableQuery(ctx, actor, workspaceID, in.TableQueryInput, true)
	if err != nil {
		return TableRowsResult{}, err
	}
	if in.ParentID != nil && !r.query.Hierarchy {
		return TableRowsResult{}, coded(http.StatusBadRequest, "parent_requires_hierarchy", "parent_id requires hierarchy")
	}
	pred, err := decodeTableGroupKey(r.query.Group, in.GroupKey)
	if err != nil {
		return TableRowsResult{}, err
	}
	limit := int(in.Limit)
	switch {
	case limit <= 0:
		limit = defaultTableRowsLimit
	case limit > maxTableRowsLimit:
		limit = maxTableRowsLimit
	}
	var after *tablequery.Cursor
	if in.Cursor != nil {
		c, err := tablequery.DecodeCursor(*in.Cursor)
		if err != nil {
			return TableRowsResult{}, coded(http.StatusBadRequest, "invalid_cursor", "cursor is invalid")
		}
		if c.FP != r.fingerprint || !equalStringPtr(c.GroupKey, in.GroupKey) || !equalStringPtr(c.ParentID, in.ParentID) {
			return TableRowsResult{}, coded(http.StatusConflict, "cursor_query_mismatch", "cursor belongs to a different query")
		}
		if err := tablequery.ValidateCursorSortValue(r.query, c); err != nil {
			return TableRowsResult{}, coded(http.StatusBadRequest, "invalid_cursor", "cursor is invalid")
		}
		after = &c
	}

	tx, err := s.beginTableRead(ctx)
	if err != nil {
		return TableRowsResult{}, err
	}
	defer tx.Rollback(ctx)

	req := tablequery.RowsRequest{Query: r.query, Group: pred, ParentID: in.ParentID, After: after, Limit: limit}
	page, err := tablequery.Rows(ctx, tx, req)
	if err != nil {
		return TableRowsResult{}, err
	}
	countSQL, countArgs := tablequery.BuildCountBranch(req)
	total, err := tablequery.Count(ctx, tx, countSQL, countArgs)
	if err != nil {
		return TableRowsResult{}, err
	}
	var next *string
	if len(page) > limit {
		page = page[:limit]
		last := page[limit-1]
		token := tablequery.EncodeCursor(tablequery.Cursor{
			V: 1, FP: r.fingerprint, GroupKey: in.GroupKey, ParentID: in.ParentID,
			SortValue: last.SortValue, SortNull: last.SortNull,
			CreatedAt: last.Task.CreatedAt.Time.Format(time.RFC3339Nano), ID: last.Task.ID,
		})
		next = &token
	}
	rows, err := s.tableRowsWithLabels(ctx, s.q.WithTx(tx), r.query, page)
	if err != nil {
		return TableRowsResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TableRowsResult{}, err
	}
	return TableRowsResult{
		QueryFingerprint: r.fingerprint,
		GroupKey:         in.GroupKey,
		ParentID:         in.ParentID,
		Total:            total,
		Rows:             rows,
		NextCursor:       next,
	}, nil
}

func (s *TaskService) TableFacets(ctx context.Context, actor Actor, workspaceID string, in TableFacetsInput) (TableFacetsResult, error) {
	r, err := s.resolveTableQuery(ctx, actor, workspaceID, in.TableQueryInput, false)
	if err != nil {
		return TableFacetsResult{}, err
	}
	kinds, err := normalizeTableFacets(in.Facets)
	if err != nil {
		return TableFacetsResult{}, err
	}
	tx, err := s.beginTableRead(ctx)
	if err != nil {
		return TableFacetsResult{}, err
	}
	defer tx.Rollback(ctx)

	countSQL, countArgs := tablequery.BuildCountQuery(r.query)
	total, err := tablequery.Count(ctx, tx, countSQL, countArgs)
	if err != nil {
		return TableFacetsResult{}, err
	}
	facets := make([]TableFacet, 0, len(kinds))
	for _, kind := range kinds {
		counts, err := tablequery.Facet(ctx, tx, r.query, kind)
		if err != nil {
			return TableFacetsResult{}, err
		}
		facets = append(facets, TableFacet{Kind: kind, Values: tableFacetValues(counts)})
	}
	if err := tx.Commit(ctx); err != nil {
		return TableFacetsResult{}, err
	}
	return TableFacetsResult{QueryFingerprint: r.fingerprint, Total: total, Facets: facets}, nil
}

// decodeTableGroupKey enforces that a key is sent exactly when the query is
// grouped, and that it belongs to that grouping.
func decodeTableGroupKey(group tablequery.Group, key *string) (*tablequery.GroupPredicate, error) {
	required := coded(http.StatusBadRequest, "group_key_required", "group_key is required when grouped and must be null otherwise")
	if group.Kind == tablequery.GroupKindNone {
		if key != nil {
			return nil, required
		}
		return nil, nil
	}
	if key == nil {
		return nil, required
	}
	p, err := tablequery.DecodeGroupKey(group, *key)
	if err != nil {
		return nil, coded(http.StatusBadRequest, "invalid_group_key", "group_key does not match group_by")
	}
	return &p, nil
}

// tableFacetValues flattens facet buckets to raw keys. Assignee buckets are
// split by actor kind in SQL; the facet key is the id alone, so equal ids
// merge.
func tableFacetValues(counts []tablequery.GroupCount) []TableFacetValue {
	out := make([]TableFacetValue, 0, len(counts))
	index := map[string]int{}
	for _, g := range counts {
		key := g.Predicate.Value
		if g.Predicate.None {
			key = ""
		}
		if i, ok := index[key]; ok {
			out[i].Count += g.Count
			continue
		}
		index[key] = len(out)
		out = append(out, TableFacetValue{Key: key, Count: g.Count})
	}
	return out
}

// tableRowsWithLabels attaches active labels to every row in one query.
func (s *TaskService) tableRowsWithLabels(ctx context.Context, q *db.Queries, query tablequery.Query, page []tablequery.Row) ([]TableRow, error) {
	rows := make([]TableRow, len(page))
	if len(page) == 0 {
		return rows, nil
	}
	ids := make([]string, len(page))
	for i, row := range page {
		ids[i] = row.Task.ID
	}
	links, err := q.ListLabelsForTasks(ctx, db.ListLabelsForTasksParams{
		OrganizationID: query.OrganizationID, WorkspaceID: query.WorkspaceID, TaskIds: ids,
	})
	if err != nil {
		return nil, err
	}
	byTask := map[string][]TableRowLabel{}
	for _, l := range links {
		byTask[l.TaskID] = append(byTask[l.TaskID], TableRowLabel{ID: l.ID, Name: l.Name, Color: l.Color})
	}
	for i, row := range page {
		labels := byTask[row.Task.ID]
		if labels == nil {
			labels = []TableRowLabel{}
		}
		rows[i] = TableRow{Task: row.Task, DirectChildCount: row.DirectChildCount, Labels: labels}
	}
	return rows, nil
}

func equalStringPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
