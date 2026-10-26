package expo.modules.unichatcalls

import android.content.Context
import android.os.PowerManager
import android.util.Log

/**
 * The screen turns off while the phone is at the ear (audit "Calls, push &
 * background", in-call-ergonomics): a voice call on the earpiece holds a
 * PROXIMITY_SCREEN_OFF_WAKE_LOCK, so a cheek cannot tap Hang up or Mute and
 * the screen does not burn the battery. JavaScript decides when (the call's
 * audio output, data/calls/call-proximity.ts); the call's end releases it
 * (CallService.stop). Released with RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY: the
 * screen comes back once the phone leaves the ear, never while it is still
 * there. A phone without a proximity sensor has nothing to hold.
 */
internal object CallProximity {
  private const val TAG = "UniChatCalls"

  /** A call never lasts this long; the lock goes by itself if nothing released it. */
  const val MAX_HOLD_MS = 4 * 60 * 60 * 1000L

  private var lock: PowerManager.WakeLock? = null

  fun isHeld(): Boolean = lock?.isHeld == true

  @Synchronized
  fun set(context: Context, on: Boolean): Boolean {
    if (!on) {
      lock?.let { if (it.isHeld) it.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY) }
      lock = null
      return false
    }
    if (isHeld()) return true
    val power = context.getSystemService(PowerManager::class.java) ?: return false
    if (!power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return false
    return try {
      val next = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "UniChat:call-proximity")
      next.setReferenceCounted(false)
      next.acquire(MAX_HOLD_MS)
      lock = next
      true
    } catch (e: RuntimeException) {
      Log.w(TAG, "the proximity wake lock was refused", e)
      false
    }
  }
}
