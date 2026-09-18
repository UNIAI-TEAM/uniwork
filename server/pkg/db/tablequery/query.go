// Package tablequery builds the dynamic SQL for the tasks table view
// (groups, rows, facets) described in ADR 0020. This file holds the plain Go
// types shared by the query builder: the normalized request shape, group
// keys and keyset cursors. No I/O, no database access.
package tablequery

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
)

// Filter narrows the task set by exact-match id/key lists. Every slice is
// normalized (sorted, deduped) by Query.Normalize before use.
//
// Positive-selection semantics (Multica parity): empty list = no constraint on
// that dimension. IncludeNoAssignee / IncludeNoProject OR with their id lists.
// CreatorRefs are "human:<id>" / "agent:<id>". Properties values may include
// "__none__" for unset. DateField is created_at|updated_at with inclusive
// DateFrom/DateTo (YYYY-MM-DD); incomplete or unknown dates are cleared.
type Filter struct {
	Statuses          []string
	Priorities        []string
	AssigneeIDs       []string
	IncludeNoAssignee bool
	ProjectIDs        []string
	IncludeNoProject  bool
	CreatorRefs       []string // "human:id" / "agent:id"
	LabelIDs          []string
	Properties        map[string][]string // def id → option ids; "__none__" = unset
	DateField         string              // created_at|updated_at|""
	DateFrom          string              // YYYY-MM-DD or ""
	DateTo            string
}

// PropertyRef identifies a custom property and, for select properties, the
// display-order option ids used to rank sort/group values.
type PropertyRef struct {
	ID      string
	Type    string   // text|number|select|multi_select|date|checkbox|url
	Options []string // select: option ids in display order (by name), for sort rank
}

// Sort picks the ordering expression for rows. Property is set only when
// Field == "property".
type Sort struct {
	Field    string // position|title|created_at|updated_at|start_date|due_date|status|priority|property
	Desc     bool
	Property *PropertyRef
}

// GroupKind is one of the supported grouping dimensions for the table view.
type GroupKind string

const (
	GroupKindNone     GroupKind = "none"
	GroupKindStatus   GroupKind = "status"
	GroupKindPriority GroupKind = "priority"
	GroupKindAssignee GroupKind = "assignee"
	GroupKindProject  GroupKind = "project"
	GroupKindProperty GroupKind = "property"
)

// Group picks how rows are bucketed. Property is set only when
// Kind == GroupKindProperty, and its Type must be select or checkbox.
type Group struct {
	Kind     GroupKind
	Property *PropertyRef
}

// Query is the fully-typed, not-yet-normalized request for the table view.
type Query struct {
	OrganizationID string
	WorkspaceID    string
	Filter         Filter
	Search         string // already trimmed once Normalize runs
	Sort           Sort
	Group          Group
	Hierarchy      bool
}

// Normalize returns a copy of q with filter slices sorted and deduped (nil
// becomes empty), Search trimmed, Sort defaulted/coerced to position where
// required, and Desc forced false for position sort.
func (q Query) Normalize() Query {
	dateField := strings.TrimSpace(q.Filter.DateField)
	dateFrom := strings.TrimSpace(q.Filter.DateFrom)
	dateTo := strings.TrimSpace(q.Filter.DateTo)
	if !dateFields[dateField] || dateFrom == "" || dateTo == "" {
		dateField, dateFrom, dateTo = "", "", ""
	}
	q.Filter = Filter{
		Statuses:          normalizeSlice(q.Filter.Statuses),
		Priorities:        normalizeSlice(q.Filter.Priorities),
		AssigneeIDs:       normalizeSlice(q.Filter.AssigneeIDs),
		IncludeNoAssignee: q.Filter.IncludeNoAssignee,
		ProjectIDs:        normalizeSlice(q.Filter.ProjectIDs),
		IncludeNoProject:  q.Filter.IncludeNoProject,
		CreatorRefs:       normalizeCreatorRefs(q.Filter.CreatorRefs),
		LabelIDs:          normalizeSlice(q.Filter.LabelIDs),
		Properties:        normalizeProperties(q.Filter.Properties),
		DateField:         dateField,
		DateFrom:          dateFrom,
		DateTo:            dateTo,
	}
	q.Search = strings.TrimSpace(q.Search)

	if q.Sort.Field == "" {
		q.Sort.Field = "position"
	}
	if !sortFields[q.Sort.Field] {
		q.Sort = Sort{Field: "position"}
	}
	if q.Sort.Field == "property" {
		if q.Sort.Property == nil || !sortPropertyTypes[q.Sort.Property.Type] {
			q.Sort = Sort{Field: "position"}
		}
	} else {
		q.Sort.Property = nil
	}
	if q.Sort.Field == "position" {
		q.Sort.Desc = false
	}

	return q
}

// sortFields is the whitelist of sort fields; anything else sorts by position.
var sortFields = map[string]bool{
	"position": true, "title": true, "created_at": true, "updated_at": true,
	"start_date": true, "due_date": true, "status": true, "priority": true, "property": true,
}

// sortPropertyTypes are the property types that can be sorted on.
var sortPropertyTypes = map[string]bool{
	"text": true, "number": true, "select": true, "date": true, "url": true,
}

