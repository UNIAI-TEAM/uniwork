package main

import (
	"crypto/hmac"
	"crypto/sha256"
)

// fileAccessSecret derives the key material FileAccessService needs (at least
// 32 bytes) from JWT_SECRET. A proxy ticket is bound to a live session, so it
// can never be stronger than the access token JWT_SECRET already signs; what
// the derivation adds is a fixed length and a label of its own, so the
// deployed JWT_SECRET keeps working whatever its length (the .env.example
// default and the CI test value are shorter than 32 bytes).
func fileAccessSecret(jwtSecret string) []byte {
	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte("uniwork/file-access-secret/v1"))
	return mac.Sum(nil)
}
