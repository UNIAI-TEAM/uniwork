package expo.modules.unichatbackground

import android.content.Context
import android.os.Build
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred

/**
 * The one WorkManager job that drains UniChat's outbox while the app is off screen (data/outbox-drain/), and the
 * answers its JavaScript task sends back.
 *
 * JavaScript schedules it as the app leaves the screen with something owed. It needs a connected network: with one,
 * it runs now (expedited on Android 12+, so the process is not frozen mid-send); without one, the moment one comes
 * back, a reboot included (WorkManager keeps it). While the drain answers "still owed" (the server busy, the network
 * gone again) it runs again on WorkManager's backoff, MAX_ATTEMPTS times at most; the next time the app leaves the
 * screen schedules it afresh. One unique name, replaced on every schedule: a newer leave runs now, not after the
 * backoff of an older one.
 */
object OutboxDrain {
  const val WORK_NAME = "unichat-outbox-drain"

  /** The JavaScript task data/outbox-drain/background-send.ts registers (AppRegistry.registerHeadlessTask). */
  const val TASK_KEY = "UniChatOutboxDrain"

  /** WorkManager's exponential backoff from here: 30 s, 1 min, 2 min … */
  const val BACKOFF_SECONDS = 30L

  /** Runs of one schedule, the first included: about an hour of retries, network-less time not counted. */
  const val MAX_ATTEMPTS = 8

  private val answers = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()

  /**
   * Expedited only on Android 12+: below it an expedited job is a foreground service with its own notification
   * (getForegroundInfo), and a process in the background is not frozen there, so a normal job does.
   */
  fun request(expedite: Boolean, sdkInt: Int = Build.VERSION.SDK_INT): OneTimeWorkRequest {
    val builder = OneTimeWorkRequestBuilder<OutboxDrainWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
      .addTag(WORK_NAME)
    if (expedite && sdkInt >= Build.VERSION_CODES.S) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
    return builder.build()
  }

  fun schedule(context: Context, expedite: Boolean) {
    WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request(expedite))
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
  }

  /** The wait for `token`'s answer, registered before its task starts so an answer that comes at once is kept. */
  fun expect(token: String): CompletableDeferred<Boolean> = CompletableDeferred<Boolean>().also { answers[token] = it }

  /** The task's answer (or, for a task that ended without one, `owed`); a token nobody waits for any more is dropped. */
  fun finished(token: String, owed: Boolean) {
    answers[token]?.complete(owed)
  }

  fun forget(token: String) {
    answers.remove(token)
  }

  /** Done when nothing is owed; again later while something is, until MAX_ATTEMPTS; no answer at all counts as owed. */
  fun resultOf(owed: Boolean?, runAttemptCount: Int): ListenableWorker.Result = when {
    owed == false -> ListenableWorker.Result.success()
    runAttemptCount + 1 >= MAX_ATTEMPTS -> ListenableWorker.Result.success()
    else -> ListenableWorker.Result.retry()
  }
}
