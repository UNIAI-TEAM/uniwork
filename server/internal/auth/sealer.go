package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

// SecretSealer keeps secrets unreadable in a database dump (Seal/Open: TOTP
// secrets, the kept Apple refresh token) and makes the blobs the server
// hands a client opaque and tamper-proof (SealFor/OpenFor). Every key comes
// from the JWT secret, so no second secret has to be configured; main.go
// builds one sealer and every service shares it.
// ponytail: one key for both; rotating JWT_SECRET voids every enrolment
// (spec F-01 §2 I2) and every blob in flight. Add MFA_ENCRYPTION_KEY if that
// ever bites.
type SecretSealer struct {
	// aead is the Seal/Open key: SHA-256 of the JWT secret.
	aead cipher.AEAD
	// secret is the HKDF input of the per-purpose keys SealFor derives.
	secret []byte
}

// The purposes a client-held blob is sealed for (ADR 0047). Each one gets its
// own HKDF subkey and is the AES-GCM additional data, so a blob issued for one
// never opens as another: a sign-in ticket is not a step-up token, an OAuth
// state cookie is not a link token.
const (
	PurposeSignInTicket     = "sign_in_ticket"
	PurposeMFAPendingLink   = "mfa_pending_link"
	PurposeLinkToken        = "link_token"
	PurposeOAuthStateGoogle = "oauth_state:google"
	PurposeOAuthStateApple  = "oauth_state:apple"
	PurposeAppleWebResult   = "apple_web_result"
	PurposeStepUp           = "step_up"
)

// sealPurposes is the closed set SealFor and OpenFor accept: a purpose named
// nowhere here is a typo that would mint blobs nothing can open.
var sealPurposes = map[string]bool{
	PurposeSignInTicket: true, PurposeMFAPendingLink: true, PurposeLinkToken: true,
	PurposeOAuthStateGoogle: true, PurposeOAuthStateApple: true, PurposeAppleWebResult: true,
	PurposeStepUp: true,
}

// sealInfo versions the subkey derivation; a new scheme takes a new prefix.
const sealInfo = "uniwork/sealer/v1/"

var errSealerNotConfigured = errors.New("sealer: not configured")

func NewSecretSealer(jwtSecret []byte) (SecretSealer, error) {
	if len(jwtSecret) == 0 {
		return SecretSealer{}, errors.New("sealer: empty key")
	}
	key := sha256.Sum256(jwtSecret)
	aead, err := newGCM(key[:])
	if err != nil {
		return SecretSealer{}, err
	}
	return SecretSealer{aead: aead, secret: append([]byte(nil), jwtSecret...)}, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func (s SecretSealer) Seal(plain string) (string, error) {
	if s.aead == nil {
		return "", errSealerNotConfigured
	}
	return seal(s.aead, plain, nil, base64.RawStdEncoding)
}

func (s SecretSealer) Open(sealed string) (string, error) {
	if s.aead == nil {
		return "", errSealerNotConfigured
	}
	return open(s.aead, sealed, nil, base64.RawStdEncoding)
}

// SealFor seals plain for one purpose: the key is the purpose's HKDF subkey
// of the JWT secret and the purpose is the additional data. The blob is
// unpadded base64url, safe in a cookie, a query string or JSON.
func (s SecretSealer) SealFor(purpose, plain string) (string, error) {
	aead, err := s.purposeAEAD(purpose)
	if err != nil {
		return "", err
	}
	return seal(aead, plain, []byte(purpose), base64.RawURLEncoding)
}

// OpenFor opens a blob SealFor sealed for the same purpose; any other
// purpose, a Seal blob, another secret or a changed byte fails.
func (s SecretSealer) OpenFor(purpose, sealed string) (string, error) {
	aead, err := s.purposeAEAD(purpose)
	if err != nil {
		return "", err
	}
	return open(aead, sealed, []byte(purpose), base64.RawURLEncoding)
}

func (s SecretSealer) purposeAEAD(purpose string) (cipher.AEAD, error) {
	if len(s.secret) == 0 {
		return nil, errSealerNotConfigured
	}
	if !sealPurposes[purpose] {
		return nil, errors.New("sealer: unknown purpose")
	}
	key, err := hkdf.Key(sha256.New, s.secret, nil, sealInfo+purpose, 32)
	if err != nil {
		return nil, err
	}
	return newGCM(key)
}

func seal(aead cipher.AEAD, plain string, ad []byte, enc *base64.Encoding) (string, error) {
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return enc.EncodeToString(aead.Seal(nonce, nonce, []byte(plain), ad)), nil
}

func open(aead cipher.AEAD, sealed string, ad []byte, enc *base64.Encoding) (string, error) {
	raw, err := enc.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	n := aead.NonceSize()
	if len(raw) < n {
		return "", errors.New("sealer: short ciphertext")
	}
	plain, err := aead.Open(nil, raw[:n], raw[n:], ad)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
