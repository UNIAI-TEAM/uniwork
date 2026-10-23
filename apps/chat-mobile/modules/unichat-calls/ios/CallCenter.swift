import AVFoundation
import CallKit
import Foundation
import PushKit

/// UniChat's calls on iOS (docs/adr/0038): the PushKit registry (the VoIP token, the VoIP pushes) and CallKit's provider
/// (the system's incoming-call screen, Answer, Decline, the in-call screen). Small and without policy: who rings, who is
/// told and how a call joins is JavaScript's (data/calls/native-call-session.ts, data/calls/call-session.ts).
///
/// - Every VoIP push is reported to CallKit before PushKit's completion is called, whatever it holds: iOS ends an app
///   that does not, and stops delivering its VoIP pushes. An end, an invite that already rang out, a call already
///   reported or a payload that is not ours is reported too, and ended at once (or left to the call it repeats).
/// - Answer, Decline and the in-call End on CallKit's screens go to JavaScript as events ("answered", "declined",
///   "ended"); events from before JavaScript listens (a closed app launched by the push) wait in `pending`. An answer
///   or end the app itself asked for (answer(callId:) and end(callId:)) is not echoed back.
/// - JavaScript takes a call CallKit answered by answering it too (answer(callId:), when its call engine starts to
///   connect it). One it never takes is given up after `takeWindow`, and an end push takes it down until then: a VoIP
///   launch of a closed app may connect no scene, and with scene support React Native starts only in one, so nothing
///   may be there to join the call.
/// - The audio session: configured for a call when CallKit's answer is performed, and its activation handed to
///   JavaScript ("audio"), which tells WebRTC (RTCAudioSession.audioSessionDidActivate) before LiveKit takes it.
///
/// Created on the main queue at launch (UniChatCallsAppDelegateSubscriber), only in a build that declares the `voip`
/// background mode (UNICHAT_IOS_CALLS=1, plugins/with-unichat-calls.js): in any other build nothing here runs.
/// PushKit and CallKit call back on the main queue; JavaScript's synchronous reads come from its own thread, so the
/// state they read is kept under `lock` (hence `@unchecked Sendable`: the lock and the main queue are the checks).
final class CallCenter: NSObject, @unchecked Sendable {
  static let shared = CallCenter()

  /// A call CallKit knows about, by its CallKit id.
  private struct TrackedCall {
    let push: VoipCallPush
    var answered = false
    /// The app asked CallKit to answer or end it: CallKit's action is not told to JavaScript again.
    var answeredByApp = false
    var endedByApp = false
    /// JavaScript's call engine took it (answer(callId:)): it joins the call, and ends it when it is over.
    var taken = false
  }

  /// What becomes of a push once CallKit has it.
  private enum Outcome {
    /// A new invite: it rings until it is answered, declined, ended or rings out.
    case ring
    /// About a call this phone already holds: a retried invite, or the end of the ring of a call answered here (the
    /// server sends it to the iPhone that answered too): the call goes on.
    case keep
    /// Reported only because iOS demands it, and ended at once.
    case end(CXCallEndedReason)
  }

  /// Events waiting for JavaScript; a launch that never loads it must not grow this for ever.
  private static let pendingCap = 32
  /// Calls that ended here, newest last: a retried invite of one rings no more.
  private static let endedCap = 64
  /// How long a call CallKit answered waits for JavaScript to take it: the app's launch, the session's restore and the
  /// call's room, before the engine's own 20 s to connect (VOICE_CALL_CONNECTING_TIMEOUT_MS) start.
  static let takeWindow: TimeInterval = 30

  private let lock = NSLock()
  private var started = false
  private var token: String?
  private var calls: [UUID: TrackedCall] = [:]
  private var answeredCalls = Set<String>()
  private var endedCalls: [String] = []
  private var pending: [[String: Any]] = []
  private var held = false
  private var sink: (([String: Any]) -> Void)?

  // Main queue only.
  private var provider: CXProvider?
  private var registry: PKPushRegistry?
  private let controller = CXCallController()

  /// The build declares the `voip` background mode: it is one with calls, and iOS will deliver VoIP pushes to it.
  static var declared: Bool {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    return modes.contains("voip")
  }

