package expo.modules.unichatcalls

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * Whether a call can reach this phone while UniChat is closed (review "Calls, push & background", OEM background
 * restrictions): Android's battery optimization and background restriction, and the vendor "autostart" switches
 * of Xiaomi, Oppo, realme, OnePlus, vivo, Huawei, Honor and Asus, which drop a high-priority FCM message to an app
 * the person swiped away until it is allowed. Android says whether the first two apply; no vendor says whether
 * autostart is on, so for those brands Settings shows the way there (apps/chat-mobile/components/settings/
 * background-calls-rows.tsx).
 *
 * No REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: Play allows it only for apps that cannot use FCM, and UniChat rings
 * through FCM. The person changes the setting on the system page this opens.
 */
internal object BackgroundDelivery {
  private const val TAG = "UniChatCalls"

  /** The vendor screens that hold the autostart switch, newest first; the first one present opens. */
  private val AUTOSTART: Map<String, List<ComponentName>> = mapOf(
    "xiaomi" to listOf(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
    "oppo" to listOf(
      ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
      ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
      ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")
    ),
    "vivo" to listOf(
      ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
      ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
      ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
    ),
    "huawei" to listOf(
      ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
      ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")
    ),
    "oneplus" to listOf(ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")),
    "asus" to listOf(ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"))
  )

  /** Sub-brands that run their parent's system (MIUI/HyperOS, ColorOS, Funtouch/OriginOS, EMUI/MagicOS). */
  private val FAMILY = mapOf(
    "redmi" to "xiaomi",
    "poco" to "xiaomi",
    "realme" to "oppo",
    "iqoo" to "vivo",
    "honor" to "huawei"
  )

  /** The vendor whose autostart screen this phone has, "" for none (Samsung, Pixel, Motorola, Nokia, …). */
  fun autostartBrand(manufacturer: String = Build.MANUFACTURER, brand: String = Build.BRAND): String {
    for (name in listOf(manufacturer, brand)) {
      val key = name.trim().lowercase()
      val family = FAMILY[key] ?: key
      if (AUTOSTART.containsKey(family)) return family
    }
    return ""
  }

  fun status(context: Context): Map<String, Any> {
    val power = context.getSystemService(PowerManager::class.java)
    val optimized = power?.isIgnoringBatteryOptimizations(context.packageName) == false
    val restricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      context.getSystemService(ActivityManager::class.java)?.isBackgroundRestricted == true
    return mapOf(
      "batteryOptimized" to optimized,
      "backgroundRestricted" to restricted,
      "autostartBrand" to autostartBrand(),
      "manufacturer" to Build.MANUFACTURER.orEmpty()
    )
  }

  /**
   * The page where the person lets UniChat run in the background: the app's own page from Android 12 (App battery
   * usage › Unrestricted lifts both the optimization and the restriction), the battery optimization list before it.
   */
  fun openBatterySettings(context: Context): Boolean {
    val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
    val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    val order = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) listOf(appDetails, list) else listOf(list, appDetails)
    return order.any { start(context, it) }
  }

  /** The vendor's autostart screen, else the app's own page; false when neither opens. */
  fun openAutostartSettings(context: Context): Boolean {
    val candidates = AUTOSTART[autostartBrand()].orEmpty().map { Intent().setComponent(it) }
    val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
    return (candidates + appDetails).any { start(context, it) }
  }

  /** Starts it if it exists here; a vendor screen another build renamed or did not export just fails. */
  private fun start(context: Context, intent: Intent): Boolean = try {
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (e: ActivityNotFoundException) {
    false
  } catch (e: SecurityException) {
    Log.w(TAG, "settings page not allowed: ${intent.component ?: intent.action}", e)
    false
  }
}
