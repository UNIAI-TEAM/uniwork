package ai

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// namedProvider is the fake provider under another name, so the model policy
// is resolved for a provider that has (or lacks) an office_uniwork_ai default.
type namedProvider struct {
	*provider.Fake
	name string
}

func (p namedProvider) Name() string { return p.name }

// UniWork AI is configured only when the gateway has a provider AND the
// office_uniwork_ai capability resolves a model on it (spec G5-G7 §8.1): no
// provider, a nil gateway and a provider without a default (ollama) are all
// "not configured"; the fake provider counts so CI and e2e can run.
func TestUniworkAIConfiguredNeedsProviderAndModel(t *testing.T) {
	cases := []struct {
		name string
		gw   *Gateway
		want bool
	}{
		{"nil gateway", nil, false},
		{"no provider", NewGateway(nil, nil, nil, nil, Options{}), false},
		{"fake provider", NewGateway(nil, &provider.Fake{}, nil, nil, Options{}), true},
		{"openai provider", NewGateway(nil, namedProvider{&provider.Fake{}, "openai"}, nil, nil, Options{}), true},
		{"ollama has no office_uniwork_ai model", NewGateway(nil, namedProvider{&provider.Fake{}, "ollama"}, nil, nil, Options{}), false},
	}
	for _, c := range cases {
		if got := c.gw.UniworkAIConfigured(); got != c.want {
			t.Errorf("%s: UniworkAIConfigured() = %v, want %v", c.name, got, c.want)
		}
	}
}
