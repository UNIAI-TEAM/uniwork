// G2-03b replay bundle entry — the driver esbuild-bundles THIS worktree's
// adapter seam so the proof runs over the real TS sources, not a copied shim.
export { createDocxAdapter, bindDocxEngine, bindDocxCrypto, isEncryptedOoxml } from "../../src/docx";
export {
  createPptxAdapter,
  bindPptxEngine,
  bindPptxOps,
  bindPptxRender,
  elementText,
  EMU_PER_PX_96,
} from "../../src/pptx";
