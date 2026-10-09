package ai

// BYOKCredential is one person's own provider key, decrypted by
// service.AICredentialService.Resolve and handed to the Gateway as a value
// (UNI-1008, ADR 0029). The Gateway never reads the credentials table: the
// service owns the row, and internal/ai only sees the key for the one call
// it was resolved for. APIKey must never reach a log, an error, a usage row
// or a response.
type BYOKCredential struct {
	Provider string
	BaseURL  string // empty: the provider's default endpoint
	APIKey   string
}
