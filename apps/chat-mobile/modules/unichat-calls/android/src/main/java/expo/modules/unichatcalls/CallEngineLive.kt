package expo.modules.unichatcalls

/**
 * Whether JavaScript's call engine holds a call now — incoming, ringing (an outgoing call not yet answered),
 * connecting or active — as apps/chat-mobile/data/calls/call-native-sync.ts › markLive writes it. A call push
 * then belongs to JavaScript, which answers a 1-1 caller busy (NativeCallPush › DEFER), even with the app behind
 * and no call service running yet. In memory on purpose: a process that died took the engine and its call with it.
 */
internal object CallEngineLive {
  @Volatile
  var live: Boolean = false
}
