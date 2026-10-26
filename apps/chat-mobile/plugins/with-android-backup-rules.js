// Android backup and transfer rules for UniChat (audit "no-masvs-baseline",
// MASVS-STORAGE-2). `android.allowBackup: false` in app.config.ts stops cloud
// backups, but from Android 12 a device-to-device transfer still copies an
// app's files unless its data extraction rules exclude them. UniChat keeps
// nothing a new phone could use: the session and the device store's key live
// in the Keystore (never transferred), the device store is encrypted under
// that key, and unsent attachments under documents/outbox are the old phone's
// queue. So every domain is excluded from both cloud backup and transfer.
// android-manifest.test.ts holds the manifest attribute and this file's rules.
const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const RULES_NAME = "unichat_data_extraction_rules";
// Every domain Android names, the direct-boot (device_*) storage included.
const DOMAINS = ["root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"];

const excludeAll = DOMAINS.map((domain) => `    <exclude domain="${domain}" path="." />`).join("\n");

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by plugins/with-android-backup-rules.js: nothing of UniChat's leaves the phone. -->
<data-extraction-rules>
  <cloud-backup>
${excludeAll}
  </cloud-backup>
  <device-transfer>
${excludeAll}
  </device-transfer>
</data-extraction-rules>
`;

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAndroidBackupRules = (config) => {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$["android:dataExtractionRules"] = `@xml/${RULES_NAME}`;
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, `${RULES_NAME}.xml`), DATA_EXTRACTION_RULES);
      return mod;
    },
  ]);
};

module.exports = withAndroidBackupRules;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.RULES_NAME = RULES_NAME;
