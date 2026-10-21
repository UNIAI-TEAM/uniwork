// The app's entry. The call tasks register before expo-router loads the
// screens, so a headless runtime (an Android call push or a Decline while
// UniChat is closed; data/calls/call-wiring.ts) has them too.
import "./data/calls/background-tasks";
import "expo-router/entry";
