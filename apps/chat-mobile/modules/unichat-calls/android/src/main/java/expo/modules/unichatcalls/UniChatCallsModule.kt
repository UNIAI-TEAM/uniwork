package expo.modules.unichatcalls

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * UniChat's native calls on Android (docs/adr/0038), as JavaScript
 * sees them through modules/unichat-calls/index.ts. Every function is cheap
 * and synchronous but leaveLockScreen, which waits for the person to unlock;
 * the policy (when to ring, when the service runs) lives in data/calls/, which
 * tests it with this module mocked.
 */
class UniChatCallsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("UniChatCalls")

    // { held: Boolean } when the phone's own call takes the line or gives it back (CallInterruptions).
    Events("onCallHeld")

    OnCreate {
      CallInterruptions.onHeld = { held -> sendEvent("onCallHeld", mapOf("held" to held)) }
    }

    OnDestroy {
      CallInterruptions.onHeld = null
    }

    Function("isCallHeld") {
      CallInterruptions.isHeld()
    }

    Function("ensureChannels") { names: ChannelNames ->
      CallNotifications.ensureChannels(context, names)
    }

    Function("showIncomingCall") { call: IncomingCall ->
      CallNotifications.showIncoming(context, call)
    }

    Function("cancelIncomingCall") { callId: String ->
      CallNotifications.cancelIncoming(context, callId)
    }

    Function("startOngoingCall") { call: OngoingCall ->
      CallService.start(context, call)
    }

    Function("stopOngoingCall") {
      CallService.stop(context)
    }

    Function("startRinging") {
      CallRinger.start(context)
    }

    Function("stopRinging") {
      CallRinger.stop()
    }

    Function("canUseFullScreenIntent") {
      CallNotifications.canUseFullScreenIntent(context)
    }

    Function("openFullScreenIntentSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.packageName))
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("releaseLockScreen") {
      (appContext.currentActivity ?: CallLockScreen.current())?.let { CallLockScreen.release(it) }
    }

    AsyncFunction("leaveLockScreen") { promise: Promise ->
      val activity = appContext.currentActivity ?: CallLockScreen.current()
      if (activity == null) {
        promise.resolve(true)
      } else {
        CallLockScreen.leave(activity) { left -> promise.resolve(left) }
      }
    }.runOnQueue(Queues.MAIN)

    Function("setProximityScreenOff") { on: Boolean ->
      CallProximity.set(context, on)
    }

    Function("takePendingActions") {
      PendingActions.take(context)
    }

    Function("takeAnsweredCall") { callId: String ->
      CallLaunchTokens.takeAnswered(context, callId, System.currentTimeMillis())
    }

    // What a call push needs to ring with no JavaScript running (NativeCallPush), kept on the phone.
    Function("configureRing") { config: RingConfig ->
      RingConfig.write(context, config)
    }

    // The call engine holds a call: a call push is JavaScript's to answer (NativeCallPush › CallEngineLive).
    Function("setCallEngineLive") { live: Boolean ->
      CallEngineLive.live = live
    }

    Function("takeRingReports") {
      RingReports.take(context)
    }

    Function("backgroundDelivery") {
      BackgroundDelivery.status(context)
    }

    Function("openBatterySettings") {
      BackgroundDelivery.openBatterySettings(context)
    }

    Function("openAutostartSettings") {
      BackgroundDelivery.openAutostartSettings(context)
    }
  }
}
