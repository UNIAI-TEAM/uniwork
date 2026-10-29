/**
 * Universal-link files for the UniChat mobile apps (spec
 * 2026-10-16-unichat-web-host-design.md): iOS reads
 * `/.well-known/apple-app-site-association`, Android `/.well-known/assetlinks.json`.
 * The two env vars are read here and only here, per request (the route handlers
 * are dynamic), so a deployment without the apps answers 404 and nothing is
 * inlined into the client bundle.
 *
 * The same files let the app's own sign-in screen offer the passwords a person
 * saved for this site (spec 2026-10-27-dang-nhap-thong-nhat-design.md §5.1):
 * `webcredentials` on iOS (Password AutoFill, beside the app's
 * `webcredentials:` associated domain) and `get_login_creds` on Android
 * (Credential Manager and Autofill). Both name the same app as the links do.
 */
const UNICHAT_IOS_BUNDLE_ID = "com.uniworkos.chat";
const UNICHAT_ANDROID_PACKAGE = "com.uniworkos.chat";

export function appleAppSiteAssociation(teamId = process.env.UNICHAT_IOS_TEAM_ID): Response {
  if (!teamId) return new Response(null, { status: 404 });
  const appIDs = [`${teamId}.${UNICHAT_IOS_BUNDLE_ID}`];
  return Response.json({
    applinks: {
      details: [{
        appIDs,
        components: [{ "/": "/*/*/chat*" }, { "/": "/invite/*" }],
      }],
    },
    webcredentials: { apps: appIDs },
  });
}

export function assetLinks(sha256 = process.env.UNICHAT_ANDROID_SHA256): Response {
  const fingerprints = (sha256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fingerprints.length === 0) return new Response(null, { status: 404 });
  return Response.json([{
    relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
    target: { namespace: "android_app", package_name: UNICHAT_ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
  }]);
}
