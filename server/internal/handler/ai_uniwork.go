package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The UniWork AI route family (G6-03a, design §2): one service, three routes
// that differ only in how they name the actor and the scope.
//
//	POST /api/v1/orgs/{orgID}/ai/uniwork/chat/completions                R1
//	POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions      R3
//	POST /api/v1/office-frame/documents/{documentID}/ai/uniwork/...      R2
//
// The handler is thin on purpose: it names the actor and the document, reads
// the body as raw JSON (bounded by maxJSONBody) and hands it to the service.
// It never parses history: the server's transcript is what reaches the model
// (rule 7). Every answer — an error included — carries the conversation id
// (A12) so the client can continue the conversation; errors are real HTTP
// statuses with the JSON envelope, never a 200 opened to report a failure
// (A14).

// uniworkChat answers one turn for a scope the caller already named, with the
// 55 s deadline of A14 counted from the moment the request arrives.
func (h *handlers) uniworkChat(w http.ResponseWriter, r *http.Request, scope service.UniworkScope) {
	if h.AIUniwork == nil {
		h.mapServiceError(w, ai.ErrDisabled)
		return
	}
	var raw json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), time.Now().Add(h.AIUniwork.Deadline()))
	defer cancel()
	turn, err := h.AIUniwork.Chat(ctx, scope, service.UniworkTurnInput{
		ConversationID: r.Header.Get(ai.UniworkConversationHeader),
		Body:           raw,
	})
	// Every answer carries the conversation of the turn, a refusal included
	// when the service could name one (A12): the client must be able to
	// continue the conversation the refused turn belongs to.
	if turn.ConversationID != "" {
		w.Header().Set(ai.UniworkConversationHeader, turn.ConversationID)
	}
	if err != nil {
		h.uniworkError(w, ctx, err)
		return
	}
	meta := ai.UniworkResponseMeta{
		ConversationID: turn.ConversationID, Model: turn.Response.Model,
		Step: turn.Step, Limit: turn.Limit, Dropped: turn.Dropped, Now: time.Now(),
	}
	if turn.Stream {
		if err := ai.WriteUniworkSSE(w, turn.Response, meta); err != nil {
			// The one chunk could not be written: the client sees a broken
			// stream, which is the honest answer once bytes are out.
			h.Log.Warn("uniwork ai: stream write failed", "conversation_id", turn.ConversationID, "err", err)
		}
		return
	}
	respondJSON(w, http.StatusOK, ai.NewUniworkChatCompletion(turn.Response, meta))
}

// uniworkDocumentChatCompletions is R3: the desktop session route for a
// document (A10). It names the user and the document only; the service takes
// the organization, workspace and module from the document, and rechecks that
// the caller may still read it on every request.
func (h *handlers) uniworkDocumentChatCompletions(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	if userID == "" {
		h.Log.Debug("ai: actor not resolved", "err_type", "missing_user")
		respondError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}
	h.uniworkChat(w, r, service.UniworkScope{UserID: userID, DocumentID: chi.URLParam(r, "documentID")})
}

// uniworkFrameChatCompletions is R2: the same turn on the web Office frame
// token. The frame auth middleware already verified the token and matched its
// document; the resolver rechecked the token's user may still view it, and
// the module is the token's — the server never trusts a module the client
// sends on this route (rule 3/7, D-3).
//
// The org route R1 mounts this same turn with the session resolver
// (ai_mount.go): its context carries no frame claim, it names no document, and
// the service reads the turn's module from the body there (D-3, a local file).
func (a *aiHandlers) uniworkFrameChatCompletions(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := a.resolve(w, r)
	if !ok {
		return
	}
	claims := officeFrameClaims(r)
	a.uniworkChat(w, r, service.UniworkScope{
		UserID: userID, OrgID: orgID, DocumentID: chi.URLParam(r, "documentID"), Module: claims.ModuleName(),
	})
}

// uniworkError answers a failed turn. Two things happen before the shared
// mapping: Retry-After is set when the refusal carries the seconds to wait
// (the concurrency bound, or an upstream 429 the façade clamped), and a
// deadline of our own reads 504 ai_provider_timeout instead of whatever the
// wrapped failure looked like (A14, design §8.4). A decision the gates
// already made — 403, 409, 413 — is never rewritten into a timeout.
func (h *handlers) uniworkError(w http.ResponseWriter, ctx context.Context, err error) {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) && uniworkDeadlineRefusal(err) {
		h.mapServiceError(w, ai.ErrProviderTimeout)
		return
	}
	if retry, ok := uniworkRetryAfter(err); ok {
		w.Header().Set("Retry-After", retry)
	}
	h.mapServiceError(w, err)
}

// uniworkRetryAfter reads the seconds a refusal wants the client to wait out
// of CodedError.Fields (A11's bound carries retry_after; so does any refusal
// built from a vendor 429).
func uniworkRetryAfter(err error) (string, bool) {
	var ce service.CodedError
	if !errors.As(err, &ce) || ce.Fields == nil {
		return "", false
	}
	switch v := ce.Fields["retry_after"].(type) {
	case int:
		return strconv.Itoa(v), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case float64:
		return strconv.Itoa(int(v)), true
	}
	return "", false
}

// uniworkDeadlineRefusal reports whether the 55 s deadline is the better
// explanation than err itself: an infrastructure or provider failure is, and
// a refusal the gates already decided is not.
func uniworkDeadlineRefusal(err error) bool {
	var ce service.CodedError
	var ve service.ValidationError
	var aiErr *ai.Error
	switch {
	case errors.As(err, &ce), errors.As(err, &ve):
		return false
	case errors.As(err, &aiErr):
		return aiErr.Status >= http.StatusInternalServerError
	}
	return true
}
