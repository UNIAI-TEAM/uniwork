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
 * screen, on create and on a new intent to the running activity, and Answer's
 * launch is recorded for JavaScript. Both only for a launch whose token
 * matches its ring's (CallLaunchTokens): the activity is exported, so any app
 * can start it with a call's extras, and that must neither unlock the app's
 * screens nor pick up the call.
 */
class CallActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    val created = activity ?: return
    CallLockScreen.track(created)
    // A recreated activity (rotation, process restore) carries the same intent: Answer counts once.
    handleLaunch(created, created.intent, recordAnswer = savedInstanceState == null)
  }

  override fun onResume(activity: Activity?) {
    activity?.let { CallLockScreen.track(it) }
    // Waking the phone resumes an activity shown over the lock: a launch past its hold goes back behind it now.
    CallLockScreen.recheck()
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    CallLockScreen.current()?.let { handleLaunch(it, intent, recordAnswer = true) }
    // Not consumed: expo-linking and the router still read the link.
    return false
  }

  private fun handleLaunch(activity: Activity, intent: Intent?, recordAnswer: Boolean) {
    if (!CallLockScreen.isCallLaunch(intent)) return
    val context = activity.applicationContext
    if (CallLaunchTokens.verifiedCall(context, intent) == null) return
    if (recordAnswer) CallLaunchTokens.recordAnswer(context, intent, System.currentTimeMillis())
    CallLockScreen.showOver(activity)
  }
}

/** Registers CallActivityListener with the app's ReactActivity. */
class UniChatCallsPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(CallActivityListener())
}
