package expo.modules.unichatcalls

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the "UniChatCallAction" JavaScript task (registered by
 * data/calls/background.ts) for a Decline or Hang up tapped on a
 * notification: in the running app when there is one, else in a headless
 * React instance that reads the stored session and tells the server.
 */
class CallActionTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    // Allowed in the foreground: Hang up on the ongoing notification while the app is open.
    return HeadlessJsTaskConfig(TASK_KEY, Arguments.fromBundle(extras), TIMEOUT_MS, true)
  }

  companion object {
    const val TASK_KEY = "UniChatCallAction"
    private const val TIMEOUT_MS = 20_000L
    private const val TAG = "UniChatCalls"

    fun start(context: Context, data: Bundle): Boolean = try {
      val started = context.startService(Intent(context, CallActionTaskService::class.java).putExtras(data))
      if (started != null) HeadlessJsTaskService.acquireWakeLockNow(context)
      started != null
    } catch (e: RuntimeException) {
      // Background start not allowed (IllegalStateException) and the like.
      Log.w(TAG, "could not start the call action task", e)
      false
    }
  }
}
