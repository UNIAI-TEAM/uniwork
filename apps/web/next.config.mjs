import { frameUrl } from "./platform/office-frame/frame-bundle.mjs";
import { officeFrameHeaderRules, readPin } from "./platform/office-frame/frame-headers.mjs";

// The Docs web frame (UNI-1013) is served from public/office-frame/docs/<version>/;
// the pin names the version and carries the headers it must be served with.
const framePin = readPin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@uniwork/ui", "@uniwork/core", "@uniwork/views"],
  env: { NEXT_PUBLIC_OFFICE_DOCS_FRAME_URL: framePin ? frameUrl(framePin) : "" },
  headers: async () => officeFrameHeaderRules(framePin),
};
export default nextConfig;
