package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (h *handlers) tableGroups(w http.ResponseWriter, r *http.Request) {
	var in sdi.TableGroupsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	result, err := h.Tasks.TableGroups(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), tableQueryInputFromSDI(in.Query, in.GroupBy, false))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TableGroupsSDO{
		QueryFingerprint: result.QueryFingerprint,
		Total:            result.Total,
		Groups:           tableGroupDTOs(result.Groups),
		NextCursor:       nil,
	})
}

func (h *handlers) tableRows(w http.ResponseWriter, r *http.Request) {
	var in sdi.TableRowsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	result, err := h.Tasks.TableRows(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.TableRowsInput{
			TableQueryInput: tableQueryInputFromSDI(in.Query, in.GroupBy, in.Hierarchy),
			GroupKey:        in.GroupKey,
			ParentID:        in.ParentID,
			Cursor:          in.Cursor,
			Limit:           in.Limit,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	tasks := make([]db.Task, 0, len(result.Rows))
	for _, row := range result.Rows {
		tasks = append(tasks, row.Task)
	}
	dtos, err := h.taskDTOs(r, tasks)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	rows := make([]sdo.TableRowDTO, 0, len(result.Rows))
	for i, row := range result.Rows {
		rows = append(rows, sdo.TableRowDTO{
			Task:             dtos[i],
			DirectChildCount: row.DirectChildCount,
			Labels:           tableRowLabelDTOs(row.Labels),
		})
	}
	respondJSON(w, 200, sdo.TableRowsSDO{
		QueryFingerprint: result.QueryFingerprint,
		GroupKey:         result.GroupKey,
		ParentID:         result.ParentID,
		Total:            result.Total,
		Rows:             rows,
		NextCursor:       result.NextCursor,
	})
}

func (h *handlers) tableFacets(w http.ResponseWriter, r *http.Request) {
	var in sdi.TableFacetsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	result, err := h.Tasks.TableFacets(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.TableFacetsInput{
			TableQueryInput: tableQueryInputFromSDI(in.Query, "", false),
			Facets:          in.Facets,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	facets := make([]sdo.TableFacetDTO, 0, len(result.Facets))
	for _, f := range result.Facets {
		values := make([]sdo.TableFacetValueDTO, 0, len(f.Values))
		for _, v := range f.Values {
			values = append(values, sdo.TableFacetValueDTO{Key: v.Key, Count: v.Count})
		}
		facets = append(facets, sdo.TableFacetDTO{Kind: f.Kind, Values: values})
	}
	respondJSON(w, 200, sdo.TableFacetsSDO{
		QueryFingerprint: result.QueryFingerprint,
		Total:            result.Total,
		Facets:           facets,
	})
}

// tableQueryInputFromSDI maps the shared query body onto the service input;
// an empty group_by means no grouping and groups/facets never carry
// hierarchy (only /table/rows exposes it on the wire).
func tableQueryInputFromSDI(q sdi.TableQuerySDI, groupBy string, hierarchy bool) service.TableQueryInput {
	if groupBy == "" {
		groupBy = "none"
	}
	// Fill the filter field by field so the handler never imports tablequery.
	var in service.TableQueryInput
	in.Filter.Statuses = q.Filter.Statuses
	in.Filter.Priorities = q.Filter.Priorities
	in.Filter.AssigneeIDs = q.Filter.AssigneeIDs
	in.Filter.ProjectIDs = q.Filter.ProjectIDs
	in.Search = q.Search
	in.SortField = q.Sort.Field
	in.SortDir = q.Sort.Direction
	in.GroupBy = groupBy
	in.Hierarchy = hierarchy
	return in
}

func tableGroupDTOs(groups []service.TableGroupDescriptor) []sdo.TableGroupDescriptorDTO {
	out := make([]sdo.TableGroupDescriptorDTO, 0, len(groups))
	for _, g := range groups {
		val := sdo.TableGroupValueDTO{
			Kind:       g.Value.Kind,
			Status:     g.Value.Status,
			Priority:   g.Value.Priority,
			ProjectID:  g.Value.ProjectID,
			PropertyID: g.Value.PropertyID,
			Option:     g.Value.Option,
			Label:      g.Value.Label,
		}
		if g.Value.Actor != nil {
			val.Actor = &sdo.TableActorRefDTO{Type: g.Value.Actor.Type, ID: g.Value.Actor.ID}
		}
		out = append(out, sdo.TableGroupDescriptorDTO{Key: g.Key, Value: val, Count: g.Count})
	}
	return out
}

// tableRowLabelDTOs maps row labels; the result is never nil so the wire
// field is always an array, never JSON null.
func tableRowLabelDTOs(labels []service.TableRowLabel) []sdo.TableRowLabelDTO {
	out := make([]sdo.TableRowLabelDTO, 0, len(labels))
	for _, l := range labels {
		out = append(out, sdo.TableRowLabelDTO{ID: l.ID, Name: l.Name, Color: l.Color})
	}
	return out
}
