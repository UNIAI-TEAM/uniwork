package expo.modules.unichatcalls

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
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
 * Decline and Hang up from a notification (review P2: no test): the ring stops and the incoming
 * notification goes at once, the JavaScript task is started with the call, and when Android refuses
 * to start it (a background start) the action waits in PendingActions instead of being lost.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallActionReceiverTest {
  private lateinit var app: Application

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    PendingActions.take(app)
  }

  /** The broadcast a notification button sends, as CallActionReceiver.pendingIntent builds it. */
  private fun broadcast(action: String, callId: String = "call-1"): Intent =
    shadowOf(CallActionReceiver.pendingIntent(app, action, callId, "room-1", "ws-1", "dm")).savedIntent

  /** A context on which Android refuses to start a service, as for an app in the background. */
  private val refusing: Context by lazy {
    object : ContextWrapper(app) {
      override fun startService(service: Intent?): ComponentName? = throw IllegalStateException("Not allowed to start service: app is in background")
    }
  }

  @Test
  fun declineRemovesTheRingAndStartsTheTaskWithTheCall() {
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
    val manager = app.getSystemService(NotificationManager::class.java)
    assertEquals(1, shadowOf(manager).allNotifications.size)

    CallActionReceiver().onReceive(app, broadcast(CallActionReceiver.ACTION_DECLINE))

    assertTrue("the ring is gone at once", shadowOf(manager).allNotifications.isEmpty())
    val task = shadowOf(app).nextStartedService
    assertEquals(ComponentName(app, CallActionTaskService::class.java), task?.component)
    assertEquals("decline", task?.getStringExtra(EXTRA_ACTION))
    assertEquals("call-1", task?.getStringExtra(EXTRA_CALL_ID))
    assertEquals("room-1", task?.getStringExtra(EXTRA_ROOM_ID))
    assertEquals("ws-1", task?.getStringExtra(EXTRA_WORKSPACE_ID))
    assertEquals("dm", task?.getStringExtra(EXTRA_CALL_KIND))
    assertTrue("nothing waits when the task started", PendingActions.take(app).isEmpty())
  }

  @Test
  fun aTaskAndroidRefusesToStartWaitsInPendingActions() {
    CallActionReceiver().onReceive(refusing, broadcast(CallActionReceiver.ACTION_HANGUP))
    val pending = PendingActions.take(app).single()
    assertEquals("hangup", pending[EXTRA_ACTION])
    assertEquals("call-1", pending[EXTRA_CALL_ID])
    assertEquals("room-1", pending[EXTRA_ROOM_ID])
    assertEquals("ws-1", pending[EXTRA_WORKSPACE_ID])
    assertTrue((pending[EXTRA_AT] as Double) > 0.0)
  }

  @Test
  fun anotherActionOrNoCallDoesNothing() {
    CallActionReceiver().onReceive(app, Intent("expo.modules.unichatcalls.SOMETHING").putExtra(EXTRA_CALL_ID, "call-1"))
    CallActionReceiver().onReceive(app, Intent(CallActionReceiver.ACTION_HANGUP))
    assertNull(shadowOf(app).nextStartedService)
    assertTrue(PendingActions.take(app).isEmpty())
  }
}
