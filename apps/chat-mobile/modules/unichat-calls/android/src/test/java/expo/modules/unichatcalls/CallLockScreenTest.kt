package expo.modules.unichatcalls

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The app's activity over the lock screen (review P2: CallLockScreen and the activity listener of
 * UniChatCallsPackage had no test): only a launch carrying its ring's token shows the app over the
 * lock screen and records Answer, a recreated activity does not answer twice, an intent another app
 * crafted does neither, and the end of the call gives the lock screen back.
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

  @Test
  fun thePackageRegistersTheListener() {
    val listeners = UniChatCallsPackage().createReactActivityLifecycleListeners(app)
    assertNotNull(listeners.single() as? CallActivityListener)
  }
}
