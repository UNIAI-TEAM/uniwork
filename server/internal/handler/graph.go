package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) graphNeighbors(w http.ResponseWriter, r *http.Request) {
	if h.Graph == nil {
		respondError(w, http.StatusNotImplemented, "graph_unavailable", "Work Graph chưa sẵn sàng")
		return
	}
	v := r.URL.Query()
	in := service.GraphNeighborsQuery{Direction: strings.TrimSpace(v.Get("direction")), Cursor: strings.TrimSpace(v.Get("cursor"))}
	for _, e := range strings.Split(v.Get("edge_types"), ",") {
		if e = strings.TrimSpace(e); e != "" {
			in.EdgeTypes = append(in.EdgeTypes, e)
		}
	}
	if raw := strings.TrimSpace(v.Get("at")); raw != "" {
		at, ok := parseRFC3339(raw)
		if !ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "at phải là thời điểm RFC 3339")
			return
		}
		in.At = at
	}
	if raw := strings.TrimSpace(v.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit phải là số nguyên dương")
			return
		}
		in.Limit = n
	}
	page, err := h.Graph.Neighbors(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "nodeType"), chi.URLParam(r, "nodeID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.GraphNeighborsSDO{Node: graphNodeDTO(page.Node), Items: []sdo.GraphNeighborDTO{}, NextCursor: page.NextCursor}
	for _, it := range page.Items {
		out.Items = append(out.Items, sdo.GraphNeighborDTO{
			EdgeType: it.EdgeType, Direction: it.Direction, Origin: it.Origin,
			ValidFrom: it.ValidFrom.UTC().Format(time.RFC3339), Backfilled: it.Backfilled, Node: graphNodeDTO(it.Node),
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) graphHistory(w http.ResponseWriter, r *http.Request) {
	if h.Graph == nil {
		respondError(w, http.StatusNotImplemented, "graph_unavailable", "Work Graph chưa sẵn sàng")
		return
	}
	var from, to time.Time
	for name, dst := range map[string]*time.Time{"from": &from, "to": &to} {
		if raw := strings.TrimSpace(r.URL.Query().Get(name)); raw != "" {
			t, ok := parseRFC3339(raw)
			if !ok {
				respondError(w, http.StatusBadRequest, "invalid_request", name+" phải là thời điểm RFC 3339")
				return
			}
			*dst = t
		}
	}
	hist, err := h.Graph.History(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "nodeType"), chi.URLParam(r, "nodeID"), from, to)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.GraphHistorySDO{Node: graphNodeDTO(hist.Node), Items: []sdo.GraphHistoryItemDTO{}}
	for _, it := range hist.Items {
		item := sdo.GraphHistoryItemDTO{
			Kind: it.Kind, EdgeType: it.EdgeType, FactType: it.FactType, Direction: it.Direction, Origin: it.Origin,
			ValidFrom: it.ValidFrom.UTC().Format(time.RFC3339), Value: it.Value, Previous: it.Previous,
			Precision: it.Precision, PreviousPrecision: it.PreviousPrecision, Backfilled: it.Backfilled,
		}
		if it.ValidTo != nil {
			item.ValidTo = it.ValidTo.UTC().Format(time.RFC3339)
		}
		if it.Node != nil {
			n := graphNodeDTO(*it.Node)
			item.Node = &n
		}
		out.Items = append(out.Items, item)
	}
	respondJSON(w, http.StatusOK, out)
}

func graphNodeDTO(n service.GraphNodeView) sdo.GraphNodeDTO {
	return sdo.GraphNodeDTO{Type: n.Type, ID: n.ID, Subtype: n.Subtype, Title: n.Title, Status: n.Status,
		WorkspaceID: n.WorkspaceID, WorkspaceSlug: n.WorkspaceSlug, Deleted: n.Deleted}
}
