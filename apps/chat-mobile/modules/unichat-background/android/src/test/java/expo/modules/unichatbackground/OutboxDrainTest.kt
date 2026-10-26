package expo.modules.unichatbackground

import android.content.Context
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.work.BackoffPolicy
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The outbox drain job: what it asks of WorkManager, how it answers it, and the task's answer reaching it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OutboxDrainTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    val config = Configuration.Builder().setMinimumLoggingLevel(Log.DEBUG).setExecutor(SynchronousExecutor()).build()
    WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
  }

  @After
  fun tearDown() {
    OutboxDrainWorker.runner = HeadlessDrainRunner
  }

  @Test
  fun theJobNeedsANetworkAndBacksOffFromThirtySeconds() {
    val spec = OutboxDrain.request(expedite = false, sdkInt = 34).workSpec
    assertEquals(NetworkType.CONNECTED, spec.constraints.requiredNetworkType)
    assertEquals(BackoffPolicy.EXPONENTIAL, spec.backoffPolicy)
    assertEquals(30_000L, spec.backoffDelayDuration)
    assertFalse(spec.expedited)
  }

  @Test
  fun leavingTheScreenIsExpeditedOnAndroid12AndLaterOnly() {
    assertTrue(OutboxDrain.request(expedite = true, sdkInt = 31).workSpec.expedited)
    // Below 31 an expedited job is a foreground service with a notification of its own.
    assertFalse(OutboxDrain.request(expedite = true, sdkInt = 30).workSpec.expedited)
  }

  @Test
  fun oneJobAtATimeANewScheduleReplacesTheWaitingOneAndCancelEndsIt() {
    OutboxDrain.schedule(context, expedite = true)
    OutboxDrain.schedule(context, expedite = false)
    val manager = WorkManager.getInstance(context)
    val waiting = manager.getWorkInfosForUniqueWork(OutboxDrain.WORK_NAME).get().filter { it.state == WorkInfo.State.ENQUEUED }
    assertEquals(1, waiting.size)
    OutboxDrain.cancel(context)
    val states = manager.getWorkInfosForUniqueWork(OutboxDrain.WORK_NAME).get().map { it.state }
    assertTrue(states.all { it == WorkInfo.State.CANCELLED })
  }

  @Test
  fun doneWhenNothingIsOwedAgainWhileSomethingIsUntilTheLastAttempt() {
    assertEquals(ListenableWorker.Result.success(), OutboxDrain.resultOf(false, 0))
    assertEquals(ListenableWorker.Result.retry(), OutboxDrain.resultOf(true, 0))
    // No answer at all (the task never started or never answered) is still owed.
    assertEquals(ListenableWorker.Result.retry(), OutboxDrain.resultOf(null, 0))
    assertEquals(ListenableWorker.Result.retry(), OutboxDrain.resultOf(true, OutboxDrain.MAX_ATTEMPTS - 2))
    assertEquals(ListenableWorker.Result.success(), OutboxDrain.resultOf(true, OutboxDrain.MAX_ATTEMPTS - 1))
  }

  @Test
  fun theTasksAnswerReachesTheWaitAndALateOneIsDropped() = runBlocking {
    val answer = OutboxDrain.expect("run-1")
    OutboxDrain.finished("run-1", false)
    // The silent-end fallback after a real answer changes nothing.
    OutboxDrain.finished("run-1", true)
    assertFalse(answer.await())
    OutboxDrain.forget("run-1")
    val later = OutboxDrain.expect("run-2")
    OutboxDrain.forget("run-2")
    OutboxDrain.finished("run-2", false)
    assertFalse(later.isCompleted)
    // An answer nobody waits for is dropped, not kept.
    OutboxDrain.finished("nobody", true)
    assertFalse(OutboxDrain.expect("nobody").isCompleted)
    OutboxDrain.forget("nobody")
  }

  private class FakeRunner(private val owed: Boolean?) : DrainRunner {
    var token: String? = null

    override suspend fun run(context: Context, token: String): Boolean? {
      this.token = token
      return owed
    }
  }

  @Test
  fun theWorkerAnswersWhatItsRunnerSaysWithItsIdAsTheToken() = runBlocking {
    val owed = FakeRunner(true)
    OutboxDrainWorker.runner = owed
    val worker = TestListenableWorkerBuilder<OutboxDrainWorker>(context).setRunAttemptCount(0).build()
    assertEquals(ListenableWorker.Result.retry(), worker.doWork())
    assertEquals(worker.id.toString(), owed.token)
    OutboxDrainWorker.runner = FakeRunner(false)
    assertEquals(ListenableWorker.Result.success(), TestListenableWorkerBuilder<OutboxDrainWorker>(context).build().doWork())
  }
}
