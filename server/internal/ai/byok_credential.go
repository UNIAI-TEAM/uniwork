package ai

// BYOKCredential is a person's own vendor key, decrypted by the credential
// service and handed to the gateway as a value for one call (contract D7):
// internal/ai never reads the credentials table itself.
type BYOKCredential struct {
	Provider string
	BaseURL  string
	APIKey   string
}
