// Same-origin routes for the Office frames (UNI-1232, UNI-1912). The open
// answer maps a document's relative pictures, stylesheets and scripts to
// signed, origin-relative API routes (`/api/v1/office-frame/documents/{id}/
// assets/{assetId}?sig=` and `.../linked/{linkedId}?sig=`). The frame is
// served by this app and its CSP loads and connects only 'self'
// (`connect-src 'self'`, CONTRACT C16), so it calls the document's AI routes
// itself on this origin: `/api/v1/office-frame/documents/{id}/ai/...`, with
// `Authorization: Bearer <frame token>` and no cookie (the fork client keeps
// only the pathname of init.apiBase and sends the request same-origin, so a
// split-origin deployment would 404 on Next). When the API lives on another
// origin the app therefore proxies those AI routes too, beside the two
// GET/HEAD byte routes: the API rechecks the frame token on every call, the
// method, headers and streaming SSE body pass through unchanged, and the
// frame's CSP stays `'self'`. Nothing else of the API is reachable through
// the app: the ids must be ULIDs and no other path matches. The API answers
// with its own headers (sandbox CSP, nosniff, no-store) and checks the
// signature and view access on every request.

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
  const tails = [
    // The two signed byte routes: the ids are ULIDs.
    { source: `/api/v1/office-frame/documents/:documentId(${ULID})/assets/:assetId(${ULID})`, destination: "/api/v1/office-frame/documents/:documentId/assets/:assetId" },
    { source: `/api/v1/office-frame/documents/:documentId(${ULID})/linked/:linkedId(${ULID})`, destination: "/api/v1/office-frame/documents/:documentId/linked/:linkedId" },
    // The frame's own AI routes: every tail under `/ai/` (credentials, byok,
    // cloud, uniwork) is one catch-all, so a new route needs no change here.
    { source: `/api/v1/office-frame/documents/:documentId(${ULID})/ai/:aiPath*`, destination: "/api/v1/office-frame/documents/:documentId/ai/:aiPath*" },
  ];
  return tails.map(({ source, destination }) => ({ source, destination: origin + destination }));
}

