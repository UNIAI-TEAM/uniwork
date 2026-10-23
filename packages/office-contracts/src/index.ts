// @uniwork/office-contracts — the UniWork Office engine boundary contract.
// Versioned wire schemas/types/errors/capability shapes ported from
// docs/office/g0/engine-contract.md (+ CONTRACT-v1.1) and
// scripts/office-g0/engine-contract.mjs. Pure TypeScript, environment-neutral:
// no Node, Electron or native imports live here.

export * from "./version.ts";
export * from "./formats.ts";
export * from "./operations.ts";
export * from "./limits.ts";
export * from "./job-states.ts";
export * from "./warnings.ts";
export * from "./error-codes.ts";
export * from "./errors.ts";
export * from "./canonical-json.ts";
export * from "./capabilities.ts";
export * from "./grants.ts";
export * from "./failure-classes.ts";
export * from "./envelope.ts";
export * from "./fingerprint.ts";
export * from "./results.ts";
export * from "./leaks.ts";
export * from "./host-adapter.ts";
