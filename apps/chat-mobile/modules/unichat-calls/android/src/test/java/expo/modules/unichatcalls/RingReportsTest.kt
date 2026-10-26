package expo.modules.unichatcalls

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The native ring path's counts wait on the phone for JavaScript (data/calls/native-ring.ts): taken once, the
 * newest MAX kept, and a ring config JavaScript wrote read back whole — or not at all when it is unreadable.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RingReportsTest {
  private lateinit var app: Application

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
    RingReports.take(app)
  }

  @Test
  fun reportsAreTakenOnceAndOnlyTheNewestAreKept() {
    for (i in 1..25) RingReports.add(app, RingReports.RESULT_NATIVE, i.toLong())
    val taken = RingReports.take(app)
    assertEquals(20, taken.size)
    assertEquals(6.0, taken.first()["latencyMs"])
    assertTrue(RingReports.take(app).isEmpty())
  }

  @Test
  fun anUnreadableStoreIsAnEmptyOne() {
    app.getSharedPreferences("expo.modules.unichatcalls.ring_reports", Context.MODE_PRIVATE).edit().putString("reports", "{").commit()
    assertTrue(RingReports.take(app).isEmpty())
    app.getSharedPreferences("expo.modules.unichatcalls.ring", Context.MODE_PRIVATE).edit().putString("config", "[").commit()
    assertEquals(null, RingConfig.read(app))
  }

  @Test
  fun theRingConfigIsReadBackWhole() {
    val written = RingConfig().apply {
      enabled = true
      scheme = "uniworkchat"
      incomingVoice = "v"
      incomingVideo = "vi"
      incomingGroup = "g {room}"
      groupFallback = "gf"
      unknownCaller = "u"
      answerLabel = "a"
      declineLabel = "d"
    }
    RingConfig.write(app, written)
    assertEquals(written.toJson(), RingConfig.read(app)?.toJson())
    assertTrue(RingConfig.read(app)?.usable() == true)
  }
}
