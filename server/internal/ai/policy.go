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
	CapChatCatchUp          Capability = "chat_catchup"
	CapChatCallSummary      Capability = "chat_call_summary"
	CapEmailThreadSummary   Capability = "email_thread_summary"
	CapContextExtraction    Capability = "context_extraction"
	CapAgentPlanning        Capability = "agent_planning"
	CapAgentGeneration      Capability = "agent_generation"
	CapAgentEvaluation      Capability = "agent_evaluation"
	CapEmbedding            Capability = "embedding"
	CapCloudSearch          Capability = "cloud_search"
	CapCloudImage           Capability = "cloud_image_generate"
	CapCloudTranscribe      Capability = "cloud_transcribe"
	CapMediaAnalysis        Capability = "media_analysis"
	// CapOfficeUniworkAI is the Office editors' UniWork AI agent loop (G6-D1
	// A1): a tool-calling chat, one Complete per tool-result round.
	CapOfficeUniworkAI Capability = "office_uniwork_ai"
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

	// officeUniwork is flagship without ollama: /api/chat has no tool-result
	// turn, so an ollama deployment has no UniWork AI rather than a broken one.
	officeUniwork = map[string]string{"anthropic": "claude-opus-5", "openai": "gpt-4o", "fake": "fake"}
)

var policies = map[Capability]ModelPolicy{
	CapMeetingSummarization: {Default: flagship, MaxTokens: 4096, Temperature: 0},
	CapCopilotAnswer:        {Default: flagship, MaxTokens: 1500, Temperature: 0},
	CapChatCatchUp:          {Default: flagship, MaxTokens: 2048, Temperature: 0},
	CapChatCallSummary:      {Default: flagship, MaxTokens: 2048, Temperature: 0},
	CapEmailThreadSummary:   {Default: flagship, MaxTokens: 2048, Temperature: 0},
	CapContextExtraction:    {Default: fast, MaxTokens: 800, Temperature: 0},
	CapAgentPlanning:        {Default: flagship, MaxTokens: 4096, Temperature: 0},
	CapAgentGeneration:      {Default: flagship, MaxTokens: 8192, Temperature: 0.2},
	CapAgentEvaluation:      {Default: flagship, MaxTokens: 2048, Temperature: 0},
	CapEmbedding:            {Default: embedding, MaxTokens: 0, Temperature: 0},
	CapMediaAnalysis:        {Default: flagship, MaxTokens: 4096, Temperature: 0},
	// Capability-wide ceiling covering the largest single-turn Office tool call (HTML); per-module ceilings are lowered in officeModuleMaxTokens.
	CapOfficeUniworkAI: {Default: officeUniwork, MaxTokens: 4096, Temperature: 0},
}

// officeModuleMaxTokens tunes the max output tokens per genoffice module (G6-08,
// UNI-1373): each module ceiling is lowered from the 4096 capability ceiling
// (except HTML, which stays at 4096) to the largest single-turn tool-call JSON
// or answer its dev-set and editing workflows require. The Gateway asks for it
// on every UniWork AI turn (officeMaxTokens below), so the map is the ceiling
// the provider is really called with, not a table tests read.
var officeModuleMaxTokens = map[string]int{
	// Spreadsheet tool calls (read_range, summarize_range, propose_operations) and scoped numerical answers fit within 2048 tokens (lowered from 4096).
	"xlsx": 2048,
	// Word multi-paragraph replace_blocks / apply_ops payloads plus verbatim before/after edit summaries fit within 3072 tokens (lowered from 4096).
	"docx": 3072,
	// Slide shape text rewrites via apply_ops and slide-scoped summaries are compact per slide and fit within 2048 tokens (lowered from 4096).
	"pptx": 2048,
	// PDF page-scoped answers, notes and single-block text edits fit within 2048 tokens (lowered from 4096).
	"pdf": 2048,
	// Markdown multi-block apply_ops batches preserve surrounding source verbatim and fit within 3072 tokens (lowered from 4096).
	"md": 3072,
	// HTML DOM apply_ops batches can carry larger element subtrees and retain the full 4096 capability ceiling.
	"html": 4096,
}

// OfficeModuleMaxTokens returns the tuned max output token ceiling for a
// genoffice module, falling back to policies[CapOfficeUniworkAI].MaxTokens when
// the module is not in officeModuleMaxTokens.
func OfficeModuleMaxTokens(module string) int {
	if n, ok := officeModuleMaxTokens[module]; ok {
		return n
	}
	return policies[CapOfficeUniworkAI].MaxTokens
}

// officeMaxTokens is the output ceiling the provider is asked for on one
// request. A UniWork AI turn (CapOfficeUniworkAI) is capped per genoffice
// module — OfficeModuleMaxTokens(req.Module) lowers xlsx/pptx/pdf to 2048 and
// docx/md to 3072 from the 4096 capability ceiling (G6-08, BE68-1). An empty
// or unknown module keeps the capability ceiling here: the sectioned office
// prompt is refused by systemText before a request is built, and a
// non-sectioned prompt under this capability carries no module by design.
// Every other capability ignores Request.Module and keeps its own policy.
func officeMaxTokens(req Request, p ModelPolicy) int {
	if req.Capability == CapOfficeUniworkAI {
		return OfficeModuleMaxTokens(req.Module)
	}
	return p.MaxTokens
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
	override := modelOverride(c, providerName, env)
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

// modelOverride is the env override ResolveModel looks for: AI_MODEL_<CAP>,
// or ANTHROPIC_MODEL for the anthropic provider. Empty when none is set.
func modelOverride(c Capability, providerName string, env func(string) string) string {
	override := strings.TrimSpace(env("AI_MODEL_" + strings.ToUpper(string(c))))
	if override == "" && providerName == "anthropic" {
		override = strings.TrimSpace(env("ANTHROPIC_MODEL"))
	}
	return override
}
