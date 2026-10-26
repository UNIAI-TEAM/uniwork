import ExpoModulesCore
import UIKit

/// The outbox's time to finish on iOS, as JavaScript sees it through modules/unichat-background/index.ts: as UniChat
/// goes to the background with something owed, data/outbox-drain/background-send.ts asks for a background task
/// (about 30 s of the system's time), sends, and ends it. Android's half (the WorkManager job) is
/// android/…/UniChatBackgroundModule.kt; the scheduled drain once the app is suspended is expo-background-task's.
public class UniChatBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UniChatBackground")

    // On the main queue: UIApplication is the main thread's, and so is the set of open tasks below.
    AsyncFunction("beginGrace") { (name: String) -> Int in
      BackgroundGrace.begin(name: name)
    }
    .runOnQueue(.main)

    AsyncFunction("endGrace") { (id: Int) in
      BackgroundGrace.end(id: id)
    }
    .runOnQueue(.main)
  }
}

/// The background tasks JavaScript holds open, by their raw id. Touched on the main queue only (both functions run
/// there, and UIKit calls the expiration handler there). Deliberately not `@MainActor`: the module's closures are not
/// isolated, and the pods build in Swift 5 mode, where UIKit's own isolation is not enforced on them.
enum BackgroundGrace {
  private static var open = Set<Int>()

  /// The id the expiration handler reads once the system has handed it out; a box, since a handler that may be
  /// `@Sendable` cannot capture a `var`.
  private final class Granted: @unchecked Sendable {
    var task = UIBackgroundTaskIdentifier.invalid
  }

  /// The task's id, or -1 when the system grants none (background time already spent, app not in a state to get it).
  static func begin(name: String) -> Int {
    let granted = Granted()
    granted.task = UIApplication.shared.beginBackgroundTask(withName: name) {
      // Out of time: the system suspends the app as this returns, and kills one that still holds the task.
      BackgroundGrace.end(id: granted.task.rawValue)
    }
    if granted.task == .invalid {
      return -1
    }
    open.insert(granted.task.rawValue)
    return granted.task.rawValue
  }

  /// Ends a task once: JavaScript's end after an expiry (or a second end) does nothing.
  static func end(id: Int) {
    guard open.remove(id) != nil else {
      return
    }
    UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: id))
  }
}
