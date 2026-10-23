package expo.modules.unichatcalls

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock

/**
 * The app's activity over the lock screen (review P2: CallLockScreen and the activity listener of
 * UniChatCallsPackage had no test): only a launch carrying its ring's token shows the app over the
 * lock screen and records Answer, a recreated activity does not answer twice, an intent another app
 * crafted does neither, and the end of the call gives the lock screen back. Review P2: the watchdog's clock
 * (uptime) stops while the phone sleeps, so waking it gives back a launch held past HOLD_MS of real time.
 * Review P1: leaving the call screen over a locked phone asks for the unlock first.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallLockScreenTest {
  private lateinit var app: Application

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
  }

  /** Rings for call-1 and returns its notification's full-screen (open) and Answer intents. */
  private fun ring(): Pair<Intent, Intent> {
    assertTrue(
      CallNotifications.showIncoming(
        app,
        IncomingCall().apply {
          callId = "call-1"
          roomId = "room-1"
          workspaceId = "ws-1"
          callerName = "An Nguyen"
          openUrl = "uniworkchat://o/w/chat?room=room-1&call=call-1"
        }
      )
    )
    val notification = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications.single()
    val open = shadowOf(notification.fullScreenIntent).savedIntent
    return open to shadowOf(answerIntent(notification)).savedIntent
  }

  /** Answer's PendingIntent: CallStyle keeps it in the extras; the plain fallback has it as the last action. */
  @Suppress("DEPRECATION")
  private fun answerIntent(notification: Notification): PendingIntent? =
    notification.extras.getParcelable(Notification.EXTRA_ANSWER_INTENT) ?: notification.actions?.lastOrNull()?.actionIntent

  private fun activity(intent: Intent): Activity = Robolectric.buildActivity(Activity::class.java, intent).setup().get()

  private fun shownOverLock(activity: Activity): Boolean = shadowOf(activity).showWhenLocked && shadowOf(activity).turnScreenOn

  @Test
  fun aRingsOwnLaunchShowsTheAppOverTheLockScreenAndTheCallsEndGivesItBack() {
    val (open, _) = ring()
    val activity = activity(open)
    CallActivityListener().onCreate(activity, null)
    assertTrue(shownOverLock(activity))
    assertFalse("opening is not answering", CallLaunchTokens.takeAnswered(app, "call-1", System.currentTimeMillis()))

    CallLockScreen.release(activity)
    assertFalse(shadowOf(activity).showWhenLocked)
    assertFalse(shadowOf(activity).turnScreenOn)
  }

  @Test
  fun answerIsRecordedOnceEvenWhenTheActivityIsRecreated() {
    val (_, answer) = ring()
    val activity = activity(answer)
    val listener = CallActivityListener()
    listener.onCreate(activity, null)
    assertTrue(shownOverLock(activity))
    assertTrue(CallLaunchTokens.takeAnswered(app, "call-1", System.currentTimeMillis()))
    // Rotation: the same intent with saved state.
    listener.onCreate(activity, Bundle())
    assertFalse(CallLaunchTokens.takeAnswered(app, "call-1", System.currentTimeMillis()))
  }

  @Test
  fun anAnswerDeliveredToTheRunningActivityAnswersAndShowsIt() {
    val running = activity(Intent(Intent.ACTION_MAIN))
    val listener = CallActivityListener()
    listener.onCreate(running, null)
    listener.onResume(running)
    assertFalse(shownOverLock(running))
    assertEquals(running, CallLockScreen.current())

    val (_, answer) = ring()
    assertFalse("the router still reads the link", listener.onNewIntent(answer))
    assertTrue(shownOverLock(running))
    assertTrue(CallLaunchTokens.takeAnswered(app, "call-1", System.currentTimeMillis()))
  }

  @Test
  fun aCraftedLaunchWithoutTheRingsTokenNeitherUnlocksNorAnswers() {
    ring()
    val crafted = Intent(Intent.ACTION_VIEW)
      .putExtra(CallLockScreen.EXTRA_CALL_LAUNCH, "call-1")
      .putExtra(CallLaunchTokens.EXTRA_TOKEN, "guessed")
      .putExtra(CallLaunchTokens.EXTRA_ANSWER, true)
    val activity = activity(crafted)
    CallActivityListener().onCreate(activity, null)
    assertFalse(shownOverLock(activity))
    assertFalse(CallLaunchTokens.takeAnswered(app, "call-1", System.currentTimeMillis()))
    assertFalse(CallLockScreen.isCallLaunch(Intent(Intent.ACTION_MAIN)))
    assertFalse(CallLockScreen.isCallLaunch(null))
  }

  /** Runs the main looper's clock forward by [ms]. */
  private fun advance(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

  @Test
  fun aLaunchThatNeverBecameACallGivesTheLockScreenBackOnItsOwn() {
    // The ring's launch showed the app over the lock, then the call was over before the call screen came:
    // nothing in JavaScript released it, the watchdog does once the ring window is past.
    CallService.stop(app) // no call's service left from another test
    val (open, _) = ring()
    val activity = activity(open)
    CallActivityListener().onCreate(activity, null)
    assertTrue(shownOverLock(activity))
    advance(CallLockScreen.HOLD_MS - 1_000)
    assertTrue("still within the ring window", shownOverLock(activity))
    advance(1_000)
    assertFalse(shadowOf(activity).showWhenLocked)
    assertFalse(shadowOf(activity).turnScreenOn)
  }

  @Test
  fun aCallUnderWayKeepsTheLockScreenUntilItsServiceStops() {
    val (_, answer) = ring()
    val activity = activity(answer)
    CallActivityListener().onCreate(activity, null)
    val service = Robolectric.buildService(CallService::class.java).create()
    advance(CallLockScreen.HOLD_MS * 3)
    assertTrue("the call is under way", shownOverLock(activity))
    service.destroy()
    advance(CallLockScreen.HOLD_MS)
    assertFalse(shadowOf(activity).showWhenLocked)
  }

  @Test
  fun aLaunchLeftOverTheLockWhileThePhoneSleptGoesBehindItWhenThePhoneWakes() {
    CallService.stop(app) // no call's service left from another test
    val (open, _) = ring()
    val activity = activity(open)
    val listener = CallActivityListener()
    listener.onCreate(activity, null)
    listener.onResume(activity)
    assertTrue("just launched", shownOverLock(activity))
    // The screen timed out and the phone slept for hours: uptime, the watchdog's clock, stood still.
    ShadowSystemClock.simulateDeepSleep(Duration.ofMillis(CallLockScreen.HOLD_MS * 100))
    assertTrue("nothing ran while it slept", shownOverLock(activity))
    // The power button wakes it and resumes the activity: the app goes back behind the lock before anyone browses.
    listener.onResume(activity)
    assertFalse(shadowOf(activity).showWhenLocked)
    assertFalse(shadowOf(activity).turnScreenOn)
  }

  @Test
  fun wakingThePhoneWithinTheHoldOrDuringACallKeepsTheCallScreenOverTheLock() {
    CallService.stop(app)
    val (_, answer) = ring()
    val activity = activity(answer)
    val listener = CallActivityListener()
    listener.onCreate(activity, null)
    ShadowSystemClock.simulateDeepSleep(Duration.ofMillis(CallLockScreen.HOLD_MS - 1_000))
    listener.onResume(activity)
    assertTrue("still within the ring window", shownOverLock(activity))
    val service = Robolectric.buildService(CallService::class.java).create()
    ShadowSystemClock.simulateDeepSleep(Duration.ofMillis(CallLockScreen.HOLD_MS * 10))
    listener.onResume(activity)
    assertTrue("the call is under way", shownOverLock(activity))
    service.destroy()
    listener.onResume(activity)
    assertFalse("the call is over and the hold long past", shadowOf(activity).showWhenLocked)
  }

  private val keyguard get() = shadowOf(app.getSystemService(KeyguardManager::class.java))

  @Test
  fun leavingTheCallScreenOverALockedPhoneAsksForTheUnlockFirst() {
    val (_, answer) = ring()
    val activity = activity(answer)
    CallActivityListener().onCreate(activity, null)
    keyguard.setKeyguardLocked(true)

    var left: Boolean? = null
    CallLockScreen.leave(activity) { left = it }
    assertNull("Android asks for the PIN, the call screen waits", left)
    // The person cancels the PIN: the call screen stays over the lock, nothing else of the app shows.
    keyguard.setKeyguardLocked(true)
    assertEquals(false, left)
    assertTrue(shownOverLock(activity))

    left = null
    CallLockScreen.leave(activity) { left = it }
    keyguard.setKeyguardLocked(false)
    assertEquals("unlocked: the app may show", true, left)
    assertFalse("and locking the phone later hides it as usual", shadowOf(activity).showWhenLocked)
  }

  @Test
  fun leavingIsFreeWhenTheAppIsNotHeldOverALock() {
    val (_, answer) = ring()
    val activity = activity(answer)
    CallActivityListener().onCreate(activity, null)
    // Shown for the call, but the person had unlocked the phone already: the hold goes, no PIN asked.
    keyguard.setKeyguardLocked(false)
    var left: Boolean? = null
    CallLockScreen.leave(activity) { left = it }
    assertEquals(true, left)
    assertFalse(shadowOf(activity).showWhenLocked)
    // Not shown over the lock at all (an ordinary launch): nothing to ask.
    keyguard.setKeyguardLocked(true)
    left = null
    CallLockScreen.leave(activity) { left = it }
    assertEquals(true, left)
  }

  @Test
  fun thePackageRegistersTheListener() {
    val listeners = UniChatCallsPackage().createReactActivityLifecycleListeners(app)
    assertNotNull(listeners.single() as? CallActivityListener)
  }
}
