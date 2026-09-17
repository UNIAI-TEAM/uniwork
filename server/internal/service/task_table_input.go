package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/db/tablequery"
)

const (
	defaultTableRowsLimit = 50
	maxTableRowsLimit     = 100
)

// tableSortFields are the plain (non-property) sort fields the table accepts.
var tableSortFields = map[string]bool{
	"position": true, "title": true, "created_at": true, "updated_at": true,
	"start_date": true, "due_date": true, "status": true, "priority": true,
}

// tableFacetKinds are the facet dimensions TableFacets accepts.
var tableFacetKinds = map[string]bool{
	tablequery.FacetStatus: true, tablequery.FacetPriority: true,
	tablequery.FacetAssignee: true, tablequery.FacetProject: true,
}

// resolvedTableQuery is a validated, normalized table query plus what the
// service needs to render group descriptors.
type resolvedTableQuery struct {
	query       tablequery.Query
	fingerprint string
	// optionLabels maps a grouped select property's option value to its label.
	optionLabels map[string]string
}

// resolveTableQuery checks membership, resolves property references and
// returns the normalized query. withGroup=false ignores GroupBy (facets).
func (s *TaskService) resolveTableQuery(ctx context.Context, actor Actor, workspaceID string, in TableQueryInput, withGroup bool) (resolvedTableQuery, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return resolvedTableQuery{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return resolvedTableQuery{}, err
	}
	out := resolvedTableQuery{}
	group := tablequery.Group{Kind: tablequery.GroupKindNone}
	if withGroup {
		group, out.optionLabels, err = s.resolveTableGroup(ctx, ws.OrganizationID, workspaceID, in.GroupBy)
		if err != nil {
			return resolvedTableQuery{}, err
		}
	}
	sortSpec, err := s.resolveTableSort(ctx, ws.OrganizationID, workspaceID, in.SortField, in.SortDir)
	if err != nil {
		return resolvedTableQuery{}, err
	}
	out.query = tablequery.Query{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    workspaceID,
		Filter:         in.Filter,
		Search:         in.Search,
		Sort:           sortSpec,
		Group:          group,
		Hierarchy:      in.Hierarchy,
	}.Normalize()
	out.fingerprint = tablequery.Fingerprint(out.query)
	return out, nil
}

func (s *TaskService) resolveTableGroup(ctx context.Context, orgID, workspaceID, groupBy string) (tablequery.Group, map[string]string, error) {
	groupBy = strings.TrimSpace(groupBy)
	switch tablequery.GroupKind(groupBy) {
	case "", tablequery.GroupKindNone:
		return tablequery.Group{Kind: tablequery.GroupKindNone}, nil, nil
	case tablequery.GroupKindStatus, tablequery.GroupKindPriority, tablequery.GroupKindAssignee, tablequery.GroupKindProject:
		return tablequery.Group{Kind: tablequery.GroupKind(groupBy)}, nil, nil
	}
	id, ok := strings.CutPrefix(groupBy, "property:")
	if !ok || id == "" {
		return tablequery.Group{}, nil, coded(http.StatusBadRequest, "invalid_group_by",
			"group_by must be none, status, priority, assignee, project or property:<id>")
	}
	unsupported := coded(http.StatusUnprocessableEntity, "unsupported_group",
		"grouping needs an active select or checkbox property")
	prop, found, err := s.activeTableProperty(ctx, orgID, workspaceID, id)
	if err != nil {
		return tablequery.Group{}, nil, err
	}
	if !found {
		return tablequery.Group{}, nil, unsupported
	}
	ref := &tablequery.PropertyRef{ID: prop.ID, Type: prop.Type}
	switch prop.Type {
	case "checkbox":
		return tablequery.Group{Kind: tablequery.GroupKindProperty, Property: ref}, nil, nil
	case "select":
		opts := parseSelectOptions(prop.Config)
		labels := make(map[string]string, len(opts))
		for _, o := range opts {
			ref.Options = append(ref.Options, o.value)
			if _, dup := labels[o.value]; !dup {
				labels[o.value] = o.label
			}
		}
		return tablequery.Group{Kind: tablequery.GroupKindProperty, Property: ref}, labels, nil
	default:
		return tablequery.Group{}, nil, unsupported
	}
}

