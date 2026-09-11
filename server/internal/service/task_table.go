package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TableFilter narrows table groups/rows/facets. Empty slices mean no filter.
type TableFilter struct {
	Statuses    []string
	Priorities  []string
	AssigneeIDs []string
	ProjectIDs  []string
}

// TableInput is the shared request for TableGroups / TableRows / TableFacets.
// Plan contract: filter + group_by + columns (facets list for facets only).
type TableInput struct {
	Filter   TableFilter
	GroupBy  string   // status | priority | assignee (default status)
	GroupKey *string  // rows: opaque group key from TableGroups
	Columns  []string // accepted into fingerprint; rows return full tasks
	Facets   []string // facets endpoint: status | priority | assignee
	Limit    int32
	Offset   int32
}

// TableGroupValue is the stable group descriptor value for table mode.
type TableGroupValue struct {
	Kind     string         `json:"kind"`
	Status   string         `json:"status,omitempty"`
	Priority string         `json:"priority,omitempty"`
	Actor    *TableActorRef `json:"actor,omitempty"`
}

// TableActorRef is an assignee key for group_by=assignee.
type TableActorRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// TableGroupDescriptor is one bucket in TableGroups.
type TableGroupDescriptor struct {
	Key   string          `json:"key"`
	Value TableGroupValue `json:"value"`
	Count int64           `json:"count"`
}

// TableGroupsResult is POST .../tasks/table/groups.
type TableGroupsResult struct {
	QueryFingerprint string                 `json:"query_fingerprint"`
	Total            int64                  `json:"total"`
	Groups           []TableGroupDescriptor `json:"groups"`
	NextCursor       *string                `json:"next_cursor"`
}

// TableRow is one row in TableRows (task + direct children count).
type TableRow struct {
	Task             db.Task
	DirectChildCount int64
}

// TableRowsResult is POST .../tasks/table/rows.
type TableRowsResult struct {
	QueryFingerprint string     `json:"query_fingerprint"`
	GroupKey         *string    `json:"group_key"`
	ParentID         *string    `json:"parent_id"`
	Total            int64      `json:"total"`
	Rows             []TableRow `json:"rows"`
	BranchTotal      int64      `json:"branch_total"`
	NextCursor       *string    `json:"next_cursor"`
}

// TableFacetValue is one facet bucket.
type TableFacetValue struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

// TableFacet is one requested facet dimension.
type TableFacet struct {
	Kind   string            `json:"kind"`
	Values []TableFacetValue `json:"values"`
}

// TableFacetsResult is POST .../tasks/table/facets.
type TableFacetsResult struct {
	QueryFingerprint string       `json:"query_fingerprint"`
	Total            int64        `json:"total"`
	Facets           []TableFacet `json:"facets"`
}

func (s *TaskService) TableGroups(ctx context.Context, actor Actor, workspaceID string, in TableInput) (TableGroupsResult, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TableGroupsResult{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TableGroupsResult{}, err
	}
	groupBy, err := normalizeTableGroupBy(in.GroupBy)
	if err != nil {
		return TableGroupsResult{}, err
	}
	fp := tableFingerprint("groups", in, groupBy)
	params := tableFilterParams(ws.OrganizationID, workspaceID, in.Filter)
	total, err := s.q.CountTableTasks(ctx, params)
	if err != nil {
		return TableGroupsResult{}, err
	}
	keys, err := s.countTableGroups(ctx, params, groupBy)
	if err != nil {
		return TableGroupsResult{}, err
	}
	groups := make([]TableGroupDescriptor, 0, len(keys))
	for _, row := range keys {
		groups = append(groups, TableGroupDescriptor{
			Key:   row.Key,
			Count: row.Count,
			Value: tableGroupValue(groupBy, row.Key),
		})
	}
	return TableGroupsResult{
		QueryFingerprint: fp,
		Total:            total,
		Groups:           groups,
		NextCursor:       nil,
	}, nil
}

