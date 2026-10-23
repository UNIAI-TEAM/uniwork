import Foundation

/// The APNs environment this build's push tokens belong to, as the server's subscription row names it ("sandbox" |
/// "production"): a VoIP token sent to the other host is refused as BadDeviceToken. Read from the build's own signing,
/// so no build setting can disagree with it: a development provisioning profile (Xcode, `expo run:ios`) carries
/// `aps-environment: development`; ad hoc and enterprise profiles carry `production`; App Store and TestFlight builds
/// have no embedded profile at all, and use production.
enum ApnsEnvironment {
  static func current() -> String {
    #if targetEnvironment(simulator)
    return "sandbox"
    #else
    return fromProvisioningProfile() ?? "production"
    #endif
  }

  /// The profile is a CMS envelope around an XML plist; the plist is read from between its markers.
  private static func fromProvisioningProfile() -> String? {
    guard
      let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let text = String(data: data, encoding: .isoLatin1),
      let start = text.range(of: "<?xml"),
      let end = text.range(of: "</plist>", range: start.lowerBound..<text.endIndex),
      let xml = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
      let plist = try? PropertyListSerialization.propertyList(from: xml, options: [], format: nil) as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any],
      let aps = entitlements["aps-environment"] as? String
    else {
      return nil
    }
    return aps == "development" ? "sandbox" : "production"
  }
}
