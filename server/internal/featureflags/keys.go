// Package featureflags is the catalogue of flag keys this server evaluates.
//
// The evaluation machinery — providers, hashing, eval context — lives in
// pkg/featureflag and knows nothing about which flags exist. This package is
// where a key is declared, documented, and marked as public to the frontend.
// UniWork has declared no flags yet; the shape is kept so the first one is a
// one-line addition here rather than a rediscovery of the plumbing.
package featureflags

import (
	"context"

	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// frontendPublicFlags lists the keys whose decisions are published to the web
// client through the public config endpoint. Anything not listed here is
// server-side only, whatever the provider says about it.
var frontendPublicFlags = []string{}

// EvaluateFrontendPublicFlags evaluates every public key for the request's
// context. A nil service is allowed and yields the empty map, which is what a
// deployment without a flag file gets.
func EvaluateFrontendPublicFlags(ctx context.Context, flags *featureflag.Service) map[string]bool {
	out := make(map[string]bool, len(frontendPublicFlags))
	if flags == nil {
		return out
	}
	for _, key := range frontendPublicFlags {
		out[key] = flags.IsEnabled(ctx, key, false)
	}
	return out
}
