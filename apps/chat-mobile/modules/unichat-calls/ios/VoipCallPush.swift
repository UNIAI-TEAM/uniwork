import CallKit
import CryptoKit
import Foundation

/// A VoIP push from the server (docs/adr/0038, the APNs VoIP sender in server/internal/notification): its whole payload is
/// `{"uniwork": {"kind": "invite" | "end", "call_id", "room_id", "workspace_id", "org_slug", "ws_slug", "caller_name",
/// "video", "expires_at", "reason"}}`. Nil when the payload is not one: the push is still reported to CallKit, and ended
/// at once.
struct VoipCallPush {
  enum Kind: String {
    case invite
    case end
  }

  /// How long an invite rings when it does not say: the server's ring window (lib/call-push.ts › CALL_RING_WINDOW_MS).
  static let defaultRing: TimeInterval = 60

  let kind: Kind
  let callId: String
  let roomId: String
  let workspaceId: String
  let orgSlug: String
  let wsSlug: String
  /// Empty when the server leaves the name out (the person's lock-screen preview rule, push_body.go).
  let callerName: String
  let video: Bool
  let expiresAt: Date
  /// Why an end's ring stopped: "answered" (on another device of this person), "declined" (on another device),
  /// "ended" (the call is over); empty on an invite and on an end from a server that does not say.
  let reason: String

  init?(_ payload: [AnyHashable: Any], now: Date = Date()) {
    guard
      let body = payload["uniwork"] as? [String: Any],
      let kind = (body["kind"] as? String).flatMap(Kind.init(rawValue:)),
      let callId = body["call_id"] as? String,
      !callId.isEmpty
    else {
      return nil
    }
    self.kind = kind
    self.callId = callId
    roomId = body["room_id"] as? String ?? ""
    workspaceId = body["workspace_id"] as? String ?? ""
    orgSlug = body["org_slug"] as? String ?? ""
    wsSlug = body["ws_slug"] as? String ?? ""
    callerName = body["caller_name"] as? String ?? ""
    video = body["video"] as? Bool ?? false
    expiresAt = (body["expires_at"] as? String).flatMap(VoipCallPush.date) ?? now.addingTimeInterval(VoipCallPush.defaultRing)
    reason = body["reason"] as? String ?? ""
  }

  /// What CallKit says of a call this end takes down: answered or declined elsewhere, else ended by the others.
  var endedReason: CXCallEndedReason {
    switch reason {
    case "answered":
      return .answeredElsewhere
    case "declined":
      return .declinedElsewhere
    default:
      return .remoteEnded
    }
  }

  /// An invite JavaScript can still answer: it has not rung out.
  func ringing(at now: Date) -> Bool {
    kind == .invite && expiresAt > now
  }

  /// What JavaScript is told about this call (data/calls/native-call-session.ts reads it).
  var fields: [String: Any] {
    [
      "callId": callId,
      "roomId": roomId,
      "workspaceId": workspaceId,
      "orgSlug": orgSlug,
      "wsSlug": wsSlug,
      "callerName": callerName,
      "video": video,
    ]
  }

  /// RFC 3339, with or without fractional seconds (Go's time.RFC3339 and RFC3339Nano).
  private static func date(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: text) {
      return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
  }

  /// CallKit's id for a call, the same for every push about it (a retried invite, its end) and across launches:
  /// `call_id` itself when it is a UUID (the app makes them so), else one derived from it (the server allows any id
  /// up to 64 characters), as a version-5-shaped UUID of its SHA-256.
  static func callKitId(_ callId: String) -> UUID {
    if let uuid = UUID(uuidString: callId) {
      return uuid
    }
    var b = Array(SHA256.hash(data: Data(callId.utf8)).prefix(16))
    b[6] = (b[6] & 0x0F) | 0x50
    b[8] = (b[8] & 0x3F) | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
  }
}
