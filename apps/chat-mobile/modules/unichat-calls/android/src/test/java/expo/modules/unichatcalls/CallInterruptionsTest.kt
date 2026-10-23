package expo.modules.unichatcalls

import android.app.Application
import android.media.AudioManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * A cellular call during a UniChat call (review P2, in-call-ergonomics): while the call's service runs, the
 * phone's own call taking the line holds the UniChat call, and giving it back ends the hold; the call ending
 * ends it too. A cellular call that only rings does not hold it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallInterruptionsTest {
  private lateinit var app: Application
  private lateinit var audio: AudioManager
  private val heard = mutableListOf<Boolean>()

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    audio = app.getSystemService(AudioManager::class.java)
    CallInterruptions.onHeld = { heard += it }
  }

  @After
  fun tearDown() {
    CallInterruptions.stop(app)
    CallInterruptions.onHeld = null
  }

  private fun mode(mode: Int) {
    audio.mode = mode
    shadowOf(Looper.getMainLooper()).idle()
  }

  @Test
  fun aCellularCallAnsweredDuringTheCallHoldsItUntilItHangsUp() {
    val service = Robolectric.buildService(CallService::class.java).create()
    mode(AudioManager.MODE_IN_COMMUNICATION) // our own call
    mode(AudioManager.MODE_RINGTONE) // the phone's own call rings: not held yet
    assertFalse(CallInterruptions.isHeld())
    mode(AudioManager.MODE_IN_CALL) // answered
    assertTrue(CallInterruptions.isHeld())
    mode(AudioManager.MODE_IN_COMMUNICATION) // hung up: ours has the line again
    assertFalse(CallInterruptions.isHeld())
    assertEquals(listOf(true, false), heard)
    service.destroy()
  }

  @Test
  fun aCellularCallUnderWayWhenTheCallStartsHoldsItFromTheStartAndTheCallsEndReleasesIt() {
    mode(AudioManager.MODE_IN_CALL)
    val service = Robolectric.buildService(CallService::class.java).create()
    assertTrue(CallInterruptions.isHeld())
    service.destroy()
    assertFalse(CallInterruptions.isHeld())
    assertEquals(listOf(true, false), heard)
    // Not watched after the call: the phone's next call holds nothing.
    mode(AudioManager.MODE_NORMAL)
    mode(AudioManager.MODE_IN_CALL)
    assertFalse(CallInterruptions.isHeld())
  }

  @Test
  fun onlyTheModesOfThePhonesOwnCallHoldTheLine() {
    assertTrue(CallInterruptions.holdsTheLine(AudioManager.MODE_IN_CALL))
    assertTrue(CallInterruptions.holdsTheLine(AudioManager.MODE_CALL_SCREENING))
    for (other in listOf(AudioManager.MODE_NORMAL, AudioManager.MODE_RINGTONE, AudioManager.MODE_IN_COMMUNICATION)) {
      assertFalse(CallInterruptions.holdsTheLine(other))
    }
  }
}
