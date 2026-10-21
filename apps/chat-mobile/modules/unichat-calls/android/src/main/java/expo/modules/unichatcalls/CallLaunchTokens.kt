package expo.modules.unichatcalls

import android.content.Context
import android.content.Intent
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Tells a launch from UniChat's own ringing notification apart from any other.
 *
 * The app's activity is exported (app links, the custom scheme), so any app on
 * the phone can start it with any URL and any extras, and a call id is no
 * secret. Each ringing notification gets a random token; its PendingIntents
 * (a tap, the full-screen intent, Answer) carry it, and only the system and
 * this app can read a PendingIntent's extras. A launch whose token does not
 * match its call's is an ordinary link: it neither shows the app over the lock
 * screen (CallLockScreen) nor answers the call. Answer is recorded here for
 * JavaScript to take (UniChatCalls.takeAnsweredCall); the link it opens is the
 * plain ringing link, so no URL can ever answer (apps/chat-mobile/lib/deep-link.ts).
 */
internal object CallLaunchTokens {
  const val EXTRA_TOKEN = "expo.modules.unichatcalls.LAUNCH_TOKEN"
  const val EXTRA_ANSWER = "expo.modules.unichatcalls.ANSWER"
  private const val PREFS = "expo.modules.unichatcalls.launch"
  private const val TOKEN_PREFIX = "token:"
  private const val ANSWERED_CALL = "answered_call_id"
  private const val ANSWERED_AT = "answered_at"
  private const val TOKEN_BYTES = 32

  /** A token outlives its ring (60 s) only by a margin: a notification the system timed out is not cancelled here. */
  private const val TOKEN_TTL_MS = 10 * 60_000L

  /** An Answer JavaScript takes later than this belongs to a ring that is over. */
  private const val ANSWER_TTL_MS = 2 * 60_000L

  private val random = SecureRandom()

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** A new token for this call's notification; tokens of rings long over are dropped on the way. */
  @Synchronized
  fun issue(context: Context, callId: String, now: Long): String {
    val bytes = ByteArray(TOKEN_BYTES).also { random.nextBytes(it) }
    val token = Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
    val prefs = prefs(context)
    val edit = prefs.edit()
    for ((key, value) in prefs.all) {
      if (key.startsWith(TOKEN_PREFIX) && now - issuedAt(value) > TOKEN_TTL_MS) edit.remove(key)
    }
    edit.putString(TOKEN_PREFIX + callId, "$now:$token").apply()
    return token
  }

  /** The call's notification is gone: its PendingIntents no longer vouch for anything. */
  @Synchronized
  fun revoke(context: Context, callId: String) {
    prefs(context).edit().remove(TOKEN_PREFIX + callId).apply()
  }

  /** The call this launch genuinely came from (its notification's own token), or null for any other launch. */
  @Synchronized
  fun verifiedCall(context: Context, intent: Intent?): String? {
    val callId = intent?.getStringExtra(CallLockScreen.EXTRA_CALL_LAUNCH) ?: return null
    val presented = intent.getStringExtra(EXTRA_TOKEN) ?: return null
    val stored = prefs(context).getString(TOKEN_PREFIX + callId, null) ?: return null
    val expected = stored.substringAfter(':', "")
    if (expected.isEmpty()) return null
    return if (MessageDigest.isEqual(presented.toByteArray(), expected.toByteArray())) callId else null
  }

  /** Records Answer for JavaScript when a verified launch is the Answer button's. */
  @Synchronized
  fun recordAnswer(context: Context, intent: Intent?, now: Long) {
    if (intent?.getBooleanExtra(EXTRA_ANSWER, false) != true) return
    val callId = verifiedCall(context, intent) ?: return
    prefs(context).edit().putString(ANSWERED_CALL, callId).putLong(ANSWERED_AT, now).apply()
  }

  /** True once when Answer was tapped on this call's notification, recently; an Answer for another call stays. */
  @Synchronized
  fun takeAnswered(context: Context, callId: String, now: Long): Boolean {
    val prefs = prefs(context)
    val answered = prefs.getString(ANSWERED_CALL, null) ?: return false
    val at = prefs.getLong(ANSWERED_AT, 0L)
    val fresh = now - at in 0..ANSWER_TTL_MS
    if (answered != callId && fresh) return false
    prefs.edit().remove(ANSWERED_CALL).remove(ANSWERED_AT).apply()
    return answered == callId && fresh
  }

  private fun issuedAt(value: Any?): Long = (value as? String)?.substringBefore(':')?.toLongOrNull() ?: 0L
}
