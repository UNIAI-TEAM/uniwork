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
 * mode rings nothing, vibrate mode only buzzes.
 */
internal object CallRinger {
  private val PATTERN = longArrayOf(0, 1000, 1000)
  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null

  @Synchronized
  fun start(context: Context) {
    stop()
    val mode = context.getSystemService(AudioManager::class.java)?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
    if (mode == AudioManager.RINGER_MODE_NORMAL) {
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
    if (mode != AudioManager.RINGER_MODE_SILENT) {
      vibrator = vibratorOf(context)?.also { v ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          v.vibrate(VibrationEffect.createWaveform(PATTERN, 0))
        } else {
          @Suppress("DEPRECATION")
          v.vibrate(PATTERN, 0)
        }
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
