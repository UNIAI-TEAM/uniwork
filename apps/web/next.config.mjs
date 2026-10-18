import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICE_MODULES } from "./platform/office-frame/frame-bundle.mjs";
import { officeFrameAssetRewrites } from "./platform/office-frame/frame-asset-rewrites.mjs";
import { officeFrameHeaderRules, readPins } from "./platform/office-frame/frame-headers.mjs";
import { offerableFrameVersion } from "./platform/office-frame/frame-install.mjs";
import { APP_REDIRECTS } from "./platform/app-redirects.mjs";

// The genoffice web frames (UNI-1013 docs, UNI-1014/1015/1016 the other modules)
// are served from public/office-frame/<module>/<version>/; each module's pin names
// the version and carries the headers it must be served with.
const framePins = readPins();
const frameRoot = join(dirname(fileURLToPath(import.meta.url)), "public", "office-frame");
// A module is offered only when its pinned bundle is installed and verifies
// (otherwise it is absent and a flag-on organization sees the "not set up" notice, not a 404 iframe).
const frameVersions = Object.fromEntries(
  OFFICE_MODULES.map((module) => [module, offerableFrameVersion(framePins[module] ?? null, join(frameRoot, module))]).filter(([, version]) => version),
);

// A dev server reached from a phone on the LAN (NEXT_PUBLIC_APP_URL=http://<lan-ip>:3000)
// must name that host, or Next refuses the page's /_next/* requests and it renders blank.
const appHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").hostname;
  } catch {
    return "";
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: appHost && appHost !== "localhost" ? [appHost] : undefined,
  transpilePackages: ["@uniwork/ui", "@uniwork/core", "@uniwork/views"],
  env: {
    NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION: frameVersions.docs ?? "",
    NEXT_PUBLIC_OFFICE_FRAME_VERSIONS: JSON.stringify(frameVersions),
  },
  headers: async () => [
    ...officeFrameHeaderRules(framePins),
    { source: "/office-frame/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
  ],
  redirects: async () => APP_REDIRECTS,
  // The Markdown/HTML frames load a document's relative pictures and files from
  // signed API byte routes; their CSP allows only 'self' (UNI-1232).
  rewrites: async () => officeFrameAssetRewrites(),
};
export default nextConfig;
