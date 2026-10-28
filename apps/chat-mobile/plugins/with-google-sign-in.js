// Sign in with Google's configuration of the binary (modules/unichat-google-sign-in, ADR 0049 §8): the iOS client of
// this variant's bundle id and the web client the server verifies tokens for (its GOOGLE_CLIENT_ID). iOS reads
// GIDClientID and GIDServerClientID from Info.plist and must register the reversed iOS client id as a URL scheme, or
// GoogleSignIn raises; Android's Credential Manager needs only the web client, read from the application's
// meta-data. Client ids are no secret (every app that signs in with Google ships its own): app.config.ts passes them
// from the build's environment, and a binary built without them offers Google through the browser instead. The
// Podfile change is not about the ids: the module, and so GoogleSignIn, is linked into every build.
const { AndroidConfig, IOSConfig, withAndroidManifest, withInfoPlist, withPodfile } = require("expo/config-plugins");

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

// GoogleSignIn 8 reaches AppCheckCore, whose iOS half is Swift and whose Objective-C dependencies define no module:
// CocoaPods then refuses to build it as a static library ("cannot yet be integrated as static libraries") and pod
// install fails. Module maps for those pods only, rather than use_modular_headers! or frameworks for every pod of the
// app; CocoaPods applies :modular_headers to the root pod, and naming the subspecs AppCheckCore already depends on
// keeps the bare GoogleUtilities (it has no default subspecs) from pulling in every one of its subspecs.
const MODULAR_PODS = ["GoogleUtilities/Environment", "GoogleUtilities/UserDefaults", "RecaptchaInterop"];
const PODFILE_MARK = "# plugins/with-google-sign-in.js: module maps for AppCheckCore's dependencies (GoogleSignIn 8)";

/** The Podfile with MODULAR_PODS declared once, right after the app target's use_expo_modules!. */
function podfile(contents) {
  if (contents.includes(PODFILE_MARK)) return contents;
  const anchor = /^([ \t]*)use_expo_modules!.*$/m;
  const match = anchor.exec(contents);
  if (!match) throw new Error("the Podfile has no use_expo_modules! line to declare GoogleSignIn's module maps after");
  const lines = [PODFILE_MARK, ...MODULAR_PODS.map((pod) => `pod '${pod}', :modular_headers => true`)];
  return contents.replace(anchor, (line) => [line, ...lines.map((text) => `${match[1]}${text}`)].join("\n"));
}

/** @type {import("expo/config-plugins").ConfigPlugin<{ iosClientId?: string; webClientId?: string }>} */
const withGoogleSignIn = (config, options = {}) => {
  check("UNICHAT_GOOGLE_IOS_CLIENT_ID", options.iosClientId);
  check("UNICHAT_GOOGLE_WEB_CLIENT_ID", options.webClientId);
  config = withInfoPlist(config, (mod) => {
    mod.modResults = iosInfoPlist(mod.modResults, options);
    return mod;
  });
  config = withPodfile(config, (mod) => {
    mod.modResults.contents = podfile(mod.modResults.contents);
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
module.exports.podfile = podfile;
module.exports.reversedClientId = reversedClientId;
