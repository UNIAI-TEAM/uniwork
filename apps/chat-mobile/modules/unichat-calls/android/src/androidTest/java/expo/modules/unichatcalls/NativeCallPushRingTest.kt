package expo.modules.unichatcalls

import android.Manifest
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import java.util.regex.Pattern
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A call push as FCM hands it to UniChatMessagingService (Expo's data message, the server's data as JSON under
 * "body"), on a real Android with no JavaScript in the process (review killed-app-ring-js-dependent): the ring
 * reaches System UI's shade as a call with Answer and Decline, and the push that ends it takes it out. The FCM
 * hop itself and a force-stopped app are the nightly's android-two-party flow (chat-mobile-verify.yml).
 */
@RunWith(AndroidJUnit4::class)
class NativeCallPushRingTest {
  @get:Rule
  val notifications: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)

  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext
  private val device = UiDevice.getInstance(instrumentation)
  private val shade = ShadeProbe(device, context)

  @After
  fun tearDown() {
    NativeCallPush.clearRing(context, CALL_ID)
    device.pressHome()
  }

  private fun expo(vararg data: Pair<String, String>): Map<String, String> = mapOf("body" to JSONObject(mapOf(*data)).toString())

  @Test
  fun aPushedRingReachesTheShadeWithNoJavaScriptAndItsEndTakesItOut() {
    shade.prepare()
    RingConfig.write(
      context,
      RingConfig().apply {
        enabled = true
        scheme = "uniworkchat"
        incomingVoice = "Incoming voice call"
        incomingVideo = "Incoming video call"
        incomingGroup = "Group call · {room}"
        groupFallback = "Group"
        unknownCaller = "Caller"
        answerLabel = "Answer"
        declineLabel = "Decline"
      }
    )
    val now = System.currentTimeMillis()
    val ring = expo(
      "type" to "call_invite",
      "call_id" to CALL_ID,
      "room_id" to "room-1",
      "workspace_id" to "ws-1",
      "caller_name" to CALLER,
      "call_kind" to "dm",
      "video" to "0",
      "expires_at" to (now + 50_000).toString(),
      "url" to "https://app.example.invalid/o/w/chat?room=room-1&call=$CALL_ID"
    )
    assertEquals(NativeCallPush.Outcome.RANG, NativeCallPush.handle(context, ring, now, appInFront = false))

    shade.awaitInShade(CALLER, TIMEOUT_MS, "the caller shows in the shade")
    shade.assertShown(By.text(Pattern.compile("(?i)answer")), TIMEOUT_MS, "Answer")

    val end = expo("type" to "call_end", "call_id" to CALL_ID, "room_id" to "room-1")
    assertEquals(NativeCallPush.Outcome.CLEARED, NativeCallPush.handle(context, end, System.currentTimeMillis(), appInFront = false))
    shade.assertGone(By.text(CALLER), TIMEOUT_MS, "the end of the ring takes it out of the shade")
  }

  private companion object {
    const val CALL_ID = "instrumented-push-1"
    const val CALLER = "UniChat Pushed Caller"
    const val TIMEOUT_MS = 10_000L
  }
}
