package handler

import (
	"errors"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) vnpayBillingWebhook(w http.ResponseWriter, r *http.Request) {
	ev, err := h.Billing.ParseProviderWebhook(r)
	if errors.Is(err, billing.ErrInvalidWebhookSignature) {
		respondError(w, http.StatusUnauthorized, "invalid_request", "webhook signature invalid")
		return
	}
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "webhook payload invalid")
		return
	}
	payload, err := service.ProviderWebhookPayloadJSON(ev)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "webhook payload invalid")
		return
	}
	ok, err := h.Billing.HandleProviderWebhook(r.Context(), ev, payload)
	if err != nil || !ok {
		if err != nil {
			h.Log.Error("vnpay webhook apply", "err", err)
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("RspCode=99&Message=Unknown error"))
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("RspCode=00&Message=Confirm Success"))
}
