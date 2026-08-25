package util

import (
	"crypto/rand"

	"github.com/oklog/ulid/v2"
)

func NewID() string {
	return ulid.MustNew(ulid.Now(), rand.Reader).String()
}
