package billing

import (
	"errors"
	"strings"
)

// IsQueryDRRetryable is true when another vnp_TransactionDate may succeed (wrong date/order vs gateway error body).
func IsQueryDRRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrInvalidWebhookSignature) {
		return true
	}
	msg := err.Error()
	if strings.Contains(msg, `querydr response "91"`) {
		return true
	}
	if strings.Contains(msg, `querydr response "94"`) {
		return true
	}
	if strings.Contains(msg, "missing SecureHash") {
		return true
	}
	return false
}
