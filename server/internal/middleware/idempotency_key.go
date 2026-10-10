package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// maxIdempotencyKeyLen bounds a client-chosen key; the service and the ledger
// store it verbatim in a TEXT column.
const maxIdempotencyKeyLen = 255

// IdempotencyKeyFormat answers 400 for an Idempotency-Key header that is not
// printable ASCII (0x20-0x7E) or is longer than 255 bytes. Handlers read the
// header raw and the ledger stores it as TEXT, so a key with invalid UTF-8 or
// a control byte used to surface as a 500 from the database. Refusing it here
// covers every command that takes the header in one place.
func IdempotencyKeyFormat(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, key := range r.Header.Values("Idempotency-Key") {
			if validIdempotencyKey(key) {
				continue
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO("invalid_request", "Idempotency-Key must be printable ASCII, at most 255 characters"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func validIdempotencyKey(key string) bool {
	if len(key) > maxIdempotencyKeyLen {
		return false
	}
	for i := 0; i < len(key); i++ {
		if key[i] < 0x20 || key[i] > 0x7e {
			return false
		}
	}
	return true
}
