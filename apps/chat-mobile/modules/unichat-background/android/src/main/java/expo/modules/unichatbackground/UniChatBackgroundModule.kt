package expo.modules.unichatbackground

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The outbox's background drain on Android, as JavaScript sees it through modules/unichat-background/index.ts. The
 * policy (when to schedule, what counts as owed) lives in data/outbox-drain/, tested with this module mocked; iOS's
 * half (beginGrace, endGrace) is ios/UniChatBackgroundModule.swift.
 */
class UniChatBackgroundModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("UniChatBackground")

    Function("scheduleDrain") { expedite: Boolean ->
      OutboxDrain.schedule(context, expedite)
    }

    Function("cancelDrain") {
      OutboxDrain.cancel(context)
    }

    Function("drainFinished") { token: String, owed: Boolean ->
      OutboxDrain.finished(token, owed)
    }
  }
}
