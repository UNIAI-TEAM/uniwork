package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TOTP per RFC 6238 on the stdlib: SHA-1, 6 digits, 30-second steps. Every
// authenticator app speaks exactly this profile, so no library is needed.
const (
	totpStep   = 30 * time.Second
	totpDigits = 6
	// totpSkew is the number of steps accepted either side of now; one step
	// absorbs clock drift between the phone and the server.
	totpSkew = 1
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret returns 160 bits of entropy as unpadded base32 — the form the
// user types or scans.
func NewTOTPSecret() (string, error) {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return b32.EncodeToString(raw), nil
}

// TOTPCode is the 6-digit code for secret at t.
func TOTPCode(secret string, t time.Time) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", fmt.Errorf("totp: bad secret: %w", err)
	}
	counter := uint64(t.Unix()) / uint64(totpStep/time.Second)
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", code%1_000_000), nil
}

// ValidTOTP reports whether code matches secret within ±totpSkew steps of now.
func ValidTOTP(secret, code string, now time.Time) bool {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return false
	}
	for i := -totpSkew; i <= totpSkew; i++ {
		want, err := TOTPCode(secret, now.Add(time.Duration(i)*totpStep))
		if err != nil {
			return false
		}
		if hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

// OTPAuthURL is the otpauth:// URI an authenticator app enrols from.
func OTPAuthURL(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{"secret": {secret}, "issuer": {issuer}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// Recovery codes: 8 codes of 10 base32 characters (50 bits each), shown once.
const recoveryCodeCount = 8

func NewRecoveryCodes() ([]string, error) {
	out := make([]string, 0, recoveryCodeCount)
	for range recoveryCodeCount {
		raw := make([]byte, 7)
		if _, err := rand.Read(raw); err != nil {
			return nil, err
		}
		s := strings.ToLower(b32.EncodeToString(raw))[:10]
		out = append(out, s[:5]+"-"+s[5:])
	}
	return out, nil
}

// HashRecoveryCode is the stored form. The codes carry 50 bits of entropy, so
// a fast hash is not a weakness the way it would be for a password.
func HashRecoveryCode(code string) string {
	norm := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), " ", ""))
	sum := sha256.Sum256([]byte(norm))
	return base64.RawStdEncoding.EncodeToString(sum[:])
}

// SecretSealer keeps TOTP secrets unreadable in a database dump. The key is
// derived from the JWT secret with SHA-256.
// ponytail: one key for both; rotating JWT_SECRET voids every enrolment
// (spec F-01 §2 I2). Add MFA_ENCRYPTION_KEY if that ever bites.
type SecretSealer struct{ aead cipher.AEAD }

func NewSecretSealer(jwtSecret []byte) (SecretSealer, error) {
	if len(jwtSecret) == 0 {
		return SecretSealer{}, errors.New("sealer: empty key")
	}
	key := sha256.Sum256(jwtSecret)
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return SecretSealer{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return SecretSealer{}, err
	}
	return SecretSealer{aead: aead}, nil
}

func (s SecretSealer) Seal(plain string) (string, error) {
	if s.aead == nil {
		return "", errors.New("sealer: not configured")
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(s.aead.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (s SecretSealer) Open(sealed string) (string, error) {
	if s.aead == nil {
		return "", errors.New("sealer: not configured")
	}
	raw, err := base64.RawStdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	n := s.aead.NonceSize()
	if len(raw) < n {
		return "", errors.New("sealer: short ciphertext")
	}
	plain, err := s.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