func (s *TaskService) resolveTableSort(ctx context.Context, orgID, workspaceID, field, dir string) (tablequery.Sort, error) {
	invalid := coded(http.StatusBadRequest, "invalid_sort",
		"sort field must be a task column or property:<id>, direction asc or desc")
	var out tablequery.Sort
	switch strings.TrimSpace(dir) {
	case "", "asc":
	case "desc":
		out.Desc = true
	default:
		return tablequery.Sort{}, invalid
	}
	field = strings.TrimSpace(field)
	if field == "" {
		field = "position"
	}
	if tableSortFields[field] {
		out.Field = field
		return out, nil
	}
	id, ok := strings.CutPrefix(field, "property:")
	if !ok || id == "" {
		return tablequery.Sort{}, invalid
	}
	prop, found, err := s.activeTableProperty(ctx, orgID, workspaceID, id)
	if err != nil {
		return tablequery.Sort{}, err
	}
	if !found {
		// A property archived or deleted after the view was saved sorts by
		// position instead of failing the whole table.
		return tablequery.Sort{Field: "position"}, nil
	}
	ref := &tablequery.PropertyRef{ID: prop.ID, Type: prop.Type}
	if prop.Type == "select" {
		for _, o := range parseSelectOptions(prop.Config) {
			ref.Options = append(ref.Options, o.value)
		}
	}
	out.Field = "property"
	out.Property = ref
	return out, nil
}

// activeTableProperty loads a non-archived property; found=false when it is
// missing or archived.
func (s *TaskService) activeTableProperty(ctx context.Context, orgID, workspaceID, id string) (db.TaskProperty, bool, error) {
	prop, err := s.q.GetTaskPropertyByID(ctx, db.GetTaskPropertyByIDParams{
		OrganizationID: orgID, WorkspaceID: workspaceID, ID: id,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskProperty{}, false, nil
	}
	if err != nil {
		return db.TaskProperty{}, false, err
	}
	return prop, !prop.ArchivedAt.Valid, nil
}

type selectOption struct{ value, label string }

// parseSelectOptions reads config.options the way the web client does
// (optionsFor in packages/views/tasks/create-task-custom-properties.tsx): a
// string option is its own value and label; an object option has value =
// value ?? id ?? name and label = label ?? name ?? value, both strings.
// Anything else is skipped. The result is ordered by label, case-insensitive.
func parseSelectOptions(config []byte) []selectOption {
	var cfg struct {
		Options []json.RawMessage `json:"options"`
	}
	if err := json.Unmarshal(config, &cfg); err != nil {
		return nil
	}
	out := make([]selectOption, 0, len(cfg.Options))
	for _, raw := range cfg.Options {
		var str string
		if err := json.Unmarshal(raw, &str); err == nil {
			out = append(out, selectOption{value: str, label: str})
			continue
		}
		var record map[string]json.RawMessage
		if err := json.Unmarshal(raw, &record); err != nil || record == nil {
			continue
		}
		value := firstPresent(record, "value", "id", "name")
		label := firstPresent(record, "label", "name")
		if label == nil {
			label = value
		}
		var v, l string
		if value == nil || label == nil || json.Unmarshal(value, &v) != nil || json.Unmarshal(label, &l) != nil {
			continue
		}
		out = append(out, selectOption{value: v, label: l})
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].label), strings.ToLower(out[j].label)
		if a != b {
			return a < b
		}
		return out[i].value < out[j].value
	})
	return out
}

// firstPresent mirrors JavaScript's `??`: the first key that is present and
// not JSON null.
func firstPresent(record map[string]json.RawMessage, keys ...string) json.RawMessage {
	for _, k := range keys {
		if raw, ok := record[k]; ok && string(raw) != "null" {
			return raw
		}
	}
	return nil
}

// normalizeTableFacets trims, dedupes and validates facet kinds; an empty
// list means status and priority.
func normalizeTableFacets(in []string) ([]string, error) {
	if len(in) == 0 {
		return []string{tablequery.FacetStatus, tablequery.FacetPriority}, nil
	}
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, kind := range in {
		kind = strings.ToLower(strings.TrimSpace(kind))
		if !tableFacetKinds[kind] {
			return nil, coded(http.StatusBadRequest, "invalid_facets_kind",
				"facets must be status, priority, assignee or project")
		}
		if !seen[kind] {
			seen[kind] = true
			out = append(out, kind)
		}
	}
	return out, nil
}

// tableGroupValue renders the descriptor value of one group bucket.
func tableGroupValue(group tablequery.Group, g tablequery.GroupCount, optionLabels map[string]string) TableGroupValue {
	p := g.Predicate
	v := TableGroupValue{Kind: string(group.Kind)}
	switch group.Kind {
	case tablequery.GroupKindStatus:
		v.Status = p.Value
	case tablequery.GroupKindPriority:
		v.Priority = p.Value
	case tablequery.GroupKindAssignee:
		if !p.None {
			v.Actor = &TableActorRef{Type: p.ActorKind, ID: p.Value}
			v.Label = g.Label
		}
	case tablequery.GroupKindProject:
		if !p.None {
			v.ProjectID = p.Value
			v.Label = g.Label
		}
	case tablequery.GroupKindProperty:
		if group.Property != nil {
			v.PropertyID = group.Property.ID
		}
		if !p.None {
			v.Option = p.Value
			if group.Property != nil && group.Property.Type == "select" {
				if label, ok := optionLabels[p.Value]; ok {
					v.Label = label
				} else {
					v.Label = p.Value
				}
			}
		}
	}
	return v
}
