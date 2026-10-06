// @uniwork/office-engine/html - HTML source + parse-map model, and the
// preview copy the isolated iframe renders. Pure: no Node, Electron or native
// imports (scripts/office/check-boundaries.mjs).
export { createHtmlEngine, type HtmlEngine } from "./engine";
export { dropBlockedResourceUrls } from "./drop-blocked";
export { BLOCKED_URL, buildHtmlPreviewCopy, type PreviewCopyOptions } from "./preview-copy";
export type { HtmlUpstream, UpstreamParseMap, UpstreamPatch, UpstreamPatchError, UpstreamPatchSet } from "./seam";
export { bindHtmlUpstream, type UpstreamHtmlModules } from "./vendor";