// dateFields is the whitelist of timestamp columns filterable by date range.
var dateFields = map[string]bool{
	"created_at": true,
	"updated_at": true,
}

// normalizeSlice sorts and dedupes s, always returning a non-nil (possibly
// empty) slice so downstream JSON encoding is stable regardless of the
// caller passing nil or a duplicate-laden slice.
func normalizeSlice(s []string) []string {
	out := make([]string, len(s))
	copy(out, s)
	sort.Strings(out)
	out = dedupeSorted(out)
	if out == nil {
		out = []string{}
	}
	return out
}

// normalizeCreatorRefs keeps only "human:<id>" / "agent:<id>" refs, then
// sorts and dedupes them.
func normalizeCreatorRefs(refs []string) []string {
	out := make([]string, 0, len(refs))
	for _, ref := range refs {
		kind, id, ok := strings.Cut(ref, ":")
		if !ok || id == "" {
			continue
		}
		if kind != "human" && kind != "agent" {
			continue
		}
		out = append(out, kind+":"+id)
	}
	return normalizeSlice(out)
}

// normalizeProperties deep-copies m with sorted keys (via map rebuild) and
// sorted/deduped option id slices. Empty maps become a non-nil empty map.
func normalizeProperties(m map[string][]string) map[string][]string {
	out := make(map[string][]string, len(m))
	if len(m) == 0 {
		return out
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		vals := normalizeSlice(m[k])
		if len(vals) == 0 {
			continue
		}
		out[k] = vals
	}
	return out
}

// dedupeSorted removes consecutive duplicates from a sorted slice in place.
func dedupeSorted(s []string) []string {
	if len(s) == 0 {
		return s
	}
	n := 1
	for i := 1; i < len(s); i++ {
		if s[i] != s[n-1] {
			s[n] = s[i]
			n++
		}
	}
	return s[:n]
}

// fingerprintSort is the fixed-order shape of Sort used inside Fingerprint.
// PropertyType and PropertyOptions ride along so that a property's type
// change or a select property's option rename/reorder — which changes what
// the sort actually orders by — invalidates outstanding cursors too.
type fingerprintSort struct {
	Field           string   `json:"field"`
	Desc            bool     `json:"desc"`
	PropertyID      string   `json:"property_id"`
	PropertyType    string   `json:"property_type"`
	PropertyOptions []string `json:"property_options"`
}

// fingerprintGroup is the fixed-order shape of Group used inside Fingerprint.
// See fingerprintSort for why PropertyType/PropertyOptions are included.
type fingerprintGroup struct {
	Kind            GroupKind `json:"kind"`
	PropertyID      string    `json:"property_id"`
	PropertyType    string    `json:"property_type"`
	PropertyOptions []string  `json:"property_options"`
}

// fingerprintDoc is the canonical JSON shape hashed by Fingerprint. Field
// order matches the brief: workspace, filter, search,
// sort{field,desc,property_id}, group{kind,property_id}, hierarchy.
type fingerprintDoc struct {
	Workspace string           `json:"workspace"`
	Filter    Filter           `json:"filter"`
	Search    string           `json:"search"`
	Sort      fingerprintSort  `json:"sort"`
	Group     fingerprintGroup `json:"group"`
	Hierarchy bool             `json:"hierarchy"`
}

// Fingerprint returns the hex sha256 of the canonical JSON encoding of q's
// cursor-relevant fields (workspace, filter, search, sort, group,
// hierarchy). Callers should pass an already-Normalize()d Query so that
// equivalent requests (reordered/duplicated filter values) share a
// fingerprint.
func Fingerprint(q Query) string {
	var sortPropID, sortPropType string
	var sortPropOptions []string
	if q.Sort.Property != nil {
		sortPropID = q.Sort.Property.ID
		sortPropType = q.Sort.Property.Type
		sortPropOptions = q.Sort.Property.Options
	}
	var groupPropID, groupPropType string
	var groupPropOptions []string
	if q.Group.Property != nil {
		groupPropID = q.Group.Property.ID
		groupPropType = q.Group.Property.Type
		groupPropOptions = q.Group.Property.Options
	}

	doc := fingerprintDoc{
		Workspace: q.WorkspaceID,
		Filter:    q.Filter,
		Search:    q.Search,
		Sort: fingerprintSort{
			Field:           q.Sort.Field,
			Desc:            q.Sort.Desc,
			PropertyID:      sortPropID,
			PropertyType:    sortPropType,
			PropertyOptions: sortPropOptions,
		},
		Group: fingerprintGroup{
			Kind:            q.Group.Kind,
			PropertyID:      groupPropID,
			PropertyType:    groupPropType,
			PropertyOptions: groupPropOptions,
		},
		Hierarchy: q.Hierarchy,
	}

	b, err := json.Marshal(doc)
	if err != nil {
		// doc contains only strings, bools and slices of strings: it always
		// marshals. Panicking here would surface a real bug immediately
		// instead of silently returning a wrong fingerprint.
		panic("tablequery: fingerprint marshal: " + err.Error())
	}

	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
