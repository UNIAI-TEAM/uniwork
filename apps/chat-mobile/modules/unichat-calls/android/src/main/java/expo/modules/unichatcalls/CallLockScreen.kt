package expo.modules.unichatcalls

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
 * under way keeps it, checked again every HOLD_MS until the call ends. The
 * Handler's clock is uptime, which stops while the phone sleeps, so the
 * watchdog alone could leave the app over the lock for hours: the launch is
 * timed on elapsedRealtime too, and the activity coming to the front
 * (recheck, from CallActivityListener.onResume, which is what the power
 * button waking the phone runs) gives the lock back at once when that time is
 * past and no call runs.
 *
 * Leaving the call screen for the rest of the app (shrinking a call) asks
 * Android to dismiss the keyguard first (leave): shown over a locked phone,
 * a shrunk call would leave every chat open to whoever holds it.
 */
internal object CallLockScreen {
  const val EXTRA_CALL_LAUNCH = "expo.modules.unichatcalls.CALL_LAUNCH"

  /** The server's ring window (60 s) and a cold start's worth of margin. */
  const val HOLD_MS = 75_000L

  private var activity: WeakReference<Activity>? = null
  private val handler by lazy { Handler(Looper.getMainLooper()) }
  private var shown: WeakReference<Activity>? = null
  /** SystemClock.elapsedRealtime of the last launch shown over the lock: it runs on while the phone sleeps. */
  private var shownAt = 0L
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
    shownAt = SystemClock.elapsedRealtime()
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

  /**
   * The activity came to the front (the phone woke, the app returned): a launch held HOLD_MS or longer by the
   * clock that runs while the phone sleeps, with no call under way, gives the lock screen back now instead of when
   * the watchdog's uptime delay runs out.
   */
  fun recheck() {
    val over = shown?.get() ?: return
    if (SystemClock.elapsedRealtime() - shownAt >= HOLD_MS && !CallService.isRunning()) release(over)
  }

  /**
   * Lets the person leave the call screen for the rest of the app. [done] gets true when the app is not held over
   * a locked phone any more: it never was, the keyguard is already gone (the hold is released, so locking the phone
   * later hides the app as usual), or Android dismissed it now — after the PIN, pattern or biometric of a secure
   * one. False when the person cancels, when Android refuses, or before Android 8, where an app cannot ask: the call
   * screen stays and nothing else of the app shows.
   */
  fun leave(activity: Activity, done: (Boolean) -> Unit) {
    if (shown?.get() == null) {
      done(true)
      return
    }
    val keyguard = activity.getSystemService(KeyguardManager::class.java)
    if (keyguard != null && !keyguard.isKeyguardLocked) {
      release(activity)
      done(true)
      return
    }
    if (keyguard == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      done(false)
      return
    }
    keyguard.requestDismissKeyguard(
      activity,
      object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          release(activity)
          done(true)
        }

        override fun onDismissCancelled() = done(false)

        override fun onDismissError() = done(false)
      }
    )
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
