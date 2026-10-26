package expo.modules.unichatcalls

import android.app.NotificationManager
import android.content.Context
import android.os.SystemClock
import android.service.notification.StatusBarNotification
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
 * [awaitActive] and [awaitNotActive] wait for the notification service rather than read it once. notify() returns before
 * the service holds the record: enqueueNotificationInternal hands an EnqueueNotificationRunnable to system_server's main
 * looper, and getActiveNotifications lists the record only once that runnable has run (a cancel is handed off the same way).
 * On android-smoke's emulator, right after the test APKs are reinstalled and the configuration flipped, that looper is busy
 * enough for one read to come back empty: about one run in five failed with "Array contains no element matching the
 * predicate" while the ring itself was fine. AOSP's CTS (NotificationHelper.findPostedNotification) polls for the same reason.
 *
 * [awaitInShade] fails with what the device held, not with the assertion alone. The first CI run of these tests failed with
 * "the caller shows in the shade" and no other output, after the ring had passed every check the app can make itself:
 * posted, a CATEGORY_CALL notification on the calls channel, its full-screen intent intact. NotificationManager's list
 * includes records queued for posting once the service has taken them in, so those checks pass even if the system drops
 * the ring before System UI draws it. The failure message therefore carries the screen's state, the notification
 * service's record of this package (posted, queued or archived, and why), the related log lines and the texts System UI
 * drew. That evidence tells a ring the system dropped from one System UI could not draw and from a shade that was not open.
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

  /** The records of this app's active notifications that [match], once there is at least one; fails after [timeoutMs]. */
  fun awaitActive(timeoutMs: Long, message: String, match: (StatusBarNotification) -> Boolean): List<StatusBarNotification> {
    val deadline = SystemClock.uptimeMillis() + timeoutMs
    var found = listed().filter(match)
    while (found.isEmpty() && SystemClock.uptimeMillis() < deadline) {
      SystemClock.sleep(POLL_MS)
      found = listed().filter(match)
    }
    if (found.isEmpty()) fail("$message\n${diagnose()}")
    return found
  }

  /** Waits until none of this app's active notifications [match]; fails after [timeoutMs]. */
  fun awaitNotActive(timeoutMs: Long, message: String, match: (StatusBarNotification) -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + timeoutMs
    while (listed().any(match) && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(POLL_MS)
    if (listed().any(match)) fail("$message\n${diagnose()}")
  }

  fun assertShown(selector: BySelector, timeoutMs: Long, message: String) {
    if (!device.wait(Until.hasObject(selector), timeoutMs)) fail("$message\n${diagnose()}")
  }

  fun assertGone(selector: BySelector, timeoutMs: Long, message: String) {
    if (!device.wait(Until.gone(selector), timeoutMs)) fail("$message\n${diagnose()}")
  }

  private fun listed(): List<StatusBarNotification> = context.getSystemService(NotificationManager::class.java).activeNotifications.toList()

  private fun shell(command: String): String = runCatching { device.executeShellCommand(command) }.getOrElse { "($command failed: $it)" }

  /**
   * Each section has its own budget, so a long service dump or log cannot push the texts System UI drew out of the
   * message. The log reads the events buffer too: the notification service writes notification_enqueue, _cancel (with
   * its reason) and _visibility there, each naming the package, so it tells a ring System UI never showed from one it
   * showed and then lost.
   */
  private fun diagnose(): String = buildString {
    section("screen", SCREEN_CHARS, screen())
    section("texts on screen (package: text | description)", TEXT_CHARS, texts())
    section("what this app still sees", ACTIVE_CHARS, active())
    section("notification service, ${context.packageName}", RECORD_CHARS, records(shell("dumpsys notification --noredact")))
    section("log", LOG_CHARS, log(), keepEnd = true)
  }

  private fun StringBuilder.section(title: String, budget: Int, body: String, keepEnd: Boolean = false) {
    appendLine("--- $title")
    when {
      body.length <= budget -> append(body)
      keepEnd -> append("(cut)\n").append(body.takeLast(budget))
      else -> append(body.take(budget)).append("\n(cut)\n")
    }
  }

  private fun screen(): String = buildString {
    appendLine(
      "provisioned=${shell("settings get global device_provisioned").trim()} " +
        "user_setup_complete=${shell("settings get secure user_setup_complete").trim()} " +
        "heads_up=${shell("settings get global heads_up_notifications_enabled").trim()} " +
        "zen_mode=${shell("settings get global zen_mode").trim()}"
    )
    // The width decides what a notification header has room for: a text squeezed to zero width is not visible to
    // the user and UI Automator leaves it out, so a text missing below can be one the screen had no room for.
    appendLine("${shell("wm size").trim()} ${shell("wm density").trim()} font_scale=${shell("settings get system font_scale").trim()}")
    shell("dumpsys power").lines().filter { "mWakefulness=" in it || "mInteractive=" in it }.forEach { appendLine(it.trim()) }
    shell("dumpsys window").lines()
      .filter { "mCurrentFocus" in it || "mFocusedApp" in it || "KeyguardShowing" in it || "isKeyguardShowing" in it }
      .distinct().take(8).forEach { appendLine(it.trim()) }
  }

  private fun active(): String = buildString {
    val rows = runCatching { listed() }.getOrDefault(emptyList())
    rows.forEach { appendLine("id=${it.id} tag=${it.tag} category=${it.notification.category} channel=${it.notification.channelId}") }
    if (rows.isEmpty()) appendLine("(no active notifications)")
  }

  private fun log(): String = shell("logcat -d -b main,system,crash,events -v brief -t 6000").lines()
    .filter { line -> LOG_KEYS.any { it in line } || context.packageName in line }
    .takeLast(MAX_LOG_LINES)
    .joinToString("\n", postfix = "\n")

  /** The service's lines that name this package, each with the detail lines under it and the section it sits in. */
  private fun records(dump: String): String = buildString {
    var section = ""
    var printedSection = ""
    var detail = 0
    var lines = 0
    for (line in dump.lines()) {
      if (lines >= MAX_RECORD_LINES) break
      if (SECTION.matches(line) || line.trimStart().startsWith("mArchive=")) section = line.trim()
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
    /** The interval AOSP's CTS polls the notification service at. */
    const val POLL_MS = 100L
    const val SCREEN_CHARS = 1_500
    const val TEXT_CHARS = 3_000
    const val ACTIVE_CHARS = 800
    const val RECORD_CHARS = 4_500
    const val LOG_CHARS = 5_000
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
      "NotifContentInflater",
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
