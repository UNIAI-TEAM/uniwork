package tablequery

import (
	"fmt"
	"strings"
)

// taskColumns mirrors the select list of ListTableTaskRows
// (server/pkg/db/queries/tasks.sql); exec.go scans in this exact order.
const taskColumns = `t.id, t.workspace_id, t.title, t.description, t.status, t.priority,
       t.assignee_id, t.due_date, t.position, t.created_by, t.created_at, t.updated_at,
       t.kind, t.created_by_kind, t.assignee_kind, t.organization_id, t.number,
       t.project_id, t.parent_task_id, t.assignee_type, t.creator_type, t.creator_id,
       t.acceptance_criteria, t.context_refs, t.metadata, t.properties, t.start_date,
       t.stage, t.origin_type, t.origin_id, t.first_executed_at, t.revision, t.last_activity_at`

// statusRankExpr ranks t.status by the workspace status catalog; statuses
// missing from the catalog sort last.
const statusRankExpr = `COALESCE((SELECT s.position FROM task_statuses s WHERE s.organization_id = $1 AND s.workspace_id = $2 AND s.key = t.status AND s.archived_at IS NULL), 1e9)`

// priorityRankExpr ranks t.priority urgent..low, anything else last.
const priorityRankExpr = `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`

// sortSpec is the whitelisted sort expression with the cast used to compare a
// cursor value against it. ascOnly marks expressions that ignore Sort.Desc
// (position, including the defensive fallback).
type sortSpec struct {
	expr     string
	cast     string
	nullable bool
	ascOnly  bool
}

// descending reports the effective direction for this sort.
func (s sortSpec) descending(desc bool) bool {
	return desc && !s.ascOnly
}

// sortExpr resolves q.Sort to a whitelisted expression. Property ids and
// option lists are bound as args, once, so the returned expression can be
// repeated in SELECT, WHERE and ORDER BY.
func (b *builder) sortExpr() sortSpec {
	s := b.q.Sort
	switch s.Field {
	case "position":
		return sortSpec{"t.position", "::float8", false, true}
	case "title":
		return sortSpec{"LOWER(t.title)", "::text", false, false}
	case "created_at", "updated_at":
		return sortSpec{"t." + s.Field, "::timestamptz", false, false}
	case "start_date", "due_date":
		return sortSpec{"t." + s.Field, "::date", true, false}
	case "status":
		return sortSpec{statusRankExpr, "::float8", false, false}
	case "priority":
		return sortSpec{priorityRankExpr, "::int", false, false}
	case "property":
		p := s.Property
		if p == nil {
			break
		}
		switch p.Type {
		case "number":
			// Property values are not type-checked on write: non-numbers
			// sort as NULL instead of failing the cast for the whole query.
			return sortSpec{fmt.Sprintf("CASE WHEN jsonb_typeof(t.properties->%[1]s::text) = 'number' THEN (t.properties->>%[1]s::text)::numeric END", b.a.add(p.ID)), "::numeric", true, false}
		case "date", "text", "url":
			return sortSpec{fmt.Sprintf("NULLIF(t.properties->>%s::text,'')", b.a.add(p.ID)), "::text", true, false}
		case "select":
			opts := p.Options
			if opts == nil {
				opts = []string{}
			}
			return sortSpec{fmt.Sprintf("array_position(%s::text[], t.properties->>%s::text)", b.a.add(opts), b.a.add(p.ID)), "::int", true, false}
		}
	}
	// Normalize never leaves an unknown field; defend by sorting by position.
	return sortSpec{"t.position", "::float8", false, true}
}

func (s sortSpec) orderBy(desc bool) string {
	dir := "ASC"
	if s.descending(desc) {
		dir = "DESC"
	}
	tail := "t.created_at DESC, t.id DESC"
	if s.nullable {
		return fmt.Sprintf("(%s) IS NULL ASC, %s %s, %s", s.expr, s.expr, dir, tail)
	}
	return fmt.Sprintf("%s %s, %s", s.expr, dir, tail)
}

