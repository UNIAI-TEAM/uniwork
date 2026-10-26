// The app's entry. The bundle's start time is read first (data/perf/boot-clock.ts:
// the "js-boot" startup mark of a measured build). The call tasks and the outbox's
// drain task register before expo-router loads the screens, so a headless runtime
// (an Android call push, a Decline while UniChat is closed, the outbox's drain job;
// data/calls/call-wiring.ts, data/outbox-drain/background-send.ts) or an iOS
// background launch has them too.
import "./data/perf/boot-clock";
import "./data/calls/background-tasks";
import "./data/outbox-drain/background-tasks";
import "expo-router/entry";
