package expo.modules.unichatcalls

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * The app's FCM service: expo-notifications' own, with the call push taken first (NativeCallPush). FCM delivers
 * to the MESSAGING_EVENT service with the highest priority; expo-notifications declares its service at -1 so an
 * app can put one in front, and plugins/with-unichat-calls.js declares this one at 1. Everything that is not a
 * call push this phone handled — chat pushes, token rotation, a ring JavaScript decides — goes on to
 * expo-notifications unchanged, which presents it and runs the JavaScript background task as before.
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
    if (outcome.forward) super.onMessageReceived(remoteMessage)
  }

  private companion object {
    const val TAG = "UniChatCalls"
  }
}
