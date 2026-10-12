package provider

// BYOK provider table (UNI-1008, ADR 0029): the vendors a person may store
// their own key for and reach through the UniWork proxy from the web host.
// Mirrored from the Office fork's packages/ai-provider/src/providers.ts and
// registry.ts; byok_test.go pins the id list. Entries are single-protocol
// API-key vendors only: genspark (UniWork's own pool), codex (a local CLI)
// and the opencode gateways (one protocol per model id) stay out.

// BYOKProtocol is the vendor wire format the proxy passes through unchanged.
type BYOKProtocol string

const (
	ProtocolOpenAICompatible BYOKProtocol = "openai-compatible"
	ProtocolAnthropic        BYOKProtocol = "anthropic"
	ProtocolGemini           BYOKProtocol = "gemini"
)

// BYOKProvider is one row of the table. DefaultBaseURL is where the proxy
// sends a request when the stored credential carries no base URL of its own.
type BYOKProvider struct {
	ID              string
	Protocol        BYOKProtocol
	DefaultBaseURL  string
	RequiresBaseURL bool
}

// CustomProviderID is the openai-compatible endpoint the person names.
const CustomProviderID = "custom"

var byokProviders = []BYOKProvider{
	{ID: "anthropic", Protocol: ProtocolAnthropic, DefaultBaseURL: "https://api.anthropic.com"},
	{ID: "gemini", Protocol: ProtocolGemini, DefaultBaseURL: "https://generativelanguage.googleapis.com/v1beta"},
	{ID: "openai", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.openai.com/v1"},
	{ID: "deepseek", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.deepseek.com/v1"},
	{ID: "kimi", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.moonshot.ai/v1"},
	{ID: "glm", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://open.bigmodel.cn/api/paas/v4"},
	{ID: "qwen", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"},
	{ID: "doubao", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3"},
	{ID: "mimo", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.xiaomimimo.com/v1"},
	{ID: "hunyuan", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://tokenhub.tencentcloudmaas.com/v1"},
	{ID: "ling", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.ant-ling.com/v1"},
	{ID: "spark", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://maas-api.cn-huabei-1.xf-yun.com/v2"},
	{ID: "longcat", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.longcat.chat/openai/v1"},
	{ID: "minimax", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.minimax.io/v1"},
	{ID: "xai", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.x.ai/v1"},
	{ID: "mistral", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.mistral.ai/v1"},
	{ID: "openrouter", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://openrouter.ai/api/v1"},
	{ID: "requesty", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://router.requesty.ai/v1"},
	{ID: "opper", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.opper.ai/v3/compat"},
	{ID: "cheaperinference", Protocol: ProtocolOpenAICompatible, DefaultBaseURL: "https://api.cheaperinference.com/v1"},
	{ID: CustomProviderID, Protocol: ProtocolOpenAICompatible, RequiresBaseURL: true},
}

// BYOKProviders returns a copy of the table in display order.
func BYOKProviders() []BYOKProvider {
	return append([]BYOKProvider(nil), byokProviders...)
}

// BYOKProviderIDs lists the ids a credential may be stored under.
func BYOKProviderIDs() []string {
	ids := make([]string, 0, len(byokProviders))
	for _, p := range byokProviders {
		ids = append(ids, p.ID)
	}
	return ids
}

// LookupBYOKProvider finds a row by id; unknown ids are not supported.
func LookupBYOKProvider(id string) (BYOKProvider, bool) {
	for _, p := range byokProviders {
		if p.ID == id {
			return p, true
		}
	}
	return BYOKProvider{}, false
}
