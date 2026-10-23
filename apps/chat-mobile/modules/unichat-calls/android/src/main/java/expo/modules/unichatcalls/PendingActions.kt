package expo.modules.unichatcalls

import android.content.Context
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject

/**
 * A Decline or Hang up whose JavaScript task could not start, kept until the
 * app runs and takes it (UniChatCalls.takePendingActions). JavaScript drops
 * one older than a ring window: the call has ended on its own by then.
 */
internal object PendingActions {
  private const val PREFS = "expo.modules.unichatcalls"
  private const val KEY = "pending_actions"
  private const val MAX = 10

  @Synchronized
  fun add(context: Context, data: Bundle) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
    val entry = JSONObject()
    for (key in listOf(EXTRA_ACTION, EXTRA_CALL_ID, EXTRA_ROOM_ID, EXTRA_WORKSPACE_ID, EXTRA_CALL_KIND)) entry.put(key, data.getString(key).orEmpty())
    entry.put(EXTRA_AT, data.getDouble(EXTRA_AT))
    list.put(entry)
    while (list.length() > MAX) list.remove(0)
    prefs.edit().putString(KEY, list.toString()).apply()
  }

  @Synchronized
  fun take(context: Context): List<Map<String, Any>> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
    prefs.edit().remove(KEY).apply()
    return (0 until list.length()).map { index ->
      val entry = list.getJSONObject(index)
      mapOf<String, Any>(
        EXTRA_ACTION to entry.optString(EXTRA_ACTION),
        EXTRA_CALL_ID to entry.optString(EXTRA_CALL_ID),
        EXTRA_ROOM_ID to entry.optString(EXTRA_ROOM_ID),
        EXTRA_WORKSPACE_ID to entry.optString(EXTRA_WORKSPACE_ID),
        EXTRA_CALL_KIND to entry.optString(EXTRA_CALL_KIND),
        EXTRA_AT to entry.optDouble(EXTRA_AT)
      )
    }
  }
}
