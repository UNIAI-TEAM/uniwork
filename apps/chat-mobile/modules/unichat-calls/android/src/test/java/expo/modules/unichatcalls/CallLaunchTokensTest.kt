package expo.modules.unichatcalls

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The launch tokens are what keeps another app on the phone from opening UniChat over the lock
 * screen or answering a ringing call with a crafted intent (CallLaunchTokens' header): a launch
 * vouches for its call only with the token of that call's own notification.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallLaunchTokensTest {
  private lateinit var context: Context
  private val now = 1_800_000_000_000L

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
  }

  private fun launch(callId: String?, token: String?, answer: Boolean = false): Intent = Intent(Intent.ACTION_VIEW).apply {
    if (callId != null) putExtra(CallLockScreen.EXTRA_CALL_LAUNCH, callId)
    if (token != null) putExtra(CallLaunchTokens.EXTRA_TOKEN, token)
    if (answer) putExtra(CallLaunchTokens.EXTRA_ANSWER, true)
  }

  @Test
  fun aLaunchWithItsRingsTokenIsThatCall() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    assertEquals("call-1", CallLaunchTokens.verifiedCall(context, launch("call-1", token)))
  }

  @Test
  fun anyOtherLaunchIsAnOrdinaryLink() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    CallLaunchTokens.issue(context, "call-2", now)
    assertNull(CallLaunchTokens.verifiedCall(context, null))
    assertNull("no call id", CallLaunchTokens.verifiedCall(context, launch(null, token)))
    assertNull("no token", CallLaunchTokens.verifiedCall(context, launch("call-1", null)))
    assertNull("a wrong token", CallLaunchTokens.verifiedCall(context, launch("call-1", token + "x")))
    assertNull("another call's id with this token", CallLaunchTokens.verifiedCall(context, launch("call-2", token)))
    assertNull("a call that never rang", CallLaunchTokens.verifiedCall(context, launch("call-9", token)))
  }

  @Test
  fun eachRingGetsAFreshTokenAndTheOldOneStopsVouching() {
    val first = CallLaunchTokens.issue(context, "call-1", now)
    val second = CallLaunchTokens.issue(context, "call-1", now + 1_000)
    assertNotEquals(first, second)
    assertTrue("32 random bytes, URL-safe base64", second.matches(Regex("[A-Za-z0-9_-]{43}")))
    assertNull(CallLaunchTokens.verifiedCall(context, launch("call-1", first)))
    assertEquals("call-1", CallLaunchTokens.verifiedCall(context, launch("call-1", second)))
  }

  @Test
  fun aRevokedTokenNoLongerVouches() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    CallLaunchTokens.revoke(context, "call-1")
    assertNull(CallLaunchTokens.verifiedCall(context, launch("call-1", token)))
  }

  @Test
  fun tokensOfRingsLongOverAreDroppedWhenTheNextRingIssuesOne() {
    val old = CallLaunchTokens.issue(context, "call-1", now)
    val recent = CallLaunchTokens.issue(context, "call-2", now + 5 * 60_000L)
    CallLaunchTokens.issue(context, "call-3", now + 11 * 60_000L)
    assertNull("over ten minutes old", CallLaunchTokens.verifiedCall(context, launch("call-1", old)))
    assertEquals("six minutes old", "call-2", CallLaunchTokens.verifiedCall(context, launch("call-2", recent)))
  }

  @Test
  fun answerIsTakenOnceForItsCall() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    CallLaunchTokens.recordAnswer(context, launch("call-1", token, answer = true), now)
    assertTrue(CallLaunchTokens.takeAnswered(context, "call-1", now + 1_000))
    assertFalse("only once", CallLaunchTokens.takeAnswered(context, "call-1", now + 2_000))
  }

  @Test
  fun onlyAVerifiedAnswerLaunchRecordsAnAnswer() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    CallLaunchTokens.recordAnswer(context, launch("call-1", token, answer = false), now)
    assertFalse("a tap is not an answer", CallLaunchTokens.takeAnswered(context, "call-1", now))
    CallLaunchTokens.recordAnswer(context, launch("call-1", "forged", answer = true), now)
    assertFalse("a forged answer is not recorded", CallLaunchTokens.takeAnswered(context, "call-1", now))
    CallLaunchTokens.recordAnswer(context, null, now)
    assertFalse(CallLaunchTokens.takeAnswered(context, "call-1", now))
  }

  @Test
  fun anAnswerForAnotherCallStaysWhileFresh() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    CallLaunchTokens.recordAnswer(context, launch("call-1", token, answer = true), now)
    assertFalse(CallLaunchTokens.takeAnswered(context, "call-2", now + 1_000))
    assertTrue(CallLaunchTokens.takeAnswered(context, "call-1", now + 2_000))
  }

  @Test
  fun aStaleAnswerBelongsToARingThatIsOver() {
    val token = CallLaunchTokens.issue(context, "call-1", now)
    CallLaunchTokens.recordAnswer(context, launch("call-1", token, answer = true), now)
    assertFalse(CallLaunchTokens.takeAnswered(context, "call-1", now + 2 * 60_000L + 1))
    // And it is gone: a later ring of the same call does not inherit it.
    assertFalse(CallLaunchTokens.takeAnswered(context, "call-1", now))
  }
}
