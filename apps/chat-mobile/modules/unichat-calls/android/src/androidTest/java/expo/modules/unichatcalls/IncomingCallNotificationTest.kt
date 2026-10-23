package expo.modules.unichatcalls

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import java.util.regex.Pattern
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The incoming call as a real Android shows it (review P2: Robolectric checks the notification's
 * fields, not what System UI draws). Posted through CallNotifications on the android-smoke
 * emulator (mobile-verify.yml), it must reach the shade as a call with the system's Answer and
 * Decline buttons, carry its full-screen intent, and leave the shade when the ring is cancelled.
 * The full-screen activity over a locked phone, the ringtone and OEM skins stay on the release
 * runbook's device checklist; a ring pushed by FCM is the nightly's manual call-answer-incoming flow.
 */
@RunWith(AndroidJUnit4::class)
class IncomingCallNotificationTest {
  @get:Rule
  val notifications: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)

  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val device = UiDevice.getInstance(instrumentation)
  private val shade = ShadeProbe(device, context)

  @After
  fun tearDown() {
    CallNotifications.cancelIncoming(context, CALL_ID)
    device.pressHome()
  }

  @Test
  fun aRingReachesTheShadeAsACallWithAnswerAndDeclineAndLeavesWhenCancelled() {
    shade.prepare()
    val posted = CallNotifications.showIncoming(
      context,
      IncomingCall().apply {
        callId = CALL_ID
        roomId = "room-1"
        workspaceId = "ws-1"
        callerName = CALLER
        text = "Incoming voice call"
        openUrl = "uniworkchat://o/w/chat?room=room-1&call=$CALL_ID"
        timeoutMs = 60_000.0
      }
    )
    assertTrue("CallNotifications posted the ring", posted)

    val active = context.getSystemService(NotificationManager::class.java).activeNotifications
      .single { it.notification.category == Notification.CATEGORY_CALL }
    assertEquals(CallNotifications.CHANNEL_CALLS, active.notification.channelId)
    assertNotNull("the full-screen intent survives the system's checks", active.notification.fullScreenIntent)

    shade.awaitInShade(CALLER, TIMEOUT_MS, "the caller shows in the shade")
    shade.assertShown(By.text(Pattern.compile("(?i)answer")), TIMEOUT_MS, "Answer")
    shade.assertShown(By.text(Pattern.compile("(?i)decline")), TIMEOUT_MS, "Decline")

    CallNotifications.cancelIncoming(context, CALL_ID)
    shade.assertGone(By.text(CALLER), TIMEOUT_MS, "cancelling the ring takes it out of the shade")
  }

  private companion object {
    const val CALL_ID = "instrumented-call-1"
    const val CALLER = "UniChat Instrumented Caller"
    const val TIMEOUT_MS = 10_000L
  }
}
