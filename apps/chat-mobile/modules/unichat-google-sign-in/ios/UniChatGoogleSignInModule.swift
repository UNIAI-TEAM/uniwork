import ExpoModulesCore
import GoogleSignIn

/// Sign in with Google for UniChat (ADR 0047 §8): Google's account chooser, with the nonce the server checks, so the
/// ID token carries it. The client ids are the binary's own Info.plist keys (GIDClientID, GIDServerClientID), written
/// by plugins/with-google-sign-in.js with the URL scheme GoogleSignIn requires; a build without them, or whose scheme
/// is missing, reports unavailable instead of letting GoogleSignIn raise on it, and the app goes through the browser.
public class UniChatGoogleSignInModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UniChatGoogleSignIn")

    AsyncFunction("isAvailable") { () -> Bool in
      return Self.configuration() != nil
    }

    AsyncFunction("signIn") { (nonce: String, promise: Promise) in
      guard let configuration = Self.configuration() else {
        promise.reject("ERR_GOOGLE_NOT_CONFIGURED", "this build carries no Google client id")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_GOOGLE_NO_PRESENTER", "no screen to present Google's sign-in on")
        return
      }
      GIDSignIn.sharedInstance.configuration = configuration
      GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: nonce) { result, error in
        if let error {
          if let signInError = error as? GIDSignInError, signInError.code == .canceled {
            promise.resolve(nil)
          } else {
            promise.reject("ERR_GOOGLE_SIGN_IN", error.localizedDescription)
          }
          return
        }
        guard let user = result?.user, let idToken = user.idToken?.tokenString else {
          promise.reject("ERR_GOOGLE_NO_TOKEN", "Google returned no ID token")
          return
        }
        var answer: [String: Any] = ["idToken": idToken]
        if let email = user.profile?.email {
          answer["email"] = email
        }
        promise.resolve(answer)
      }
    }.runOnQueue(.main)

    AsyncFunction("signOut") {
      GIDSignIn.sharedInstance.signOut()
    }.runOnQueue(.main)
  }

  /// The client this binary was built with, or nil: no GIDClientID, or its reversed id not registered as a URL scheme.
  private static func configuration() -> GIDConfiguration? {
    let info = Bundle.main.infoDictionary ?? [:]
    guard let clientID = info["GIDClientID"] as? String, !clientID.isEmpty else {
      return nil
    }
    let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
    let types = info["CFBundleURLTypes"] as? [[String: Any]] ?? []
    guard types.contains(where: { ($0["CFBundleURLSchemes"] as? [String] ?? []).contains(scheme) }) else {
      return nil
    }
    let serverClientID = (info["GIDServerClientID"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return GIDConfiguration(clientID: clientID, serverClientID: serverClientID)
  }
}
