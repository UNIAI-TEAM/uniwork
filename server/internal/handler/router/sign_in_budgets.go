package router

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
)

// signInBudgets are the named budgets of the routes that take a guess at a
// secret (ADR 0047 §9, spec §3.9), each under a ceiling per address that
// runs first, so a request the ceiling refuses opens no counter of its own:
//
//   - password: POST /auth/login (and the app's /auth/native/password),
//     per address and normalized email, 20 a minute, under 600 a minute per
//     address: an office behind one NAT signs in on a budget per person,
//     while one address still cannot try a password on every account;
//   - mfa: POST /auth/mfa/verify (and /auth/native/mfa), per address and the
//     account the verified challenge token names, 10 a minute, under 600;
//   - stepUp: every route that takes a signed-in person's proof (POST
//     /me/step-up*, PUT /me/password, POST /me/delete, POST
//     /orgs/{org}/transfer-ownership), per bearer, 10 a minute, under 600.
//
// The second factor's lockout (ten wrong answers lock it for fifteen
// minutes, per account) is the bound no number of addresses gets around;
// these keep any one caller from spending it in seconds.
type signInBudgets struct {
	password, mfa, stepUp func(http.Handler) http.Handler
}

func newSignInBudgets(rdb *redis.Client, proxies []*net.IPNet, minter auth.TokenMinter) signInBudgets {
	ceiling := func(bucket string) func(http.Handler) http.Handler {
		return mw.RateLimitByIdentityBucket(rdb, bucket, 600, time.Minute, proxies, nil)
	}
	under := func(ceiling, per func(http.Handler) http.Handler) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler { return ceiling(per(next)) }
	}
	return signInBudgets{
		password: under(ceiling("sign-in-password-ip"),
			mw.RateLimitByIdentityBucket(rdb, "sign-in-password", 20, time.Minute, proxies, signInPasswordKey(proxies))),
		mfa: under(ceiling("sign-in-mfa-ip"),
			mw.RateLimitByIdentityBucket(rdb, "sign-in-mfa", 10, time.Minute, proxies, signInMFAKey(minter, proxies))),
		stepUp: under(ceiling("step-up-ip"),
			mw.RateLimitByIdentityBucket(rdb, "step-up", 10, time.Minute, proxies, bearerUser(minter))),
	}
}

// signInPeekLimit is how much of a body a budget key reads: a sign-in body
// is an email, a password and a flag; one longer than this keys by address.
const signInPeekLimit = 8 << 10

// peekJSONBody reads up to signInPeekLimit bytes of r's body for a budget
// key and puts them back in front of the rest, so the handler (and decode's
// own cap) reads the body whole. It answers nil when there is no body or it
// is longer than the peek, and the key falls back to the address.
func peekJSONBody(r *http.Request) []byte {
	if r.Body == nil || r.Body == http.NoBody {
		return nil
	}
	buf, err := io.ReadAll(io.LimitReader(r.Body, signInPeekLimit+1))
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(buf), r.Body), r.Body}
	if err != nil || len(buf) > signInPeekLimit {
		return nil
	}
	return buf
}

// signInPasswordKey keys the password budget by the client address and the
// email the body names, normalized as Login does (trimmed, lower case) and
// hashed, so no address book lands in Redis keys. Nothing is verified here:
// the address is part of the key, so naming someone else's email spends only
// the caller's own budget for it.
func signInPasswordKey(proxies []*net.IPNet) mw.IdentityFunc {
	return func(r *http.Request) string {
		var in struct {
			Email string `json:"email"`
		}
		raw := peekJSONBody(r)
		if raw == nil || json.Unmarshal(raw, &in) != nil {
			return ""
		}
		email := strings.ToLower(strings.TrimSpace(in.Email))
		if email == "" {
			return ""
		}
		sum := sha256.Sum256([]byte(email))
		return "sign-in:" + mw.ClientIP(r, proxies) + ":" + hex.EncodeToString(sum[:16])
	}
}

// mfaCookieName is the cookie the browser's provider sign-ins carry the
// challenge token in (handler.mfaCookie); the second step reads it when the
// body has no mfa_token.
const mfaCookieName = "uniwork_mfa"

// signInMFAKey keys the second-factor budget by the client address and the
// account of the challenge token (body mfa_token, else the uniwork_mfa
// cookie), verified here so a made-up token mints no budget: whatever does
// not verify keys by address.
func signInMFAKey(minter auth.TokenMinter, proxies []*net.IPNet) mw.IdentityFunc {
	return func(r *http.Request) string {
		var in struct {
			MFAToken string `json:"mfa_token"`
		}
		if raw := peekJSONBody(r); raw != nil {
			_ = json.Unmarshal(raw, &in)
		}
		token := in.MFAToken
		if token == "" {
			if c, err := r.Cookie(mfaCookieName); err == nil {
				token = c.Value
			}
		}
		if token == "" {
			return ""
		}
		ch, err := minter.ParseMFA(token)
		if err != nil {
			return ""
		}
		return "mfa:" + mw.ClientIP(r, proxies) + ":" + ch.UserID
	}
}
