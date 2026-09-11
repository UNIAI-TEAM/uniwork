package util

import (
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

// entropy is process-wide so IDs minted in the same millisecond stay sortable
// (Ask UNI user+assistant rows share created_at and ORDER BY id ASC).
var entropy = sync.OnceValue(ulid.DefaultEntropy)

func NewID() string {
	return ulid.MustNew(ulid.Timestamp(time.Now()), entropy()).String()
}
