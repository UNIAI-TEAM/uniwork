package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// updateDocumentAccess is PUT /api/v1/documents/{documentID}/access: batch
// grant, update, revoke or keep across user, workspace and organization
// principals, with optional dry_run preview (SH-S2, UNI-1781).
func (h *handlers) updateDocumentAccess(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	// R1-10: level is a required key on every item, where an explicit null is
	// the revoke and an absent key is malformed. A *string conflates the two,
	// so an incomplete item would silently revoke a live grant. The raw body
	// is decoded once into a presence map (the updateChatChannel pattern), the
	// typed decode runs on the same bytes, and the presence of level is read
	// back per item before the service sees it.
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	var in sdi.UpdateDocumentAccessSDI
	buf, _ := json.Marshal(raw)
	if err := json.Unmarshal(buf, &in); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "JSON không hợp lệ")
		return
	}
	var rawItems []map[string]json.RawMessage
	if v, ok := raw["items"]; ok && string(v) != "null" {
		if err := json.Unmarshal(v, &rawItems); err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "JSON không hợp lệ")
			return
		}
	}
	if len(rawItems) != len(in.Items) {
		respondError(w, http.StatusBadRequest, "invalid_request", "items không hợp lệ")
		return
	}
	items := make([]service.DocumentAccessBatchItem, len(in.Items))
	for i, it := range in.Items {
		_, levelPresent := rawItems[i]["level"]
		if !levelPresent {
			respondError(w, http.StatusBadRequest, "invalid_request", "level là trường bắt buộc; gửi null để thu hồi")
			return
		}
		var lvl *service.DocumentLevel
		if it.Level != nil {
			l := service.DocumentLevel(*it.Level)
			lvl = &l
		}
		items[i] = service.DocumentAccessBatchItem{
			PrincipalType: it.PrincipalType,
			PrincipalID:   it.PrincipalID,
			Level:         lvl,
			OnExisting:    it.OnExisting,
		}
	}
	res, err := h.Documents.UpdateDocumentAccess(
		r.Context(),
		service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"),
		service.UpdateDocumentAccessInput{
			Items:  items,
			DryRun: in.DryRun,
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentAccessBatchSDO(res))
}

func documentAccessBatchSDO(res service.DocumentAccessBatchResult) sdo.DocumentAccessBatchSDO {
	results := make([]sdo.DocumentAccessItemResultSDO, 0, len(res.Results))
	for _, r := range res.Results {
		var lvl, prev *string
		if r.Level != nil {
			s := string(*r.Level)
			lvl = &s
		}
		if r.PreviousLevel != nil {
			s := string(*r.PreviousLevel)
			prev = &s
		}
		results = append(results, sdo.DocumentAccessItemResultSDO{
			Index:         r.Index,
			PrincipalType: r.PrincipalType,
			PrincipalID:   r.PrincipalID,
			Status:        r.Status,
			ShareID:       r.ShareID,
			Level:         lvl,
			PreviousLevel: prev,
		})
	}
	users := make([]sdo.DocumentAccessPreviewUserSDO, 0, len(res.Preview.Users))
	for _, u := range res.Preview.Users {
		users = append(users, sdo.DocumentAccessPreviewUserSDO{
			UserID:      u.UserID,
			DisplayName: u.DisplayName,
			Before: sdo.DocumentAccessPreviewLevelSDO{
				Level: string(u.Before.Level),
				Via:   u.Before.Via,
			},
			After: sdo.DocumentAccessPreviewLevelSDO{
				Level: string(u.After.Level),
				Via:   u.After.Via,
			},
		})
	}
	groups := make([]sdo.DocumentAccessPreviewGroupSDO, 0, len(res.Preview.Groups))
	for _, g := range res.Preview.Groups {
		var lvl *string
		if g.Level != nil {
			s := string(*g.Level)
			lvl = &s
		}
		groups = append(groups, sdo.DocumentAccessPreviewGroupSDO{
			PrincipalType: g.PrincipalType,
			PrincipalID:   g.PrincipalID,
			Level:         lvl,
			MemberCount:   g.MemberCount,
			LosingCount:   g.LosingCount,
		})
	}
	warnings := make([]sdo.DocumentAccessWarningSDO, 0, len(res.Preview.Warnings))
	for _, w := range res.Preview.Warnings {
		warnings = append(warnings, sdo.DocumentAccessWarningSDO{
			Code:  w.Code,
			Index: w.Index,
		})
	}
	return sdo.DocumentAccessBatchSDO{
		BatchID: res.BatchID,
		DryRun:  res.DryRun,
		Results: results,
		Preview: sdo.DocumentAccessPreviewSDO{
			Users:    users,
			Groups:   groups,
			Warnings: warnings,
		},
	}
}
