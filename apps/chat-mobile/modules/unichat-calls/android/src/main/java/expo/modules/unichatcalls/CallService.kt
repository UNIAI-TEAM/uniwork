package expo.modules.unichatcalls

import android.Manifest
import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * The foreground service a call runs under (audit P0-5): without it Android
 * mutes the microphone of a backgrounded app and may kill the process when
 * the screen locks. Types: phoneCall always (MANAGE_OWN_CALLS makes it
 * startable), microphone once RECORD_AUDIO is granted, camera for a video
 * call once CAMERA is granted.
 *
 * Started once, from the app in front (the call screen). Every later update
 * (connecting → active, LiveKit holding the microphone) goes to the running
 * service directly, never through startForegroundService again, so it needs
 * no foreground-start exemption when the app is in the background by then.
 * An update never stops a running call's service: a type Android refuses now
 * (Android 14: microphone or camera while the app is not in use) keeps the
 * types already applied, and at worst only the notification changes.
 */
class CallService : Service() {
  /** The types the service runs with now; NOT_FOREGROUND until startForeground succeeded. */
  private var appliedTypes = NOT_FOREGROUND

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = this
  }

  override fun onDestroy() {
    if (running === this) running = null
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val extras = intent?.extras
    if (extras == null && appliedTypes == NOT_FOREGROUND) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (extras != null) update(extras)
    return START_NOT_STICKY
  }

  /** Applies the call's notification and types; true when the service is (still) in the foreground. */
  @Synchronized
  internal fun update(extras: Bundle): Boolean {
    val notification = CallNotifications.ongoing(this, extras)
    val wanted = serviceTypes(this, extras.getBoolean(EXTRA_VIDEO))
    if (tryForeground(notification, wanted)) return true
    if (appliedTypes != NOT_FOREGROUND) {
      // Already in the foreground: keep its types, show the new notification.
      if (appliedTypes != wanted && tryForeground(notification, appliedTypes)) return true
      postNotification(notification)
      return true
    }
    // First start: phoneCall alone needs no while-in-use permission.
    val phoneOnly = phoneCallType()
    if (phoneOnly != wanted && tryForeground(notification, phoneOnly)) return true
    // Nothing Android accepts: the call goes on without the service.
    Log.w(TAG, "the call's foreground service could not start")
    stopSelf()
    return false
  }

  private fun tryForeground(notification: Notification, types: Int): Boolean = try {
    ServiceCompat.startForeground(this, CallNotifications.ONGOING_ID, notification, types)
    appliedTypes = types
    true
  } catch (e: RuntimeException) {
    // ForegroundServiceStartNotAllowedException, a SecurityException for a type not eligible now.
    Log.w(TAG, "startForeground refused for types $types", e)
    false
  }

  private fun postNotification(notification: Notification) {
    try {
      NotificationManagerCompat.from(this).notify(CallNotifications.ONGOING_ID, notification)
    } catch (e: SecurityException) {
      Log.w(TAG, "could not update the ongoing call notification", e)
    }
  }

  companion object {
    private const val TAG = "UniChatCalls"
    private const val NOT_FOREGROUND = -1

    /** The service of the call under way, if any: updates go straight to it. */
    @Volatile
    private var running: CallService? = null

    private fun granted(context: Context, permission: String): Boolean =
      ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun phoneCallType(): Int =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL else 0

    internal fun serviceTypes(context: Context, video: Boolean): Int {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
      var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        if (granted(context, Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (video && granted(context, Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
      return types
    }

    fun start(context: Context, call: OngoingCall): Boolean {
      running?.let { return it.update(call.toBundle()) }
      return try {
        ContextCompat.startForegroundService(context, Intent(context, CallService::class.java).putExtras(call.toBundle()))
        true
      } catch (e: RuntimeException) {
        // ForegroundServiceStartNotAllowedException: the app is not in front.
        Log.w(TAG, "could not start the call's foreground service", e)
        false
      }
    }

    /** A call's service is running: the call is under way (CallLockScreen's watchdog keeps the lock screen for it). */
    fun isRunning(): Boolean = running != null

    fun stop(context: Context) {
      // Forgotten now, not at onDestroy: the next call's start must not update a service on its way out.
      running = null
      // The screen turns off near the ear only during a call.
      CallProximity.set(context, false)
      context.stopService(Intent(context, CallService::class.java))
    }
  }
}
