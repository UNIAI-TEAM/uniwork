package service

// McpToolError is a refusal the model can read and act on: a stale revision,
// a duplicate, a closed write switch. The transport shows it as
// "code: message"; it never carries another tenant's data.
type McpToolError struct {
	Code string
	Msg  string
}

func (e McpToolError) Error() string { return e.Code + ": " + e.Msg }
