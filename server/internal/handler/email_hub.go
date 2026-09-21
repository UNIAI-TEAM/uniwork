package handler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) listEmailHubAccounts(w http.ResponseWriter, r *http.Request) {
	rows, err := h.EmailHub.ListAccounts(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.EmailHubAccountListSDO{Accounts: make([]sdo.EmailHubAccountSDO, 0, len(rows))}
	for _, a := range rows {
		out.Accounts = append(out.Accounts, toEmailHubAccountSDO(a))
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) connectEmailHubAccount(w http.ResponseWriter, r *http.Request) {
	var in sdi.ConnectEmailHubAccountSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	acc, err := h.EmailHub.Connect(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), service.ConnectEmailHubInput{
		EmailAddress: in.EmailAddress, AppPassword: in.AppPassword,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmailHubNotConfigured):
			respondError(w, http.StatusServiceUnavailable, "email_hub_not_configured", "Email Hub is not configured")
		case errors.Is(err, service.ErrEmailHubUnsupported):
			respondError(w, http.StatusBadRequest, "email_hub_unsupported", "Email provider is not supported")
		case errors.Is(err, service.ErrEmailHubConnectFailed):
			respondError(w, http.StatusBadRequest, "email_hub_connect_failed", "Could not connect to the mailbox")
		default:
			h.mapServiceError(w, err)
		}
		return
	}
	respondJSON(w, http.StatusCreated, toEmailHubAccountSDO(acc))
}

func (h *handlers) disconnectEmailHubAccount(w http.ResponseWriter, r *http.Request) {
	err := h.EmailHub.Disconnect(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "accountID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) listEmailHubThreads(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := int32(50)
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = int32(v)
	}
	page, err := h.EmailHub.ListThreads(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.ListEmailHubThreadsInput{
			AccountID: q.Get("account_id"), Folder: q.Get("folder"), Limit: limit,
			Query: q.Get("q"), FromFilter: q.Get("from"), BeforeID: q.Get("before"),
			UnreadOnly: q.Get("unread") == "1", HasAttachmentsOnly: q.Get("has_attachments") == "1",
		},
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.EmailHubThreadListSDO{
		Threads:    make([]sdo.EmailHubThreadSDO, 0, len(page.Threads)),
		Counts:     sdo.EmailHubCountsSDO{Total: page.Counts.Total, Unread: page.Counts.Unread},
		NextCursor: page.NextCursor,
	}
	for _, t := range page.Threads {
		out.Threads = append(out.Threads, toEmailHubThreadSDO(t))
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) downloadEmailHubAttachment(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	view, body, err := h.EmailHub.OpenAttachment(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), accountID,
		chi.URLParam(r, "threadID"), chi.URLParam(r, "attachmentID"),
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer body.Close()
	filename := view.Filename
	if filename == "" {
		filename = "attachment"
	}
	w.Header().Set("Content-Type", view.MimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	if view.SizeBytes > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(view.SizeBytes, 10))
	}
	if _, err := io.Copy(w, body); err != nil {
		h.Log.Warn("email hub attachment stream", "err", err)
	}
}

func (h *handlers) getEmailHubThread(w http.ResponseWriter, r *http.Request) {
	thread, err := h.EmailHub.GetThread(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), r.URL.Query().Get("account_id"), chi.URLParam(r, "threadID"),
		r.URL.Query().Get("body") == "1",
		r.URL.Query().Get("mark_read") == "1",
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toEmailHubThreadSDO(thread))
}

func (h *handlers) sendEmailHub(w http.ResponseWriter, r *http.Request) {
	var in sdi.SendEmailHubSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	thread, err := h.EmailHub.Send(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), service.SendEmailHubInput{
		AccountID: in.AccountID, To: in.To, Cc: in.Cc, Subject: in.Subject,
		BodyText: in.BodyText, ReplyToThreadID: in.ReplyToThreadID,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmailHubNotConfigured):
			respondError(w, http.StatusServiceUnavailable, "email_hub_not_configured", "Email Hub is not configured")
		case errors.Is(err, service.ErrEmailHubSendFailed):
			respondError(w, http.StatusBadGateway, "email_hub_send_failed", "Could not send the message")
		default:
			h.mapServiceError(w, err)
		}
		return
	}
	respondJSON(w, http.StatusCreated, toEmailHubThreadSDO(thread))
}

