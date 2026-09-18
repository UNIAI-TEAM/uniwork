package tablequery

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RowsRequest is one page request of table rows: a normalized query, the
// optional group bucket, the optional hierarchy parent and keyset cursor.
type RowsRequest struct {
	Query    Query           // normalized
	Group    *GroupPredicate // nil when Group.Kind == none
	ParentID *string         // only with Query.Hierarchy
	After    *Cursor
	Limit    int // server fetches Limit+1
}

// Row is one scanned table row plus the values needed to build the next
// cursor.
type Row struct {
	Task             db.Task
	DirectChildCount int64
	SortValue        *string
	SortNull         bool
}

// GroupCount is one bucket of a groups or facet query.
type GroupCount struct {
	Predicate GroupPredicate
	Count     int64
	Label     string // project title / member or agent name; "" for status, priority and property
}

// args collects positional parameters; add returns the placeholder for v.
type args struct{ list []any }

func (a *args) add(v any) string {
	a.list = append(a.list, v)
	return fmt.Sprintf("$%d", len(a.list))
}

// builder holds the argument list of one statement. $1 and $2 are always the
// organization and workspace ids.
type builder struct {
	q Query
	a args
}

func newBuilder(q Query) *builder {
	b := &builder{q: q}
	b.a.add(q.OrganizationID)
	b.a.add(q.WorkspaceID)
	return b
}

// tenant is the mandatory tenant clause for alias (ADR 0020).
func tenant(alias string) string {
	return alias + ".organization_id = $1 AND " + alias + ".workspace_id = $2"
}

// membership is the full membership predicate for alias: tenant, filter,
// search and (when g != nil) the group predicate.
func (b *builder) membership(alias string, g *GroupPredicate) string {
	return joinAnd(append([]string{tenant(alias)}, b.memberFilters(alias, g)...))
}

// memberFilters returns the non-tenant membership clauses for alias. It is
// used on its own inside correlated subqueries that already carry the tenant
// clause.
func (b *builder) memberFilters(alias string, g *GroupPredicate) []string {
	var out []string
	f := b.q.Filter
	for _, c := range []struct {
		col  string
		vals []string
	}{
		{"status", f.Statuses},
		{"priority", f.Priorities},
	} {
		if len(c.vals) > 0 {
			out = append(out, fmt.Sprintf("%s.%s = ANY(%s::text[])", alias, c.col, b.a.add(c.vals)))
		}
	}
	if c := nullableIDFilter(alias, "assignee_id", f.AssigneeIDs, f.IncludeNoAssignee, &b.a); c != "" {
		out = append(out, c)
	}
	if c := nullableIDFilter(alias, "project_id", f.ProjectIDs, f.IncludeNoProject, &b.a); c != "" {
		out = append(out, c)
	}
	if c := b.creatorFilter(alias); c != "" {
		out = append(out, c)
	}
	if c := b.labelFilter(alias); c != "" {
		out = append(out, c)
	}
	out = append(out, b.propertyFilters(alias)...)
	if c := b.dateFilter(alias); c != "" {
		out = append(out, c)
	}
	if s := b.search(alias); s != "" {
		out = append(out, s)
	}
	if g != nil {
		out = append(out, b.groupPredicate(alias, g))
	}
	return out
}

// nullableIDFilter renders positive selection on a nullable id column: ids
// only, IS NULL only, or (IS NULL OR id = ANY(...)).
func nullableIDFilter(alias, col string, ids []string, includeNone bool, a *args) string {
	switch {
	case includeNone && len(ids) == 0:
		return alias + "." + col + " IS NULL"
	case includeNone && len(ids) > 0:
		return fmt.Sprintf("(%s.%s IS NULL OR %s.%s = ANY(%s::text[]))",
			alias, col, alias, col, a.add(ids))
	case len(ids) > 0:
		return fmt.Sprintf("%s.%s = ANY(%s::text[])", alias, col, a.add(ids))
	default:
		return ""
	}
}

// creatorFilter matches (created_by_kind, created_by) against parsed
// CreatorRefs. Invalid refs were dropped in Normalize.
func (b *builder) creatorFilter(alias string) string {
	refs := b.q.Filter.CreatorRefs
	if len(refs) == 0 {
		return ""
	}
	pairs := make([]string, 0, len(refs))
	for _, ref := range refs {
		kind, id, ok := strings.Cut(ref, ":")
		if !ok {
			continue
		}
		pairs = append(pairs, fmt.Sprintf("(%s, %s)", b.a.add(kind), b.a.add(id)))
	}
	if len(pairs) == 0 {
		return ""
	}
	return fmt.Sprintf("(%s.created_by_kind, %s.created_by) IN (%s)",
		alias, alias, strings.Join(pairs, ", "))
}

