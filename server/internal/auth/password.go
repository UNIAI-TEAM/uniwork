package auth

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// passwordCost is bcrypt's default in the server. A test binary hashes at the
// minimum instead: bcrypt is pure Go, so under -race one default-cost hash
// takes ~0.7s, and the service tests register thousands of users. A stored
// hash carries its own cost, so CheckPassword needs no matching change.
var passwordCost = func() int {
	if testing.Testing() {
		return bcrypt.MinCost
	}
	return bcrypt.DefaultCost
}()

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), passwordCost)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}
