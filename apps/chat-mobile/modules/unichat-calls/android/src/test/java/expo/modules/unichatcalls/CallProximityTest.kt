package expo.modules.unichatcalls

import android.app.Application
import android.os.PowerManager
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
import org.robolectric.shadows.ShadowPowerManager

/**
 * The screen off at the ear (audit in-call-ergonomics): a voice call on the earpiece holds the
 * proximity wake lock once, turning it off releases it, the call's end (CallService.stop) releases
 * it too, and a phone without a proximity sensor holds nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallProximityTest {
  private lateinit var app: Application
  private lateinit var power: PowerManager

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    power = app.getSystemService(PowerManager::class.java)
    shadowOf(power).setIsWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, true)
  }

  @After
  fun tearDown() {
    CallProximity.set(app, false)
  }

  @Test
  fun anEarpieceCallHoldsTheProximityLockUntilItIsTurnedOff() {
    assertTrue(CallProximity.set(app, true))
    val held = ShadowPowerManager.getLatestWakeLock()
    assertTrue(held.isHeld)
    assertTrue("a second call keeps the same lock", CallProximity.set(app, true))
    assertTrue(ShadowPowerManager.getLatestWakeLock() === held)

    assertFalse(CallProximity.set(app, false))
    assertFalse(held.isHeld)
    assertFalse(CallProximity.isHeld())
  }

  @Test
  fun theCallsEndReleasesTheLock() {
    assertTrue(CallProximity.set(app, true))
    CallService.stop(app)
    assertFalse(CallProximity.isHeld())
  }

  @Test
  fun aPhoneWithoutAProximitySensorHoldsNothing() {
    shadowOf(power).setIsWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, false)
    assertFalse(CallProximity.set(app, true))
    assertFalse(CallProximity.isHeld())
  }
}
