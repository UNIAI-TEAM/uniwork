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
	// StreamTimeout replaces Timeout for a streamed call (default 120s): the
	// answer arrives over time, so the whole-call budget is longer.
	StreamTimeout time.Duration
	// Env resolves AI_MODEL_<CAPABILITY> overrides; nil means no overrides.
	Env func(string) string
	// ExtraAllow extends the model allowlist (AI_MODEL_ALLOW, comma-separated).
	ExtraAllow []string
	// Cloud are the UniWork cloud tools (AI_CLOUD_*); nil members are unavailable.
	Cloud CloudTools
}

// FromEnv picks the provider from the environment (spec §3.2, OPEN_QUESTIONS
// G4). AI_PROVIDER names it explicitly; empty means "whichever credential is
// set", anthropic first. A nil provider means the gateway is disabled: the
// feature hides, nothing 500s.
func FromEnv(get func(string) string) (provider.Provider, Options) {
	opts := Options{Timeout: 60 * time.Second, Env: get, Cloud: CloudFromEnv(get)}
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
	// The HTTP clients' own cap is only a backstop: the gateway bounds every
	// call by its capability (CallTimeoutFor), so it must not cut a longer one.
	httpTimeout := opts.Timeout
	for _, p := range policies {
		httpTimeout = max(httpTimeout, opts.Timeout*time.Duration(p.TimeoutScale))
	}
	switch name {
	case "anthropic":
		if key := get("ANTHROPIC_API_KEY"); key != "" {
			return provider.NewAnthropic(key), opts
		}
	case "openai":
		if key := get("OPENAI_API_KEY"); key != "" {
			return provider.NewOpenAI(get("OPENAI_BASE_URL"), key, httpTimeout), opts
		}
	case "ollama":
		return provider.NewOllama(get("OLLAMA_BASE_URL"), httpTimeout), opts
	case "fake":
		return &provider.Fake{Reply: FakeReply}, opts
	}
	return nil, opts
}
