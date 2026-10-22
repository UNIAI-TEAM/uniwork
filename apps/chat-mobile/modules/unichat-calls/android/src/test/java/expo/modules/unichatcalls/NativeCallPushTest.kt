package expo.modules.unichatcalls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * A call push handled natively, before any JavaScript (review killed-app-ring-js-dependent): a ring to a closed
 * app is the incoming-call notification at once, in the app's language and with the app's link; the end of a ring
 * takes it down; what JavaScript must decide (the app on screen, no ring config yet) is passed on; a switched-off
 * or late ring rings nothing. The FCM message is Expo's: the server's data as a JSON string under "body".
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeCallPushTest {
  private lateinit var app: Application
  private lateinit var manager: NotificationManager

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    manager = app.getSystemService(NotificationManager::class.java)
    RingReports.take(app)
    // No call under way: a ring during one is the call engine's to answer busy.
    CallService.stop(app)
    CallEngineLive.live = false
  }

  private fun configure(enabled: Boolean = true) = RingConfig.write(
    app,
    RingConfig().apply {
      this.enabled = enabled
      scheme = "uniworkchat"
      incomingVoice = "Cuộc gọi thoại đến"
      incomingVideo = "Cuộc gọi video đến"
      incomingGroup = "Cuộc gọi nhóm · {room}"
      groupFallback = "Nhóm"
      unknownCaller = "Người gọi"
      answerLabel = "Nghe"
      declineLabel = "Từ chối"
    }
  )

  private val url = "https://app.test/acme/hq/chat?room=r-1&call=c-1"

  private fun expo(vararg data: Pair<String, String>): Map<String, String> =
    mapOf("experienceId" to "@unicom/unichat", "body" to JSONObject(mapOf(*data)).toString())

  private fun invite(expiresAt: Long = NOW + 40_000, kind: String = "dm", video: String = "0", caller: String = "Minh") = expo(
    "type" to "call_invite",
    "call_id" to "c-1",
    "room_id" to "r-1",
    "workspace_id" to "w-1",
    "caller_name" to caller,
    "room_name" to "Kho",
    "call_kind" to kind,
    "video" to video,
    "expires_at" to expiresAt.toString(),
    "url" to url
  )

  private fun handle(message: Map<String, String>, inFront: Boolean = false) = NativeCallPush.handle(app, message, NOW, inFront)

  private fun posted(): List<Notification> = shadowOf(manager).allNotifications

  private fun text(notification: Notification, key: String): String = notification.extras.getCharSequence(key).toString()

  @Test
  fun aRingToAClosedAppIsTheIncomingCallNotificationInTheAppsWordsWithNoJavaScript() {
    configure()
    assertEquals(NativeCallPush.Outcome.RANG, handle(invite()))
    val notification = posted().single()
    assertEquals(CallNotifications.CHANNEL_CALLS, notification.channelId)
    assertEquals("Minh", text(notification, Notification.EXTRA_TITLE))
    assertEquals("Cuộc gọi thoại đến", text(notification, Notification.EXTRA_TEXT))
    assertEquals(40_000L, notification.timeoutAfter)
    // The same custom-scheme link JavaScript builds (lib/call-push.ts › appLink): the ringing screen, never an answer.
    assertEquals("uniworkchat://open?url=" + Uri.encode(url), shadowOf(notification.contentIntent).savedIntent.data.toString())
    // Counted when JavaScript next runs: rung natively, 20 s after the server rang (expires_at less the 60 s window).
    assertEquals(listOf(mapOf<String, Any>("result" to "native", "latencyMs" to 20_000.0)), RingReports.take(app))
  }

  @Test
  fun aGroupOrVideoRingSaysSoAndAnUnnamedCallerHasAName() {
    configure()
    handle(invite(kind = "group", caller = ""))
    val group = posted().single()
    assertEquals("Người gọi", text(group, Notification.EXTRA_TITLE))
    assertEquals("Cuộc gọi nhóm · Kho", text(group, Notification.EXTRA_TEXT))
    NativeCallPush.clearRing(app, "c-1")
    handle(invite(video = "1"))
    assertEquals("Cuộc gọi video đến", text(posted().single(), Notification.EXTRA_TEXT))
  }

  @Test
  fun theEndOfARingTakesItDownAndIsNotPassedOn() {
    configure()
    handle(invite())
    RingReports.take(app)
    val end = handle(expo("type" to "call_end", "call_id" to "c-1", "room_id" to "r-1"))
    assertEquals(NativeCallPush.Outcome.CLEARED, end)
    assertTrue(posted().isEmpty())
    assertEquals(listOf(mapOf<String, Any>("result" to "cleared", "latencyMs" to -1.0)), RingReports.take(app))
  }

  @Test
  fun aMissedCallTakesTheRingDownButStillGoesOnToBeShown() {
    configure()
    handle(invite())
    assertEquals(NativeCallPush.Outcome.DEFER, handle(expo("type" to "call_missed", "call_id" to "c-1", "room_id" to "r-1", "url" to url)))
    assertTrue(posted().isEmpty())
  }

  @Test
  fun whatJavaScriptMustDecideIsPassedOn() {
    // No ring config yet (JavaScript never ran on this install): the JavaScript path, as before.
    assertEquals(NativeCallPush.Outcome.DEFER, handle(invite()))
    configure()
    // UniChat on screen: its call engine knows whether this call already rings there, or another is under way.
    assertEquals(NativeCallPush.Outcome.DEFER, handle(invite(), inFront = true))
    assertTrue(posted().isEmpty())
    assertTrue(RingReports.take(app).isEmpty())
  }

  @Test
  fun aRingWhileTheEngineHoldsACallIsJavaScriptsToAnswerBusyEvenWithTheAppBehind() {
    configure()
    // An outgoing 1-1 call still ringing, the person gone to Home: no call service yet, the app not in front.
    CallEngineLive.live = true
    assertEquals(NativeCallPush.Outcome.DEFER, handle(invite()))
    assertTrue(posted().isEmpty())
    assertTrue(RingReports.take(app).isEmpty())
    // The engine idle again: the next ring is the native one.
    CallEngineLive.live = false
    assertEquals(NativeCallPush.Outcome.RANG, handle(invite()))
  }

  @Test
  fun aSwitchedOffOrLateRingRingsNothing() {
    configure(enabled = false)
    assertEquals(NativeCallPush.Outcome.IGNORED, handle(invite()))
    configure()
    assertEquals(NativeCallPush.Outcome.IGNORED, handle(invite(expiresAt = NOW - 1)))
    assertTrue(posted().isEmpty())
    assertEquals(listOf("ignored", "ignored"), RingReports.take(app).map { it["result"] })
  }

  @Test
  fun anythingElseIsNotACallPush() {
    configure()
    val chat = expo("type" to "chat_message", "room_id" to "r-1", "message_id" to "m-1")
    assertEquals(NativeCallPush.Outcome.NOT_A_CALL, handle(chat))
    assertEquals(NativeCallPush.Outcome.NOT_A_CALL, handle(mapOf("title" to "Minh", "message" to "Chào", "body" to "not json")))
    assertEquals(NativeCallPush.Outcome.NOT_A_CALL, handle(expo("type" to "call_invite", "room_id" to "r-1")))
    assertTrue(posted().isEmpty())
  }

  @Test
  fun aDirectFcmDataMapIsReadAsWellAsExposBody() {
    val direct = NativeCallPush.parse(mapOf("type" to "call_end", "call_id" to "c-9", "room_id" to "r-9"))
    assertEquals("c-9", direct?.callId)
    val push = NativeCallPush.parse(invite(expiresAt = 0, kind = "channel"))
    assertEquals("channel", push?.callKind)
    assertEquals(NativeCallPush.RING_WINDOW_MS, push?.ringRemainingMs(NOW))
    assertEquals(-1L, push?.ringLatencyMs(NOW))
    assertNull(NativeCallPush.parse(expo("type" to "call_invite", "call_id" to "c-1")))
  }

  @Test
  fun aRingConfigMissingAWordIsNotUsed() {
    RingConfig.write(app, RingConfig().apply { enabled = true; scheme = "uniworkchat" })
    assertEquals(NativeCallPush.Outcome.DEFER, handle(invite()))
    assertTrue(posted().isEmpty())
  }

  private companion object {
    const val NOW = 1_700_000_000_000L
  }
}
