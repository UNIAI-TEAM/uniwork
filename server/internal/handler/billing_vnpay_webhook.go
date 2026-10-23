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
		writeVNPayIPN(w, "97")
		return
	}
	if err != nil {
		writeVNPayIPN(w, "99")
		return
	}
	payload, err := service.ProviderWebhookPayloadJSON(ev)
	if err != nil {
		writeVNPayIPN(w, "99")
		return
	}
	code, err := h.Billing.HandleProviderWebhook(r.Context(), ev, payload)
	if err != nil {
		h.Log.Error("vnpay webhook apply", "err", err)
		if code == "" {
			code = "99"
		}
	}
	writeVNPayIPN(w, code)
}

func writeVNPayIPN(w http.ResponseWriter, code string) {
	respondJSON(w, http.StatusOK, map[string]string{
		"RspCode": code,
		"Message": vnpayIPNMessage(code),
	})
}

func vnpayIPNMessage(code string) string {
	switch code {
	case "00":
		return "Confirm Success"
	case "01":
		return "Order not found"
	case "02":
		return "Order already confirmed"
	case "04":
		return "Invalid amount"
	case "97":
		return "Invalid Checksum"
	default:
		return "Unknown error"
	}
}
