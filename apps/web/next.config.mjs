import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICE_MODULES } from "./platform/office-frame/frame-bundle.mjs";
import { officeFrameAssetRewrites } from "./platform/office-frame/frame-asset-rewrites.mjs";
import { officeFrameHeaderRules, readPins } from "./platform/office-frame/frame-headers.mjs";
import { offerableFrameVersion } from "./platform/office-frame/frame-install.mjs";

// The genoffice web frames (UNI-1013 docs, UNI-1014/1015/1016 the other modules)
// are served from public/office-frame/<module>/<version>/; each module's pin names
// the version and carries the headers it must be served with.
const framePins = readPins();
const frameRoot = join(dirname(fileURLToPath(import.meta.url)), "public", "office-frame");
// A module is offered only when its pinned bundle is installed and verifies
// (otherwise it is absent and a flag-on organization keeps the G3 editor, not a 404 iframe).
const frameVersions = Object.fromEntries(
  OFFICE_MODULES.map((module) => [module, offerableFrameVersion(framePins[module] ?? null, join(frameRoot, module))]).filter(([, version]) => version),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@uniwork/ui", "@uniwork/core", "@uniwork/views"],
  env: {
    NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION: frameVersions.docs ?? "",
    NEXT_PUBLIC_OFFICE_FRAME_VERSIONS: JSON.stringify(frameVersions),
  },
  headers: async () => officeFrameHeaderRules(framePins),
  // The Markdown/HTML frames load a document's relative pictures and files from
  // signed API byte routes; their CSP allows only 'self' (UNI-1232).
  rewrites: async () => officeFrameAssetRewrites(),
};
export default nextConfig;
