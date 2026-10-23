package expo.modules.unichatcalls

/**
 * Whether the app's activity is in front now (resumed), from UniChatCallsPackage's activity listener. A call push
 * then belongs to JavaScript, whose call engine knows what the screen shows (NativeCallPush › DEFER); with the
 * activity paused, stopped or never created (a closed app that FCM just started), it rings natively.
 */
internal object AppVisibility {
  @Volatile
  var resumed: Boolean = false
}