func (s *TaskService) TableRows(ctx context.Context, actor Actor, workspaceID string, in TableInput) (TableRowsResult, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TableRowsResult{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TableRowsResult{}, err
	}
	groupBy, err := normalizeTableGroupBy(in.GroupBy)
	if err != nil {
		return TableRowsResult{}, err
	}
	if in.Limit <= 0 || in.Limit > maxTaskQueryLimit {
		in.Limit = defaultTaskQueryLimit
	}
	if in.Offset < 0 {
		in.Offset = 0
	}
	fp := tableFingerprint("rows", in, groupBy)
	filter := tableFilterParams(ws.OrganizationID, workspaceID, in.Filter)
	hasGroupKey := in.GroupKey != nil
	groupKey := ""
	if hasGroupKey {
		groupKey = *in.GroupKey
	}
	// Narrow the count to the selected group when group_key is set.
	countFilter := in.Filter
	if hasGroupKey {
		switch groupBy {
		case "priority":
			countFilter.Priorities = []string{groupKey}
		case "assignee":
			if groupKey == "" {
				// Empty key = unassigned; CountTableTasks cannot express
				// "assignee IS NULL" via the assignee_ids ANY filter.
			} else {
				countFilter.AssigneeIDs = []string{groupKey}
			}
		default:
			countFilter.Statuses = []string{groupKey}
		}
	}
	var total int64
	if hasGroupKey && groupBy == "assignee" && groupKey == "" {
		total, err = countUnassigned(ctx, s, filter)
	} else {
		total, err = s.q.CountTableTasks(ctx, tableFilterParams(ws.OrganizationID, workspaceID, countFilter))
	}
	if err != nil {
		return TableRowsResult{}, err
	}
	rows, err := s.q.ListTableTaskRows(ctx, db.ListTableTaskRowsParams{
		OrganizationID:    filter.OrganizationID,
		WorkspaceID:       filter.WorkspaceID,
		HasStatusFilter:   filter.HasStatusFilter,
		Statuses:          filter.Statuses,
		HasPriorityFilter: filter.HasPriorityFilter,
		Priorities:        filter.Priorities,
		HasAssigneeFilter: filter.HasAssigneeFilter,
		AssigneeIds:       filter.AssigneeIds,
		HasProjectFilter:  filter.HasProjectFilter,
		ProjectIds:        filter.ProjectIds,
		HasGroupKey:       hasGroupKey,
		GroupBy:           groupBy,
		GroupKey:          groupKey,
		LimitN:            in.Limit,
		OffsetN:           in.Offset,
	})
	if err != nil {
		return TableRowsResult{}, err
	}
	out := make([]TableRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, TableRow{
			Task:             tableRowToTask(r),
			DirectChildCount: r.DirectChildCount,
		})
	}
	var gk *string
	if hasGroupKey {
		gk = &groupKey
	}
	return TableRowsResult{
		QueryFingerprint: fp,
		GroupKey:         gk,
		ParentID:         nil,
		Total:            total,
		Rows:             out,
		BranchTotal:      int64(len(out)),
		NextCursor:       nil,
	}, nil
}

func (s *TaskService) TableFacets(ctx context.Context, actor Actor, workspaceID string, in TableInput) (TableFacetsResult, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TableFacetsResult{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TableFacetsResult{}, err
	}
	fp := tableFingerprint("facets", in, "")
	base := tableFilterParams(ws.OrganizationID, workspaceID, in.Filter)
	total, err := s.q.CountTableTasks(ctx, base)
	if err != nil {
		return TableFacetsResult{}, err
	}
	kinds := in.Facets
	if len(kinds) == 0 {
		kinds = []string{"status", "priority"}
	}
	facets := make([]TableFacet, 0, len(kinds))
	for _, kind := range kinds {
		kind = strings.TrimSpace(strings.ToLower(kind))
		// Disjunctive: drop this facet's own dimension from the filter.
		f := in.Filter
		switch kind {
		case "status":
			f.Statuses = nil
		case "priority":
			f.Priorities = nil
		case "assignee":
			f.AssigneeIDs = nil
		default:
			return TableFacetsResult{}, Invalid("invalid facets kind: " + kind)
		}
		params := tableFilterParams(ws.OrganizationID, workspaceID, f)
		keys, err := s.countTableGroups(ctx, params, kind)
		if err != nil {
			return TableFacetsResult{}, err
		}
		values := make([]TableFacetValue, 0, len(keys))
		for _, row := range keys {
			values = append(values, TableFacetValue(row))
		}
		facets = append(facets, TableFacet{Kind: kind, Values: values})
	}
	return TableFacetsResult{
		QueryFingerprint: fp,
		Total:            total,
		Facets:           facets,
	}, nil
}

type tableKeyCount struct {
	Key   string
	Count int64
}

func (s *TaskService) countTableGroups(ctx context.Context, params db.CountTableTasksParams, groupBy string) ([]tableKeyCount, error) {
	switch groupBy {
	case "priority":
		rows, err := s.q.CountTableTasksByPriority(ctx, db.CountTableTasksByPriorityParams(params))
		if err != nil {
			return nil, err
		}
		out := make([]tableKeyCount, 0, len(rows))
		for _, r := range rows {
			out = append(out, tableKeyCount{Key: r.Key, Count: r.Count})
		}
		return out, nil
	case "assignee":
		rows, err := s.q.CountTableTasksByAssignee(ctx, db.CountTableTasksByAssigneeParams(params))
		if err != nil {
			return nil, err
		}
		out := make([]tableKeyCount, 0, len(rows))
		for _, r := range rows {
			out = append(out, tableKeyCount{Key: r.Key, Count: r.Count})
		}
		return out, nil
	default:
		rows, err := s.q.CountTableTasksByStatus(ctx, db.CountTableTasksByStatusParams(params))
		if err != nil {
			return nil, err
		}
		out := make([]tableKeyCount, 0, len(rows))
		for _, r := range rows {
			out = append(out, tableKeyCount{Key: r.Key, Count: r.Count})
		}
		return out, nil
	}
}

