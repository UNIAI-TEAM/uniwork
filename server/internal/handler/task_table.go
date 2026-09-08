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
		chi.URLParam(r, "workspaceID"), tableInputFromSDI(in.Filter, in.GroupBy, nil, in.Columns, nil, in.Limit, in.Offset))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TableGroupsSDO{
		QueryFingerprint: result.QueryFingerprint,
		Total:            result.Total,
		Groups:           tableGroupDTOs(result.Groups),
		NextCursor:       result.NextCursor,
	})
}

func (h *handlers) tableRows(w http.ResponseWriter, r *http.Request) {
	var in sdi.TableRowsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	result, err := h.Tasks.TableRows(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), tableInputFromSDI(in.Filter, in.GroupBy, in.GroupKey, in.Columns, nil, in.Limit, in.Offset))
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
		rows = append(rows, sdo.TableRowDTO{Task: dtos[i], DirectChildCount: row.DirectChildCount})
	}
	respondJSON(w, 200, sdo.TableRowsSDO{
		QueryFingerprint: result.QueryFingerprint,
		GroupKey:         result.GroupKey,
		ParentID:         result.ParentID,
		Total:            result.Total,
		Rows:             rows,
		BranchTotal:      result.BranchTotal,
		NextCursor:       result.NextCursor,
	})
}

func (h *handlers) tableFacets(w http.ResponseWriter, r *http.Request) {
	var in sdi.TableFacetsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	result, err := h.Tasks.TableFacets(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), tableInputFromSDI(in.Filter, "", nil, in.Columns, in.Facets, 0, 0))
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

func tableInputFromSDI(filter sdi.TableFilterSDI, groupBy string, groupKey *string, columns, facets []string, limit, offset int32) service.TableInput {
	return service.TableInput{
		Filter: service.TableFilter{
			Statuses:    filter.Statuses,
			Priorities:  filter.Priorities,
			AssigneeIDs: filter.AssigneeIDs,
		},
		GroupBy:  groupBy,
		GroupKey: groupKey,
		Columns:  columns,
		Facets:   facets,
		Limit:    limit,
		Offset:   offset,
	}
}

func tableGroupDTOs(groups []service.TableGroupDescriptor) []sdo.TableGroupDescriptorDTO {
	out := make([]sdo.TableGroupDescriptorDTO, 0, len(groups))
	for _, g := range groups {
		val := sdo.TableGroupValueDTO{
			Kind:     g.Value.Kind,
			Status:   g.Value.Status,
			Priority: g.Value.Priority,
		}
		if g.Value.Actor != nil {
			val.Actor = &sdo.TableActorRefDTO{Type: g.Value.Actor.Type, ID: g.Value.Actor.ID}
		}
		out = append(out, sdo.TableGroupDescriptorDTO{Key: g.Key, Value: val, Count: g.Count})
	}
	return out
}
