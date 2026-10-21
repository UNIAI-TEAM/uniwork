package expo.modules.unichatcalls

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

// Its own file on purpose: expo-modules-autolinking registers a Package only
// from a file named *Package.kt and takes the class name from the file name
// (apps/chat-mobile/native-modules.test.ts). Declared in another file, the
// listener below never runs and a call never shows over the lock screen.

/**
 * Applies CallLockScreen to the app's activity: a launch from the ringing
 * notification (full-screen intent, tap, Answer) shows it over the lock
 * screen, on create and on a new intent to the running activity.
 */
class CallActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    val created = activity ?: return
    CallLockScreen.track(created)
    if (CallLockScreen.isCallLaunch(created.intent)) CallLockScreen.showOver(created)
  }

  override fun onResume(activity: Activity?) {
    activity?.let { CallLockScreen.track(it) }
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    if (CallLockScreen.isCallLaunch(intent)) CallLockScreen.current()?.let { CallLockScreen.showOver(it) }
    // Not consumed: expo-linking and the router still read the link.
    return false
  }
}

/** Registers CallActivityListener with the app's ReactActivity. */
class UniChatCallsPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(CallActivityListener())
}