func countUnassigned(ctx context.Context, s *TaskService, filter db.CountTableTasksParams) (int64, error) {
	rows, err := s.q.CountTableTasksByAssignee(ctx, db.CountTableTasksByAssigneeParams(filter))
	if err != nil {
		return 0, err
	}
	for _, r := range rows {
		if r.Key == "" {
			return r.Count, nil
		}
	}
	return 0, nil
}

func normalizeTableGroupBy(v string) (string, error) {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return "status", nil
	}
	switch v {
	case "status", "priority", "assignee":
		return v, nil
	default:
		return "", coded(http.StatusBadRequest, "invalid_group_by", "group_by must be status, priority, or assignee")
	}
}

func tableGroupValue(groupBy, key string) TableGroupValue {
	switch groupBy {
	case "priority":
		return TableGroupValue{Kind: "priority", Priority: key}
	case "assignee":
		var actor *TableActorRef
		if key != "" {
			actor = &TableActorRef{Type: "member", ID: key}
		}
		return TableGroupValue{Kind: "assignee", Actor: actor}
	default:
		return TableGroupValue{Kind: "status", Status: key}
	}
}

func tableFilterParams(orgID, workspaceID string, f TableFilter) db.CountTableTasksParams {
	statuses := append([]string(nil), f.Statuses...)
	priorities := append([]string(nil), f.Priorities...)
	assignees := append([]string(nil), f.AssigneeIDs...)
	projects := append([]string(nil), f.ProjectIDs...)
	if statuses == nil {
		statuses = []string{}
	}
	if priorities == nil {
		priorities = []string{}
	}
	if assignees == nil {
		assignees = []string{}
	}
	if projects == nil {
		projects = []string{}
	}
	return db.CountTableTasksParams{
		OrganizationID:    orgID,
		WorkspaceID:       workspaceID,
		HasStatusFilter:   len(f.Statuses) > 0,
		Statuses:          statuses,
		HasPriorityFilter: len(f.Priorities) > 0,
		Priorities:        priorities,
		HasAssigneeFilter: len(f.AssigneeIDs) > 0,
		AssigneeIds:       assignees,
		HasProjectFilter:  len(f.ProjectIDs) > 0,
		ProjectIds:        projects,
	}
}

func tableFingerprint(kind string, in TableInput, groupBy string) string {
	payload := map[string]any{
		"kind":     kind,
		"filter":   in.Filter,
		"group_by": groupBy,
		"columns":  sortedCopy(in.Columns),
		"facets":   sortedCopy(in.Facets),
		"group_key": func() any {
			if in.GroupKey == nil {
				return nil
			}
			return *in.GroupKey
		}(),
	}
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:16])
}

func sortedCopy(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func tableRowToTask(r db.ListTableTaskRowsRow) db.Task {
	return db.Task{
		ID:                 r.ID,
		WorkspaceID:        r.WorkspaceID,
		Title:              r.Title,
		Description:        r.Description,
		Status:             r.Status,
		Priority:           r.Priority,
		AssigneeID:         r.AssigneeID,
		DueDate:            r.DueDate,
		Position:           r.Position,
		CreatedBy:          r.CreatedBy,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
		Kind:               r.Kind,
		CreatedByKind:      r.CreatedByKind,
		AssigneeKind:       r.AssigneeKind,
		OrganizationID:     r.OrganizationID,
		Number:             r.Number,
		ProjectID:          r.ProjectID,
		ParentTaskID:       r.ParentTaskID,
		AssigneeType:       r.AssigneeType,
		CreatorType:        r.CreatorType,
		CreatorID:          r.CreatorID,
		AcceptanceCriteria: r.AcceptanceCriteria,
		ContextRefs:        r.ContextRefs,
		Metadata:           r.Metadata,
		Properties:         r.Properties,
		StartDate:          r.StartDate,
		Stage:              r.Stage,
		OriginType:         r.OriginType,
		OriginID:           r.OriginID,
		FirstExecutedAt:    r.FirstExecutedAt,
		Revision:           r.Revision,
		LastActivityAt:     r.LastActivityAt,
	}
}
