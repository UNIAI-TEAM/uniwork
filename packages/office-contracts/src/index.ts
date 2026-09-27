// @uniwork/office-contracts — the UniWork Office engine boundary contract.
// Versioned wire schemas/types/errors/capability shapes ported from
// docs/office/g0/engine-contract.md (+ CONTRACT-v1.1) and
// scripts/office-g0/engine-contract.mjs. Pure TypeScript, environment-neutral:
// no Node, Electron or native imports live here.

export * from "./version";
export * from "./formats";
export * from "./operations";
export * from "./limits";
export * from "./job-states";
export * from "./warnings";
export * from "./error-codes";
export * from "./errors";
export * from "./canonical-json";
export * from "./capabilities";
export * from "./grants";
export * from "./failure-classes";
export * from "./envelope";
export * from "./fingerprint";
export * from "./results";
export * from "./leaks";
export * from "./host-adapter";
