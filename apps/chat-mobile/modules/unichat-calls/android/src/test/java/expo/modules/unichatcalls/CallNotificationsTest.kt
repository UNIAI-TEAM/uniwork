package expo.modules.unichatcalls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.media.AudioManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The incoming-call and ongoing-call notifications as the system receives them: a ringing
 * CallStyle notification that keeps ringing (FLAG_INSISTENT), shows over the lock screen through
 * its full-screen intent, and whose intents carry the ring's launch token; and the ongoing call's
 * chronometer and Hang up. What only a phone shows (the ringtone, the full-screen activity, OEM
 * skins) is the release runbook's device checklist.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallNotificationsTest {
  private lateinit var app: Application
  private lateinit var manager: NotificationManager

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    manager = app.getSystemService(NotificationManager::class.java)
  }

  private fun incoming(id: String = "call-1"): IncomingCall = IncomingCall().apply {
    callId = id
    roomId = "room-1"
    workspaceId = "ws-1"
    callerName = "An Nguyen"
    text = "Incoming voice call"
    openUrl = "uniworkchat://o/w/chat?room=room-1&call=$id"
    timeoutMs = 45_000.0
  }

  private fun posted(): Notification = shadowOf(manager).allNotifications.single()

  private fun savedIntent(pending: PendingIntent?): Intent {
    assertNotNull(pending)
    return shadowOf(pending).savedIntent
  }

  /** Answer's PendingIntent: CallStyle keeps it in the extras; the plain fallback has it as the last action. */
  @Suppress("DEPRECATION")
  private fun answerIntent(notification: Notification): Intent = savedIntent(
    notification.extras.getParcelable(Notification.EXTRA_ANSWER_INTENT) ?: notification.actions?.lastOrNull()?.actionIntent
  )

  @Test
  fun aRingPostsOneInsistentCallNotificationThatCanShowOverTheLockScreen() {
    assertTrue(CallNotifications.showIncoming(app, incoming()))
    val notification = posted()
    assertEquals(Notification.CATEGORY_CALL, notification.category)
    assertEquals(CallNotifications.CHANNEL_CALLS, notification.channelId)
    assertTrue("rings until answered, declined or timed out", notification.flags and Notification.FLAG_INSISTENT != 0)
    assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertNotNull("the full-screen intent", notification.fullScreenIntent)
    assertEquals(45_000L, notification.timeoutAfter)
    assertEquals(Notification.VISIBILITY_PUBLIC, notification.visibility)
    // The system's call template, not the plain fallback with two actions.
    assertEquals(Notification.CallStyle::class.java.name, notification.extras.getString(Notification.EXTRA_TEMPLATE))
  }

  @Test
  fun itsTapAndFullScreenIntentsVouchForTheCallAndOnlyAnswerAnswers() {
    CallNotifications.showIncoming(app, incoming())
    val notification = posted()
    val open = savedIntent(notification.fullScreenIntent)
    assertEquals(app.packageName, open.`package`)
    assertEquals("call-1", CallLaunchTokens.verifiedCall(app, open))
    assertFalse(open.getBooleanExtra(CallLaunchTokens.EXTRA_ANSWER, false))
    assertEquals("call-1", CallLaunchTokens.verifiedCall(app, savedIntent(notification.contentIntent)))

    val answer = answerIntent(notification)
    assertTrue(answer.getBooleanExtra(CallLaunchTokens.EXTRA_ANSWER, false))
    // The same ringing link as a tap: what answers is the token-checked extra, never the URL.
    assertEquals(open.data, answer.data)
    CallLaunchTokens.recordAnswer(app, answer, System.currentTimeMillis())
    assertTrue(CallLaunchTokens.takeAnswered(app, "call-1", System.currentTimeMillis()))
  }

  @Test
  fun duringAnotherCallTheRingIsCallWaitingThatAlertsOnceAndNeverLoops() {
    val audio = app.getSystemService(AudioManager::class.java)
    audio.mode = AudioManager.MODE_IN_CALL
    try {
      assertTrue(CallNotifications.showIncoming(app, incoming()))
      val notification = posted()
      // Still the call, heads-up with Answer and Decline and its full-screen intent, but no ringtone loop over the
      // call under way.
      assertEquals(Notification.CATEGORY_CALL, notification.category)
      assertEquals(0, notification.flags and Notification.FLAG_INSISTENT)
      assertNotNull(notification.fullScreenIntent)
    } finally {
      audio.mode = AudioManager.MODE_NORMAL
    }
  }

  @Test
  fun cancellingTheRingRemovesItAndItsIntentsStopVouching() {
    CallNotifications.showIncoming(app, incoming())
    val open = savedIntent(posted().fullScreenIntent)
    CallNotifications.cancelIncoming(app, "call-1")
    assertTrue(shadowOf(manager).allNotifications.isEmpty())
    assertNull(CallLaunchTokens.verifiedCall(app, open))
  }

  @Test
  fun noCallIdNoLinkOrNoPermissionPostsNothing() {
    assertFalse(CallNotifications.showIncoming(app, incoming().apply { callId = "" }))
    assertFalse(CallNotifications.showIncoming(app, incoming().apply { openUrl = "" }))
    shadowOf(app).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
    assertFalse(CallNotifications.showIncoming(app, incoming()))
    assertTrue(shadowOf(manager).allNotifications.isEmpty())
  }

  @Test
  fun aRingCreatesBothChannelsWhenTheAppHasNotYet() {
    CallNotifications.showIncoming(app, incoming())
    val calls = manager.getNotificationChannel(CallNotifications.CHANNEL_CALLS)
    assertEquals(NotificationManager.IMPORTANCE_HIGH, calls.importance)
    assertNotNull(manager.getNotificationChannel(CallNotifications.CHANNEL_ONGOING))
  }

  @Test
  fun theOngoingCallShowsHowLongItHasRunAndHangUp() {
    val call = OngoingCall().apply {
      callId = "call-1"
      roomId = "room-1"
      workspaceId = "ws-1"
      peerName = "An Nguyen"
      text = "Ongoing call"
      startedAt = 1_700_000_000_000.0
    }
    val notification = CallNotifications.ongoing(app, call.toBundle())
    assertEquals(CallNotifications.CHANNEL_ONGOING, notification.channelId)
    assertEquals(Notification.CallStyle::class.java.name, notification.extras.getString(Notification.EXTRA_TEMPLATE))
    assertEquals(Notification.CATEGORY_CALL, notification.category)
    assertEquals(1_700_000_000_000L, notification.`when`)
    assertTrue(notification.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
    @Suppress("DEPRECATION")
    val hangUp = savedIntent(
      notification.extras.getParcelable(Notification.EXTRA_HANG_UP_INTENT) ?: notification.actions?.lastOrNull()?.actionIntent
    )
    assertEquals(CallActionReceiver.ACTION_HANGUP, hangUp.action)
    assertEquals("call-1", hangUp.getStringExtra(EXTRA_CALL_ID))
    assertEquals("room-1", hangUp.getStringExtra(EXTRA_ROOM_ID))
  }

  @Test
  fun aCallStillConnectingHasNoChronometer() {
    val notification = CallNotifications.ongoing(app, OngoingCall().apply { callId = "call-1" }.toBundle())
    assertFalse(notification.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
  }

  // Audit "native-channel-fallback-english": a ring before JavaScript has run once creates the channels from the
  // module's string resources (generated by scripts/sync-i18n.mjs), in the phone's language, not hardcoded English.
  @Test
  fun channelsCreatedBeforeJavaScriptAreNamedInEnglishByDefault() {
    assertTrue(CallNotifications.showIncoming(app, incoming()))
    assertEquals("Incoming calls", manager.getNotificationChannel(CallNotifications.CHANNEL_CALLS).name)
    assertEquals("Ongoing call", manager.getNotificationChannel(CallNotifications.CHANNEL_ONGOING).name)
  }

  @Test
  @Config(qualifiers = "vi")
  fun channelsCreatedBeforeJavaScriptAreNamedInVietnameseOnAVietnamesePhone() {
    assertTrue(CallNotifications.showIncoming(app, incoming()))
    assertEquals("Cuộc gọi đến", manager.getNotificationChannel(CallNotifications.CHANNEL_CALLS).name)
    assertEquals("Cuộc gọi đang diễn ra", manager.getNotificationChannel(CallNotifications.CHANNEL_ONGOING).name)
  }
}
