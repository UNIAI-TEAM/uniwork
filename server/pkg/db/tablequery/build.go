package tablequery

import (
	"fmt"
	"regexp"
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
		{"assignee_id", f.AssigneeIDs},
		{"project_id", f.ProjectIDs},
	} {
		if len(c.vals) > 0 {
			out = append(out, fmt.Sprintf("%s.%s = ANY(%s::text[])", alias, c.col, b.a.add(c.vals)))
		}
	}
	if s := b.search(alias); s != "" {
		out = append(out, s)
	}
	if g != nil {
		out = append(out, b.groupPredicate(alias, g))
	}
	return out
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
