package expo.modules.unichatcalls

import android.content.Context
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A Decline or Hang up whose JavaScript task could not start waits here for the next launch (CallActionReceiver). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PendingActionsTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
  }

  private fun action(index: Int, action: String = "decline"): Bundle = Bundle().apply {
    putString(EXTRA_ACTION, action)
    putString(EXTRA_CALL_ID, "call-$index")
    putString(EXTRA_ROOM_ID, "room-$index")
    putString(EXTRA_WORKSPACE_ID, "ws-1")
    putString(EXTRA_CALL_KIND, "dm")
    putDouble(EXTRA_AT, 1_800_000_000_000.0 + index)
  }

  @Test
  fun aKeptActionIsTakenOnceWithEveryField() {
    PendingActions.add(context, action(1, "hangup"))
    val taken = PendingActions.take(context)
    assertEquals(
      listOf(
        mapOf<String, Any>(
          EXTRA_ACTION to "hangup",
          EXTRA_CALL_ID to "call-1",
          EXTRA_ROOM_ID to "room-1",
          EXTRA_WORKSPACE_ID to "ws-1",
          EXTRA_CALL_KIND to "dm",
          EXTRA_AT to 1_800_000_000_001.0
        )
      ),
      taken
    )
    assertTrue("taken means gone", PendingActions.take(context).isEmpty())
  }

  @Test
  fun keepsTheTenNewestInOrder() {
    for (index in 1..12) PendingActions.add(context, action(index))
    val ids = PendingActions.take(context).map { it[EXTRA_CALL_ID] }
    assertEquals((3..12).map { "call-$it" }, ids)
  }

  @Test
  fun aMissingFieldReadsAsEmpty() {
    PendingActions.add(context, Bundle().apply { putString(EXTRA_CALL_ID, "call-1") })
    val taken = PendingActions.take(context).single()
    assertEquals("", taken[EXTRA_ACTION])
    assertEquals("call-1", taken[EXTRA_CALL_ID])
    assertEquals(0.0, taken[EXTRA_AT])
  }

  @Test
  fun nothingKeptIsAnEmptyList() {
    assertTrue(PendingActions.take(context).isEmpty())
  }
}
