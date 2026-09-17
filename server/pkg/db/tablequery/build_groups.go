package tablequery

import "fmt"

// Facet kinds accepted by BuildFacet and Facet.
const (
	FacetStatus   = "status"
	FacetPriority = "priority"
	FacetAssignee = "assignee"
	FacetProject  = "project"
)

// bucketSpec is the per-row bucket shape of a groups query: key (NULL for the
// none bucket), actor kind, label and rank, plus the joins they need and the
// ORDER BY over the bucketed subquery b.
type bucketSpec struct {
	key, actorKind, label, rank string
	joins                       string
	order                       string
}

// bucket resolves the whitelisted bucket shape for q.Group.
func (b *builder) bucket() bucketSpec {
	g := b.q.Group
	switch g.Kind {
	case GroupKindStatus:
		return bucketSpec{key: "t.status", actorKind: "''", label: "''", rank: statusRankExpr,
			order: "b.rank, b.key"}
	case GroupKindPriority:
		return bucketSpec{key: "t.priority", actorKind: "''", label: "''", rank: priorityRankExpr + "::float8",
			order: "b.rank, b.key"}
	case GroupKindAssignee:
		return bucketSpec{
			key:       "t.assignee_id",
			actorKind: "CASE WHEN t.assignee_id IS NULL THEN '' ELSE t.assignee_kind END",
			label:     "COALESCE(NULLIF(u.display_name,''), u.email, a.name, '')",
			rank:      "0::float8",
			joins: " LEFT JOIN users u ON t.assignee_kind = 'human' AND u.id = t.assignee_id" +
				" LEFT JOIN agents a ON t.assignee_kind = 'agent' AND a.id = t.assignee_id AND a.organization_id = $1",
			order: "b.key IS NULL, LOWER(b.label), b.key, b.actor_kind",
		}
	case GroupKindProject:
		return bucketSpec{
			key:       "t.project_id",
			actorKind: "''",
			label:     "COALESCE(pj.title,'')",
			rank:      "0::float8",
			joins:     " LEFT JOIN projects pj ON pj.organization_id = $1 AND pj.workspace_id = $2 AND pj.id = t.project_id",
			order:     "b.key IS NULL, LOWER(b.label), b.key",
		}
	case GroupKindProperty:
		p := g.Property
		if p == nil {
			break
		}
		pid := b.a.add(p.ID) + "::text"
		if p.Type == "checkbox" {
			return bucketSpec{
				key:       fmt.Sprintf("CASE WHEN jsonb_typeof(t.properties->%[1]s) = 'boolean' THEN t.properties->>%[1]s END", pid),
				actorKind: "''", label: "''", rank: "0::float8",
				order: "b.key DESC NULLS LAST",
			}
		}
		opts := p.Options
		if opts == nil {
			opts = []string{}
		}
		return bucketSpec{
			key:       fmt.Sprintf("NULLIF(t.properties->>%s,'')", pid),
			actorKind: "''", label: "''",
			rank:  fmt.Sprintf("COALESCE(array_position(%s::text[], NULLIF(t.properties->>%s,'')), 2147483647)::float8", b.a.add(opts), pid),
			order: "b.key IS NULL, b.rank, b.key",
		}
	}
	// No grouping: a single bucket holding every matching task.
	return bucketSpec{key: "NULL::text", actorKind: "''", label: "''", rank: "0::float8", order: "b.rank"}
}

// BuildGroups counts matching tasks (filter + search, every hierarchy level)
// per bucket of q.Group, ordered per spec §3.4. Columns: key (NULL = none
// bucket), actor_kind, label, count.
func BuildGroups(q Query) (string, []any) {
	b := newBuilder(q)
	s := b.bucket()
	where := b.membership("t", nil)
	sql := fmt.Sprintf(`SELECT b.key, b.actor_kind, b.label, count(*)::bigint
FROM (SELECT %s AS key, %s AS actor_kind, %s AS label, %s AS rank
      FROM tasks t%s
      WHERE %s) b
GROUP BY b.key, b.actor_kind, b.label, b.rank
ORDER BY %s`, s.key, s.actorKind, s.label, s.rank, s.joins, where, s.order)
	return sql, b.a.list
}

// BuildFacet counts matching tasks per value of one facet dimension. The
// filter on that dimension is dropped (disjunctive facets); search and the
// other filters still apply. An unknown kind yields a single ungrouped bucket;
// Facet rejects unknown kinds before building.
func BuildFacet(q Query, kind string) (string, []any) {
	q.Group = Group{Kind: GroupKindNone}
	switch kind {
	case FacetStatus:
		q.Filter.Statuses = nil
		q.Group.Kind = GroupKindStatus
	case FacetPriority:
		q.Filter.Priorities = nil
		q.Group.Kind = GroupKindPriority
	case FacetAssignee:
		q.Filter.AssigneeIDs = nil
		q.Group.Kind = GroupKindAssignee
	case FacetProject:
		q.Filter.ProjectIDs = nil
		q.Group.Kind = GroupKindProject
	}
	return BuildGroups(q)
}
