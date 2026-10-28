package auth

import "context"

type accessTokenKey struct{}

// WithAccessToken puts the request's verified bearer on the context. The
// auth middleware does it once per request, so a service command that must
// judge the token itself (a sensitive command refusing a browser token
// issued before the account's credentials_revoked_at, ADR 0049) reads it
// without a database read on every request or a parameter on every call.
func WithAccessToken(ctx context.Context, at AccessToken) context.Context {
	return context.WithValue(ctx, accessTokenKey{}, at)
}

// AccessTokenFrom returns the bearer WithAccessToken put on the context;
// false outside a bearer request (a job, a test calling a service directly).
func AccessTokenFrom(ctx context.Context) (AccessToken, bool) {
	at, ok := ctx.Value(accessTokenKey{}).(AccessToken)
	return at, ok
}
