package expo.modules.unichatcalls

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * What the native call-push path did, kept until JavaScript next runs and counts it
 * (UniChatCalls.takeRingReports → apps/chat-mobile/data/calls/native-ring.ts → the call_push and call_ring
 * events): a ring rung natively and how long after the server rang it, an end that cleared one, a ring dropped.
 * The ring path itself never waits for JavaScript, so it cannot report as it goes. Counts and a duration only.
 */
internal object RingReports {
  const val RESULT_NATIVE = "native"
  const val RESULT_IGNORED = "ignored"
  const val RESULT_CLEARED = "cleared"

  private const val PREFS = "expo.modules.unichatcalls.ring_reports"
  private const val KEY = "reports"
  private const val MAX = 20

  @Synchronized
  fun add(context: Context, result: String, latencyMs: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = read(prefs.getString(KEY, null))
    list.put(JSONObject().put("result", result).put("latencyMs", latencyMs))
    while (list.length() > MAX) list.remove(0)
    prefs.edit().putString(KEY, list.toString()).apply()
  }

  @Synchronized
  fun take(context: Context): List<Map<String, Any>> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = read(prefs.getString(KEY, null))
    prefs.edit().remove(KEY).apply()
    return (0 until list.length()).mapNotNull { index ->
      val entry = list.optJSONObject(index) ?: return@mapNotNull null
      mapOf<String, Any>("result" to entry.optString("result"), "latencyMs" to entry.optLong("latencyMs", -1).toDouble())
    }
  }

  private fun read(raw: String?): JSONArray = try {
    JSONArray(raw ?: "[]")
  } catch (e: JSONException) {
    JSONArray()
  }
}