// labelFilter requires at least one task_label_links row for the selected
// label ids (OR across labels), scoped to the same tenant.
func (b *builder) labelFilter(alias string) string {
	ids := b.q.Filter.LabelIDs
	if len(ids) == 0 {
		return ""
	}
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM task_label_links ll WHERE ll.organization_id = $1 AND ll.workspace_id = $2 AND ll.task_id = %s.id AND ll.label_id = ANY(%s::text[]))`,
		alias, b.a.add(ids))
}

// propertyFilters ANDs one clause per property def: OR of option matches,
// with "__none__" meaning the JSONB key is absent / null / empty string.
func (b *builder) propertyFilters(alias string) []string {
	props := b.q.Filter.Properties
	if len(props) == 0 {
		return nil
	}
	keys := make([]string, 0, len(props))
	for k := range props {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]string, 0, len(keys))
	for _, pid := range keys {
		vals := props[pid]
		if len(vals) == 0 {
			continue
		}
		pidPH := b.a.add(pid) + "::text"
		var branches []string
		var options []string
		for _, v := range vals {
			if v == "__none__" {
				branches = append(branches, fmt.Sprintf("((%[1]s.properties->%[2]s) IS NULL OR NULLIF(%[1]s.properties->>%[2]s,'') IS NULL)", alias, pidPH))
				continue
			}
			options = append(options, v)
		}
		if len(options) > 0 {
			optPH := b.a.add(options)
			branches = append(branches, fmt.Sprintf(`(%[1]s.properties->>%[2]s = ANY(%[3]s::text[]) OR EXISTS (SELECT 1 FROM unnest(%[3]s::text[]) AS pv(v) WHERE %[1]s.properties->%[2]s @> to_jsonb(pv.v)))`,
				alias, pidPH, optPH))
		}
		if len(branches) == 0 {
			continue
		}
		out = append(out, "("+strings.Join(branches, " OR ")+")")
	}
	return out
}

// dateFilter applies an inclusive ::date range on created_at or updated_at
// when Normalize left a whitelisted DateField with both bounds.
func (b *builder) dateFilter(alias string) string {
	f := b.q.Filter
	if !dateFields[f.DateField] || f.DateFrom == "" || f.DateTo == "" {
		return ""
	}
	return fmt.Sprintf("%s.%s::date BETWEEN %s::date AND %s::date",
		alias, f.DateField, b.a.add(f.DateFrom), b.a.add(f.DateTo))
}

// numberSearchRe matches a search that is a task number, optionally with a
// key prefix ("12", "WST-12").
var numberSearchRe = regexp.MustCompile(`^(?:[A-Za-z]+-)?(\d{1,9})$`)

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// search renders the title/number search clause, or "" when search is empty.
func (b *builder) search(alias string) string {
	words := strings.Fields(strings.ToLower(b.q.Search))
	if len(words) == 0 {
		return ""
	}
	likes := make([]string, len(words))
	for i, w := range words {
		likes[i] = fmt.Sprintf(`LOWER(%s.title) LIKE %s ESCAPE '\'`, alias, b.a.add("%"+likeEscaper.Replace(w)+"%"))
	}
	clause := "(" + strings.Join(likes, " AND ") + ")"
	if m := numberSearchRe.FindStringSubmatch(b.q.Search); m != nil {
		n, err := strconv.ParseInt(m[1], 10, 64)
		if err == nil {
			clause = fmt.Sprintf("(%s OR %s.number = %s)", clause, alias, b.a.add(n))
		}
	}
	return "(" + clause + ")"
}

// groupPredicate renders the bucket predicate for alias.
func (b *builder) groupPredicate(alias string, g *GroupPredicate) string {
	switch g.Kind {
	case GroupKindStatus:
		return fmt.Sprintf("%s.status = %s", alias, b.a.add(g.Value))
	case GroupKindPriority:
		return fmt.Sprintf("%s.priority = %s", alias, b.a.add(g.Value))
	case GroupKindAssignee:
		if g.None {
			return alias + ".assignee_id IS NULL"
		}
		return fmt.Sprintf("(%s.assignee_id = %s AND %s.assignee_kind = %s)", alias, b.a.add(g.Value), alias, b.a.add(g.ActorKind))
	case GroupKindProject:
		if g.None {
			return alias + ".project_id IS NULL"
		}
		return fmt.Sprintf("%s.project_id = %s", alias, b.a.add(g.Value))
	case GroupKindProperty:
		p := b.q.Group.Property
		if p == nil {
			return "FALSE"
		}
		pid := b.a.add(p.ID) + "::text"
		switch {
		case p.Type == "checkbox" && g.None:
			return fmt.Sprintf("((%[1]s.properties->%[2]s) IS NULL OR jsonb_typeof(%[1]s.properties->%[2]s) <> 'boolean')", alias, pid)
		case p.Type == "checkbox":
			return fmt.Sprintf("(%s.properties->%s) = to_jsonb(%s::boolean)", alias, pid, b.a.add(g.Value == "true"))
		case g.None:
			return fmt.Sprintf("NULLIF(%s.properties->>%s,'') IS NULL", alias, pid)
		default:
			return fmt.Sprintf("%s.properties->>%s = %s", alias, pid, b.a.add(g.Value))
		}
	}
	// Unknown kinds never match: safer than silently widening the set.
	return "FALSE"
}

func joinAnd(clauses []string) string {
	return strings.Join(clauses, " AND ")
}
