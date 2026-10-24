import ExpoModulesCore
import Foundation

/// CallCenter as JavaScript sees it (modules/unichat-calls/index.ts › UniChatCallKit). Named apart from Android's
/// "UniChatCalls" module on purpose: the two halves expose different functions, and data/calls/native-call-session.ts
/// turns each into the same NativeCallSession.
public class UniChatCallKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UniChatCallKit")

    Events("onCallEvent")

    OnStartObserving("onCallEvent") {
      CallCenter.shared.attach { [weak self] event in
        var body: [String: Any?] = [:]
        for (key, value) in event {
          body[key] = value
        }
        self?.sendEvent("onCallEvent", body)
      }
    }

    OnStopObserving("onCallEvent") {
      CallCenter.shared.attach(nil)
    }

    /// The build has calls (the `voip` background mode) and the call center runs.
    Function("isEnabled") { () -> Bool in
      CallCenter.shared.isStarted
    }

    /// PushKit's VoIP token in hex, null until PushKit hands one over.
    Function("voipToken") { () -> String? in
      CallCenter.shared.voipToken
    }

    Function("apnsEnvironment") { () -> String in
      ApnsEnvironment.current()
    }

    Function("bundleId") { () -> String in
      Bundle.main.bundleIdentifier ?? ""
    }

    Function("isRinging") { () -> Bool in
      CallCenter.shared.isRinging
    }

    Function("isHeld") { () -> Bool in
      CallCenter.shared.isHeld
    }

    Function("takeAnswered") { (callId: String) -> Bool in
      CallCenter.shared.takeAnswered(callId)
    }

    Function("takePendingEvents") { () -> [[String: Any]] in
      CallCenter.shared.takePending()
    }

    AsyncFunction("answer") { (callId: String) in
      CallCenter.shared.answer(callId: callId)
    }
    .runOnQueue(.main)

    AsyncFunction("end") { (callId: String) in
      CallCenter.shared.end(callId: callId)
    }
    .runOnQueue(.main)
  }
}
