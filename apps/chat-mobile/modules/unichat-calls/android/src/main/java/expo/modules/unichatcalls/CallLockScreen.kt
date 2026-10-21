package expo.modules.unichatcalls

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.view.WindowManager
import java.lang.ref.WeakReference

/**
 * The app's activity shows over the lock screen only while a call needs it: a
 * launch from the ringing notification (its full-screen intent, a tap, Answer)
 * turns the screen on and shows the call there; the call ending gives the
 * lock screen back (UniChatCalls.releaseLockScreen). The manifest never says
 * showWhenLocked, so the rest of the app stays behind the lock.
 */
internal object CallLockScreen {
  const val EXTRA_CALL_LAUNCH = "expo.modules.unichatcalls.CALL_LAUNCH"
  private var activity: WeakReference<Activity>? = null

  fun track(activity: Activity) {
    this.activity = WeakReference(activity)
  }

  fun current(): Activity? = activity?.get()

  fun isCallLaunch(intent: Intent?): Boolean = intent?.hasExtra(EXTRA_CALL_LAUNCH) == true

  fun showOver(activity: Activity) {
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(true)
        activity.setTurnScreenOn(true)
      } else {
        @Suppress("DEPRECATION")
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
      }
    }
  }

  fun release(activity: Activity) {
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(false)
        activity.setTurnScreenOn(false)
      } else {
        @Suppress("DEPRECATION")
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
      }
    }
  }
}
