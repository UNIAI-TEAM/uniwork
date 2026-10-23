package expo.modules.unichatcalls

import android.os.Bundle
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Each message of a room replaces the room's notification on Android (UNI-2141): expo-notifications names a pushed
 * notification by the FCM message's top-level data "tag", while Expo's push service sends the server's data, tag
 * included, as a JSON string under "body". The tag is lifted to where expo-notifications reads it, and nothing else
 * in the message changes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PushTagTest {
  private fun expo(vararg data: Pair<String, String>): Map<String, String> = mapOf(
    "experienceId" to "@unicom/unichat",
    "title" to "Minh",
    "message" to "ba",
    "body" to JSONObject(mapOf(*data)).toString()
  )

  private fun extrasOf(data: Map<String, String>): Bundle = Bundle().apply {
    putString("google.message_id", "0:1700000000000000%abc")
    data.forEach { (key, value) -> putString(key, value) }
  }

  @Test
  fun liftsTheServersTagOntoTheMessage() {
    val data = expo("room_id" to "r-1", "message_id" to "m-3", "tag" to "chat_room:r-1:dm")
    val lifted = PushTag.lift(extrasOf(data), data)!!
    assertEquals("chat_room:r-1:dm", lifted.getString("tag"))
    // The rest of the message is as FCM delivered it: the data string, the title and FCM's own keys.
    assertEquals(data["body"], lifted.getString("body"))
    assertEquals("Minh", lifted.getString("title"))
    assertEquals("0:1700000000000000%abc", lifted.getString("google.message_id"))
  }

  @Test
  fun leavesAMessageWithNothingToLiftAlone() {
    // No tag in the server's data, a data string that is not JSON, no data string at all.
    assertNull(PushTag.lift(Bundle(), expo("room_id" to "r-1")))
    assertNull(PushTag.lift(Bundle(), expo("tag" to "")))
    assertNull(PushTag.lift(Bundle(), mapOf("title" to "Minh", "body" to "not json")))
    assertNull(PushTag.lift(Bundle(), mapOf("title" to "Minh")))
    // A message that already names its tag keeps it.
    assertNull(PushTag.lift(Bundle(), expo("tag" to "chat_room:r-1:dm") + ("tag" to "own")))
  }
}
