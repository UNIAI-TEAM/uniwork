package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// mfaAudience marks the short-lived token handed out between a correct
// password and a correct TOTP code. Parse refuses it, so it opens nothing
// but POST /auth/mfa/verify (spec F-01 §2 I4).
const mfaAudience = "mfa"

const mfaTokenTTL = 5 * time.Minute

// accessClaims adds the browser-session mark to the registered claims.
type accessClaims struct {
	jwt.RegisteredClaims
	// Web marks a browser session, which never has a device_sessions row.
	// Only AuthService sets it; desktop tokens leave it false, so a token
	// minted before the mark existed is still checked against its device.
	Web bool `json:"web,omitempty"`
}

type TokenMinter struct {
	Secret []byte
	TTL    time.Duration
}

// Mint issues an access token; sessionID (may be empty) travels as the
// registered `jti`-like claim so the client can spot its own session.
func (m TokenMinter) Mint(userID string) (string, error) {
	return m.MintSession(userID, "")
}

func (m TokenMinter) MintSession(userID, sessionID string) (string, error) {
	return m.mintAccess(userID, sessionID, false)
}

// MintWebSession issues a browser-session access token (see accessClaims.Web).
func (m TokenMinter) MintWebSession(userID, sessionID string) (string, error) {
	return m.mintAccess(userID, sessionID, true)
}

func (m TokenMinter) mintAccess(userID, sessionID string, web bool) (string, error) {
	now := time.Now()
	claims := accessClaims{RegisteredClaims: jwt.RegisteredClaims{
		Subject:   userID,
		ID:        sessionID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(m.TTL)),
	}, Web: web}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.Secret)
}

// The channels a challenge token is bound to (ADR 0049 §4): the browser's
// POST /auth/mfa/verify takes only a web one, the app's route only a native
// one minted for the same client and deployment.
const (
	MFAChannelWeb    = "web"
	MFAChannelNative = "native"
)

// MFAChallenge is what a challenge token says besides its expiry: whose
// second factor is owed, on which channel (with the native client and
// deployment), and the identity a provider sign-in left waiting to be linked
// once the factor passes (PendingLink, sealed for mfa_pending_link; empty
// when nothing waits). IssuedAt is the token's iat as ParseMFA read it
// (MintMFA stamps its own): the second step refuses a challenge minted
// before the account's credentials last changed (ADR 0049).
type MFAChallenge struct {
	UserID       string
	Channel      string
	ClientID     string
	DeploymentID string
	PendingLink  string
	IssuedAt     time.Time
}

// mfaClaims is the challenge token's body. The short names keep the token,
// and the uniwork_mfa cookie that carries it, small.
type mfaClaims struct {
	jwt.RegisteredClaims
	Channel      string `json:"chn,omitempty"`
	ClientID     string `json:"cid,omitempty"`
	DeploymentID string `json:"dep,omitempty"`
	PendingLink  string `json:"pl,omitempty"`
}

// MintMFA issues the five-minute challenge token for c.UserID. An empty
// channel is minted as web.
func (m TokenMinter) MintMFA(c MFAChallenge) (string, error) {
	if c.Channel == "" {
		c.Channel = MFAChannelWeb
	}
	if c.Channel != MFAChannelWeb && c.Channel != MFAChannelNative {
		return "", fmt.Errorf("mfa token: unknown channel %q", c.Channel)
	}
	now := time.Now()
	claims := mfaClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   c.UserID,
			Audience:  jwt.ClaimStrings{mfaAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(mfaTokenTTL)),
		},
		Channel: c.Channel, ClientID: c.ClientID, DeploymentID: c.DeploymentID, PendingLink: c.PendingLink,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.Secret)
}

// parseInto verifies token's HS256 signature and expiry into claims and
// refuses one without a subject.
func (m TokenMinter) parseInto(token string, claims jwt.Claims) error {
	if _, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return m.Secret, nil
	}); err != nil {
		return err
	}
	if sub, err := claims.GetSubject(); err != nil || sub == "" {
		return fmt.Errorf("invalid claims")
	}
	return nil
}

func (m TokenMinter) parse(token string) (*accessClaims, error) {
	claims := &accessClaims{}
	if err := m.parseInto(token, claims); err != nil {
		return nil, err
	}
	return claims, nil
}

// Parse returns the user id of an access token. A challenge token is refused.
func (m TokenMinter) Parse(token string) (string, error) {
	uid, _, err := m.ParseSession(token)
	return uid, err
}

// ParseSession returns user id and session id ("" for tokens minted before
// sessions carried an id).
func (m TokenMinter) ParseSession(token string) (userID, sessionID string, err error) {
	at, err := m.ParseAccessToken(token)
	return at.UserID, at.SessionID, err
}

// AccessToken is what a verified access token says about its holder.
type AccessToken struct {
	UserID, SessionID string
	Web               bool
	// IssuedAt is the token's iat, at its one-second precision: a sensitive
	// command refuses a browser token issued before the account's
	// credentials_revoked_at (ADR 0049).
	IssuedAt  time.Time
	ExpiresAt time.Time
}

// ParseAccessToken returns what a verified access token says: user, session,
// the browser-session mark, when it was issued and its expiry (for a holder
// that outlives one request, a WebSocket).
func (m TokenMinter) ParseAccessToken(token string) (AccessToken, error) {
	claims, err := m.parse(token)
	if err != nil {
		return AccessToken{}, err
	}
	if len(claims.Audience) != 0 {
		return AccessToken{}, fmt.Errorf("not an access token")
	}
	at := AccessToken{UserID: claims.Subject, SessionID: claims.ID, Web: claims.Web}
	if claims.IssuedAt != nil {
		at.IssuedAt = claims.IssuedAt.Time
	}
	if claims.ExpiresAt != nil {
		at.ExpiresAt = claims.ExpiresAt.Time
	}
	return at, nil
}

// ParseMFA returns what a challenge token carries. A token minted before
// tokens named their channel reads as web, the only channel there was.
func (m TokenMinter) ParseMFA(token string) (MFAChallenge, error) {
	claims := &mfaClaims{}
	if err := m.parseInto(token, claims); err != nil {
		return MFAChallenge{}, err
	}
	isMFA := false
	for _, a := range claims.Audience {
		isMFA = isMFA || a == mfaAudience
	}
	if !isMFA {
		return MFAChallenge{}, fmt.Errorf("not an mfa token")
	}
	c := MFAChallenge{
		UserID: claims.Subject, Channel: claims.Channel, ClientID: claims.ClientID,
		DeploymentID: claims.DeploymentID, PendingLink: claims.PendingLink,
	}
	if claims.IssuedAt != nil {
		c.IssuedAt = claims.IssuedAt.Time
	}
	if c.Channel == "" {
		c.Channel = MFAChannelWeb
	}
	return c, nil
}
