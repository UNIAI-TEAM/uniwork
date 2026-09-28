// @uniwork/office-engine/assets - the asset manifest, reference policy and
// the text + assets save transaction shared by Markdown and HTML. Pure: no
// Node, Electron or native imports (scripts/office/check-boundaries.mjs).
export {
  emptyAssetManifest,
  parseAssetManifest,
  resolveAssetReference,
  serializeAssetManifest,
  type AssetManifest,
  type AssetManifestEntry,
  type ResolvedReference,
} from "./manifest";
export { mayRenderAsset, mayRenderInline, mediaTypeFor, type AssetSlot } from "./media";
export { normaliseAssetReference, type AssetReference, type RefusalReason } from "./references";
export type { AssetBytesSource, AssetSaveReport, AssetStagingPort, PublishInput } from "./save";
export type { TextDocumentEngine, TextSnapshot } from "./text-document";
