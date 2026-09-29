# 0025 — Office desktop host: Electron boundary and typed IPC

**Trạng thái:** accepted (2026-09-29, G4-D2; UNI-830)
**Issue:** UNI-830 · **Liên quan:** UNI-636, G4-01a, G4-02a
**Nguồn:** [Office desktop specification](../superpowers/specs/2026-09-27-office-g4-desktop-design.md) §7;
G4-D1/G4-D2 decided by the product owner on 2026-09-29 (Office G3-G4 run
decision record; UNI-830 comment), and the
[identity manifest input](../office/g3g4/desktop-identity-manifest.proposed.json);
[engine runtime ADR](0021-runtime-engine-office-da-dinh-dang.md).

## Bối cảnh

UniWork Office needs a native window for desktop workflows while retaining the
same engine and shared views as the web host. The upstream inventory is
provenance only; copying its shell or identity would create an unreviewed
privileged surface and could share caches, schemes, or update feeds with a
different product. G4-D2 therefore requires a new host with an explicit
main/preload/renderer boundary before native login, local I/O, deep links, or
packaging are added by later tasks.

## Quyết định

Build `@uniwork/office-desktop` as an Electron-shaped host scaffold from the
trusted G2 engine pin. The main process owns window policy, OS adapters, and
typed IPC validation. The preload exposes only the closed channel allowlist;
the renderer runs with `sandbox: true`, `contextIsolation: true`, and
`nodeIntegration: false`, and receives runtime, navigation, and transport
through adapters. The renderer and preload import only shared contracts and
their own graph; `scripts/office/check-boundaries.mjs` checks this graph.

IPC requests are schema-checked, capped at 64 KiB, and bound to the expected
sender id, frame id, application origin, and current session generation. The
allowlist contains bootstrap, engine operation, and approved external-browser
operations only. It has no generic filesystem, process, or HTTP proxy channel;
filesystem and credentials remain opaque host handles owned by later tasks.
Navigation and `window.open` are denied by default. External URLs require
`https:` and an exact host allowlist before an injected system-browser adapter
may open them.

The identity fields used by this scaffold match the G4-D1 subset accepted in
the decision record: `com.uniwork.office`, schemes `uniwork-office`,
`uniwork-office-app`, `uniwork-office-preview`, and `uniwork-office-asset`,
with user-data namespaces `uniwork-office` and `uniwork-office-dev`. The
current build and package outputs are explicitly unsigned development
artifacts; signing, update feeds, native credentials, local drafts, deep
links, telemetry, and editor implementations remain later scope.

## Hệ quả

The scaffold can be built and started without a native display, which makes
the security policy and IPC contract unit-testable in CI. Native Electron
wiring attaches through the bootstrap slots without changing shared core or
engine code. A renderer import of Node, Electron, or the main graph fails the
canonical boundary checker, and governance keeps the ADR/index and package
entry points reviewable. The placeholder shell is evidence of host startup,
not a claim that six editors or cloud login are complete.

## Trạng thái

`accepted` (2026-09-29, G4-D2 decision; unsigned development host only).
