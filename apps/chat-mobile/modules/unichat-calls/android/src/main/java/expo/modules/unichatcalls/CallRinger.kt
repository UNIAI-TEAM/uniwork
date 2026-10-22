package expo.modules.unichatcalls

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The in-app ring of an incoming call while UniChat is open: the phone's own
 * ringtone on the ringtone stream (audit P2 Calls: it played on the media
 * stream, ignoring the ringer switch), looping, and the ringtone's buzz. Silent
 * mode rings nothing, vibrate mode only buzzes. During another call (the
 * phone's own or another app's: CallInterruptions.phoneBusy) it is call
 * waiting: one short buzz, never the ringtone over that call.
 */
internal object CallRinger {
  private val PATTERN = longArrayOf(0, 1000, 1000)
  private val WAITING = longArrayOf(0, 200, 150, 200)
  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null

  /** What a ring does on this phone now. */
  enum class Ring { RINGTONE, VIBRATE, WAITING, NOTHING }

  fun ringFor(context: Context): Ring {
    val mode = context.getSystemService(AudioManager::class.java)?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
    return when {
      mode == AudioManager.RINGER_MODE_SILENT -> Ring.NOTHING
      CallInterruptions.phoneBusy(context) -> Ring.WAITING
      mode == AudioManager.RINGER_MODE_NORMAL -> Ring.RINGTONE
      else -> Ring.VIBRATE
    }
  }

  @Synchronized
  fun start(context: Context) {
    stop()
    val ring = ringFor(context)
    if (ring == Ring.WAITING) {
      vibrate(context, WAITING, -1)
      return
    }
    if (ring == Ring.RINGTONE) {
      val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ringtone = RingtoneManager.getRingtone(context, uri)?.apply {
        audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
        play()
      }
    }
    if (ring != Ring.NOTHING) vibrate(context, PATTERN, 0)
  }

  /** [repeat] 0 loops the pattern until stop(); -1 plays it once. */
  private fun vibrate(context: Context, pattern: LongArray, repeat: Int) {
    vibrator = vibratorOf(context)?.also { v ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createWaveform(pattern, repeat))
      } else {
        @Suppress("DEPRECATION")
        v.vibrate(pattern, repeat)
      }
    }
  }

  @Synchronized
  fun stop() {
    ringtone?.stop()
    ringtone = null
    vibrator?.cancel()
    vibrator = null
  }

  private fun vibratorOf(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
}
