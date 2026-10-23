package expo.modules.unichatbackground

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** Runs the drain task once and answers for it: true still owed, false nothing owed, null no answer. */
interface DrainRunner {
  suspend fun run(context: Context, token: String): Boolean?
}

/**
 * The outbox drain job (OutboxDrain): runs the JavaScript task and tells WorkManager whether to come back. While it
 * runs, WorkManager holds a wake lock and the job keeps the process out of the cached state, so the JavaScript
 * runtime is not frozen mid-send. Each run is told apart by the job's id, the token its task answers with.
 */
class OutboxDrainWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val owed = runner.run(applicationContext, id.toString())
    Log.i(TAG, "outbox drain run $runAttemptCount: owed=$owed")
    return OutboxDrain.resultOf(owed, runAttemptCount)
  }

  companion object {
    private const val TAG = "UniChatBackground"

    /** The JavaScript task in the app's React host; the JVM tests put a fake here. */
    internal var runner: DrainRunner = HeadlessDrainRunner
  }
}
