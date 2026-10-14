package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

// DocumentChangeProtocol is the wire protocol version of the Office change
// feed (G5-01a). A cursor binds it, so a cursor minted under another protocol
// is refused as invalid instead of being read with the wrong meaning.
const DocumentChangeProtocol = "office-change-feed/1"

// Change cursor phases. A snapshot cursor pages a materialised cold-start
// snapshot; the last snapshot page hands out a feed cursor carrying the
// snapshot's high-water mark, which the incremental feed (G5-01b) continues
// from.
const (
	changeCursorPhaseSnapshot = "snapshot"
	changeCursorPhaseFeed     = "feed"
)

// changeCursorPrefix tags the token format; a new format takes a new prefix.
const changeCursorPrefix = "dcc1."

// changeCursorClaims is what a change cursor binds. Every field is checked on
// the way in; only the signature makes it trustworthy, the encoding is not a
// secret (base64 JSON), so it carries ids and positions only.
type changeCursorClaims struct {
	Protocol     string `json:"p"`
	Deployment   string `json:"d"`
	UserID       string `json:"u"`
	Organization string `json:"o"`
	Workspace    string `json:"w"`
	Phase        string `json:"ph"`
	SnapshotID   string `json:"s,omitempty"`
	// After is the last document id the previous snapshot page returned
	// (keyset position); empty is the first page.
	After string `json:"a,omitempty"`
	// HighWater is the snapshot's pg_snapshot, carried on the feed cursor so
	// the feed position outlives the swept snapshot row.
	HighWater string `json:"h,omitempty"`
	// AfterXact / AfterID are the feed keyset: the (xact_id, id) of the last
	// row the previous feed page returned (G5-01b). Both empty is the first
	// feed page. xact_id is the commit-ordered transaction id of the audit
	// row behind the change; id breaks ties inside one transaction.
	AfterXact string `json:"x,omitempty"`
	AfterID   string `json:"i,omitempty"`
	ExpiresAt int64  `json:"e"`
}

// changeCursorScope is what the request presenting a cursor stands in; a
// cursor whose binding differs on any field is invalid.
type changeCursorScope struct {
	deployment   string
	userID       string
	organization string
	workspace    string
}

// changeCursorCodec signs and verifies change cursors. The key is derived
// from the server secret under its own label, so a change cursor can never
// pass for an access token, a frame token or a preview capability.
type changeCursorCodec struct {
	key []byte
}

func newChangeCursorCodec(secret string) changeCursorCodec {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("uniwork/office-change-cursor/v1"))
	return changeCursorCodec{key: mac.Sum(nil)}
}

func (c changeCursorCodec) mac(body string) []byte {
	m := hmac.New(sha256.New, c.key)
	m.Write([]byte(body))
	return m.Sum(nil)
}

func (c changeCursorCodec) sign(claims changeCursorClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	body := changeCursorPrefix + base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(c.mac(body)), nil
}

// verify answers the claims of a well-signed cursor bound to scope and the
// current protocol, ErrChangeCursorInvalid for anything else (forged,
// tampered, another account, workspace, organization, deployment or
// protocol), and ErrChangeCursorExpired for a genuine cursor past its
// expiry. Scope is checked before expiry, so an expired cursor of another
// scope still reads as invalid and never confirms that the scope exists.
func (c changeCursorCodec) verify(token string, scope changeCursorScope, now time.Time) (changeCursorClaims, error) {
	var claims changeCursorClaims
	rest, ok := strings.CutPrefix(token, changeCursorPrefix)
	if !ok {
		return claims, ErrChangeCursorInvalid
	}
	payload, sig, ok := strings.Cut(rest, ".")
	if !ok || payload == "" || sig == "" {
		return claims, ErrChangeCursorInvalid
	}
	// Strict: one spelling per MAC (see PreviewAssetService.verify).
	got, err := base64.RawURLEncoding.Strict().DecodeString(sig)
	if err != nil || !hmac.Equal(got, c.mac(changeCursorPrefix+payload)) {
		return claims, ErrChangeCursorInvalid
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(payload)
	if err != nil || json.Unmarshal(raw, &claims) != nil {
		return changeCursorClaims{}, ErrChangeCursorInvalid
	}
	if claims.Protocol != DocumentChangeProtocol ||
		claims.Deployment != scope.deployment ||
		claims.UserID != scope.userID ||
		claims.Organization != scope.organization ||
		claims.Workspace != scope.workspace {
		return changeCursorClaims{}, ErrChangeCursorInvalid
	}
	switch claims.Phase {
	case changeCursorPhaseSnapshot:
		if claims.SnapshotID == "" {
			return changeCursorClaims{}, ErrChangeCursorInvalid
		}
	case changeCursorPhaseFeed:
		// A feed cursor carries the snapshot mark it continues from; the
		// keyset may be empty (the first feed page).
		if claims.HighWater == "" {
			return changeCursorClaims{}, ErrChangeCursorInvalid
		}
	default:
		return changeCursorClaims{}, ErrChangeCursorInvalid
	}
	if !now.Before(time.Unix(claims.ExpiresAt, 0)) {
		return changeCursorClaims{}, ErrChangeCursorExpired
	}
	return claims, nil
}
