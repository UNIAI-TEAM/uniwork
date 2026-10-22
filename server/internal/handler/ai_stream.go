package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// askUniStream is POST /workspaces/{id}/ai/ask/stream (R3-R5). The service
// refuses before its first event, so until then an error is the same JSON the
// legacy route answers; after it, an error is an event carrying only a code.
func (h *handlers) askUniStream(w http.ResponseWriter, r *http.Request) {
	var in sdi.AskUniSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	// A writer that can no longer reach the client cancels the run, which the
	// service stores and charges as a stop (R6) instead of running on.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	sw := newSSEWriter(w)
	sw.onDead = cancel
	defer sw.close()
	emit := func(ev service.AskEvent) { writeAskEvent(sw, ev) }
	// The stream route is the docked panel's (R1); the JSON route never sets Dock.
	askIn := askInputFromSDI(in)
	askIn.Dock = true
	_, err := h.AskUNI.AskStream(ctx, middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), askIn, emit)
	if err == nil {
		return
	}
	if !sw.started {
		h.refuseAsk(w, err)
		return
	}
	sw.event("error", sdo.AskStreamErrorDTO{Code: h.askErrorCode(err)})
}

func writeAskEvent(sw *sseWriter, ev service.AskEvent) {
	switch ev.Name {
	case "run":
		if ev.Run != nil {
			sw.event("run", sdo.AskStreamRunDTO{RunID: ev.Run.RunID, ConversationID: ev.Run.ConversationID})
		}
	case "step":
		if ev.Step != nil {
			counts := ev.Step.Counts
			if counts == nil {
				counts = map[string]int{}
			}
			sw.event("step", sdo.AskStreamStepDTO{Round: ev.Step.Round, Phase: ev.Step.Phase, Tool: ev.Step.Tool, Label: ev.Step.Label, Counts: counts})
		}
	case "sources":
		sw.event("sources", sdo.AskStreamSourcesDTO{Sources: citationDTOs(ev.Sources)})
	case "delta":
		sw.event("delta", sdo.AskStreamDeltaDTO{Text: ev.Delta})
	case "citations":
		sw.event("citations", sdo.AskStreamCitationsDTO{Citations: citationDTOs(ev.Citations)})
	case "followups":
		sw.event("followups", sdo.AskStreamFollowupsDTO{Followups: ev.Followups})
	case "done":
		if ev.Done != nil {
			u := ev.Done.Usage
			if u == (service.AskUsage{}) { // the P0 path reports the two totals only
				u.InputTokens, u.OutputTokens = ev.Done.InputTokens, ev.Done.OutputTokens
			}
			sw.event("done", sdo.AskStreamDoneDTO{
				Message: toAiMessageDTO(ev.Done.Message),
				Usage:   sdo.AskStreamUsageDTO{InputTokens: u.InputTokens, OutputTokens: u.OutputTokens, CacheReadTokens: u.CacheReadTokens, CacheWriteTokens: u.CacheWriteTokens},
			})
		}
	case "error":
		sw.event("error", sdo.AskStreamErrorDTO{Code: ev.Code})
	}
}

// askErrorCode is the code mapServiceError would have answered, for an error
// that arrives once the status is already sent. Never the message text.
func (h *handlers) askErrorCode(err error) string {
	f := classifyServiceError(err)
	// A stop or shutdown cancelling the run is not an unexpected failure.
	if f.unexpected && !errors.Is(err, context.Canceled) {
		h.Log.Error("internal", "err", err)
	}
	return f.code
}
