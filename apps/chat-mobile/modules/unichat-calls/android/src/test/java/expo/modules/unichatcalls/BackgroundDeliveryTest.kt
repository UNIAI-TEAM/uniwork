package expo.modules.unichatcalls

import android.app.ActivityManager
import android.app.Application
import android.content.ComponentName
import android.os.PowerManager
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowBuild

/**
 * Whether a call can reach this phone while UniChat is closed (review: OEM background restrictions): Android's
 * battery optimization and background restriction as Android reports them, the vendors whose autostart switch
 * drops FCM to a swiped-away app, and the settings pages that fix each — the vendor's own screen first, the app's
 * page when that screen is not on this build. Which switch a real Xiaomi or Oppo shows is the device farm's
 * (runbook › Native calls on Android).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackgroundDeliveryTest {
  private lateinit var app: Application

  @Before
  fun setUp() {
    app = ApplicationProvider.getApplicationContext()
  }

  @After
  fun tearDown() {
    ShadowBuild.reset()
  }

  @Test
  fun theVendorsWithAnAutostartSwitchAreToldBySubBrandToo() {
    assertEquals("xiaomi", BackgroundDelivery.autostartBrand("Xiaomi", "Redmi"))
    assertEquals("xiaomi", BackgroundDelivery.autostartBrand("unknown", "POCO"))
    assertEquals("oppo", BackgroundDelivery.autostartBrand("realme", "realme"))
    assertEquals("oppo", BackgroundDelivery.autostartBrand("OPPO", "OPPO"))
    assertEquals("vivo", BackgroundDelivery.autostartBrand("vivo", "iQOO"))
    assertEquals("huawei", BackgroundDelivery.autostartBrand("HONOR", "HONOR"))
    assertEquals("oneplus", BackgroundDelivery.autostartBrand("OnePlus", "OnePlus"))
    assertEquals("asus", BackgroundDelivery.autostartBrand("asus", "asus"))
    // Samsung's "sleeping apps" is battery, not autostart: the battery row covers it. Stock Android has neither.
    assertEquals("", BackgroundDelivery.autostartBrand("samsung", "samsung"))
    assertEquals("", BackgroundDelivery.autostartBrand("Google", "google"))
  }

  @Test
  fun theStatusIsWhatAndroidSays() {
    ShadowBuild.setManufacturer("Xiaomi")
    val power = shadowOf(app.getSystemService(PowerManager::class.java))
    power.setIgnoringBatteryOptimizations(app.packageName, false)
    shadowOf(app.getSystemService(ActivityManager::class.java)).setBackgroundRestricted(true)
    assertEquals(
      mapOf("batteryOptimized" to true, "backgroundRestricted" to true, "autostartBrand" to "xiaomi", "manufacturer" to "Xiaomi"),
      BackgroundDelivery.status(app)
    )
    power.setIgnoringBatteryOptimizations(app.packageName, true)
    shadowOf(app.getSystemService(ActivityManager::class.java)).setBackgroundRestricted(false)
    val ok = BackgroundDelivery.status(app)
    assertEquals(false, ok["batteryOptimized"])
    assertEquals(false, ok["backgroundRestricted"])
  }

  @Test
  fun autostartOpensTheVendorsScreenAndOtherwiseTheAppsPage() {
    ShadowBuild.setManufacturer("Xiaomi")
    assertTrue(BackgroundDelivery.openAutostartSettings(app))
    assertEquals(
      ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      shadowOf(app).nextStartedActivity.component
    )
    ShadowBuild.setManufacturer("samsung")
    ShadowBuild.setBrand("samsung")
    assertTrue(BackgroundDelivery.openAutostartSettings(app))
    val page = shadowOf(app).nextStartedActivity
    assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, page.action)
    assertEquals("package:" + app.packageName, page.data.toString())
  }

  @Test
  fun batteryOpensTheAppsPageOnAndroid12AndLater() {
    assertTrue(BackgroundDelivery.openBatterySettings(app))
    assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, shadowOf(app).nextStartedActivity.action)
  }

  @Test
  fun aSettingsPageThatIsNotThereIsReportedNotOpened() {
    shadowOf(app).checkActivities(true)
    assertFalse(BackgroundDelivery.openBatterySettings(app))
    assertFalse(BackgroundDelivery.openAutostartSettings(app))
  }
}
