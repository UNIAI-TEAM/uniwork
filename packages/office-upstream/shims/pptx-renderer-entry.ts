// P0-1 (UNI-927) — browser entry for the vendored genoffice pptx engine, op
// executor and render tree. Built by scripts/office/build-pptx-browser.mjs
// into dist/pptx-renderer.mjs; the web host (apps/web/platform/office) binds
// it through @uniwork/office-engine/pptx and P0-2's canvas reads the render
// surface. The typed contract of this artifact is shims/pptx-renderer.d.ts.
//
// The Node-only facilities the upstream closure imports are resolved by the
// build script to UniWork shims:
//   node:crypto -> shims/pptx-renderer/crypto.ts  (real SHA-256 + randomUUID)
//   node:zlib   -> shims/pptx-renderer/zlib.ts    (real DEFLATE + zlib frame)
//   bidi-js     -> shims/pptx-renderer/bidi.ts    (UAX#9 subset; see the file)
//   Buffer      -> shims/pptx-renderer/buffer.ts  (esbuild `inject`)
//   node:fs / node:stream/promises -> shims/pptx-renderer/node-file-io.ts
//     (savePptxToFile is Node-only and refuses in the browser)
// `?raw` markdown imports inside pptx-ops are inlined by the raw-text plugin.
export {
  openPptx,
  savePptx,
  commitSaved,
  reparseDeck,
  listSlideLayouts,
  getSlideNotes,
} from "../upstream/packages/pptx-engine/src/index";
export { runTxn } from "../upstream/packages/pptx-ops/src/index";
export {
  buildRenderSlide,
  HeuristicMetrics,
  makeViewport,
  presetPath,
  presetPolygon,
  layoutText,
} from "../upstream/packages/pptx-render/src/index";