// keyset renders the "strictly after cursor c" predicate for sort s.
func (b *builder) keyset(s sortSpec, desc bool, c *Cursor) string {
	tail := fmt.Sprintf("(t.created_at < %[1]s OR (t.created_at = %[1]s AND t.id < %[2]s))",
		b.a.add(c.CreatedAt)+"::timestamptz", b.a.add(c.ID))
	if s.nullable && c.SortNull {
		return fmt.Sprintf("((%s) IS NULL AND %s)", s.expr, tail)
	}
	op := ">"
	if s.descending(desc) {
		op = "<"
	}
	var v string
	if c.SortValue != nil {
		v = b.a.add(*c.SortValue) + s.cast
	} else {
		// A non-null cursor without a value cannot come from this package;
		// NULL makes every comparison false, so the page is empty.
		v = "NULL" + s.cast
	}
	cmp := fmt.Sprintf("(%[1]s) %[2]s %[3]s OR ((%[1]s) = %[3]s AND %[4]s)", s.expr, op, v, tail)
	if s.nullable {
		return fmt.Sprintf("((%s) IS NULL OR %s)", s.expr, cmp)
	}
	return "(" + cmp + ")"
}

// branch renders membership plus the hierarchy root/child rule for r.
func (b *builder) branch(r RowsRequest) string {
	clauses := []string{b.membership("t", r.Group)}
	if !r.Query.Hierarchy {
		return joinAnd(clauses)
	}
	if r.ParentID == nil {
		parent := joinAnd(append([]string{tenant("p"), "p.id = t.parent_task_id"}, b.memberFilters("p", r.Group)...))
		clauses = append(clauses, fmt.Sprintf("(t.parent_task_id IS NULL OR NOT EXISTS (SELECT 1 FROM tasks p WHERE %s))", parent))
		return joinAnd(clauses)
	}
	pid := b.a.add(*r.ParentID)
	parent := joinAnd(append([]string{tenant("p"), "p.id = " + pid}, b.memberFilters("p", r.Group)...))
	clauses = append(clauses,
		"t.parent_task_id = "+pid,
		fmt.Sprintf("EXISTS (SELECT 1 FROM tasks p WHERE %s)", parent))
	return joinAnd(clauses)
}

// BuildRows renders one page of rows: membership, hierarchy rule, keyset
// cursor, ORDER BY and LIMIT Limit+1.
func BuildRows(r RowsRequest) (string, []any) {
	b := newBuilder(r.Query)
	s := b.sortExpr()
	where := []string{b.branch(r)}
	if r.After != nil {
		where = append(where, b.keyset(s, r.Query.Sort.Desc, r.After))
	}
	child := joinAnd(append([]string{tenant("c"), "c.parent_task_id = t.id"}, b.memberFilters("c", r.Group)...))

	var sb strings.Builder
	fmt.Fprintf(&sb, "SELECT %s,\n", taskColumns)
	fmt.Fprintf(&sb, "  (SELECT count(*) FROM tasks c WHERE %s)::bigint AS direct_child_count,\n", child)
	fmt.Fprintf(&sb, "  (%s)::text AS sort_value,\n", s.expr)
	fmt.Fprintf(&sb, "  (%s) IS NULL AS sort_null\n", s.expr)
	fmt.Fprintf(&sb, "FROM tasks t\nWHERE %s\n", joinAnd(where))
	fmt.Fprintf(&sb, "ORDER BY %s\n", s.orderBy(r.Query.Sort.Desc))
	fmt.Fprintf(&sb, "LIMIT %s", b.a.add(r.Limit+1))
	return sb.String(), b.a.list
}

// BuildCountBranch counts the rows of r's branch (same membership and
// root/child rule as BuildRows) across all pages.
func BuildCountBranch(r RowsRequest) (string, []any) {
	b := newBuilder(r.Query)
	return "SELECT count(*)::bigint FROM tasks t WHERE " + b.branch(r), b.a.list
}

// BuildCountQuery counts every task matching q's filter and search, at any
// hierarchy level and ignoring grouping.
func BuildCountQuery(q Query) (string, []any) {
	b := newBuilder(q)
	return "SELECT count(*)::bigint FROM tasks t WHERE " + b.membership("t", nil), b.a.list
}
