// Version negotiation at the engine boundary (plan G2-07, UNI-690): before Go
// mutates anything - no office_jobs row, no provider-output intent - it asks
// the engine what it advertises for the requested format and refuses a build,
// contract or protocol outside the pinned identity. The engine's own
// submit-time refusal stays as defence in depth; this check is what makes
// "rejected before mutation" true on the Go side.
package office

import (
	"context"
	"strconv"
)

// CapabilityResult is the engine's /v1/capability answer for one format: the
// engine identity plus the per-operation rows. contract_version and
// protocol_version are optional because the service build advertises only
// engine_version today; when they are present they are checked as well.
type CapabilityResult struct {
	JobID           string            `json:"job_id"`
	State           string            `json:"state"`
	Operation       Operation         `json:"operation"`
	EngineVersion   string            `json:"engine_version"`
	ContractVersion string            `json:"contract_version"`
	ProtocolVersion *int              `json:"protocol_version"`
	Format          Format            `json:"format"`
	Capabilities    []CapabilityEntry `json:"capabilities"`
	Limits          CapabilityLimits  `json:"limits"`
}

// CapabilityLimits is the byte envelope the engine advertises for the format.
type CapabilityLimits struct {
	MaxInputBytes *int64 `json:"max_input_bytes"`
}

// CapabilityReader is the engine surface negotiation needs. *Client
// implements it; tests implement it to drive drift and malformed answers.
type CapabilityReader interface {
	Capability(ctx context.Context, format Format) (CapabilityResult, error)
}

// Negotiate checks the engine's advertised identity for one format. A
// mismatch answers a typed EngineError (engine_incompatible, contract_mismatch,
// protocol_mismatch) the caller reports before it writes anything. A missing
// engine_version is drift, not a wildcard.
func Negotiate(ctx context.Context, engine CapabilityReader, format Format) (CapabilityResult, error) {
	res, err := engine.Capability(ctx, format)
	if err != nil {
		return CapabilityResult{}, err
	}
	if res.EngineVersion != TrustedEngineVersion {
		return CapabilityResult{}, NewEngineError("engine_incompatible", "engine_version:"+res.EngineVersion)
	}
	if res.ContractVersion != "" && res.ContractVersion != ContractVersion {
		return CapabilityResult{}, NewEngineError("contract_mismatch", "contract_version:"+res.ContractVersion)
	}
	if res.ProtocolVersion != nil && *res.ProtocolVersion != ProtocolVersion {
		return CapabilityResult{}, NewEngineError("protocol_mismatch", "protocol_version:"+strconv.Itoa(*res.ProtocolVersion))
	}
	return res, nil
}

// Supports reports whether the engine binds one operation for the format the
// answer describes. It is the pre-mutation operation gate: an operation the
// build does not bind is refused before a job row or an output intent exists.
func (r CapabilityResult) Supports(op Operation) bool {
	for _, entry := range r.Capabilities {
		if Operation(entry.Operation) == op {
			return entry.Supported
		}
	}
	return false
}
