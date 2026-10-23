// TLS public-key pinning for UniChat's own servers (audit "Security & privacy",
// no-pinning-or-attestation; MASVS-NETWORK-2). Off unless the build's
// environment names the pins (app.config.ts › tlsPinning reads
// UNICHAT_TLS_PINS and UNICHAT_TLS_PIN_EXPIRES), so no build pins by accident.
//
// The pins are base64 SHA-256 hashes of the SubjectPublicKeyInfo of the CA
// keys that issue the API's and the web app's certificates, a current one and
// at least one backup (runbook › Ghim khoá TLS): a leaf certificate rotates
// every few months, a CA key does not, and a backup lets the server move to
// another CA without a new binary.
//
// - Android: a network security config with one <pin-set> per build, carrying
//   an expiration date after which Android stops enforcing it: the safety
//   valve if every pinned key were lost, since a pin-set cannot be switched
//   off remotely. Cleartext stays refused, as by default.
// - iOS 14+: NSAppTransportSecurity › NSPinnedDomains with the same keys as
//   NSPinnedCAIdentities. iOS has no expiry: a pin that no longer matches
//   needs a new binary, so the runbook rotates the backup in first.
const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod, withInfoPlist } = require("expo/config-plugins");

const CONFIG_NAME = "unichat_network_security_config";

const xmlEscape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Android's res/xml network security config for these hosts and pins. */
function networkSecurityConfig({ domains, pins, expiration }) {
  const domainLines = domains.map((domain) => `    <domain includeSubdomains="false">${xmlEscape(domain)}</domain>`).join("\n");
  const pinLines = pins.map((pin) => `      <pin digest="SHA-256">${xmlEscape(pin)}</pin>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by plugins/with-tls-pins.js from UNICHAT_TLS_PINS: do not edit. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="false">
${domainLines}
    <pin-set expiration="${xmlEscape(expiration)}">
${pinLines}
    </pin-set>
  </domain-config>
</network-security-config>
`;
}

/** iOS's NSPinnedDomains for these hosts and pins. */
function pinnedDomains({ domains, pins }) {
  return Object.fromEntries(
    domains.map((domain) => [domain, { NSIncludesSubdomains: false, NSPinnedCAIdentities: pins.map((pin) => ({ "SPKI-SHA256-BASE64": pin })) }]),
  );
}

/** @type {import("expo/config-plugins").ConfigPlugin<{ domains: string[]; pins: string[]; expiration: string }>} */
const withTlsPins = (config, options) => {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$["android:networkSecurityConfig"] = `@xml/${CONFIG_NAME}`;
    return mod;
  });
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, `${CONFIG_NAME}.xml`), networkSecurityConfig(options));
      return mod;
    },
  ]);
  return withInfoPlist(config, (mod) => {
    const ats = mod.modResults.NSAppTransportSecurity ?? {};
    mod.modResults.NSAppTransportSecurity = { ...ats, NSPinnedDomains: { ...(ats.NSPinnedDomains ?? {}), ...pinnedDomains(options) } };
    return mod;
  });
};

module.exports = withTlsPins;
module.exports.networkSecurityConfig = networkSecurityConfig;
module.exports.pinnedDomains = pinnedDomains;
module.exports.CONFIG_NAME = CONFIG_NAME;
