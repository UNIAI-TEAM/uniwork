package billing

import (
	"net/http"
	"time"
)

// vnpHTTP bounds every VNPay merchant call. http.DefaultClient has no
// timeout, so a hung gateway would stall the billing worker until restart.
var vnpHTTP = &http.Client{Timeout: 15 * time.Second}
