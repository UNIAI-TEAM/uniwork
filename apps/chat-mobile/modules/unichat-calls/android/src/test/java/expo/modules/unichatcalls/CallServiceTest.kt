package expo.modules.unichatcalls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowService

/**
 * Android's answer to a typed startForeground, per type: Android 14 refuses microphone or camera
 * while the app is not in use (a SecurityException), which Robolectric's own shadow never does.
 * Every type in [refused] is refused; the rest behave as ShadowService does.
 */
@Implements(Service::class)
class ShadowRefusingService : ShadowService() {
  @Implementation(minSdk = Build.VERSION_CODES.Q)
  override fun startForeground(id: Int, notification: Notification, foregroundServiceType: Int) {
    if (foregroundServiceType and refused != 0) throw SecurityException("foreground service type $foregroundServiceType not allowed now")
    super.startForeground(id, notification, foregroundServiceType)
  }

  companion object {
    @JvmStatic
    var refused = 0
  }
}

/**
 * The call's foreground service (review P2: it had no test): the types it starts with, the types it
 * keeps when Android refuses one, that it gives up cleanly when Android refuses all, and that a call
 * starts it once — every later update goes to the running service, never through
 * startForegroundService again (which a backgrounded app may no longer call).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [ShadowRefusingService::class])
class CallServiceTest {
  private lateinit var app: Application
  private val controllers = mutableListOf<ServiceController<CallService>>()

  private val phone = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
  private val microphone = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
  private val camera = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    ShadowRefusingService.refused = 0
  }

  @After
  fun tearDown() {
    CallService.stop(app)
    controllers.forEach { it.destroy() }
    ShadowRefusingService.refused = 0
  }

  private fun call(peer: String = "An Nguyen", video: Boolean = false): OngoingCall = OngoingCall().apply {
    callId = "call-1"
    roomId = "room-1"
    workspaceId = "ws-1"
    peerName = peer
    text = "Ongoing call"
    this.video = video
  }

  /** The service as Android runs it after startForegroundService: created, then onStartCommand. */
  private fun started(call: OngoingCall?): CallService {
    val intent = Intent(app, CallService::class.java).apply { call?.let { putExtras(it.toBundle()) } }
    val controller = Robolectric.buildService(CallService::class.java, intent)
    controllers += controller
    return controller.create().startCommand(0, 1).get()
  }

  private fun nextStarted(): Intent? = shadowOf(app).nextStartedService

  @Test
  fun aVoiceCallStartsInTheForegroundAsAPhoneCall() {
    val service = started(call())
    assertEquals(phone, service.foregroundServiceType)
    assertEquals(CallNotifications.ONGOING_ID, shadowOf(service).lastForegroundNotificationId)
    assertEquals(CallNotifications.CHANNEL_ONGOING, shadowOf(service).lastForegroundNotification.channelId)
    assertFalse(shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun theMicrophoneAndTheCameraJoinOnceGranted() {
    shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
    assertEquals(phone or microphone, started(call()).foregroundServiceType)
    CallService.stop(app)
    shadowOf(app).grantPermissions(Manifest.permission.CAMERA)
    assertEquals(phone or microphone or camera, started(call(video = true)).foregroundServiceType)
  }

  @Test
  fun aFirstStartWithARefusedTypeFallsBackToPhoneCallAlone() {
    shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
    ShadowRefusingService.refused = microphone
    val service = started(call())
    assertEquals(phone, service.foregroundServiceType)
    assertFalse(shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun anUpdateWithARefusedTypeKeepsTheTypesAlreadyGrantedAndShowsTheNewNotification() {
    shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
    val service = started(call())
    assertEquals(phone or microphone, service.foregroundServiceType)
    val first = shadowOf(service).lastForegroundNotification
    // The call turns to video while the app is in the background: Android refuses the camera now.
    ShadowRefusingService.refused = camera
    assertTrue(service.update(call(peer = "Binh Tran", video = true).toBundle()))
    assertEquals("the running call keeps its microphone", phone or microphone, service.foregroundServiceType)
    assertNotSame(first, shadowOf(service).lastForegroundNotification)
    assertFalse(shadowOf(service).isForegroundStopped)
    assertFalse(shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun anUpdateAndroidRefusesEntirelyLeavesTheRunningCallInTheForegroundAndPostsTheNotification() {
    val service = started(call())
    val first = shadowOf(service).lastForegroundNotification
    ShadowRefusingService.refused = phone or microphone or camera
    assertTrue(service.update(call(peer = "Binh Tran").toBundle()))
    assertEquals(phone, service.foregroundServiceType)
    val manager = app.getSystemService(NotificationManager::class.java)
    val shown = shadowOf(manager).getNotification(CallNotifications.ONGOING_ID)
    assertNotNull(shown)
    assertNotSame("the new notification, posted directly", first, shown)
    assertFalse(shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun aFirstStartAndroidRefusesEntirelyStopsTheServiceAndTheCallGoesOnWithoutIt() {
    ShadowRefusingService.refused = phone
    val service = started(call())
    assertTrue(shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun aStartWithoutACallStopsAServiceThatIsNotInTheForeground() {
    val service = started(null)
    assertTrue(shadowOf(service).isStoppedBySelf)
  }

  @Test
  fun aCallStartsTheServiceOnceAndSendsEveryLaterUpdateToTheRunningOne() {
    assertTrue(CallService.start(app, call()))
    assertEquals(ComponentName(app, CallService::class.java), nextStarted()?.component)
    // Android creates it; from now on the service is running.
    val service = started(call())
    val before = shadowOf(service).lastForegroundNotification
    assertTrue(CallService.start(app, call(peer = "Binh Tran")))
    assertNull("no second startForegroundService", nextStarted())
    assertNotSame(before, shadowOf(service).lastForegroundNotification)
    // Hung up: the next call starts its own service.
    CallService.stop(app)
    assertTrue(CallService.start(app, call()))
    assertEquals(ComponentName(app, CallService::class.java), nextStarted()?.component)
  }
}
