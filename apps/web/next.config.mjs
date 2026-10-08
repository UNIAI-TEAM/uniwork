import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { officeFrameHeaderRules, readPin } from "./platform/office-frame/frame-headers.mjs";
import { offerableFrameVersion } from "./platform/office-frame/frame-install.mjs";

// The Docs web frame (UNI-1013) is served from public/office-frame/docs/<version>/;
// the pin names the version and carries the headers it must be served with.
const framePin = readPin();
const frameRoot = join(dirname(fileURLToPath(import.meta.url)), "public", "office-frame", "docs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@uniwork/ui", "@uniwork/core", "@uniwork/views"],
  // The frame is offered only when the pinned bundle is installed and verifies
  // (otherwise "" and a flag-on organization keeps the G3 editor, not a 404 iframe).
  env: { NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION: offerableFrameVersion(framePin, frameRoot) },
  headers: async () => officeFrameHeaderRules(framePin),
};
export default nextConfig;
