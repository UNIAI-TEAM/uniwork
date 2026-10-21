package expo.modules.unichatcalls

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat

/**
 * The two call notifications. Incoming: CallStyle.forIncomingCall on the
 * high-importance "calls" channel, whose sound is the phone's ringtone with
 * the ringtone's audio attributes (so the ringer switch and Do Not Disturb
 * decide, not the media volume), looping (FLAG_INSISTENT) until answered,
 * declined or timed out, with a full-screen intent for a locked phone.
 * Ongoing: CallStyle.forOngoingCall for the foreground service, with a
 * chronometer and Hang up.
 */
internal object CallNotifications {
  const val CHANNEL_CALLS = "calls"
  const val CHANNEL_ONGOING = "call_ongoing"
  private const val TAG_INCOMING = "unichat_call_incoming"
  const val ONGOING_ID = 0x0C411
  private const val TAG = "UniChatCalls"
  private val VIBRATION = longArrayOf(0, 1000, 1000)

  private val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  /** Creates (or renames) both channels. A channel's sound and importance are fixed once created. */
  fun ensureChannels(context: Context, names: ChannelNames) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    val ringtoneAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val calls = NotificationChannel(CHANNEL_CALLS, names.calls, NotificationManager.IMPORTANCE_HIGH).apply {
      description = names.callsDescription
      setSound(ringtone, ringtoneAttributes)
      enableVibration(true)
      vibrationPattern = VIBRATION
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    val ongoing = NotificationChannel(CHANNEL_ONGOING, names.ongoing, NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = names.ongoingDescription
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannels(listOf(calls, ongoing))
  }

  private fun ensureChannelsExist(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_CALLS) == null || manager.getNotificationChannel(CHANNEL_ONGOING) == null) {
      ensureChannels(context, ChannelNames())
    }
  }

  fun canPost(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  /** Android 14+: whether this app may still show a full-screen ringing screen (Settings › Special app access). */
  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
    return context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() ?: false
  }

  fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  private fun notificationId(callId: String): Int = callId.hashCode()

  /** An app link to open in the app's own activity, marked as a call launch (CallLockScreen). */
  private fun linkIntent(context: Context, url: String, callId: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(CallLockScreen.EXTRA_CALL_LAUNCH, callId)
    }

  private fun launchIntent(context: Context): Intent? =
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }

  fun showIncoming(context: Context, call: IncomingCall): Boolean {
    if (call.callId.isEmpty() || call.openUrl.isEmpty() || !canPost(context)) return false
    ensureChannelsExist(context)
    val person = Person.Builder().setName(call.callerName).setImportant(true).build()
    val requestCode = notificationId(call.callId)
    val open = PendingIntent.getActivity(context, requestCode, linkIntent(context, call.openUrl, call.callId), pendingFlags)
    val answer = PendingIntent.getActivity(
      context,
      requestCode + 1,
      linkIntent(context, call.answerUrl.ifEmpty { call.openUrl }, call.callId),
      pendingFlags
    )
    val decline = CallActionReceiver.pendingIntent(context, CallActionReceiver.ACTION_DECLINE, call.callId, call.roomId, call.workspaceId, call.callKind)
    val builder = NotificationCompat.Builder(context, CHANNEL_CALLS)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(call.callerName)
      .setContentText(call.text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setVibrate(VIBRATION)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setTimeoutAfter(call.timeoutMs.toLong().coerceAtLeast(1_000L))
      .addPerson(person)
    return try {
      post(context, requestCode, builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer).setIsVideo(call.video)).build())
      true
    } catch (e: IllegalArgumentException) {
      // A CallStyle the system refuses (no usable full-screen intent on some
      // builds): the same notification with plain Decline / Answer actions.
      Log.w(TAG, "CallStyle refused, posting a plain call notification", e)
      postPlain(context, requestCode, builder, call, decline, answer)
    } catch (e: SecurityException) {
      Log.w(TAG, "incoming call notification not allowed", e)
      false
    }
  }

  private fun post(context: Context, id: Int, notification: Notification) {
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    NotificationManagerCompat.from(context).notify(TAG_INCOMING, id, notification)
  }

  private fun postPlain(
    context: Context,
    id: Int,
    builder: NotificationCompat.Builder,
    call: IncomingCall,
    decline: PendingIntent,
    answer: PendingIntent
  ): Boolean = try {
    builder.setStyle(null)
      .addAction(0, call.declineLabel, decline)
      .addAction(0, call.answerLabel, answer)
    post(context, id, builder.build())
    true
  } catch (e: RuntimeException) {
    Log.w(TAG, "incoming call notification failed", e)
    false
  }

  fun cancelIncoming(context: Context, callId: String) {
    if (callId.isEmpty()) return
    NotificationManagerCompat.from(context).cancel(TAG_INCOMING, notificationId(callId))
  }

  /** The foreground service's notification: who, how long, and Hang up. */
  fun ongoing(context: Context, extras: Bundle): Notification {
    val callId = extras.getString(EXTRA_CALL_ID).orEmpty()
    val peerName = extras.getString(EXTRA_PEER_NAME).orEmpty()
    val startedAt = extras.getLong(EXTRA_STARTED_AT)
    val person = Person.Builder().setName(peerName).setImportant(true).build()
    val hangUp = CallActionReceiver.pendingIntent(
      context,
      CallActionReceiver.ACTION_HANGUP,
      callId,
      extras.getString(EXTRA_ROOM_ID).orEmpty(),
      extras.getString(EXTRA_WORKSPACE_ID).orEmpty(),
      ""
    )
    val builder = NotificationCompat.Builder(context, CHANNEL_ONGOING)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(peerName)
      .setContentText(extras.getString(EXTRA_TEXT).orEmpty())
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    if (startedAt > 0) builder.setWhen(startedAt).setShowWhen(true).setUsesChronometer(true)
    launchIntent(context)?.let { builder.setContentIntent(PendingIntent.getActivity(context, ONGOING_ID, it, pendingFlags)) }
    return try {
      builder.setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp).setIsVideo(extras.getBoolean(EXTRA_VIDEO))).build()
    } catch (e: IllegalArgumentException) {
      Log.w(TAG, "CallStyle refused for the ongoing call", e)
      builder.setStyle(null).build()
    }
  }
}
