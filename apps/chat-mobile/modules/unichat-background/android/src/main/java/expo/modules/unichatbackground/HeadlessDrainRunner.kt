package expo.modules.unichatbackground

import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Runs the "UniChatOutboxDrain" JavaScript task in the app's React host, as React Native's HeadlessJsTaskService
 * does but without a Service (a background app may not start one): in the running app when there is one, else in a
 * React instance started here, which reads the stored session and queues itself (data/outbox-drain/drain-env.ts).
 * The task answers through UniChatBackgroundModule.drainFinished; one that ends without answering (React Native's
 * timeout, a bundle without the task) counts as still owed.
 */
object HeadlessDrainRunner : DrainRunner {
  private const val TAG = "UniChatBackground"

  /** Longer than the task's own budget (data/outbox-drain/drain.ts › DRAIN_BUDGET_MS, 120 s): it ends only a task that never answered. */
  const val TIMEOUT_MS = 150_000L

  override suspend fun run(context: Context, token: String): Boolean? {
    val answer = OutboxDrain.expect(token)
    try {
      val started = withContext(Dispatchers.Main) { start(context, token) }
      if (!started) return null
      return withTimeoutOrNull(TIMEOUT_MS) { answer.await() }
    } finally {
      OutboxDrain.forget(token)
    }
  }

  /** On the main thread, as ReactHost.start and HeadlessJsTaskContext.startTask want. False when there is no host. */
  private fun start(context: Context, token: String): Boolean {
    val host = (context.applicationContext as? ReactApplication)?.reactHost ?: return false
    val data = Arguments.createMap().apply { putString("token", token) }
    // Allowed in the foreground: the person may come back to the app while it runs.
    val config = HeadlessJsTaskConfig(OutboxDrain.TASK_KEY, data, TIMEOUT_MS, true)
    val current = host.currentReactContext
    if (current != null) {
      startIn(current, config, token)
      return true
    }
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          startIn(context, config, token)
        }
      }
    )
    host.start()
    return true
  }

  private fun startIn(reactContext: ReactContext, config: HeadlessJsTaskConfig, token: String) {
    UiThreadUtil.runOnUiThread {
      try {
        val tasks = HeadlessJsTaskContext.getInstance(reactContext)
        val started = tasks.startTask(config)
        tasks.addTaskEventListener(
          object : HeadlessJsTaskEventListener {
            override fun onHeadlessJsTaskStart(taskId: Int) = Unit

            override fun onHeadlessJsTaskFinish(taskId: Int) {
              if (taskId != started) return
              tasks.removeTaskEventListener(this)
              // A task that answered already keeps its answer: this one only completes a silent end.
              OutboxDrain.finished(token, true)
            }
          }
        )
      } catch (e: IllegalStateException) {
        Log.w(TAG, "outbox drain task did not start", e)
        OutboxDrain.finished(token, true)
      } catch (e: AssertionError) {
        // The React context was torn down between the lookup and the start.
        Log.w(TAG, "outbox drain task did not start", e)
        OutboxDrain.finished(token, true)
      }
    }
  }
}
