package expo.modules.unichatcalls

import android.os.Bundle
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** The two call channels' names, in the app's language (lib/notification-channels.ts). */
class ChannelNames : Record {
  @Field
  var calls: String = "Calls"

  @Field
  var callsDescription: String = ""

  @Field
  var ongoing: String = "Ongoing call"

  @Field
  var ongoingDescription: String = ""
}

/** A call ringing for this person (data/calls/call-push.ts › incomingCallSpec). */
class IncomingCall : Record {
  @Field
  var callId: String = ""

  @Field
  var roomId: String = ""

  @Field
  var workspaceId: String = ""

  @Field
  var callerName: String = ""

  /** dm, group or channel: Decline tells the server only for a DM (a group call goes on without us). */
  @Field
  var callKind: String = "dm"

  @Field
  var text: String = ""

  @Field
  var video: Boolean = false

  /** The app link a tap, the full-screen intent and Answer open: the ringing screen (Answer's carries CallLaunchTokens.EXTRA_ANSWER). */
  @Field
  var openUrl: String = ""

  /** How much longer the call may ring; the notification goes away then. */
  @Field
  var timeoutMs: Double = 45_000.0

  /** The buttons' words where the system's CallStyle cannot be used. */
  @Field
  var answerLabel: String = "Answer"

  @Field
  var declineLabel: String = "Decline"
}

/** The call this phone is in, for the foreground service's notification. */
class OngoingCall : Record {
  @Field
  var callId: String = ""

  @Field
  var roomId: String = ""

  @Field
  var workspaceId: String = ""

  @Field
  var peerName: String = ""

  @Field
  var text: String = ""

  @Field
  var video: Boolean = false

  /** When the call connected, Unix milliseconds; 0 while it is still connecting. */
  @Field
  var startedAt: Double = 0.0

  fun toBundle(): Bundle = Bundle().apply {
    putString(EXTRA_CALL_ID, callId)
    putString(EXTRA_ROOM_ID, roomId)
    putString(EXTRA_WORKSPACE_ID, workspaceId)
    putString(EXTRA_PEER_NAME, peerName)
    putString(EXTRA_TEXT, text)
    putBoolean(EXTRA_VIDEO, video)
    putLong(EXTRA_STARTED_AT, startedAt.toLong())
  }
}

internal const val EXTRA_CALL_ID = "callId"
internal const val EXTRA_ROOM_ID = "roomId"
internal const val EXTRA_WORKSPACE_ID = "workspaceId"
internal const val EXTRA_CALL_KIND = "callKind"
internal const val EXTRA_PEER_NAME = "peerName"
internal const val EXTRA_TEXT = "text"
internal const val EXTRA_VIDEO = "video"
internal const val EXTRA_STARTED_AT = "startedAt"
internal const val EXTRA_ACTION = "action"
internal const val EXTRA_AT = "at"