func (h *handlers) patchEmailHubThread(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchEmailHubThreadSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	threadID := chi.URLParam(r, "threadID")
	if in.MoveTo != "" {
		if err := h.EmailHub.MoveThread(r.Context(), actor, wsID, in.AccountID, threadID, in.MoveTo); err != nil {
			h.mapServiceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if in.IsStarred != nil {
		thread, err := h.EmailHub.MarkThreadStarred(r.Context(), actor, wsID, in.AccountID, threadID, *in.IsStarred)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		respondJSON(w, http.StatusOK, toEmailHubThreadSDO(thread))
		return
	}
	if in.IsRead == nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "is_read, is_starred or move_to is required")
		return
	}
	thread, err := h.EmailHub.MarkThreadRead(r.Context(), actor, wsID, in.AccountID, threadID, *in.IsRead)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toEmailHubThreadSDO(thread))
}

func (h *handlers) syncEmailHub(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("force") == "1" || r.URL.Query().Get("force") == "true"
	live := r.URL.Query().Get("live") == "1" || r.URL.Query().Get("live") == "true"
	synced, err := h.EmailHub.Sync(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), r.URL.Query().Get("account_id"), r.URL.Query().Get("folder"), force, live,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubSyncSDO{Synced: synced})
}

func (h *handlers) watchEmailHub(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	changed, err := h.EmailHub.WatchInbox(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), accountID,
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmailHubNotConfigured):
			respondError(w, http.StatusServiceUnavailable, "email_hub_not_configured", "Email Hub is not configured")
		default:
			h.mapServiceError(w, err)
		}
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubWatchSDO{
		Changed: changed, Synced: changed, At: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *handlers) subscribeEmailHubInboxWatch(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	err := h.EmailHub.SubscribeInboxWatch(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), accountID,
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmailHubNotConfigured):
			respondError(w, http.StatusServiceUnavailable, "email_hub_not_configured", "Email Hub is not configured")
		default:
			h.mapServiceError(w, err)
		}
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubInboxWatchSDO{Subscribed: true})
}

func (h *handlers) unsubscribeEmailHubInboxWatch(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	if err := h.EmailHub.UnsubscribeInboxWatch(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), accountID,
	); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubInboxWatchSDO{Subscribed: false})
}

func toEmailHubAccountSDO(a service.EmailHubAccountView) sdo.EmailHubAccountSDO {
	out := sdo.EmailHubAccountSDO{
		ID: a.ID, EmailAddress: a.EmailAddress, Provider: a.Provider,
		ConnectedAt: a.ConnectedAt.Format(time.RFC3339),
	}
	if a.LastSyncAt != nil {
		out.LastSyncAt = a.LastSyncAt.Format(time.RFC3339)
	}
	return out
}

func toEmailHubThreadSDO(t service.EmailHubThreadView) sdo.EmailHubThreadSDO {
	out := sdo.EmailHubThreadSDO{
		ID: t.ID, AccountID: t.AccountID, Folder: t.Folder, Subject: t.Subject, Snippet: t.Snippet,
		FromAddr: t.FromAddr, FromName: t.FromName, ToAddrs: t.ToAddrs, SentAt: t.SentAt.Format(time.RFC3339),
		IsRead: t.IsRead, IsStarred: t.IsStarred, HasAttachments: t.HasAttachments,
		BodyText: t.BodyText, BodyHTML: t.BodyHTML, BodyCached: t.BodyCached,
	}
	if len(t.Attachments) > 0 {
		out.Attachments = make([]sdo.EmailHubAttachmentSDO, 0, len(t.Attachments))
		for _, att := range t.Attachments {
			out.Attachments = append(out.Attachments, sdo.EmailHubAttachmentSDO{
				ID: att.ID, Filename: att.Filename, MimeType: att.MimeType, SizeBytes: att.SizeBytes,
			})
		}
	}
	return out
}
