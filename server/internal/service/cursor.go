package service

import (
	"encoding/base64"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// Keyset pagination for the people directory and the member list. Both sort by
// (display_name, user_id), so the cursor carries exactly that pair: an offset
// would skip or repeat rows when someone is renamed mid-scroll, and a numeric
// page would go wrong the moment a member is added.
//
// The encoding is opaque on purpose — the client passes back what it was
// given and never builds one — but it is not a secret: it holds a name the
// caller has already read.
const cursorSeparator = "\x00"

func encodeMemberCursor(displayName, userID string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(displayName + cursorSeparator + userID))
}

// decodeMemberCursor returns the two keyset columns. An empty cursor is the
// first page; anything unparseable is a client error rather than a silent
// restart from the top, which would loop forever.
func decodeMemberCursor(cursor string) (pgtype.Text, pgtype.Text, error) {
	if cursor == "" {
		return pgtype.Text{}, pgtype.Text{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return pgtype.Text{}, pgtype.Text{}, Invalid("cursor không hợp lệ")
	}
	name, userID, ok := strings.Cut(string(raw), cursorSeparator)
	if !ok || userID == "" {
		return pgtype.Text{}, pgtype.Text{}, Invalid("cursor không hợp lệ")
	}
	return pgtype.Text{String: name, Valid: true}, pgtype.Text{String: userID, Valid: true}, nil
}
