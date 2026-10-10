// Same-origin byte routes for the Markdown/HTML frames (UNI-1232). The open
// answer maps a document's relative pictures, stylesheets and scripts to
// signed, origin-relative API routes (`/api/v1/office-frame/documents/{id}/
// assets/{assetId}?sig=` and `.../linked/{linkedId}?sig=`). The frame is
// served by this app and its CSP loads only 'self', so when the API lives on
// another origin the app proxies exactly those two GET/HEAD byte routes to
// it. Nothing else of the API is reachable through the app: the ids must be
// ULIDs and no other path matches. The API answers with its own headers
// (sandbox CSP, nosniff, no-store) and checks the signature and view access
// on every request.

import process from "node:process";
import { URL } from "node:url";

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";

/**
 * The rewrites for apiUrl (default: the API URL the app is built with, as
 * platform/runtime-config.ts reads it); none when it is not an absolute URL.
 */
export function officeFrameAssetRewrites(apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080") {
  let origin;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    return [];
  }
  if (origin === "null") return [];
  return ["assets/:assetId", "linked/:linkedId"].map((tail) => {
    const [kind, param] = tail.split("/");
    const path = `/api/v1/office-frame/documents/:documentId(${ULID})/${kind}/${param}(${ULID})`;
    const target = `/api/v1/office-frame/documents/:documentId/${kind}/${param}`;
    return { source: path, destination: origin + target };
  });
}
