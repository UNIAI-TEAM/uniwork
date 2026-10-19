import { z } from "zod";

// Contract identity (docs/office/g0/engine-contract.md §4.1). Bumping
// ENGINE_CONTRACT_VERSION is a contract break and needs a new parity fixture
// under fixtures/ plus a Go-side update in server/internal/office.
export const ENGINE_CONTRACT_VERSION = "uniwork-office-engine-contract/1";
// Protocol 2 (SIZE-OPS1): a job's input bytes ride a framed body after the
// JSON envelope instead of base64 inside it; see ENVELOPE_MAX_BYTES.
export const ENGINE_PROTOCOL_VERSION = 2;
export const WIRE_FORMAT = "snake_case";

// The frozen G0 lab bridge protocol (CONTRACT-v1.1.md). Distinct from the
// engine contract: it is the host <-> webview channel set, not the engine
// request/response envelope.
export const LAB_BRIDGE_CONTRACT = "uniwork-office-lab-bridge@1";

// The only G0-trusted engine build (CONTRACT-v1.1.md §9). Capability honesty
// below still applies even when this string matches.
export const ENGINE_VERSION_TRUSTED = "genoffice@09485f88+uniwork-office.0";

export const contractVersionSchema = z.literal(ENGINE_CONTRACT_VERSION);
export const protocolVersionSchema = z.literal(ENGINE_PROTOCOL_VERSION);
