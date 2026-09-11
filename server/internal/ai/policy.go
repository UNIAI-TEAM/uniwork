package ai

import (
	"log/slog"
	"strings"
)

// Capability is what a caller declares; the model is the gateway's choice
// (spec §2 #2). The enum is closed — a capability without a policy is a
// refusal, not a default.
type Capability string

const (
	CapMeetingSummarization Capability = "meeting_summarization"
	CapCopilotAnswer        Capability = "copilot_answer"
	CapContextExtraction    Capability = "context_extraction"
	CapAgentPlanning        Capability = "agent_planning"
	CapAgentGeneration      Capability = "agent_generation"
	CapAgentEvaluation      Capability = "agent_evaluation"
	CapEmbedding            Capability = "embedding"
)

// ModelPolicy is the source-code constant behind a capability: the default
// model per provider and the allowlist an env override must sit in.
type ModelPolicy struct {
	Default     map[string]string // provider name → model
	MaxTokens   int
	Temperature float64
}

var (
	flagship  = map[string]string{"anthropic": "claude-opus-5", "openai": "gpt-4o", "ollama": "llama3.1", "fake": "fake"}
	fast      = map[string]string{"anthropic": "claude-haiku-4-5-20251001", "openai": "gpt-4o-mini", "ollama": "llama3.1", "fake": "fake"}
	embedding = map[string]string{"openai": "text-embedding-3-small", "ollama": "nomic-embed-text", "fake": "fake"}
)

var policies = map[Capability]ModelPolicy{
	CapMeetingSummarization: {Default: flagship, MaxTokens: 4096, Temperature: 0},
	CapCopilotAnswer:        {Default: flagship, MaxTokens: 1500, Temperature: 0},
	CapContextExtraction:    {Default: fast, MaxTokens: 800, Temperature: 0},
	CapAgentPlanning:        {Default: flagship, MaxTokens: 4096, Temperature: 0},
	CapAgentGeneration:      {Default: flagship, MaxTokens: 8192, Temperature: 0.2},
	CapAgentEvaluation:      {Default: flagship, MaxTokens: 2048, Temperature: 0},
	CapEmbedding:            {Default: embedding, MaxTokens: 0, Temperature: 0},
}

// allowedModels is the allowlist every override is checked against
// (inherits the old model-policy.ts). AI_MODEL_ALLOW extends it for
// self-hosted names the code cannot know.
var allowedModels = []string{
	"claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001",
	"gpt-4o", "gpt-4o-mini", "text-embedding-3-small",
	"llama3.1", "qwen2.5", "nomic-embed-text", "fake",
}

// ResolveModel picks the model for a capability on a provider. An override
// (AI_MODEL_<CAPABILITY>, or ANTHROPIC_MODEL for the anthropic provider)
// must be in the allowlist; otherwise the default wins and a warning is
// logged, because a typo in .env must not silently route to a model nobody
// priced.
func ResolveModel(c Capability, providerName string, env func(string) string, extraAllow []string) (ModelPolicy, string, error) {
	p, ok := policies[c]
	if !ok {
		return ModelPolicy{}, "", errPolicy("no policy for capability " + string(c))
	}
	def, ok := p.Default[providerName]
	if !ok {
		return ModelPolicy{}, "", errPolicy("provider " + providerName + " has no default for " + string(c))
	}
	if env == nil {
		return p, def, nil
	}
	override := strings.TrimSpace(env("AI_MODEL_" + strings.ToUpper(string(c))))
	if override == "" && providerName == "anthropic" {
		override = strings.TrimSpace(env("ANTHROPIC_MODEL"))
	}
	if override == "" || override == def {
		return p, def, nil
	}
	for _, m := range append(append([]string{}, allowedModels...), extraAllow...) {
		if m == override {
			return p, override, nil
		}
	}
	slog.Warn("ai: model override outside allowlist, using default", "capability", c, "override", override, "default", def)
	return p, def, nil
}
