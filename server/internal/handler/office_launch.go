package handler

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// maxOfficeCommentIDLen is the ULID bound of every document comment id
// (util.NewID); the SDI's maxLength tag documents the same number.
const maxOfficeCommentIDLen = 26

func (h *handlers) createOfficeLaunch(w http.ResponseWriter, r *http.Request) {
	if h.OfficeLaunch == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "office launch is not configured")
		return
	}
	var in sdi.CreateOfficeLaunchSessionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	commentID := ""
	if in.CommentID != nil {
		commentID = strings.TrimSpace(*in.CommentID)
		// R1-6: a present comment_id must fit the ULID bound the SDI tags
		// document; blank or oversized is a 400 here, before any lookup.
		// Anything else is left to the existence check, which answers the
		// same 404 for unknown and other-document ids (no existence oracle).
		if commentID == "" || len(commentID) > maxOfficeCommentIDLen {
			respondError(w, http.StatusBadRequest, "invalid_request", "comment_id không hợp lệ")
			return
		}
	}
	row, err := h.OfficeLaunch.Create(r.Context(), service.Human(middleware.UserID(r.Context())), service.OfficeLaunchCreateInput{
		DocumentID: chi.URLParam(r, "documentID"), Operation: in.Operation, Version: in.Version,
		DeploymentID: strings.TrimSpace(in.DeploymentID), ClientID: strings.TrimSpace(in.ClientID),
		ReturnHint: strings.TrimSpace(in.ReturnHint), CommentID: commentID,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	launchURL := ""
	if strings.TrimSpace(in.ReturnHint) != "none" {
		launchURL = officeLaunchURL(in.ClientID, row.Ticket)
	}
	respondOfficeJSON(w, http.StatusCreated, sdo.OfficeLaunchSessionSDO{
		LaunchTicket: row.Ticket, LaunchURL: launchURL, ExpiresAt: row.ExpiresAt.UTC().Format(time.RFC3339),
		DocumentID: row.DocumentID, Operation: row.Operation, Version: row.Version, CommentID: row.CommentID,
	})
}

// officeLaunchURL is the deep link the client registered: the scheme is the
// allow-listed client id (stable "uniwork-office", dev "uniwork-office-dev"),
// so a dev build is never sent to the stable app's protocol handler.
func officeLaunchURL(clientID, ticket string) string {
	return strings.TrimSpace(clientID) + "://open?ticket=" + url.QueryEscape(ticket)
}

func (h *handlers) exchangeOfficeLaunch(w http.ResponseWriter, r *http.Request) {
	if h.OfficeLaunch == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "office launch is not configured")
		return
	}
	var in sdi.ExchangeOfficeLaunchSessionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if sid := middleware.SessionID(r.Context()); sid == "" || sid != strings.TrimSpace(in.DeviceSessionID) {
		respondError(w, http.StatusForbidden, "forbidden", "device session does not match bearer")
		return
	}
	res, err := h.OfficeLaunch.Exchange(r.Context(), service.OfficeLaunchExchangeInput{
		Ticket: strings.TrimSpace(in.LaunchTicket), AccountID: middleware.UserID(r.Context()),
		DeploymentID: strings.TrimSpace(in.DeploymentID), ClientID: strings.TrimSpace(in.ClientID), DeviceSessionID: strings.TrimSpace(in.DeviceSessionID),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	d := res.Document
	revision := strconv.FormatInt(d.Revision, 10)
	respondOfficeJSON(w, http.StatusOK, sdo.OfficeLaunchExchangeSDO{
		ReceiptID:  res.Session.SessionID,
		Document:   sdo.OfficeLaunchDocumentDTO{ID: d.ID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, Title: d.Title, Kind: d.Kind, Operation: res.Session.Operation, Version: res.Session.Version, Revision: revision, ContractVersion: "uniwork-office-engine-contract/1", ProtocolVersion: "1", DownloadPath: officeLaunchDownloadPath(d.ID, res.Session.Version)},
		CommentID:  res.CommentID,
		RedeemedAt: res.RedeemedAt.UTC().Format(time.RFC3339),
	})
}

func officeLaunchDownloadPath(documentID string, version int32) string {
	path := "/api/v1/documents/" + url.PathEscape(documentID) + "/download"
	if version > 0 {
		path += "?version=" + strconv.FormatInt(int64(version), 10)
	}
	return path
}

func (h *handlers) revokeOfficeLaunch(w http.ResponseWriter, r *http.Request) {
	if h.OfficeLaunch == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "office launch is not configured")
		return
	}
	err := h.OfficeLaunch.Revoke(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "launchSessionID"))
	if errors.Is(err, service.ErrNotFound) {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, sdo.StatusSDO{Status: "revoked"})
}

func respondOfficeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	respondJSON(w, status, v)
}
