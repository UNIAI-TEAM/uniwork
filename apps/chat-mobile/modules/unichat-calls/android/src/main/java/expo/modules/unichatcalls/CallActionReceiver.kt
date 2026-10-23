package expo.modules.unichatcalls

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * Decline (on the incoming-call notification) and Hang up (on the ongoing
 * one). The ringing stops here at once; the server is told by JavaScript,
 * which holds the session: CallActionTaskService runs the "UniChatCallAction"
 * task (data/calls/call-actions.ts) in the running app or a headless one. If
 * Android refuses to start it, the action waits in PendingActions for the
 * next launch.
 */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = when (intent.action) {
      ACTION_DECLINE -> "decline"
      ACTION_HANGUP -> "hangup"
      else -> return
    }
    val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return
    CallRinger.stop()
    if (action == "decline") CallNotifications.cancelIncoming(context, callId)
    val data = Bundle().apply {
      putString(EXTRA_ACTION, action)
      putString(EXTRA_CALL_ID, callId)
      putString(EXTRA_ROOM_ID, intent.getStringExtra(EXTRA_ROOM_ID).orEmpty())
      putString(EXTRA_WORKSPACE_ID, intent.getStringExtra(EXTRA_WORKSPACE_ID).orEmpty())
      putString(EXTRA_CALL_KIND, intent.getStringExtra(EXTRA_CALL_KIND).orEmpty())
      putDouble(EXTRA_AT, System.currentTimeMillis().toDouble())
    }
    if (!CallActionTaskService.start(context, data)) PendingActions.add(context, data)
  }

  companion object {
    const val ACTION_DECLINE = "expo.modules.unichatcalls.DECLINE"
    const val ACTION_HANGUP = "expo.modules.unichatcalls.HANGUP"

    fun pendingIntent(context: Context, action: String, callId: String, roomId: String, workspaceId: String, callKind: String): PendingIntent {
      val intent = Intent(context, CallActionReceiver::class.java).apply {
        setAction(action)
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_ROOM_ID, roomId)
        putExtra(EXTRA_WORKSPACE_ID, workspaceId)
        putExtra(EXTRA_CALL_KIND, callKind)
      }
      return PendingIntent.getBroadcast(
        context,
        (action + callId).hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
  }
}
