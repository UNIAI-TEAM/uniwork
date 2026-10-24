package expo.modules.unichatcalls

import android.os.Bundle

/**
 * The notification tag of a push, where expo-notifications looks for it. expo-notifications names the notification
 * it posts by the FCM message's top-level data "tag" (FirebaseMessagingDelegate.getNotificationIdentifier), and a
 * notification posted under a name already in the tray replaces it. Expo's push service does not put the server's
 * data there: it sends it as one JSON string under "body", the shape NativeCallPush.dataOf reads. So the server's
 * tag (its notification group key: one per room for chat, server push_expo.go) is lifted onto the message before
 * expo-notifications sees it, and each message of a room replaces the room's notification instead of adding one.
 */
internal object PushTag {
  const val KEY = "tag"

  /** The server's tag in [data] (an FCM message's data), or null when it has none or the message already has one. */
  fun of(data: Map<String, String>): String? {
    if (!data[KEY].isNullOrEmpty()) return null
    if (data["body"] == null) return null
    return NativeCallPush.dataOf(data)?.get(KEY)?.takeIf { it.isNotEmpty() }
  }

  /** [extras] (an FCM message's bundle) with the server's tag on top, or null when there is nothing to lift. */
  fun lift(extras: Bundle, data: Map<String, String>): Bundle? {
    val tag = of(data) ?: return null
    return Bundle(extras).apply { putString(KEY, tag) }
  }
}
