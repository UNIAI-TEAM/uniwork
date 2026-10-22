package expo.modules.unichatcalls

import android.app.Application
import android.media.AudioManager
import android.os.VibratorManager
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The in-app ring follows the ringer switch (review P2: no test): silent rings nothing, vibrate
 * only buzzes, and stopping it (Decline, Answer, the call ending) stops the buzz. The ringtone
 * itself on the ringtone stream is the release runbook's device check: Robolectric plays no sound.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallRingerTest {
  private lateinit var app: Application

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
  }

  @After
  fun tearDown() {
    CallRinger.stop()
  }

  private fun ringerMode(mode: Int) {
    app.getSystemService(AudioManager::class.java).ringerMode = mode
  }

  private fun buzzing(): Boolean = shadowOf(app.getSystemService(VibratorManager::class.java).defaultVibrator).isVibrating

  @Test
  fun silentModeRingsNothing() {
    ringerMode(AudioManager.RINGER_MODE_SILENT)
    CallRinger.start(app)
    assertFalse(buzzing())
  }

  @Test
  fun vibrateModeBuzzesUntilStopped() {
    ringerMode(AudioManager.RINGER_MODE_VIBRATE)
    CallRinger.start(app)
    assertTrue(buzzing())
    CallRinger.stop()
    assertFalse(buzzing())
  }

  @Test
  fun aSecondRingReplacesTheFirstAndOneStopEndsIt() {
    ringerMode(AudioManager.RINGER_MODE_VIBRATE)
    CallRinger.start(app)
    CallRinger.start(app)
    assertTrue(buzzing())
    CallRinger.stop()
    assertFalse(buzzing())
  }
}
