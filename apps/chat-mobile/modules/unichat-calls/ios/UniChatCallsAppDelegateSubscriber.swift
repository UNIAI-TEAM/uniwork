import ExpoModulesCore
import UIKit

/// Starts the call center as the app launches (docs/adr/0038). iOS launches a closed app in the background to deliver
/// a VoIP push, and hands the push to the PushKit registry the app creates while launching: made any later (by the
/// JavaScript module), that push would find no delegate, and iOS ends an app that does not report one to CallKit.
public class UniChatCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallCenter.shared.start()
    return true
  }
}
