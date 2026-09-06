package ai

import (
	"strconv"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// Options is what the gateway reads from the environment besides the
// provider itself.
type Options struct {
	Timeout time.Duration
	// Env resolves AI_MODEL_<CAPABILITY> overrides; nil means no overrides.
	Env func(string) string
	// ExtraAllow extends the model allowlist (AI_MODEL_ALLOW, comma-separated).
	ExtraAllow []string
}

// FromEnv picks the provider from the environment (spec §3.2, OPEN_QUESTIONS
// G4). AI_PROVIDER names it explicitly; empty means "whichever credential is
// set", anthropic first. A nil provider means the gateway is disabled: the
// feature hides, nothing 500s.
func FromEnv(get func(string) string) (provider.Provider, Options) {
	opts := Options{Timeout: 60 * time.Second, Env: get}
	if s := strings.TrimSpace(get("AI_TIMEOUT_SECONDS")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			opts.Timeout = time.Duration(n) * time.Second
		}
	}
	for _, m := range strings.Split(get("AI_MODEL_ALLOW"), ",") {
		if m = strings.TrimSpace(m); m != "" {
			opts.ExtraAllow = append(opts.ExtraAllow, m)
		}
	}
	name := strings.ToLower(strings.TrimSpace(get("AI_PROVIDER")))
	if name == "" {
		switch {
		case get("ANTHROPIC_API_KEY") != "":
			name = "anthropic"
		case get("OPENAI_API_KEY") != "":
			name = "openai"
		case get("OLLAMA_BASE_URL") != "":
			name = "ollama"
		}
	}
	switch name {
	case "anthropic":
		if key := get("ANTHROPIC_API_KEY"); key != "" {
			return provider.NewAnthropic(key), opts
		}
	case "openai":
		if key := get("OPENAI_API_KEY"); key != "" {
			return provider.NewOpenAI(get("OPENAI_BASE_URL"), key, opts.Timeout), opts
		}
	case "ollama":
		return provider.NewOllama(get("OLLAMA_BASE_URL"), opts.Timeout), opts
	case "fake":
		return &provider.Fake{Reply: fakeReply}, opts
	}
	return nil, opts
}
