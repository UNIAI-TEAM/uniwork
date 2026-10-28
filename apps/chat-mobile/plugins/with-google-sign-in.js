// Sign in with Google's configuration of the binary (modules/unichat-google-sign-in, ADR 0049 §8): the iOS client of
// this variant's bundle id and the web client the server verifies tokens for (its GOOGLE_CLIENT_ID). iOS reads
// GIDClientID and GIDServerClientID from Info.plist and must register the reversed iOS client id as a URL scheme, or
// GoogleSignIn raises; Android's Credential Manager needs only the web client, read from the application's
// meta-data. Client ids are no secret (every app that signs in with Google ships its own): app.config.ts passes them
// from the build's environment, and a binary built without them offers Google through the browser instead.
const { AndroidConfig, IOSConfig, withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

/** The meta-data modules/unichat-google-sign-in reads on Android (UniChatGoogleSignInModule.SERVER_CLIENT_ID). */
const SERVER_CLIENT_ID = "expo.modules.unichatgooglesignin.SERVER_CLIENT_ID";
/** An OAuth client id as Google's console issues it. */
const CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/** com.googleusercontent.apps.<id>: the scheme Google redirects an iOS client to. */
const reversedClientId = (clientId) => clientId.split(".").reverse().join(".");

function check(name, value) {
  if (value !== undefined && !CLIENT_ID.test(value)) throw new Error(`${name} is not a Google OAuth client id: ${value}`);
}

/** Info.plist with the iOS client, its scheme (once) and the server client; unchanged without an iOS client. */
function iosInfoPlist(infoPlist, { iosClientId, webClientId }) {
  if (!iosClientId) return infoPlist;
  const scheme = reversedClientId(iosClientId);
  const next = IOSConfig.Scheme.hasScheme(scheme, infoPlist) ? { ...infoPlist } : IOSConfig.Scheme.appendScheme(scheme, infoPlist);
  next.GIDClientID = iosClientId;
  if (webClientId) next.GIDServerClientID = webClientId;
  return next;
}

/** @type {import("expo/config-plugins").ConfigPlugin<{ iosClientId?: string; webClientId?: string }>} */
const withGoogleSignIn = (config, options = {}) => {
  check("UNICHAT_GOOGLE_IOS_CLIENT_ID", options.iosClientId);
  check("UNICHAT_GOOGLE_WEB_CLIENT_ID", options.webClientId);
  config = withInfoPlist(config, (mod) => {
    mod.modResults = iosInfoPlist(mod.modResults, options);
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    if (options.webClientId) {
      const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, SERVER_CLIENT_ID, options.webClientId);
    }
    return mod;
  });
};

module.exports = withGoogleSignIn;
module.exports.SERVER_CLIENT_ID = SERVER_CLIENT_ID;
module.exports.iosInfoPlist = iosInfoPlist;
module.exports.reversedClientId = reversedClientId;
