package expo.modules.unichatcalls

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import java.lang.ref.WeakReference

/**
 * The app's activity shows over the lock screen only while a call needs it: a
 * launch from the ringing notification (its full-screen intent, a tap, Answer)
 * turns the screen on and shows the call there; the call ending gives the
 * lock screen back (UniChatCalls.releaseLockScreen). The manifest never says
 * showWhenLocked, so the rest of the app stays behind the lock.
 *
 * A watchdog bounds it natively too (audit "Calls, push & background": a
 * launch whose call never became the call screen left every chat browsable
 * over the lock): HOLD_MS after the last launch, with no call's foreground
 * service running, the lock screen comes back whatever JavaScript did. A call
 * under way keeps it, checked again every HOLD_MS until the call ends.
 */
internal object CallLockScreen {
  const val EXTRA_CALL_LAUNCH = "expo.modules.unichatcalls.CALL_LAUNCH"

  /** The server's ring window (60 s) and a cold start's worth of margin. */
  const val HOLD_MS = 75_000L

  private var activity: WeakReference<Activity>? = null
  private val handler by lazy { Handler(Looper.getMainLooper()) }
  private var shown: WeakReference<Activity>? = null
  private val watchdog = object : Runnable {
    override fun run() {
      val over = shown?.get() ?: return
      if (CallService.isRunning()) {
        handler.postDelayed(this, HOLD_MS)
      } else {
        release(over)
      }
    }
  }

  fun track(activity: Activity) {
    this.activity = WeakReference(activity)
  }

  fun current(): Activity? = activity?.get()

  fun isCallLaunch(intent: Intent?): Boolean = intent?.hasExtra(EXTRA_CALL_LAUNCH) == true

  fun showOver(activity: Activity) {
    shown = WeakReference(activity)
    handler.removeCallbacks(watchdog)
    handler.postDelayed(watchdog, HOLD_MS)
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
    handler.removeCallbacks(watchdog)
    shown = null
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
