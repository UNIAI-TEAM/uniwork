/**
 * Universal-link files for the UniChat mobile apps (spec
 * 2026-10-16-unichat-web-host-design.md): iOS reads
 * `/.well-known/apple-app-site-association`, Android `/.well-known/assetlinks.json`.
 * The two env vars are read here and only here, per request (the route handlers
 * are dynamic), so a deployment without the apps answers 404 and nothing is
 * inlined into the client bundle.
 */
const UNICHAT_IOS_BUNDLE_ID = "com.uniworkos.chat";
const UNICHAT_ANDROID_PACKAGE = "com.uniworkos.chat";

export function appleAppSiteAssociation(teamId = process.env.UNICHAT_IOS_TEAM_ID): Response {
  if (!teamId) return new Response(null, { status: 404 });
  return Response.json({
    applinks: {
      details: [{
        appIDs: [`${teamId}.${UNICHAT_IOS_BUNDLE_ID}`],
        components: [{ "/": "/*/*/chat*" }, { "/": "/invite/*" }],
      }],
    },
  });
}

export function assetLinks(sha256 = process.env.UNICHAT_ANDROID_SHA256): Response {
  const fingerprints = (sha256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fingerprints.length === 0) return new Response(null, { status: 404 });
  return Response.json([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: UNICHAT_ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
  }]);
}