  private static var appName: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
      ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
      ?? "UniChat"
  }

  // MARK: - Lifecycle (main queue)

  func start() {
    guard CallCenter.declared, !isStarted else {
      return
    }
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = true
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    // A workspace call is not a phone call: it stays out of the Phone app's Recents.
    configuration.includesCallsInRecents = false
    let provider = CXProvider(configuration: configuration)
    provider.setDelegate(self, queue: nil)
    self.provider = provider

    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry

    lock.lock()
    started = true
    lock.unlock()
  }

  var isStarted: Bool {
    lock.lock()
    defer { lock.unlock() }
    return started
  }

  // MARK: - JavaScript's reads (any thread)

  var voipToken: String? {
    lock.lock()
    defer { lock.unlock() }
    return token
  }

  /// CallKit rings a call the person has not answered: the app's own ringer stays quiet.
  var isRinging: Bool {
    lock.lock()
    defer { lock.unlock() }
    return calls.values.contains { !$0.answered }
  }

  var isHeld: Bool {
    lock.lock()
    defer { lock.unlock() }
    return held
  }

  /// True once for a call CallKit's Answer answered (not the app): only that event, never a link, answers a call.
  func takeAnswered(_ callId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return answeredCalls.remove(callId) != nil
  }

  func takePending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    let taken = pending
    pending = []
    return taken
  }

  /// JavaScript listens (the module's OnStartObserving) or stops (nil).
  func attach(_ sink: (([String: Any]) -> Void)?) {
    lock.lock()
    self.sink = sink
    lock.unlock()
  }

  // MARK: - The app's requests (main queue)

  /// The app's call engine took a call CallKit also rings or answered: answered in the app, CallKit answers it too, and
  /// activates the audio; answered on CallKit, the call is JavaScript's now (`taken`).
  func answer(callId: String) {
    guard let found = find(callId) else {
      return
    }
    let id = found.id
    update(id) { $0.taken = true }
    guard !found.call.answered, !found.call.answeredByApp else {
      return
    }
    update(id) { $0.answeredByApp = true }
    controller.request(CXTransaction(action: CXAnswerCallAction(call: id))) { _ in }
  }

  /// The call is over for this phone (declined in the app, hung up, ended by the others): CallKit's screen goes.
  func end(callId: String) {
    guard let id = find(callId)?.id else {
      return
    }
    update(id) { $0.endedByApp = true }
    controller.request(CXTransaction(action: CXEndCallAction(call: id))) { [weak self] error in
      guard error != nil else {
        return
      }
      // CallKit refused the local end (it no longer holds the call): report it ended instead.
      DispatchQueue.main.async {
        self?.provider?.reportCall(with: id, endedAt: nil, reason: .remoteEnded)
        _ = self?.untrack(id)
      }
    }
  }

  // MARK: - State helpers

  private func find(_ callId: String) -> (id: UUID, call: TrackedCall)? {
    let id = VoipCallPush.callKitId(callId)
    return tracked(id).map { (id: id, call: $0) }
  }

  private func tracked(_ id: UUID) -> TrackedCall? {
    lock.lock()
    defer { lock.unlock() }
    return calls[id]
  }

  private func track(_ id: UUID, _ push: VoipCallPush) {
    lock.lock()
    calls[id] = TrackedCall(push: push)
    lock.unlock()
  }

  private func update(_ id: UUID, _ change: (inout TrackedCall) -> Void) {
    lock.lock()
    if var call = calls[id] {
      change(&call)
      calls[id] = call
    }
    lock.unlock()
  }

  /// Forgets a call CallKit no longer holds, and remembers that it ended.
  private func untrack(_ id: UUID) -> TrackedCall? {
    lock.lock()
    defer { lock.unlock() }
    let call = calls.removeValue(forKey: id)
    if let callId = call?.push.callId {
      rememberEnded(callId)
    }
    return call
  }

  /// Under `lock`.
  private func rememberEnded(_ callId: String) {
    endedCalls.removeAll { $0 == callId }
    endedCalls.append(callId)
    if endedCalls.count > CallCenter.endedCap {
      endedCalls.removeFirst(endedCalls.count - CallCenter.endedCap)
    }
  }

  private func hasEnded(_ callId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return endedCalls.contains(callId)
  }

  /// To JavaScript now, or kept for it (`queued`) until it listens. A token is never kept: JavaScript reads the
  /// current one when it starts.
  private func emit(_ event: [String: Any], queued: Bool = true) {
    lock.lock()
    let sink = self.sink
    if sink == nil && queued {
      pending.append(event)
      if pending.count > CallCenter.pendingCap {
        pending.removeFirst(pending.count - CallCenter.pendingCap)
      }
    }
    lock.unlock()
    sink?(event)
  }

  private func callEvent(_ type: String, _ push: VoipCallPush) -> [String: Any] {
    var event = push.fields
    event["type"] = type
    return event
  }

  /// A call CallKit answered and let go before JavaScript took it: JavaScript must not join it later (its answer, waiting
  /// or not yet taken, is withdrawn) and hears it ended, which declines it to the server (data/calls/call-session.ts).
  private func abandoned(_ call: TrackedCall) {
    lock.lock()
    answeredCalls.remove(call.push.callId)
    pending.removeAll { ($0["type"] as? String) == "answered" && ($0["callId"] as? String) == call.push.callId }
    lock.unlock()
    emit(callEvent("ended", call.push))
  }

  // MARK: - Reporting a push (main queue)

  private func report(_ push: VoipCallPush?, completion: @escaping () -> Void) {
    guard let provider else {
      completion()
      return
    }
    let id = push.map { VoipCallPush.callKitId($0.callId) } ?? UUID()
    let outcome = decide(push, held: tracked(id), now: Date())
    if case .ring = outcome, let push {
      track(id, push)
    }

    let callUpdate = CXCallUpdate()
    let name = push?.callerName ?? ""
    let roomId = push?.roomId ?? ""
    callUpdate.localizedCallerName = name.isEmpty ? CallCenter.appName : name
    callUpdate.remoteHandle = CXHandle(type: .generic, value: roomId.isEmpty ? CallCenter.appName : roomId)
    callUpdate.hasVideo = push?.video ?? false
    callUpdate.supportsHolding = true
    callUpdate.supportsGrouping = false
    callUpdate.supportsUngrouping = false
    callUpdate.supportsDTMF = false

    // A call CallKit already holds answers this with callUUIDAlreadyExists, and goes on as it was: the report is
    // still made, which is what iOS checks.
    provider.reportNewIncomingCall(with: id, update: callUpdate) { [weak self] error in
      DispatchQueue.main.async {
        self?.reported(id, push: push, outcome: outcome, error: error)
        completion()
      }
    }
    // Reported only because iOS demands it (an end for a call this phone no longer rings, a late invite): ended in the
    // same turn, so the incoming-call screen the report would show does not get to. Waiting for the report's
    // completion would leave it lit for as long as CallKit takes to answer.
    if case .end(let reason) = outcome {
      provider.reportCall(with: id, endedAt: nil, reason: reason)
      forget(id, push: push)
    }
  }

  private func decide(_ push: VoipCallPush?, held: TrackedCall?, now: Date) -> Outcome {
    guard let push else {
      return .end(.failed)
    }
    if let held {
      // Answered here: JavaScript's to end once it took it (the server sends no end to the session that answered); an
      // end before then is the call's (the caller hung up, another device answered first).
      if held.answered {
        return held.taken || push.kind != .end ? .keep : .end(push.endedReason)
      }
      if push.kind == .end {
        return .end(push.endedReason)
      }
      return push.ringing(at: now) ? .keep : .end(.unanswered)
    }
    if push.kind == .end {
      return .end(push.endedReason)
    }
    if hasEnded(push.callId) {
      return .end(.remoteEnded)
    }
    return push.ringing(at: now) ? .ring : .end(.unanswered)
  }

  /// A call ended at its report: CallKit holds it no more, and a retried invite of it rings no more.
  private func forget(_ id: UUID, push: VoipCallPush?) {
    guard let call = untrack(id) else {
      if let callId = push?.callId {
        lock.lock()
        rememberEnded(callId)
        lock.unlock()
      }
      return
    }
    if call.answered {
      abandoned(call)
    }
  }

  /// After CallKit took the report: a new invite rings until it rings out.
  private func reported(_ id: UUID, push: VoipCallPush?, outcome: Outcome, error: Error?) {
    switch outcome {
    case .ring:
      if error != nil {
        // Do Not Disturb, a blocked caller or a call limit: CallKit shows nothing, and nothing is left to end.
        _ = untrack(id)
        return
      }
      let delay = max(0, (push?.expiresAt ?? Date()).timeIntervalSinceNow)
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.ringOut(id)
      }
    case .keep:
      return
    case .end(let reason):
      // Ended already as it was reported (report()); again, in case CallKit took the report after that end. Ending a
      // call CallKit no longer holds changes nothing.
      provider?.reportCall(with: id, endedAt: nil, reason: reason)
    }
  }

  /// The invite's ring window passed with no answer and no end push (one lost on the way).
  private func ringOut(_ id: UUID) {
    guard let call = tracked(id), !call.answered else {
      return
    }
    provider?.reportCall(with: id, endedAt: nil, reason: .unanswered)
    _ = untrack(id)
  }

  /// CallKit answered a call JavaScript has not taken in `takeWindow`: no app joins it, so CallKit lets it go.
  private func giveUp(_ id: UUID) {
    guard let call = tracked(id), call.answered, !call.taken else {
      return
    }
    provider?.reportCall(with: id, endedAt: nil, reason: .failed)
    _ = untrack(id)
    abandoned(call)
  }

  /// CallKit's audio for a call: voice through the earpiece (video through the speaker), Bluetooth headsets allowed.
  /// LiveKit applies its own configuration when the call connects (components/calls/call-room.tsx).
  private func configureAudioSession(video: Bool) {
    #if swift(>=6.2)
    let bluetooth: AVAudioSession.CategoryOptions = [.allowBluetoothHFP, .allowBluetoothA2DP]
    #else
    let bluetooth: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
    #endif
    let options = video ? bluetooth.union(.defaultToSpeaker) : bluetooth
    try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: video ? .videoChat : .voiceChat, options: options)
  }
}

