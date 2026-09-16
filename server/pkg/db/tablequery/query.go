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
type Filter struct {
	Statuses    []string
	Priorities  []string
	AssigneeIDs []string
	ProjectIDs  []string
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
	q.Filter = Filter{
		Statuses:    normalizeSlice(q.Filter.Statuses),
		Priorities:  normalizeSlice(q.Filter.Priorities),
		AssigneeIDs: normalizeSlice(q.Filter.AssigneeIDs),
		ProjectIDs:  normalizeSlice(q.Filter.ProjectIDs),
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
type fingerprintSort struct {
	Field      string `json:"field"`
	Desc       bool   `json:"desc"`
	PropertyID string `json:"property_id"`
}

// fingerprintGroup is the fixed-order shape of Group used inside Fingerprint.
type fingerprintGroup struct {
	Kind       GroupKind `json:"kind"`
	PropertyID string    `json:"property_id"`
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
	var sortPropID string
	if q.Sort.Property != nil {
		sortPropID = q.Sort.Property.ID
	}
	var groupPropID string
	if q.Group.Property != nil {
		groupPropID = q.Group.Property.ID
	}

	doc := fingerprintDoc{
		Workspace: q.WorkspaceID,
		Filter:    q.Filter,
		Search:    q.Search,
		Sort: fingerprintSort{
			Field:      q.Sort.Field,
			Desc:       q.Sort.Desc,
			PropertyID: sortPropID,
		},
		Group: fingerprintGroup{
			Kind:       q.Group.Kind,
			PropertyID: groupPropID,
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
