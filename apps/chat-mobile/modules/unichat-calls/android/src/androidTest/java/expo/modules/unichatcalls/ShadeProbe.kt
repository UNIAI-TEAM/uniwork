package expo.modules.unichatcalls

import android.app.NotificationManager
import android.content.Context
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.ByteArrayOutputStream
import org.junit.Assert.fail

/**
 * System UI as the instrumented tests see it, on android-smoke's emulator (mobile-verify.yml) and the device farm's phones.
 *
 * [prepare] puts the screen in a known state before a ring is posted: awake, unlocked, at Home. Over a locked or sleeping
 * screen, System UI launches the ring's full-screen intent rather than showing a heads-up, and the shade the test opens is
 * then a different one.
 *
 * [awaitInShade] fails with what the device held, not with the assertion alone. The first CI run of these tests failed with
 * "the caller shows in the shade" and no other output, after the ring had passed every check the app can make itself:
 * posted, a CATEGORY_CALL notification on the calls channel, its full-screen intent intact. NotificationManager's list
 * includes records still queued for posting, so those checks pass even if the system drops the ring before System UI draws
 * it. The failure message therefore carries the screen's state, the notification service's record of this package
 * (posted, queued or archived, and why), the related log lines and the texts System UI drew. That evidence tells a ring
 * the system dropped from one System UI could not draw and from a shade that was not open.
 */
internal class ShadeProbe(private val device: UiDevice, private val context: Context) {
  fun prepare() {
    device.wakeUp()
    shell("wm dismiss-keyguard")
    device.pressHome()
    device.waitForIdle()
  }

  /**
   * Pulls the shade down and waits for [text], pulling it again halfway through: a pull that lands while the ring's
   * heads-up is still coming in can leave the shade closed. Either way the text must be drawn by System UI.
   */
  fun awaitInShade(text: String, timeoutMs: Long, message: String) {
    device.openNotification()
    if (device.wait(Until.hasObject(By.text(text)), timeoutMs / 2)) return
    device.openNotification()
    if (device.wait(Until.hasObject(By.text(text)), timeoutMs / 2)) return
    fail("$message\n${diagnose()}")
  }

  fun assertShown(selector: BySelector, timeoutMs: Long, message: String) {
    if (!device.wait(Until.hasObject(selector), timeoutMs)) fail("$message\n${diagnose()}")
  }

  fun assertGone(selector: BySelector, timeoutMs: Long, message: String) {
    if (!device.wait(Until.gone(selector), timeoutMs)) fail("$message\n${diagnose()}")
  }

  private fun shell(command: String): String = runCatching { device.executeShellCommand(command) }.getOrElse { "($command failed: $it)" }

  private fun diagnose(): String = buildString {
    appendLine("--- screen")
    appendLine(
      "provisioned=${shell("settings get global device_provisioned").trim()} " +
        "user_setup_complete=${shell("settings get secure user_setup_complete").trim()} " +
        "heads_up=${shell("settings get global heads_up_notifications_enabled").trim()} " +
        "zen_mode=${shell("settings get global zen_mode").trim()}"
    )
    shell("dumpsys power").lines().filter { "mWakefulness=" in it || "mInteractive=" in it }.forEach { appendLine(it.trim()) }
    shell("dumpsys window").lines()
      .filter { "mCurrentFocus" in it || "mFocusedApp" in it || "KeyguardShowing" in it || "isKeyguardShowing" in it }
      .distinct().take(8).forEach { appendLine(it.trim()) }

    appendLine("--- what this app still sees")
    val active = runCatching { context.getSystemService(NotificationManager::class.java).activeNotifications.toList() }.getOrDefault(emptyList())
    active.forEach { appendLine("id=${it.id} tag=${it.tag} category=${it.notification.category} channel=${it.notification.channelId}") }
    if (active.isEmpty()) appendLine("(no active notifications)")

    appendLine("--- notification service, ${context.packageName}")
    append(records(shell("dumpsys notification --noredact")))

    appendLine("--- log")
    shell("logcat -d -v brief -t 4000").lines().filter { line -> LOG_KEYS.any { it in line } || context.packageName in line }
      .takeLast(MAX_LOG_LINES).forEach { appendLine(it) }

    appendLine("--- texts on screen (package: text | description)")
    append(texts())
  }.take(MAX_CHARS)

  /** The service's lines that name this package, each with the detail lines under it and the section it sits in. */
  private fun records(dump: String): String = buildString {
    var section = ""
    var printedSection = ""
    var detail = 0
    var lines = 0
    for (line in dump.lines()) {
      if (lines >= MAX_RECORD_LINES) break
      if (SECTION.matches(line)) section = line.trim()
      when {
        context.packageName in line -> {
          if (section != printedSection) {
            appendLine("[$section]")
            printedSection = section
          }
          appendLine(line.trimEnd())
          detail = RECORD_DETAIL_LINES
          lines++
        }
        detail > 0 -> {
          appendLine(line.trimEnd())
          detail--
          lines++
        }
      }
    }
    if (lines == 0) appendLine("(no line names ${context.packageName})")
  }

  private fun texts(): String {
    val xml = runCatching { ByteArrayOutputStream().also { device.dumpWindowHierarchy(it) }.toString("UTF-8") }.getOrElse { return "(dump failed: $it)\n" }
    val nodes = NODE.findAll(xml).mapNotNull { node ->
      val text = TEXT.find(node.value)?.groupValues?.get(1).orEmpty()
      val description = DESCRIPTION.find(node.value)?.groupValues?.get(1).orEmpty()
      val pkg = PACKAGE.find(node.value)?.groupValues?.get(1).orEmpty()
      if (text.isEmpty() && description.isEmpty()) null else "$pkg: $text | $description"
    }.distinct().take(MAX_TEXTS).toList()
    return if (nodes.isEmpty()) "(nothing with a text or a description)\n" else nodes.joinToString("\n", postfix = "\n")
  }

  private companion object {
    const val MAX_CHARS = 14_000
    const val MAX_LOG_LINES = 60
    const val MAX_RECORD_LINES = 80
    const val RECORD_DETAIL_LINES = 14
    const val MAX_TEXTS = 80
    val SECTION = Regex("^ {0,4}[A-Za-z][^=()]*:\\s*$")
    val NODE = Regex("<node [^>]*>")
    val TEXT = Regex(" text=\"([^\"]*)\"")
    val DESCRIPTION = Regex(" content-desc=\"([^\"]*)\"")
    val PACKAGE = Regex(" package=\"([^\"]*)\"")

    /** The notification service, System UI's notification pipeline and this module's own tag. */
    val LOG_KEYS = listOf(
      "NotificationService",
      "NotifBindPipeline",
      "NotifInflat",
      "NotificationContentInflater",
      "RowContentBindStage",
      "InflationException",
      "Couldn't create icon",
      "Bad notification",
      "FullScreenIntent",
      "VisualInterruption",
      "HeadsUpCoordinator",
      "UniChatCalls"
    )
  }
}
