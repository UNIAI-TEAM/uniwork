// G2-04 replay bundle entry: the driver esbuild-bundles THIS worktree's xlsx
// adapter seam plus the node sidecar client, so the proof runs over the real
// TS sources, not a copied shim.
export { createXlsxAdapter, bindXlsxGateway } from "../../src/xlsx/index.ts";
export { createXlsxSidecar } from "../../src/node/xlsx-sidecar.ts";
