package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
)

// maxMobileEventsBody: twenty small events fit in well under 4 KiB.
const maxMobileEventsBody = 4096

// maxMobileEventsPerBatch: what one flush of the app's queue sends at most.
const maxMobileEventsPerBatch = 20

// mobileEvents is POST /api/v1/mobile/events: UniChat mobile's anonymous
// product events (data/analytics.ts), turned into counters by OS, store
// version and OTA update and nothing else — no person, organization or content is recorded.
// Always 204: the app never retries or shows an analytics failure.
func (h *handlers) mobileEvents(w http.ResponseWriter, r *http.Request) {
	var in sdi.MobileEventsSDI
	if !decode(w, r, &in, maxMobileEventsBody) {
		return
	}
	if h.MobileEvents != nil {
		_, version, os := mw.ClientMetadataFromContext(r.Context())
		update := mw.ClientUpdateIDFromContext(r.Context())
		for i, event := range in.Events {
			if i == maxMobileEventsPerBatch {
				break
			}
			h.MobileEvents.Observe(event.Name, event.Result, os, version, update, event.DurationMs)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