// MARK: - PushKit

extension CallCenter: PKPushRegistryDelegate {
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else {
      return
    }
    let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    lock.lock()
    token = hex
    lock.unlock()
    emit(["type": "token", "token": hex], queued: false)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else {
      return
    }
    lock.lock()
    token = nil
    lock.unlock()
    emit(["type": "token", "token": ""], queued: false)
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    report(VoipCallPush(payload.dictionaryPayload), completion: completion)
  }
}

// MARK: - CallKit

extension CallCenter: CXProviderDelegate {
  /// CallKit dropped every call (the system reset the provider): a call under way is over for JavaScript too.
  func providerDidReset(_ provider: CXProvider) {
    lock.lock()
    let dropped = calls.values.filter { $0.answered && !$0.endedByApp }
    for call in calls.values {
      rememberEnded(call.push.callId)
    }
    calls.removeAll()
    held = false
    lock.unlock()
    for call in dropped {
      emit(callEvent("ended", call.push))
    }
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let call = tracked(action.callUUID) else {
      action.fail()
      return
    }
    configureAudioSession(video: call.push.video)
    update(action.callUUID) { $0.answered = true }
    if !call.answeredByApp {
      lock.lock()
      answeredCalls.insert(call.push.callId)
      lock.unlock()
      emit(callEvent("answered", call.push))
      let id = action.callUUID
      DispatchQueue.main.asyncAfter(deadline: .now() + CallCenter.takeWindow) { [weak self] in
        self?.giveUp(id)
      }
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    if let call = untrack(action.callUUID), !call.endedByApp {
      emit(callEvent(call.answered ? "ended" : "declined", call.push))
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    guard let call = tracked(action.callUUID) else {
      action.fail()
      return
    }
    emit(["type": "muted", "callId": call.push.callId, "muted": action.isMuted])
    action.fulfill()
  }

  /// Another call (the phone's own) took the line, or gave it back.
  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    guard let call = tracked(action.callUUID) else {
      action.fail()
      return
    }
    lock.lock()
    held = action.isOnHold
    lock.unlock()
    emit(["type": "held", "callId": call.push.callId, "held": action.isOnHold])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    emit(["type": "audio", "active": true])
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    lock.lock()
    held = false
    lock.unlock()
    emit(["type": "audio", "active": false])
  }
}
