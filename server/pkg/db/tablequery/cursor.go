package tablequery

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrInvalidCursor is returned (wrapped) by DecodeCursor when the string is
// not a well-formed, valid cursor.
var ErrInvalidCursor = errors.New("tablequery: invalid cursor")

// Cursor is the keyset position for one page of the table view: which query
// it belongs to (FP), which group/parent it is scoped to, and the last row's
// sort value + tiebreakers (created_at, id).
type Cursor struct {
	V         int     `json:"v"`
	FP        string  `json:"fp"`
	GroupKey  *string `json:"group_key"`
	ParentID  *string `json:"parent_id"`
	SortValue *string `json:"sort_value"` // text form; nil when SortNull
	SortNull  bool    `json:"sort_null"`
	CreatedAt string  `json:"created_at"` // RFC3339Nano
	ID        string  `json:"id"`
}

// EncodeCursor renders c as an opaque base64url (no padding) token.
func EncodeCursor(c Cursor) string {
	b, err := json.Marshal(c)
	if err != nil {
		// Cursor is made only of strings, *string, bool and int: it always
		// marshals successfully.
		panic("tablequery: cursor marshal: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor parses and validates an opaque cursor token produced by
// EncodeCursor. Any failure (bad base64, bad JSON, unknown field, wrong
// version, missing id, unparsable created_at) is ErrInvalidCursor.
func DecodeCursor(s string) (Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, fmt.Errorf("%w: bad base64: %v", ErrInvalidCursor, err)
	}

	var c Cursor
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return Cursor{}, fmt.Errorf("%w: bad json: %v", ErrInvalidCursor, err)
	}

	if c.V != 1 {
		return Cursor{}, fmt.Errorf("%w: unsupported version %d", ErrInvalidCursor, c.V)
	}
	if c.ID == "" {
		return Cursor{}, fmt.Errorf("%w: missing id", ErrInvalidCursor)
	}
	if _, err := time.Parse(time.RFC3339Nano, c.CreatedAt); err != nil {
		return Cursor{}, fmt.Errorf("%w: bad created_at: %v", ErrInvalidCursor, err)
	}

	return c, nil
}
