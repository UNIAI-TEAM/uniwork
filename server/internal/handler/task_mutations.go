package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) createTask(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	t, err := h.Tasks.CreateTaskSuite(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"),
		service.CreateTaskInput{Title: in.Title, Description: in.Description, Priority: in.Priority,
			AssigneeID: in.AssigneeID, AssigneeKind: in.AssigneeKind, DueDate: in.DueDate},
		r.Header.Get("Idempotency-Key"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondTask(w, r, 200, t)
}

func (h *handlers) putTaskSuite(w http.ResponseWriter, r *http.Request) {
	var in sdi.PutTaskSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	rev, err := resolveTaskRevision(r.Header.Get("If-Match"), in.Revision)
	if err != nil {
		respondError(w, 400, "invalid_request", err.Error())
		return
	}
	if rev == nil {
		respondError(w, 400, "invalid_request", "revision hoặc If-Match là bắt buộc")
		return
	}
	t, err := h.Tasks.UpdateTaskSuite(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"),
		service.UpdateTaskSuiteInput{
			Revision: *rev,
			Title:    in.Title,
			Status:   in.Status,
			Priority: in.Priority,
			Position: in.Position,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondTask(w, r, 200, t)
}

func (h *handlers) batchUpdateTasks(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	var ids []string
	if v, ok := raw["task_ids"]; ok {
		if err := json.Unmarshal(v, &ids); err != nil {
			respondError(w, 400, "invalid_request", "task_ids phải là mảng chuỗi")
			return
		}
	}
	var patch service.UpdateTaskInput
	if v, ok := raw["updates"]; ok {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(v, &fields); err != nil {
			respondError(w, 400, "invalid_request", "updates không hợp lệ")
			return
		}
		var err error
		patch, err = parseTaskPatch(fields)
		if err != nil {
			respondError(w, 400, "invalid_request", err.Error())
			return
		}
	}
	n, err := h.Tasks.BatchUpdateTasks(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.BatchUpdateTasksInput{TaskIDs: ids, Patch: patch})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"updated": n})
}

func (h *handlers) batchDeleteTasks(w http.ResponseWriter, r *http.Request) {
	var in sdi.BatchDeleteTasksSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	n, err := h.Tasks.BatchDeleteTasks(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), in.TaskIDs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"deleted": n})
}

// resolveTaskRevision prefers a matching body revision and If-Match pair.
// Either alone is enough; disagreeing values are rejected.
func resolveTaskRevision(ifMatch string, body *int64) (*int64, error) {
	var header *int64
	ifMatch = strings.TrimSpace(ifMatch)
	if ifMatch != "" {
		ifMatch = strings.Trim(ifMatch, `"`)
		n, err := strconv.ParseInt(ifMatch, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("If-Match phải là số revision")
		}
		header = &n
	}
	switch {
	case header == nil && body == nil:
		return nil, nil
	case header == nil:
		return body, nil
	case body == nil:
		return header, nil
	case *header != *body:
		return nil, fmt.Errorf("If-Match và revision không khớp")
	default:
		return body, nil
	}
}
