package expo.modules.unichatcalls

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * UniChat's native calls on Android (docs/adr/drafts/0038), as JavaScript
 * sees them through modules/unichat-calls/index.ts. Every function is cheap
 * and synchronous; the policy (when to ring, when the service runs) lives in
 * data/calls/, which tests it with this module mocked.
 */
class UniChatCallsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("UniChatCalls")

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

    Function("takePendingActions") {
      PendingActions.take(context)
    }

    Function("takeAnsweredCall") { callId: String ->
      CallLaunchTokens.takeAnswered(context, callId, System.currentTimeMillis())
    }
  }
}
