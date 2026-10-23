// The app's entry. The bundle's start time is read first (data/perf/boot-clock.ts:
// the "js-boot" startup mark of a measured build). The call tasks register before
// expo-router loads the screens, so a headless runtime (an Android call push or a
// Decline while UniChat is closed; data/calls/call-wiring.ts) has them too.
import "./data/perf/boot-clock";
import "./data/calls/background-tasks";
import "expo-router/entry";
