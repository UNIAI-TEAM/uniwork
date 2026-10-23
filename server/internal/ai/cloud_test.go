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
// "not configured"; the fake provider counts so CI and e2e can run. The same
// table pins the model the cloud status serves (G6-05m): the provider's
// policy default, an allowlisted AI_MODEL_OFFICE_UNIWORK_AI override over it,
// and an AI_MODEL_ALLOW extra name.
func TestUniworkAIConfiguredNeedsProviderAndModel(t *testing.T) {
	env := func(v string) func(string) string {
		return func(k string) string {
			if k == "AI_MODEL_OFFICE_UNIWORK_AI" {
				return v
			}
			return ""
		}
	}
	cases := []struct {
		name  string
		gw    *Gateway
		want  bool
		model string
	}{
		{"nil gateway", nil, false, ""},
		{"no provider", NewGateway(nil, nil, nil, nil, Options{}), false, ""},
		{"fake provider", NewGateway(nil, &provider.Fake{}, nil, nil, Options{}), true, "fake"},
		{"openai default", NewGateway(nil, namedProvider{&provider.Fake{}, "openai"}, nil, nil, Options{}), true, "gpt-4o"},
		{"anthropic default", NewGateway(nil, namedProvider{&provider.Fake{}, "anthropic"}, nil, nil, Options{}), true, "claude-opus-5"},
		{"ollama has no office_uniwork_ai model", NewGateway(nil, namedProvider{&provider.Fake{}, "ollama"}, nil, nil, Options{}), false, ""},
		{"allowlisted env override", NewGateway(nil, namedProvider{&provider.Fake{}, "openai"}, nil, nil, Options{Env: env("gpt-4o-mini")}), true, "gpt-4o-mini"},
		{"AI_MODEL_ALLOW extra override", NewGateway(nil, namedProvider{&provider.Fake{}, "openai"}, nil, nil, Options{Env: env("dev-model"), ExtraAllow: []string{"dev-model"}}), true, "dev-model"},
	}
	for _, c := range cases {
		if got := c.gw.UniworkAIConfigured(); got != c.want {
			t.Errorf("%s: UniworkAIConfigured() = %v, want %v", c.name, got, c.want)
		}
		if got := c.gw.UniworkAIModel(); got != c.model {
			t.Errorf("%s: UniworkAIModel() = %q, want %q", c.name, got, c.model)
		}
	}
}
