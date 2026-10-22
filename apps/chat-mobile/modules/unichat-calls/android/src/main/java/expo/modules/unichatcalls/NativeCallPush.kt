package expo.modules.unichatcalls

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import org.json.JSONException
import org.json.JSONObject

/** A call push as the server sends it (server notification/push_expo.go › callData); every value is a string. */
data class CallPushData(
  val type: String,
  val callId: String,
  val roomId: String,
  val workspaceId: String,
  val callerName: String,
  val roomName: String,
  /** dm, group or channel */
  val callKind: String,
  val video: Boolean,
  /** Unix milliseconds the ring stops; 0 when the push did not say. */
  val expiresAt: Long,
  val url: String
) {
  /** How much longer the ring may last, at most the ring window; 0 once it is over (lib/call-push.ts › ringRemainingMs). */
  fun ringRemainingMs(now: Long): Long {
    if (expiresAt <= 0) return NativeCallPush.RING_WINDOW_MS
    return (expiresAt - now).coerceIn(0L, NativeCallPush.RING_WINDOW_MS)
  }

  /** From the server's ring to now (expires_at less the window), or -1 when the push carries no end; clock skew included. */
  fun ringLatencyMs(now: Long): Long = if (expiresAt <= 0) -1 else now - (expiresAt - NativeCallPush.RING_WINDOW_MS)
}

/**
 * A call push handled where it lands, before any JavaScript (review "Calls, push & background",
 * killed-app-ring-js-dependent): UniChatMessagingService hands every FCM message here first. A ring for a closed
 * or backgrounded app becomes the incoming-call notification at once — no Hermes runtime, bundle or session to
 * load first — and the end of a ring takes it down. JavaScript keeps what needs it: a ring while UniChat is on
 * screen or already in a call (the call engine decides in_app or busy), a ring before JavaScript ever wrote the
 * ring config (RingConfig), a ring the notification could not show (the plain fallback), and everything that is
 * not a call push. The same policy as apps/chat-mobile/data/calls/call-push.ts, which stays the path for those.
 */
internal object NativeCallPush {
  /** The server's callRingWindow (lib/call-push.ts › CALL_RING_WINDOW_MS). */
  const val RING_WINDOW_MS = 60_000L

  const val TYPE_INVITE = "call_invite"
  const val TYPE_END = "call_end"
  const val TYPE_MISSED = "call_missed"

  /** The plain ring JavaScript posts when the native one cannot show (call-wiring.ts › callFallback). */
  private const val FALLBACK_TAG_PREFIX = "call-ring:"

  /** expo-notifications posts every notification under its identifier as the tag, with id 0. */
  private const val EXPO_NOTIFICATION_ID = 0

  enum class Outcome(val forward: Boolean) {
    /** Not a call push: expo-notifications presents it and runs the JavaScript task, as before. */
    NOT_A_CALL(true),

    /** A call push JavaScript decides (the app on screen, a call under way, no ring config, a ring not shown). */
    DEFER(true),

    /** The incoming-call notification is up. */
    RANG(false),

    /** Calls switched off, or the ring is over: nothing rings. */
    IGNORED(false),

    /** The end of a ring: its notification is down. */
    CLEARED(false)
  }

  /** The server's data in an FCM message from Expo (a JSON string under "body"), or the message's own data map. */
  fun dataOf(message: Map<String, String>): Map<String, String>? {
    val body = message["body"]
    if (body != null) {
      try {
        val json = JSONObject(body)
        return json.keys().asSequence().associateWith { key -> json.optString(key) }
      } catch (e: JSONException) {
        // Not JSON: no call push in it.
      }
    }
    return if (message.containsKey("call_id") && message.containsKey("type")) message else null
  }

  fun parse(message: Map<String, String>): CallPushData? {
    val data = dataOf(message) ?: return null
    val type = data["type"].orEmpty()
    val callId = data["call_id"].orEmpty()
    val roomId = data["room_id"].orEmpty()
    if (callId.isEmpty() || roomId.isEmpty() || type !in setOf(TYPE_INVITE, TYPE_END, TYPE_MISSED)) return null
    val kind = data["call_kind"].orEmpty()
    return CallPushData(
      type = type,
      callId = callId,
      roomId = roomId,
      workspaceId = data["workspace_id"].orEmpty(),
      callerName = data["caller_name"].orEmpty(),
      roomName = data["room_name"].orEmpty(),
      callKind = if (kind == "group" || kind == "channel") kind else "dm",
      video = data["video"] == "1",
      expiresAt = data["expires_at"]?.toLongOrNull()?.takeIf { it > 0 } ?: 0L,
      url = data["url"].orEmpty()
    )
  }

  /**
   * What this phone does with an FCM message. [appInFront]: the app's activity is resumed (AppVisibility), so
   * JavaScript is running and its call engine has the say. [now] is Unix milliseconds.
   */
  fun handle(context: Context, message: Map<String, String>, now: Long, appInFront: Boolean): Outcome {
    val push = parse(message) ?: return Outcome.NOT_A_CALL
    when (push.type) {
      TYPE_END -> {
        clearRing(context, push.callId)
        RingReports.add(context, RingReports.RESULT_CLEARED, -1)
        return Outcome.CLEARED
      }
      // A missed call is a visible push expo-notifications presents: the ring goes, the push still shows.
      TYPE_MISSED -> {
        clearRing(context, push.callId)
        return Outcome.DEFER
      }
    }
    val config = RingConfig.read(context)?.takeIf { it.usable() } ?: return Outcome.DEFER
    val remaining = push.ringRemainingMs(now)
    if (!config.enabled || push.url.isEmpty() || remaining <= 0) {
      RingReports.add(context, RingReports.RESULT_IGNORED, -1)
      return Outcome.IGNORED
    }
    if (appInFront || CallService.isRunning()) return Outcome.DEFER
    if (!CallNotifications.showIncoming(context, config.incomingCall(push, remaining))) return Outcome.DEFER
    RingReports.add(context, RingReports.RESULT_NATIVE, push.ringLatencyMs(now))
    return Outcome.RANG
  }

  /** The native ring and the plain fallback JavaScript may have posted for it. */
  fun clearRing(context: Context, callId: String) {
    CallNotifications.cancelIncoming(context, callId)
    NotificationManagerCompat.from(context).cancel(FALLBACK_TAG_PREFIX + callId, EXPO_NOTIFICATION_ID)
  }
}
