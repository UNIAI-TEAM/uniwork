// @uniwork/office-engine/xlsx/native — the Node binding for the XLSX lane's
// native half: the Rust sidecar client plus asset resolution. Everything here
// may use node: builtins; this entry must never be reachable from ./xlsx or
// the browser-safe entry (scripts/office/check-boundaries.mjs enforces it).
export * from "./xlsx-sidecar.ts";
export * from "./xlsx-assets.ts";
