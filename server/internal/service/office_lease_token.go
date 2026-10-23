package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
)

// officeLeaseKeyLabel derives the lease signing key from JWT_SECRET (G5-D1
// row 4), the same construction as the change cursor: a lease can never pass
// for an access token, a frame token, a preview capability or a cursor.
const officeLeaseKeyLabel = "uniwork/office-offline-lease/v1"

// officeLeaseKeyID is the kid claim: the label's version, so a later key
// scheme (Ed25519, G5-D1 row 4 option b) can ship without a wire change.
const officeLeaseKeyID = "v1"

// officeLeaseTokenVersion is the v claim, the claim layout version.
const officeLeaseTokenVersion = 1

// officeLeaseTokenPrefix tags the token format; a new format takes a new prefix.
const officeLeaseTokenPrefix = "ofl1."

// officeLeaseClaims is what a lease signs (G5-D1 row 3). The app reads them
// offline to show the scope and expiry; the server trusts none of them on the
// way back in beyond picking the row: every decision reads the stored row.
// Times are server Unix seconds; revision is a decimal string like every
// other revision on the wire.
type officeLeaseClaims struct {
	V               int    `json:"v"`
	KeyID           string `json:"kid"`
	LeaseID         string `json:"lease_id"`
	Generation      int32  `json:"generation"`
	UserID          string `json:"user_id"`
	DeviceSessionID string `json:"device_session_id"`
	DeploymentID    string `json:"deployment_id"`
	OrganizationID  string `json:"organization_id"`
	WorkspaceID     string `json:"workspace_id"`
	DocumentID      string `json:"document_id"`
	VersionID       string `json:"version_id"`
	Version         int32  `json:"version"`
	Revision        string `json:"revision"`
	Level           string `json:"level"`
	PolicyEpoch     int64  `json:"policy_epoch"`
	IssuedAt        int64  `json:"iat"`
	ExpiresAt       int64  `json:"exp"`
}

// officeLeaseCodec signs and verifies lease tokens with HMAC-SHA256 under the
// derived key.
type officeLeaseCodec struct {
	key []byte
}

func newOfficeLeaseCodec(secret string) officeLeaseCodec {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(officeLeaseKeyLabel))
	return officeLeaseCodec{key: mac.Sum(nil)}
}

func (c officeLeaseCodec) mac(body string) []byte {
	m := hmac.New(sha256.New, c.key)
	m.Write([]byte(body))
	return m.Sum(nil)
}

func (c officeLeaseCodec) sign(claims officeLeaseClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	body := officeLeaseTokenPrefix + base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(c.mac(body)), nil
}

// verify answers the claims of a well-signed token of the current layout and
// key, false for anything else: a forged or tampered token, another key (a
// rotated JWT_SECRET) or another layout. A token that verifies still only
// names a row; the caller checks the row.
func (c officeLeaseCodec) verify(token string) (officeLeaseClaims, bool) {
	var claims officeLeaseClaims
	rest, ok := strings.CutPrefix(token, officeLeaseTokenPrefix)
	if !ok {
		return claims, false
	}
	payload, sig, ok := strings.Cut(rest, ".")
	if !ok || payload == "" || sig == "" {
		return claims, false
	}
	// Strict: one spelling per MAC (see PreviewAssetService.verify).
	got, err := base64.RawURLEncoding.Strict().DecodeString(sig)
	if err != nil || !hmac.Equal(got, c.mac(officeLeaseTokenPrefix+payload)) {
		return claims, false
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(payload)
	if err != nil || json.Unmarshal(raw, &claims) != nil {
		return officeLeaseClaims{}, false
	}
	if claims.V != officeLeaseTokenVersion || claims.KeyID != officeLeaseKeyID || claims.LeaseID == "" {
		return officeLeaseClaims{}, false
	}
	return claims, true
}
