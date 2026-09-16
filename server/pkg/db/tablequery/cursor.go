package tablequery

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
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

// numericText matches what Postgres' float8 and numeric inputs accept from
// their own text output: a decimal with optional exponent, NaN or infinity.
var numericText = regexp.MustCompile(`^[+-]?((\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|(?i:nan|inf|infinity))$`)

// timestampLayouts cover the ISO text output of timestamptz (offsets as
// +hh, +hh:mm or +hh:mm:ss) and RFC 3339.
var timestampLayouts = []string{
	"2006-01-02 15:04:05.999999999Z07",
	"2006-01-02 15:04:05.999999999Z07:00",
	"2006-01-02 15:04:05.999999999Z07:00:00",
	time.RFC3339Nano,
}

// ValidateCursorSortValue reports ErrInvalidCursor when c carries a sort
// value that q's sort expression cannot cast. The value is bound as a
// parameter and cast in SQL, so without this a tampered or stale cursor with
// a matching fingerprint fails the whole statement instead of the request.
func ValidateCursorSortValue(q Query, c Cursor) error {
	if c.SortNull || c.SortValue == nil {
		return nil
	}
	v := *c.SortValue
	var ok bool
	switch cast := newBuilder(q).sortExpr().cast; cast {
	case "::float8":
		_, err := strconv.ParseFloat(v, 64)
		ok = numericText.MatchString(v) && err == nil
	case "::numeric":
		ok = numericText.MatchString(v)
	case "::int":
		_, err := strconv.ParseInt(v, 10, 32)
		ok = err == nil
	case "::date":
		_, err := time.Parse("2006-01-02", v)
		ok = err == nil || isInfinity(v)
	case "::timestamptz":
		ok = isInfinity(v)
		for _, layout := range timestampLayouts {
			if _, err := time.Parse(layout, v); err == nil {
				ok = true
				break
			}
		}
	case "::text":
		ok = true
	default:
		return fmt.Errorf("%w: unknown sort cast %s", ErrInvalidCursor, cast)
	}
	if !ok {
		return fmt.Errorf("%w: sort_value %q does not cast", ErrInvalidCursor, v)
	}
	return nil
}

func isInfinity(v string) bool {
	return v == "infinity" || v == "-infinity"
}
