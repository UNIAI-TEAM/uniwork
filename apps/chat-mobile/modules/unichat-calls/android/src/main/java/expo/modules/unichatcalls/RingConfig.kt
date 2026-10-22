package expo.modules.unichatcalls

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONException
import org.json.JSONObject

/**
 * What a ring needs that only JavaScript knows, kept on the phone so a call push can ring with no JavaScript
 * running (NativeCallPush): whether calls ring at all (the calls switch, a person signed in), the app's link
 * scheme, and the ring's words in the app's language. JavaScript writes it at launch and whenever one of them
 * changes (apps/chat-mobile/data/calls/native-ring.ts); until it has, a ring is left to JavaScript.
 */
class RingConfig : Record {
  /** The calls switch on and a person signed in; false makes the native path drop a ring. */
  @Field
  var enabled: Boolean = false

  /** The app's URL scheme (app.config.ts › scheme), which every build opens. */
  @Field
  var scheme: String = ""

  @Field
  var incomingVoice: String = ""

  @Field
  var incomingVideo: String = ""

  /** A group call's line, with "{room}" where the room's name goes. */
  @Field
  var incomingGroup: String = ""

  @Field
  var groupFallback: String = ""

  @Field
  var unknownCaller: String = ""

  @Field
  var answerLabel: String = ""

  @Field
  var declineLabel: String = ""

  fun toJson(): String = JSONObject()
    .put(KEY_ENABLED, enabled)
    .put(KEY_SCHEME, scheme)
    .put(KEY_VOICE, incomingVoice)
    .put(KEY_VIDEO, incomingVideo)
    .put(KEY_GROUP, incomingGroup)
    .put(KEY_GROUP_FALLBACK, groupFallback)
    .put(KEY_UNKNOWN, unknownCaller)
    .put(KEY_ANSWER, answerLabel)
    .put(KEY_DECLINE, declineLabel)
    .toString()

  /** Complete enough to ring with: a scheme for the links and every word of the notification. */
  fun usable(): Boolean = scheme.isNotEmpty() &&
    listOf(incomingVoice, incomingVideo, incomingGroup, groupFallback, unknownCaller, answerLabel, declineLabel).none { it.isEmpty() }

  /** The ringing notification for [push], ringing for [timeoutMs] more (CallPushData.ringRemainingMs). */
  fun incomingCall(push: CallPushData, timeoutMs: Long): IncomingCall {
    val config = this
    return IncomingCall().apply {
      callId = push.callId
      roomId = push.roomId
      workspaceId = push.workspaceId
      callerName = push.callerName.ifEmpty { config.unknownCaller }
      callKind = push.callKind
      text = when {
        push.callKind != "dm" -> config.incomingGroup.replace(ROOM_PLACEHOLDER, push.roomName.ifEmpty { config.groupFallback })
        push.video -> config.incomingVideo
        else -> config.incomingVoice
      }
      video = push.video
      openUrl = appLink(config.scheme, push.url)
      this.timeoutMs = timeoutMs.toDouble()
      answerLabel = config.answerLabel
      declineLabel = config.declineLabel
    }
  }

  companion object {
    const val ROOM_PLACEHOLDER = "{room}"
    private const val PREFS = "expo.modules.unichatcalls.ring"
    private const val KEY = "config"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_SCHEME = "scheme"
    private const val KEY_VOICE = "incomingVoice"
    private const val KEY_VIDEO = "incomingVideo"
    private const val KEY_GROUP = "incomingGroup"
    private const val KEY_GROUP_FALLBACK = "groupFallback"
    private const val KEY_UNKNOWN = "unknownCaller"
    private const val KEY_ANSWER = "answerLabel"
    private const val KEY_DECLINE = "declineLabel"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Kept with commit, not apply: the next push may start a process that reads it before a lazy write lands. */
    @Synchronized
    fun write(context: Context, config: RingConfig) {
      prefs(context).edit().putString(KEY, config.toJson()).commit()
    }

    /** The kept config, or null when JavaScript never wrote one (or wrote something unreadable). */
    @Synchronized
    fun read(context: Context): RingConfig? {
      val raw = prefs(context).getString(KEY, null) ?: return null
      return try {
        val json = JSONObject(raw)
        RingConfig().apply {
          enabled = json.optBoolean(KEY_ENABLED, false)
          scheme = json.optString(KEY_SCHEME)
          incomingVoice = json.optString(KEY_VOICE)
          incomingVideo = json.optString(KEY_VIDEO)
          incomingGroup = json.optString(KEY_GROUP)
          groupFallback = json.optString(KEY_GROUP_FALLBACK)
          unknownCaller = json.optString(KEY_UNKNOWN)
          answerLabel = json.optString(KEY_ANSWER)
          declineLabel = json.optString(KEY_DECLINE)
        }
      } catch (e: JSONException) {
        null
      }
    }

    /**
     * The custom-scheme wrapper every build opens (apps/chat-mobile/lib/call-push.ts › appLink): Uri.encode
     * leaves the same characters as JavaScript's encodeURIComponent unescaped.
     */
    fun appLink(scheme: String, webUrl: String): String = "$scheme://open?url=${Uri.encode(webUrl)}"
  }
}
