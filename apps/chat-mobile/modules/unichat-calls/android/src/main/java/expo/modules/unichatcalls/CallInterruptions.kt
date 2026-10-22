package expo.modules.unichatcalls

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat

/**
 * The phone's own call during a UniChat call (review P2, in-call-ergonomics). Without Telecom, Android neither
 * holds nor mutes a VoIP call when a cellular call is answered: both fight over the same output. While the call's
 * service runs (CallService.onCreate / onDestroy), this watches the device's audio mode
 * (AudioManager.OnModeChangedListener, Android 12+, no permission; the telephony call state would need
 * READ_PHONE_STATE). MODE_IN_CALL or MODE_CALL_SCREENING means a cellular call has the line: [onHeld] tells
 * JavaScript the call is held (UniChatCallsModule's onCallHeld event), which turns our microphone and the other
 * side's audio off and says so on the call screen. Any other mode ends the hold. Before Android 12 nothing is
 * watched and the call is never held.
 */
internal object CallInterruptions {
  private const val TAG = "UniChatCalls"

  /** Set by the module while JavaScript runs; called on every change of [isHeld]. */
  @Volatile
  var onHeld: ((Boolean) -> Unit)? = null

  @Volatile
  private var held = false

  /** The registered AudioManager.OnModeChangedListener (an API 31 type, so kept as Any). */
  private var listener: Any? = null

  fun isHeld(): Boolean = held

  /** The modes in which the phone's own call has the line; MODE_RINGTONE (it only rings) is not one. */
  fun holdsTheLine(mode: Int): Boolean = mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_CALL_SCREENING

  @Synchronized
  fun modeChanged(mode: Int) {
    val now = holdsTheLine(mode)
    if (now == held) return
    held = now
    onHeld?.invoke(now)
  }

  @Synchronized
  fun start(context: Context) {
    if (listener != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    try {
      listener = register(context, audio)
      // A cellular call already under way when the UniChat call starts holds it from the start.
      modeChanged(audio.mode)
    } catch (e: RuntimeException) {
      Log.w(TAG, "the audio mode cannot be watched", e)
    }
  }

  @Synchronized
  fun stop(context: Context) {
    val registered = listener
    listener = null
    if (registered != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        unregister(context, registered)
      } catch (e: RuntimeException) {
        Log.w(TAG, "the audio mode listener could not be removed", e)
      }
    }
    // The call is over: nothing is held any more.
    modeChanged(AudioManager.MODE_NORMAL)
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun register(context: Context, audio: AudioManager): Any {
    val next = AudioManager.OnModeChangedListener { mode -> modeChanged(mode) }
    audio.addOnModeChangedListener(ContextCompat.getMainExecutor(context), next)
    return next
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun unregister(context: Context, registered: Any) {
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    (registered as? AudioManager.OnModeChangedListener)?.let { audio.removeOnModeChangedListener(it) }
  }
}
