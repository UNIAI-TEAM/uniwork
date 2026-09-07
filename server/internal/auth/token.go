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
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   userID,
		ID:        sessionID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(m.TTL)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.Secret)
}

// MintMFA issues the five-minute challenge token for userID.
func (m TokenMinter) MintMFA(userID string) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   userID,
		Audience:  jwt.ClaimStrings{mfaAudience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(mfaTokenTTL)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.Secret)
}

func (m TokenMinter) parse(token string) (*jwt.RegisteredClaims, error) {
	parsed, err := jwt.ParseWithClaims(token, &jwt.RegisteredClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return m.Secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return nil, fmt.Errorf("invalid claims")
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
	claims, err := m.parse(token)
	if err != nil {
		return "", "", err
	}
	if len(claims.Audience) != 0 {
		return "", "", fmt.Errorf("not an access token")
	}
	return claims.Subject, claims.ID, nil
}

// ParseMFA returns the user id of a challenge token and nothing else.
func (m TokenMinter) ParseMFA(token string) (string, error) {
	claims, err := m.parse(token)
	if err != nil {
		return "", err
	}
	for _, a := range claims.Audience {
		if a == mfaAudience {
			return claims.Subject, nil
		}
	}
	return "", fmt.Errorf("not an mfa token")
}
