// XLSX adapter lane (G2-04): engine seam (patched xlsx-gateway), session
// model, recalc planning, contract adapter + service seam. Browser-safe —
// the native sidecar reaches this lane only through the XlsxRecalcPort seam;
// the Node binding lives in @uniwork/office-engine/xlsx/native.
export * from "./engine.ts";
export * from "./model.ts";
export * from "./ops.ts";
export * from "./page-setup.ts";
export * from "./recalc.ts";
export * from "./render-model.ts";
export * from "./adapter.ts";
export * from "./vendor.ts";
