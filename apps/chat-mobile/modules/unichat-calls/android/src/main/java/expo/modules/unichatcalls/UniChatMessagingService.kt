package expo.modules.unichatcalls

import android.os.Bundle
import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * The app's FCM service: expo-notifications' own, with the call push taken first (NativeCallPush). FCM delivers
 * to the MESSAGING_EVENT service with the highest priority; expo-notifications declares its service at -1 so an
 * app can put one in front, and plugins/with-unichat-calls.js declares this one at 1. Everything that is not a
 * call push this phone handled — chat pushes, token rotation, a ring JavaScript decides — goes on to
 * expo-notifications, which presents it and runs the JavaScript background task as before, with the server's
 * notification tag lifted to where expo-notifications reads it (PushTag).
 */
class UniChatMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val outcome = try {
      NativeCallPush.handle(applicationContext, remoteMessage.data, System.currentTimeMillis(), AppVisibility.resumed)
    } catch (e: RuntimeException) {
      // Whatever went wrong natively, JavaScript still gets the push and its fallback ring.
      Log.w(TAG, "native call push failed", e)
      NativeCallPush.Outcome.DEFER
    }
    if (outcome.forward) super.onMessageReceived(tagged(remoteMessage))
  }

  /**
   * [message] with the server's tag where expo-notifications names the notification by it (PushTag), so a room's
   * next message replaces the room's notification. Whatever goes wrong, the message goes on as it came.
   */
  private fun tagged(message: RemoteMessage): RemoteMessage = try {
    PushTag.lift(message.toIntent().extras ?: Bundle(), message.data)?.let(::RemoteMessage) ?: message
  } catch (e: RuntimeException) {
    Log.w(TAG, "push tag not lifted", e)
    message
  }

  private companion object {
    const val TAG = "UniChatCalls"
  }
}
